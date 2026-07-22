import SwiftUI
import CoreSpotlight

@main
struct AkashicApp: App {
    @StateObject private var store = JourneyStore()

    init() {
        // Demo/screenshot hook: force the on-disk `.local` store before the store is first
        // built (so the import persists and photos display). Gated on an env var, so normal
        // launches are unaffected.
        if ProcessInfo.processInfo.environment["AKASHIC_FORCE_LOCAL"] != nil {
            Config.setPersistenceModeOverride(.local)
        }
    }

    var body: some Scene {
        WindowGroup {
            rootScreen
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
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
