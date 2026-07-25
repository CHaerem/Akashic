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

        XCTAssertTrue(coord.model.isPending(.routeFromPhotos))
        XCTAssertTrue(coord.model.isPending(.country))
        XCTAssertTrue(coord.model.isPending(.campName(dayID: draft.days[0].id)))
        XCTAssertTrue(coord.model.isPending(.weather(dayID: draft.days[0].id)))
        XCTAssertTrue(coord.model.isPending(.pois(dayID: draft.days[0].id)))

        // Accept-all lands every value on the draft.
        coord.acceptAll(into: &draft)
        XCTAssertEqual(draft.country, "Tanzania")
        XCTAssertEqual(draft.days[0].name, "Barafu Camp")
        XCTAssertEqual(draft.days[0].weather?.weatherCode, 2)
        XCTAssertEqual(draft.days[0].pointsOfInterest?.first?.name, "Uhuru Peak")
        XCTAssertFalse(draft.route?.coordinates.isEmpty ?? true)
        XCTAssertFalse(coord.model.hasPending)
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
}
