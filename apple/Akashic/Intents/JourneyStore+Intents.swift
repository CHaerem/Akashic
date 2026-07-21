import Foundation

// MARK: - Store-backed query surface for App Intents
//
// The intents run through `JourneyStore` (which reads via `PersistenceController`), never
// straight to Core Data — the same abstraction CloudKit will populate later. These wrappers
// just apply the pure `JourneyQuery` engine to the store's current journeys.

@MainActor
extension JourneyStore {
    func listResult(limit: Int?, offset: Int?, country: String?) -> JourneyListResult {
        JourneyQuery.list(journeys, limit: limit, offset: offset, country: country)
    }

    func searchOutcome(query: String, limit: Int?) -> JourneyQuery.Outcome<JourneySearchResult> {
        JourneyQuery.search(journeys, query: query, limit: limit)
    }

    func detailsOutcome(idOrSlug: String) -> JourneyQuery.Outcome<JourneyDetailsResult> {
        JourneyQuery.details(journeys, idOrSlug: idOrSlug)
    }

    func statsOutcome(idOrSlug: String) -> JourneyQuery.Outcome<JourneyStatsResult> {
        JourneyQuery.stats(journeys, idOrSlug: idOrSlug)
    }

    func photosOutcome(idOrSlug: String, waypointId: String?, limit: Int?) -> JourneyQuery.Outcome<JourneyPhotosResult> {
        JourneyQuery.photos(journeys, idOrSlug: idOrSlug, waypointId: waypointId, limit: limit)
    }
}

/// Shared, main-actor store the App Intents and `JourneyEntityQuery` read from.
///
/// App Intents can be invoked while the app UI is not running (Siri / Shortcuts), so they
/// cannot rely on the `@main` app's `@StateObject`. This cached store reads
/// `PersistenceController.shared` (Fixtures today, CloudKit later). `refreshed()` re-reads the
/// underlying store so intents reflect the latest data.
@MainActor
enum AkashicIntentData {
    static let store = JourneyStore()

    static func refreshed() -> JourneyStore {
        store.reload()
        return store
    }
}
