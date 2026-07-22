import XCTest
@testable import Akashic

/// Numeric golden tests for the ported `ExtendedStatsCalculator` against the Kilimanjaro
/// fixture, plus a check that the string-typed fields serialise as JSON strings.
final class IntentStatsTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func kilimanjaro() throws -> Journey {
        try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
    }

    func testKilimanjaroExtendedStats() throws {
        let journey = try kilimanjaro()
        guard case .success(let result) = JourneyQuery.stats([journey], idOrSlug: "kilimanjaro") else {
            return XCTFail("expected success")
        }
        let ext = result.extendedStats

        // Passthrough basic stats (the stored journeys.stats).
        XCTAssertEqual(result.basicStats.duration, 7, "fixture duration is 7 days")
        XCTAssertEqual(result.basicStats.totalDistance, 70, "fixture distance is 70 km")

        // avgDailyDistance is a STRING, one decimal: 70 / 7 = "10.0".
        XCTAssertEqual(ext.avgDailyDistance, "10.0")

        // Route start/end elevations are exact route endpoints.
        XCTAssertEqual(ext.startElevation, 2404)
        XCTAssertEqual(ext.endElevation, 1642)

        // Elevation totals along the full route are substantial (~4.8 km each way).
        XCTAssertGreaterThan(ext.totalElevationGain, 3000)
        XCTAssertGreaterThan(ext.totalElevationLoss, 3000)
        XCTAssertGreaterThan(ext.maxDailyGain, 600)

        // estimatedTotalTime is a STRING formatted "Xh Ymin"; base time alone (70/5*60) is 14h.
        XCTAssertTrue(
            ext.estimatedTotalTime.range(of: #"^[0-9]+h [0-9]+min$"#, options: .regularExpression) != nil,
            "unexpected time format: \(ext.estimatedTotalTime)")
        let hours = Int(ext.estimatedTotalTime.prefix { $0.isNumber }) ?? 0
        XCTAssertGreaterThanOrEqual(hours, 14)

        // Difficulty per the ported thresholds (avg 10.0 → 0, maxGain>1000 → +2, totalElev>8000 → +2 = Hard).
        XCTAssertEqual(ext.difficulty, "Hard")

        // Longest/steepest day numbers point at real days.
        XCTAssertTrue((1...7).contains(ext.longestDayNumber))
        XCTAssertTrue((1...7).contains(ext.steepestDayNumber))
    }

    func testStatsResultSerialisesStringTypedFields() throws {
        let journey = try kilimanjaro()
        guard case .success(let result) = JourneyQuery.stats([journey], idOrSlug: "kilimanjaro") else {
            return XCTFail("expected success")
        }
        let json = IntentJSON.string(result)

        // avgDailyDistance / estimatedTotalTime must be quoted (strings), not bare numbers.
        XCTAssertTrue(json.contains("\"avgDailyDistance\":\"10.0\""), json)
        XCTAssertTrue(json.range(of: #""estimatedTotalTime":"[0-9]+h"#, options: .regularExpression) != nil, json)
        XCTAssertTrue(json.contains("\"journeyName\":"))
        XCTAssertTrue(json.contains("\"basicStats\":"))
        XCTAssertTrue(json.contains("\"extendedStats\":"))
    }

    func testStatsMissingRouteFails() throws {
        var journey = try kilimanjaro()
        journey.route = .empty
        XCTAssertEqual(JourneyQuery.stats([journey], idOrSlug: "kilimanjaro"),
                       .failure("Journey has no route or stats data"))
    }
}
