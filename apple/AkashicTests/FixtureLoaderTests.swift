import XCTest
@testable import Akashic

final class FixtureLoaderTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    func testLoadsAllThreeFixtures() throws {
        let journeys = try FixtureLoader.loadAll(bundle: bundle)
        XCTAssertEqual(journeys.count, 3)
        XCTAssertEqual(Set(journeys.map(\.slug)), ["kilimanjaro", "mount-kenya", "inca-trail"])
    }

    func testKilimanjaroDecodes() throws {
        let j = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        XCTAssertEqual(j.country, "Tanzania")
        XCTAssertEqual(j.shortName, "Kilimanjaro")
        XCTAssertEqual(j.camps.count, 8)
        XCTAssertEqual(j.stats.duration, 7)
        XCTAssertEqual(j.stats.highestPoint?.elevation, 5895)
        XCTAssertEqual(j.stats.highestPoint?.name, "Uhuru Peak")
        XCTAssertGreaterThan(j.route.coordinates.count, 100)
        XCTAssertTrue(j.route.coordinates.allSatisfy { $0.count == 3 })
        XCTAssertTrue(j.camps.allSatisfy { $0.elevation > 0 })
        XCTAssertEqual(j.dateStarted, "2023-09-29")
    }

    func testMountKenyaAndIncaCampCounts() throws {
        let kenya = try FixtureLoader.load(named: "mountKenya", bundle: bundle)
        XCTAssertEqual(kenya.slug, "mount-kenya")
        XCTAssertEqual(kenya.camps.count, 6)

        let inca = try FixtureLoader.load(named: "incaTrail", bundle: bundle)
        XCTAssertEqual(inca.slug, "inca-trail")
        XCTAssertEqual(inca.country, "Peru")
        XCTAssertEqual(inca.camps.count, 4)
    }

    func testCountryFlags() throws {
        let journeys = try FixtureLoader.loadAll(bundle: bundle)
        let flags = Dictionary(uniqueKeysWithValues: journeys.map { ($0.slug, $0.countryFlag) })
        XCTAssertEqual(flags["kilimanjaro"], "🇹🇿")
        XCTAssertEqual(flags["mount-kenya"], "🇰🇪")
        XCTAssertEqual(flags["inca-trail"], "🇵🇪")
    }

    // MARK: - Flexible numeric decoding (older exports stored elevations as strings)

    func testFlexibleNumberParsing() {
        XCTAssertEqual(FlexibleNumber.parseInt("2,812m"), 2812)
        XCTAssertEqual(FlexibleNumber.parseDouble("5,895 m"), 5895)
        XCTAssertEqual(FlexibleNumber.parseInt("4150"), 4150)
    }

    func testFixtureCampDecodesStringElevation() throws {
        // Minimal fixture whose camp elevation and stats arrive as JSON strings.
        let json = """
        {
          "id": "test", "name": "Test - Route", "country": "Norway", "slug": "test",
          "description": "d", "heroImage": "/x.png",
          "dates": { "start": "2024-01-01", "end": "2024-01-03" },
          "stats": { "totalDistance": "12", "totalElevationGain": "300",
                     "totalElevationLoss": 100, "duration": "2",
                     "highestPoint": { "name": "Top", "elevation": "1500", "coordinates": [10.0, 60.0] } },
          "route": { "type": "LineString", "coordinates": [[10.0,60.0,100],[10.01,60.01,400]] },
          "camps": [ { "id": "c1", "name": "Camp 1", "dayNumber": 1, "date": "Day 1",
                       "elevation": "1200", "coordinates": [10.005, 60.005],
                       "distanceFromStart": "5", "highlights": ["View"] } ],
          "dailyStages": []
        }
        """.data(using: .utf8)!

        let j = try FixtureLoader.journey(from: json)
        XCTAssertEqual(j.stats.duration, 2)
        XCTAssertEqual(j.stats.totalDistance, 12)
        XCTAssertEqual(j.stats.highestPoint?.elevation, 1500)
        XCTAssertEqual(j.camps.first?.elevation, 1200)
        XCTAssertEqual(j.countryFlag, "🇳🇴")
    }
}
