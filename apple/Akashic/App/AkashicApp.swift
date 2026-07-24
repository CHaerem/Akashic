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

    var body: some Scene {
        WindowGroup {
            rootScreen
                .environmentObject(store)
                .environmentObject(onboarding)
                .environmentObject(entitlements)
                .environmentObject(intelligence)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
                // First-run onboarding (§4.2): a full-screen cover shown once. The coordinator
                // owns the "show once" state (seeded from OnboardingState.shouldShow, which
                // honors AKASHIC_SKIP_ONBOARDING and no-ops under XCTest), and the "Replay intro"
                // Settings row re-presents through the same coordinator.
                .fullScreenCover(isPresented: $onboarding.isPresented) {
                    OnboardingView(onFinish: { onboarding.finish() })
                        .preferredColorScheme(.dark)
                }
                .task { await runLaunchImportIfRequested() }
                // Spotlight deep-link: tapping an indexed journey/day records the target so the
                // map can fly to it (see JourneyStore.pendingJourneySelection).
                .onContinueUserActivity(CSSearchableItemActionType) { activity in
                    if let journeyID = SpotlightIndexer.journeySelection(from: activity) {
                        store.requestJourneySelection(journeyID)
                    }
                }
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
