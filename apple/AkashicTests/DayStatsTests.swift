import XCTest
@testable import Akashic

final class DayStatsTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    // MARK: - Primitive helpers

    func testElevationGainAndLoss() {
        let route: [[Double]] = [[0, 0, 0], [0, 0.01, 100], [0, 0.02, 50]]
        XCTAssertEqual(DayStats.elevationGain(route: route, from: 0, to: 2), 100)
        XCTAssertEqual(DayStats.elevationLoss(route: route, from: 0, to: 2), 50)
        XCTAssertEqual(DayStats.elevationGain(route: route, from: 2, to: 0), 0, "reversed range is zero")
    }

    func testDistanceIsPositiveAndZeroForSameIndex() {
        let route: [[Double]] = [[0, 0, 0], [0, 0.05, 0], [0, 0.10, 0]]
        XCTAssertGreaterThan(DayStats.distance(route: route, from: 0, to: 2), 0)
        XCTAssertEqual(DayStats.distance(route: route, from: 1, to: 1), 0)
    }

    func testClosestRoutePointIndex() {
        let route: [[Double]] = [[0, 0, 0], [1, 1, 0], [2, 2, 0]]
        XCTAssertEqual(DayStats.closestRoutePointIndex(camp: [1.01, 0.99], route: route), 1)
        XCTAssertEqual(DayStats.closestRoutePointIndex(camp: [-5, -5], route: route), 0)
    }

    // MARK: - End-to-end on the real fixtures

    func testPerDayStatsSanityAcrossFixtures() throws {
        let expected: [String: Int] = ["kilimanjaro": 8, "mountKenya": 6, "incaTrail": 4]
        for (name, count) in expected {
            let journey = try FixtureLoader.load(named: name, bundle: bundle)

            XCTAssertEqual(journey.camps.count, count, "\(name) camp count")

            for camp in journey.camps {
                XCTAssertGreaterThanOrEqual(camp.dayDistance, 0, "\(name) day \(camp.dayNumber) distance")
                XCTAssertGreaterThanOrEqual(camp.elevationGainFromPrevious, 0)
                XCTAssertGreaterThanOrEqual(camp.elevationLossFromPrevious, 0)
                XCTAssertNotNil(camp.routePointIndex)
                if let idx = camp.routePointIndex {
                    XCTAssertTrue((0..<journey.route.coordinates.count).contains(idx))
                }
            }

            // At least one day should cover real ground.
            XCTAssertTrue(journey.camps.contains { $0.dayDistance > 0 }, "\(name) has some daily distance")
            // Total route length should be positive.
            let total = DayStats.distance(route: journey.route.coordinates,
                                          from: 0, to: journey.route.coordinates.count - 1)
            XCTAssertGreaterThan(total, 0)
        }
    }

    func testAnnotateRespectsExplicitRoutePointIndex() {
        let route = Route(type: "LineString", coordinates: [[0, 0, 0], [0, 0.01, 100], [0, 0.02, 200]])
        var camp = Camp(id: "c", name: "C", dayNumber: 1, elevation: 100,
                        coordinates: [0, 0.02], notes: "", highlights: [])
        camp.routePointIndex = 2
        let out = DayStats.annotate(camps: [camp], route: route)
        XCTAssertEqual(out.first?.routePointIndex, 2)
        XCTAssertEqual(out.first?.elevationGainFromPrevious, 200)
    }

    // MARK: - Stored routeDistanceKm preferred over Haversine (FIX 1)

    /// Kilimanjaro's day distances must come from the stored cumulative `routeDistanceKm`
    /// (`distanceFromStart` 7,24,34,39,43,48,60,70) as per-day deltas — NOT the Haversine
    /// route length, which yields different, lower numbers.
    func testKilimanjaroDayDistancesUseStoredDeltas() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let expected: [Double] = [7, 17, 10, 5, 4, 5, 12, 10]
        XCTAssertEqual(journey.camps.map(\.dayDistance), expected,
                       "Kilimanjaro day distances should equal the stored routeDistanceKm deltas")
        // Sum of the per-day deltas equals the trek's total distance.
        XCTAssertEqual(journey.camps.reduce(0) { $0 + $1.dayDistance }, 70, accuracy: 0.001)
    }

    /// A negative stored delta (cumulative distance decreases) must fall back to Haversine and
    /// never produce a negative day distance — the guard that `transforms.ts` lacks.
    func testNegativeStoredDeltaFallsBackToHaversine() {
        let route = Route(type: "LineString",
                          coordinates: [[0, 0, 0], [0, 0.01, 0], [0, 0.02, 0], [0, 0.03, 0], [0, 0.04, 0]])
        var a = Camp(id: "a", name: "A", dayNumber: 1, elevation: 0, coordinates: [0, 0.01], notes: "", highlights: [])
        a.routeDistanceKm = 50
        var b = Camp(id: "b", name: "B", dayNumber: 2, elevation: 0, coordinates: [0, 0.04], notes: "", highlights: [])
        b.routeDistanceKm = 0   // delta = 0 - 50 = -50
        let out = DayStats.annotate(camps: [a, b], route: route)
        let second = try? XCTUnwrap(out.last)
        XCTAssertNotNil(second)
        XCTAssertGreaterThan(second?.dayDistance ?? -1, 0, "negative delta must not surface as day distance")
        // Falls back to the Haversine length between the two snapped indices.
        let expected = DayStats.distance(route: route.coordinates,
                                         from: out[0].routePointIndex ?? 0,
                                         to: out[1].routePointIndex ?? 0)
        XCTAssertEqual(second?.dayDistance, expected)
    }
}
