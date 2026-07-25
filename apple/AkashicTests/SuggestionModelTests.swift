import XCTest
@testable import Akashic

/// Assisted creation §6 — the suggestion state machine. Register/accept/dismiss idempotence and
/// accept-all, plus the coordinator applying accepted payloads onto a draft by day identity.
final class SuggestionModelTests: XCTestCase {

    // MARK: Pure model

    func testRegisterIsIdempotentAndPreservesOrder() {
        var m = SuggestionModel()
        m.register(.routeFromPhotos)
        m.register(.country)
        m.register(.routeFromPhotos)   // no-op
        XCTAssertEqual(m.pending, [.routeFromPhotos, .country])
    }

    func testAcceptIsIdempotent() {
        var m = SuggestionModel()
        m.register(.country)
        XCTAssertTrue(m.accept(.country))
        XCTAssertFalse(m.accept(.country), "second accept is a no-op")
        XCTAssertEqual(m.statusOf(.country), .accepted)
        XCTAssertFalse(m.hasPending)
    }

    func testDismissIsIdempotentAndBlocksLaterAccept() {
        var m = SuggestionModel()
        m.register(.country)
        XCTAssertTrue(m.dismiss(.country))
        XCTAssertFalse(m.dismiss(.country))
        XCTAssertFalse(m.accept(.country), "a dismissed suggestion cannot be accepted")
        XCTAssertEqual(m.statusOf(.country), .dismissed)
    }

    func testReRegisterDoesNotResurrectDismissed() {
        var m = SuggestionModel()
        m.register(.country)
        _ = m.dismiss(.country)
        m.register(.country)   // a re-run must not bring it back
        XCTAssertEqual(m.statusOf(.country), .dismissed)
        XCTAssertFalse(m.hasPending)
    }

    func testAcceptAllTransitionsPendingOnly() {
        var m = SuggestionModel()
        m.register(.routeFromPhotos)
        m.register(.country)
        m.register(.campName(dayID: "d1"))
        _ = m.dismiss(.country)                 // already terminal
        let accepted = m.acceptAllPending()
        XCTAssertEqual(Set(accepted), Set([.routeFromPhotos, .campName(dayID: "d1")]))
        XCTAssertFalse(m.hasPending)
        XCTAssertEqual(m.acceptAllPending(), [], "second accept-all does nothing")
        XCTAssertEqual(m.statusOf(.country), .dismissed)
    }

    // MARK: Coordinator application (with fakes)

    private struct StubGeocoder: ReverseGeocoding {
        func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace? {
            GeocodedPlace(countryName: "Tanzania", areaOfInterest: "Barafu Camp")
        }
    }
    private struct StubSearch: LocalPOISearching {
        func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult] {
            [LocalSearchResult(name: "Uhuru Peak", category: "summit", coordinate: [37.35, -3.07])]
        }
    }
    private struct StubWeather: HistoricalWeatherProviding {
        func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? {
            WeatherData(temperatureMax: 10, temperatureMin: 0, precipitationSum: 1, windSpeedMax: 12, weatherCode: 2)
        }
    }

    @MainActor
    private func coordinator() -> JourneySuggestionCoordinator {
        JourneySuggestionCoordinator(
            place: PlaceEnrichment(geocoder: StubGeocoder(), search: StubSearch(), interCallDelayNanos: 0),
            weather: WeatherEnrichment(provider: StubWeather(), interCallDelayNanos: 0),
            factsEnabled: false)   // keep FoundationModels out of the deterministic test
    }

    @MainActor
    func testCoordinatorRegistersAndAppliesSuggestions() async {
        var draft = JourneyDraft(name: "Kili")
        draft.dateStarted = Date(timeIntervalSince1970: 1_695_945_600)   // gives the day a real date for weather
        draft.days = [
            DraftDay(name: "Day 1", coordinates: [37.30, -3.10], source: .photoCluster),
        ]
        let coord = coordinator()
        // A geotagged fix so route-from-photos also appears.
        let fix = PhotoFix(coordinate: [37.30, -3.10], timestamp: Date(timeIntervalSince1970: 1_695_960_000))
        await coord.run(fixes: [fix], draft: draft)

        // C3: route-from-photos is a STRUCTURAL suggestion — it lives in `routeFromPhotosState`, not
        // the enrichment `model`, and is never an Accept row (see `testRouteFromPhotosAppliesDirectly...`
        // below for its own dedicated coverage).
        XCTAssertTrue(coord.routeFromPhotosState.isPending(.routeFromPhotos))
        XCTAssertFalse(coord.model.isPending(.routeFromPhotos), "never offered as an Accept row")
        XCTAssertTrue(coord.model.isPending(.country))
        XCTAssertTrue(coord.model.isPending(.campName(dayID: draft.days[0].id)))
        XCTAssertTrue(coord.model.isPending(.weather(dayID: draft.days[0].id)))
        XCTAssertTrue(coord.model.isPending(.pois(dayID: draft.days[0].id)))

        // Accept-all lands every ENRICHMENT value on the draft (country here still goes through the
        // ordinary Accept-row path at the `SuggestionModel` level — it's `NewJourneySheet` that chooses
        // to auto-accept it instead of waiting for a tap; the coordinator itself doesn't care which).
        coord.acceptAll(into: &draft)
        XCTAssertEqual(draft.country, "Tanzania")
        XCTAssertEqual(draft.days[0].name, "Barafu Camp")
        XCTAssertEqual(draft.days[0].weather?.weatherCode, 2)
        XCTAssertEqual(draft.days[0].pointsOfInterest?.first?.name, "Uhuru Peak")
        XCTAssertFalse(coord.model.hasPending)

        // The route only lands once `applyRouteFromPhotos` is called — the structural counterpart to
        // `acceptAll` for the one suggestion that isn't in `model`.
        XCTAssertNil(draft.route)
        XCTAssertTrue(coord.applyRouteFromPhotos(into: &draft))
        XCTAssertFalse(draft.route?.coordinates.isEmpty ?? true)
    }

    @MainActor
    func testCampNameNotAppliedToHandEditedDay() async {
        var draft = JourneyDraft(name: "Kili")
        draft.days = [DraftDay(name: "Summit push", coordinates: [37.30, -3.10], source: .photoCluster)]
        let coord = coordinator()
        await coord.run(fixes: [], draft: draft)
        // No camp-name suggestion for a hand-named day, so nothing to accept there.
        XCTAssertFalse(coord.model.isPending(.campName(dayID: draft.days[0].id)))
    }

    // MARK: - C3: route-from-photos applied directly, and permanently gone once removed

    @MainActor
    func testRouteFromPhotosAppliesDirectlyWithoutAnAcceptRow() async {
        var draft = JourneyDraft(name: "Kili")
        let coord = coordinator()
        let fix = PhotoFix(coordinate: [37.30, -3.10], timestamp: Date(timeIntervalSince1970: 1_695_960_000))
        await coord.run(fixes: [fix], draft: draft)

        XCTAssertNil(draft.route, "not applied until the caller calls applyRouteFromPhotos")
        XCTAssertTrue(coord.applyRouteFromPhotos(into: &draft))
        XCTAssertFalse(draft.route?.coordinates.isEmpty ?? true)
        // Calling again is a no-op (idempotent) — it doesn't, say, duplicate or reset the route.
        let appliedRoute = draft.route
        XCTAssertFalse(coord.applyRouteFromPhotos(into: &draft))
        XCTAssertEqual(draft.route, appliedRoute)
    }

    @MainActor
    func testRemovedRouteFromPhotosNeverReappliesOnLaterRerun() async {
        var draft = JourneyDraft(name: "Kili")
        let coord = coordinator()
        let fix = PhotoFix(coordinate: [37.30, -3.10], timestamp: Date(timeIntervalSince1970: 1_695_960_000))
        await coord.run(fixes: [fix], draft: draft)
        XCTAssertTrue(coord.applyRouteFromPhotos(into: &draft))
        XCTAssertNotNil(draft.route)

        // The user taps Remove.
        coord.removeRouteFromPhotos(from: &draft)
        XCTAssertNil(draft.route)
        XCTAssertEqual(coord.routeFromPhotosState.statusOf(.routeFromPhotos), .dismissed)

        // A later suggestion re-run (e.g. picking MORE photos) must not resurrect it, even though
        // `draft.hasRoute` is false again (the guard `run()` uses to decide whether to re-infer).
        let secondFix = PhotoFix(coordinate: [37.31, -3.11], timestamp: Date(timeIntervalSince1970: 1_695_970_000))
        await coord.run(fixes: [fix, secondFix], draft: draft)
        XCTAssertFalse(coord.applyRouteFromPhotos(into: &draft), "removed — must stay removed")
        XCTAssertNil(draft.route)
        XCTAssertEqual(coord.routeFromPhotosState.statusOf(.routeFromPhotos), .dismissed,
                       "register() on a re-run is a no-op for an already-dismissed key")
    }
}
