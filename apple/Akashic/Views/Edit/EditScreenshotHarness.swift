import SwiftUI

/// A deterministic host for capturing the editing sheets over real data. The photo picker
/// itself can't be driven headlessly, so screenshots present the *edit* sheets directly:
///
///   AKASHIC_SCREEN=editsheet AKASHIC_EDIT_SCREENSHOT=photo     — PhotoEditSheet (caption/assign)
///   AKASHIC_SCREEN=editsheet AKASHIC_EDIT_SCREENSHOT=waypoint  — WaypointEditSheet
///   AKASHIC_SCREEN=editsheet AKASHIC_EDIT_SCREENSHOT=journey   — JourneyEditSheet
///   AKASHIC_SCREEN=editsheet AKASHIC_EDIT_SCREENSHOT=import    — PhotoImportSheet
///
/// Combine with AKASHIC_FORCE_LOCAL=1 so it runs against the persisted `.local` store.
struct EditScreenshotHarness: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    let kind: String

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            VStack(spacing: 8) {
                Image(systemName: "slider.horizontal.3").font(.largeTitle).foregroundStyle(Theme.accentText)
                Text("Editing preview").foregroundStyle(Theme.textSecondary)
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: .constant(true)) { sheet }
    }

    /// Prefer the journey with the most photos so the photo editor has real media to show.
    private var richestJourney: Journey? {
        store.journeys.max { store.photos(forJourneyID: $0.id).count < store.photos(forJourneyID: $1.id).count }
            ?? store.journeys.first
    }

    @ViewBuilder
    private var sheet: some View {
        if let journey = richestJourney {
            switch kind {
            case "journey":
                JourneyEditSheet(journey: journey).environmentObject(store)
            case "waypoint":
                if let camp = journey.camps.first {
                    WaypointEditSheet(journeyID: journey.id, camp: camp)
                        .environmentObject(store)
                        .environmentObject(entitlements)
                        .environmentObject(intelligence)
                }
            case "import":
                PhotoImportSheet(journey: journey).environmentObject(store).environmentObject(entitlements)
            default: // "photo"
                if let photo = firstPhotoWithMedia(in: journey) {
                    PhotoEditSheet(photo: photo, journey: journey).environmentObject(store)
                }
            }
        }
    }

    private func firstPhotoWithMedia(in journey: Journey) -> Photo? {
        let photos = store.photos(forJourneyID: journey.id)
        return photos.first { $0.hasLocalMedia && !$0.isVideo } ?? photos.first
    }
}
