import SwiftUI

/// A deterministic host for capturing `JourneyExportSheet` (SHIP-03, shot 6 — the "no lock-in"
/// trust shot), reached with:
///
///   AKASHIC_SCREEN=exportsheet [AKASHIC_EXPORT_JOURNEY=<journey id or slug>]
///
/// Why a harness rather than navigating to it: the sheet's only route in the app is
/// Explore → Journeys → a journey → the overflow menu → "Export journey", and `xcrun simctl` has
/// no way to inject those taps. A capture run therefore either drives the simulator by hand every
/// release or presents the sheet directly — the same trade-off `EditScreenshotHarness` already
/// resolved the same way for the four editing sheets.
///
/// Deliberately presents the sheet in its **idle** state: that is the state carrying the message
/// the shot is for ("A .zip containing route.gpx, journey.json and the photos. Everything opens
/// without Akashic."), whereas the finished state has already replaced it with a photo count.
///
/// The backdrop is the real `JourneyDetailView` the sheet is reached from, and the sheet sits at
/// the `.medium` detent over it — the sheet's own content is only a toggle and a button, so a
/// full-height presentation over a placeholder leaves two thirds of the frame empty.
struct ExportScreenshotHarness: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence

    var body: some View {
        Group {
            if let journey = target {
                NavigationStack { JourneyDetailView(journey: journey) }
                    .sheet(isPresented: .constant(true)) {
                        JourneyExportSheet(journey: journey)
                            .environmentObject(store)
                            .environmentObject(entitlements)
                            .presentationDetents([.medium, .large])
                    }
            } else {
                Theme.background.ignoresSafeArea()
            }
        }
        .environmentObject(store)
        .environmentObject(entitlements)
        .environmentObject(intelligence)
    }

    /// The journey named by `AKASHIC_EXPORT_JOURNEY` (id or slug), else the one with the most
    /// photos — so the sheet has real media to report rather than an empty archive.
    private var target: Journey? {
        let key = ProcessInfo.processInfo.environment["AKASHIC_EXPORT_JOURNEY"]
        if let key, let match = store.journeys.first(where: { $0.id == key || $0.slug == key }) {
            return match
        }
        return store.journeys.max {
            store.photos(forJourneyID: $0.id).count < store.photos(forJourneyID: $1.id).count
        } ?? store.journeys.first
    }
}
