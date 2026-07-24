import XCTest
@testable import Akashic

/// Assisted creation §2 — place enrichment. Fakes stand in for CLGeocoder / MKLocalSearch so the
/// composition is deterministic: country from centroid, camp names only for auto-named days, and
/// de-duplicated POIs capped per day.
final class PlaceEnrichmentTests: XCTestCase {

    // MARK: Fakes

    private struct FakeGeocoder: ReverseGeocoding {
        var byRoundedKey: [String: GeocodedPlace] = [:]
        var fallback: GeocodedPlace?
        func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace? {
            byRoundedKey[Self.key(lng, lat)] ?? fallback
        }
        static func key(_ lng: Double, _ lat: Double) -> String {
            String(format: "%.2f,%.2f", lng, lat)
        }
    }

    private struct FakeSearch: LocalPOISearching {
        var results: [LocalSearchResult]
        func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult] {
            results
        }
    }

    private func enrichment(geocoder: ReverseGeocoding, search: LocalPOISearching) -> PlaceEnrichment {
        PlaceEnrichment(geocoder: geocoder, search: search, interCallDelayNanos: 0)
    }

    // MARK: Country

    func testSuggestsCountryFromCentroid() async {
        let geo = FakeGeocoder(fallback: GeocodedPlace(countryName: "Tanzania", countryCode: "TZ"))
        let e = enrichment(geocoder: geo, search: FakeSearch(results: []))
        let country = await e.suggestCountry(lng: 37.35, lat: -3.07)
        XCTAssertEqual(country, "Tanzania")
    }

    func testCountryNilWhenNothingResolves() async {
        let e = enrichment(geocoder: FakeGeocoder(), search: FakeSearch(results: []))
        let country = await e.suggestCountry(lng: 0, lat: 0)
        XCTAssertNil(country)
    }

    func testCentroidIsMeanOfCoordinates() throws {
        let c = try XCTUnwrap(PlaceEnrichment.centroid(of: [[0, 0], [2, 4], [4, 8]]))
        XCTAssertEqual(c[0], 2, accuracy: 1e-9)
        XCTAssertEqual(c[1], 4, accuracy: 1e-9)
        XCTAssertNil(PlaceEnrichment.centroid(of: []))
    }

    // MARK: Camp names

    func testCampNamesOnlyForAutoNamedDaysWithCoordinates() async {
        let geo = FakeGeocoder(
            byRoundedKey: [
                FakeGeocoder.key(37.00, -3.10): GeocodedPlace(areaOfInterest: "Barafu Camp"),
                FakeGeocoder.key(37.10, -3.10): GeocodedPlace(locality: "Moshi"),
            ])
        let e = enrichment(geocoder: geo, search: FakeSearch(results: []))
        let days = [
            DayEnrichmentInput(dayID: "d1", name: "Day 1", coordinate: [37.00, -3.10]),   // auto → suggest
            DayEnrichmentInput(dayID: "d2", name: "Summit push", coordinate: [37.10, -3.10]), // named → skip
            DayEnrichmentInput(dayID: "d3", name: "Day 3", coordinate: []),                // no coord → skip
        ]
        let suggestions = await e.suggestCampNames(for: days)
        XCTAssertEqual(suggestions.count, 1)
        XCTAssertEqual(suggestions.first?.dayID, "d1")
        XCTAssertEqual(suggestions.first?.name, "Barafu Camp")
    }

    func testBestLocalNamePrefersAreaOfInterest() {
        let place = GeocodedPlace(locality: "Moshi", administrativeArea: "Kilimanjaro",
                                  areaOfInterest: "Barafu Camp", name: "Trail")
        XCTAssertEqual(place.bestLocalName, "Barafu Camp")
        let onlyLocality = GeocodedPlace(locality: "Moshi")
        XCTAssertEqual(onlyLocality.bestLocalName, "Moshi")
    }

    // MARK: Day names worth keeping (preference order · nearby feature · consecutive de-dupe)

    /// Preference order: area of interest → nearby named feature → locality → region → name,
    /// case-insensitively de-duplicated.
    func testCampNameCandidatesPreferenceOrder() {
        let place = GeocodedPlace(locality: "Cuzco", administrativeArea: "Cusco",
                                  areaOfInterest: "Machu Picchu", name: "Cuzco")
        // With an area of interest present, it leads; the feature slot still ranks above locality.
        XCTAssertEqual(PlaceEnrichment.campNameCandidates(place: place, feature: "Wiñay Wayna"),
                       ["Machu Picchu", "Wiñay Wayna", "Cuzco", "Cusco"])
        // No area of interest: the nearby feature leads over the locality.
        let bare = GeocodedPlace(locality: "Cuzco", name: "Cuzco")
        XCTAssertEqual(PlaceEnrichment.campNameCandidates(place: bare, feature: "Sacsayhuamán"),
                       ["Sacsayhuamán", "Cuzco"])
        // No feature at all: locality is the honest fallback.
        XCTAssertEqual(PlaceEnrichment.campNameCandidates(place: bare, feature: nil), ["Cuzco"])
    }

    /// When the reverse-geocode has no area of interest, a nearby named feature beats the locality.
    func testCampNamesPreferNearbyFeatureOverLocality() async {
        let geo = FakeGeocoder(fallback: GeocodedPlace(locality: "Cuzco"))
        let search = FakeSearch(results: [
            LocalSearchResult(name: "Machu Picchu", category: "summit", coordinate: [-72.5450, -13.1631]),
        ])
        let e = enrichment(geocoder: geo, search: search)
        let days = [DayEnrichmentInput(dayID: "d1", name: "Day 1", coordinate: [-72.5450, -13.1631])]
        let out = await e.suggestCampNames(for: days)
        XCTAssertEqual(out.first?.name, "Machu Picchu")
    }

    /// Falls back to the locality when no named feature is nearby.
    func testCampNamesFallBackToLocalityWithoutFeature() async {
        let geo = FakeGeocoder(fallback: GeocodedPlace(locality: "Cuzco"))
        let e = enrichment(geocoder: geo, search: FakeSearch(results: []))   // no features found
        let days = [DayEnrichmentInput(dayID: "d1", name: "Day 1", coordinate: [-71.97, -13.53])]
        let out = await e.suggestCampNames(for: days)
        XCTAssertEqual(out.first?.name, "Cuzco")
    }

    /// The "Cuzco ×5" fix: consecutive auto-named days that all resolve to the same locality are not
    /// offered the same name five times — repeats are skipped.
    func testCampNamesDoNotRepeatPreviousDaysSuggestion() async {
        let geo = FakeGeocoder(fallback: GeocodedPlace(locality: "Cuzco"))
        let e = enrichment(geocoder: geo, search: FakeSearch(results: []))
        let days = (1...5).map { DayEnrichmentInput(dayID: "d\($0)", name: "Day \($0)",
                                                    coordinate: [-71.97, -13.53]) }
        let out = await e.suggestCampNames(for: days)
        XCTAssertEqual(out.count, 1, "only the first Cuzco is offered; the four repeats are skipped")
        XCTAssertEqual(out.first?.dayID, "d1")
    }

    // MARK: POIs

    func testPOIsDeduplicatedAndCapped() async {
        // Every query returns the same four, plus a duplicate — dedupe by name, cap at 4.
        let results = [
            LocalSearchResult(name: "Uhuru Peak", category: "summit", coordinate: [37.35, -3.07]),
            LocalSearchResult(name: "Reusch Crater", category: "landmark"),
            LocalSearchResult(name: "Uhuru Peak", category: "summit"),   // dup
            LocalSearchResult(name: "Barafu Camp", category: "shelter"),
            LocalSearchResult(name: "Karanga Valley", category: "viewpoint"),
            LocalSearchResult(name: "Extra", category: "landmark"),
        ]
        let e = enrichment(geocoder: FakeGeocoder(), search: FakeSearch(results: results))
        let day = DayEnrichmentInput(dayID: "d1", name: "Day 1", coordinate: [37.35, -3.07])
        let out = await e.suggestPOIs(for: day)
        XCTAssertEqual(out.dayID, "d1")
        XCTAssertEqual(out.pois.count, PlaceEnrichment.maxPOIsPerDay)
        let names = out.pois.map(\.name)
        XCTAssertEqual(names.filter { $0 == "Uhuru Peak" }.count, 1, "de-duplicated by name")
    }

    func testPOIsEmptyWithoutCoordinate() async {
        let e = enrichment(geocoder: FakeGeocoder(),
                           search: FakeSearch(results: [LocalSearchResult(name: "X")]))
        let day = DayEnrichmentInput(dayID: "d1", name: "Day 1", coordinate: [])
        let out = await e.suggestPOIs(for: day)
        XCTAssertTrue(out.pois.isEmpty)
    }
}
