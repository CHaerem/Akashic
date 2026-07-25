import SwiftUI
import CoreSpotlight
import CloudKit

/// Receives CloudKit share invitations (T2.8).
///
/// When someone taps an Akashic share link, iOS launches the app and hands over the share
/// metadata here — there is no SwiftUI equivalent, so an app-delegate adaptor is the only
/// route. UIKit calls the scene variant first when a scene delegate implements it; SwiftUI's
/// own scene delegate does not, so this app-level method is the one that fires.
final class AkashicAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     userDidAcceptCloudKitShareWith metadata: CKShare.Metadata) {
        Task { @MainActor in
            await PersistenceController.shared.acceptShare(metadata)
        }
    }
}

@main
struct AkashicApp: App {
    @UIApplicationDelegateAdaptor(AkashicAppDelegate.self) private var appDelegate
    @StateObject private var store = JourneyStore()
    @StateObject private var onboarding = OnboardingCoordinator()
    @StateObject private var entitlements = EntitlementStore()
    // M6 — the on-device Intelligence gate (Foundation Models). Probes availability once at
    // construction; the whole feature family is absent (not broken) when it reports unavailable.
    @StateObject private var intelligence = Intelligence()

    /// Drives the on-foreground availability re-probe (see `.onChange` below).
    @Environment(\.scenePhase) private var scenePhase

    // C7 — opening a `.gpx` shared from Files, Mail, or any app that hands off to Akashic's
    // registered document type (see `project.yml`'s `CFBundleDocumentTypes` /
    // `UTImportedTypeDeclarations`, and `handleOpenedGPX` below). At most one of these three is
    // ever active: a successful parse populates `openedGPX` (driving the sheet), a parse failure
    // populates `openGPXAlertMessage` (driving the alert), and hitting the free-tier journey cap
    // sets `showOpenedGPXPaywall` instead of either. v1 always creates a NEW journey from the
    // opened file — attaching a route to an existing one already has a path in its own edit sheet.
    @State private var openedGPX: OpenedGPX?
    @State private var showOpenedGPXPaywall = false
    @State private var openGPXAlertMessage: String?

    /// Wraps a parsed file so `.sheet(item:)` has the `Identifiable` it needs — `GPXFile` itself
    /// carries no stable identity, and one wouldn't mean anything beyond this single hand-off.
    private struct OpenedGPX: Identifiable {
        let id = UUID()
        var file: GPXFile
        var suggestedName: String
    }

    init() {
        // Demo/screenshot hook: force the on-disk `.local` store before the store is first
        // built (so the import persists and photos display). Gated on an env var, so normal
        // launches are unaffected.
        if ProcessInfo.processInfo.environment["AKASHIC_FORCE_LOCAL"] != nil {
            Config.setPersistenceModeOverride(.local)
        }
        // Exports are transient: the file matters until it has been shared, and an archive of
        // a photo-heavy journey is gigabytes. Clearing at launch keeps them from accumulating.
        ExportWorkspace.purge()
    }

    /// A5 — Light / Dark / Automatic, chosen in Settings. Automatic (the default) means `nil`,
    /// i.e. no override at all.
    @AppStorage(AppearancePreference.storageKey) private var appearance: AppearancePreference = .automatic

    var body: some Scene {
        WindowGroup {
            rootScreen
                .environmentObject(store)
                .environmentObject(onboarding)
                .environmentObject(entitlements)
                .environmentObject(intelligence)
                // A3 (2026-07-25): the earlier "dark-only is deliberate" call is withdrawn — the
                // app now follows the system appearance like any other iOS app. `Theme.swift`
                // carries the light/dark adaptation, so removing this is safe rather than
                // cosmetic: nothing here was still relying on a fixed dark canvas.
                //
                // A5: ...unless the user has chosen otherwise in Settings. `nil` for Automatic
                // leaves the system in charge, which is the default — see `AppearancePreference`
                // for why a viewer app earns an override that most apps should not have.
                .preferredColorScheme(appearance.colorScheme)
                .tint(Theme.accent)
                // First-run onboarding (§4.2): a full-screen cover shown once. The coordinator
                // owns the "show once" state (seeded from OnboardingState.shouldShow, which
                // honors AKASHIC_SKIP_ONBOARDING and no-ops under XCTest), and the "Replay intro"
                // Settings row re-presents through the same coordinator.
                .fullScreenCover(isPresented: $onboarding.isPresented) {
                    OnboardingView(onFinish: { onboarding.finish() })
                }
                .task { await runLaunchImportIfRequested() }
                // Re-probe Intelligence availability on every return to the foreground: if the user
                // toggled Apple Intelligence off mid-session the entry points must go absent (not
                // become dead buttons that fail on tap), and if the model finished downloading the
                // feature must appear. `refresh()` was previously dead code with no caller.
                // (quality gate: Intelligence availability probed once at launch.)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { intelligence.refresh() }
                }
                // Spotlight deep-link: tapping an indexed journey/day records the target so the
                // map can fly to it (see JourneyStore.pendingJourneySelection).
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let journeyID = SpotlightIndexer.journeySelection(from: activity) {
                        store.requestJourneySelection(journeyID)
                    }
                }
                // C7: the system hands a `.gpx` here — from Files' "Share to Akashic", from a Mail
                // attachment's "Open in Akashic", from AirDrop, etc. — because `project.yml`
                // registers the type. CloudKit share links do NOT arrive here: they go through
                // `AkashicAppDelegate.application(_:userDidAcceptCloudKitShareWith:)` above instead,
                // so this handler is GPX-only.
                .onOpenURL { url in
                    Task { await handleOpenedGPX(url) }
                }
                .sheet(item: $openedGPX) { opened in
                    NewJourneySheet(preloadedGPX: opened.file, suggestedName: opened.suggestedName)
                        .environmentObject(store)
                        .environmentObject(entitlements)
                        .environmentObject(intelligence)
                }
                .sheet(isPresented: $showOpenedGPXPaywall) {
                    PaywallView(reason: .journeyLimit)
                        .environmentObject(entitlements)
                }
                .alert("Couldn't open this file",
                       isPresented: Binding(get: { openGPXAlertMessage != nil },
                                             set: { if !$0 { openGPXAlertMessage = nil } })) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(openGPXAlertMessage ?? "")
                }
        }
    }

    /// C7: security-scoped read (the URL comes from outside our sandbox) → parse off the main
    /// actor (`GPXParser.parseSecurityScoped` already `Task.detached`es the parse itself) → either
    /// present the review sheet or surface why not. Mirrors the two other creation entry points
    /// (`JourneyListView.startCreate`, `GlobeExperienceView.startCreate`): the paywall gate is
    /// checked before anything is presented, not discovered after the user has already reviewed a
    /// draft. A malformed file always surfaces as an alert and presents nothing — never a silent
    /// no-op that leaves the user wondering whether the share worked.
    ///
    /// Ignores the file entirely (rather than presenting anything) if a creation flow is already
    /// in progress — checked TWO ways: `openedGPX != nil` catches a second file arriving while
    /// THIS handler's own review sheet is still up (the `.sheet(item:)` below would otherwise just
    /// swap its item and silently discard whatever the user had already edited); `isPresentingJourneyCreation`
    /// catches the cross-view case, where `NewJourneySheet` is up because the user tapped "+" on
    /// the journey list or the globe instead — a sheet this view has no other way to see. Losing a
    /// user's in-progress draft to an incoming file neither queued nor merged with it would be
    /// worse than ignoring the file; the Share Sheet / Mail attachment that triggered this is still
    /// sitting right there for the user to reopen once they finish or cancel.
    @MainActor
    private func handleOpenedGPX(_ url: URL) async {
        guard openedGPX == nil, !store.isPresentingJourneyCreation else { return }
        do {
            let file = try await GPXParser.parseSecurityScoped(url)
            // Re-checked after the (async) parse: a creation flow could have started WHILE this
            // file was being parsed, and the same silent-discard risk applies just as much then.
            guard openedGPX == nil, !store.isPresentingJourneyCreation else { return }
            guard entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) else {
                showOpenedGPXPaywall = true
                return
            }
            openedGPX = OpenedGPX(file: file, suggestedName: file.name ?? "")
        } catch {
            openGPXAlertMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Normally the tab shell; screenshot hooks can deep-link straight to the import browser
    /// or a journey's photo grid without touching `RootView`.
    ///   AKASHIC_SCREEN=photos                         — imported-photos journey list
    ///   AKASHIC_SCREEN=photogrid + AKASHIC_PHOTOS_JOURNEY=<id> — that journey's thumbnail grid
    @ViewBuilder
    private var rootScreen: some View {
        let env = ProcessInfo.processInfo.environment
        switch env["AKASHIC_SCREEN"] {
        case "photos":
            NavigationStack { ImportBrowserView() }
        case "photogrid":
            NavigationStack { JourneyPhotosView(journeyID: env["AKASHIC_PHOTOS_JOURNEY"] ?? "") }
        case "editsheet":
            // Screenshot harness for the Phase 3 editing sheets (see EditScreenshotHarness).
            EditScreenshotHarness(kind: env["AKASHIC_EDIT_SCREENSHOT"] ?? "photo")
        case "widgets":
            // Debug harness that renders the WidgetKit views for screenshots (see WidgetGallery).
            WidgetGalleryHarness(snapshots: store.journeys.map { WidgetSnapshot.make(from: $0) })
        default:
            RootView()
        }
    }

    /// Scriptable import for the simulator demo:
    ///   AKASHIC_IMPORT_ON_LAUNCH=1  — run the local import at startup
    ///   AKASHIC_IMPORT_PATH=…       — export bundle path (default: Config.importBundlePath)
    ///   AKASHIC_MEDIA_ROOT=…        — media root (default: <bundle>/r2/objects)
    ///   AKASHIC_IMPORT_RESET=1      — clear the fixture seed first (clean 3-journey demo)
    private func runLaunchImportIfRequested() async {
        let env = ProcessInfo.processInfo.environment
        guard env["AKASHIC_IMPORT_ON_LAUNCH"] != nil else { return }
        let path = env["AKASHIC_IMPORT_PATH"] ?? Config.importBundlePath
        let media = env["AKASHIC_MEDIA_ROOT"] ?? Config.defaultMediaRoot(forBundlePath: path)
        let reset = env["AKASHIC_IMPORT_RESET"] != nil
        await store.runLocalImport(bundlePath: path, mediaRoot: media, reset: reset)
    }
}
