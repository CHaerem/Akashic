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
