import XCTest
import CoreGraphics
@testable import Akashic

/// Unit tests for `ElevationProfileModel` — the pure port of the web `generateElevationProfile`.
final class ElevationProfileTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    // MARK: - Synthetic (deterministic projection math)

    func testEmptyRouteReturnsNil() {
        XCTAssertNil(ElevationProfileModel(coordinates: []))
    }

    func testProjectionBoundsAndPaddingOnSyntheticRoute() throws {
        let coords: [[Double]] = [[0, 0, 0], [0, 0.01, 100], [0, 0.02, 50]]
        let model = try XCTUnwrap(ElevationProfileModel(coordinates: coords))

        XCTAssertEqual(model.minEle, 0)
        XCTAssertEqual(model.maxEle, 100)
        // 10% padding, floored at 0.
        XCTAssertEqual(model.plotMinEle, 0, accuracy: 0.0001)          // max(0, 0 - 10) == 0
        XCTAssertEqual(model.plotMaxEle, 110, accuracy: 0.0001)        // 100 + 10

        // x spans the full 0…300 logical width; endpoints exact.
        XCTAssertEqual(model.points.first?.x, 0)
        XCTAssertEqual(try XCTUnwrap(model.points.last?.x), 300, accuracy: 0.0001)

        // Highest point projects near the top (small y), lowest near the bottom (large y).
        let top = try XCTUnwrap(model.points.max { $0.ele < $1.ele })
        let bottom = try XCTUnwrap(model.points.min { $0.ele < $1.ele })
        XCTAssertLessThan(top.y, bottom.y)
    }

    func testFlatRouteCentresVertically() throws {
        let coords: [[Double]] = [[0, 0, 500], [0, 0.01, 500], [0, 0.02, 500]]
        let model = try XCTUnwrap(ElevationProfileModel(coordinates: coords))
        // eleRange == 0 → every point sits at height/2.
        for p in model.points { XCTAssertEqual(p.y, ElevationProfileModel.logicalHeight / 2) }
    }

    // MARK: - Real Kilimanjaro fixture

    func testKilimanjaroProfileShape() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let model = try XCTUnwrap(ElevationProfileModel(journey: journey))

        // Distance is monotonically non-decreasing (cumulative Haversine).
        for i in 1..<model.points.count {
            XCTAssertGreaterThanOrEqual(model.points[i].dist, model.points[i - 1].dist,
                                        "distance must be monotonic at index \(i)")
            XCTAssertGreaterThanOrEqual(model.points[i].x, model.points[i - 1].x,
                                        "projected x must be monotonic at index \(i)")
        }

        // Every projected point lies inside the 300 × 120 logical box.
        for p in model.points {
            XCTAssertGreaterThanOrEqual(p.x, 0)
            XCTAssertLessThanOrEqual(p.x, ElevationProfileModel.logicalWidth + 0.001)
            XCTAssertGreaterThanOrEqual(p.y, 0)
            XCTAssertLessThanOrEqual(p.y, ElevationProfileModel.logicalHeight)
        }

        // Kilimanjaro has 8 camps; all snap onto the route → 8 markers, sorted by distance.
        XCTAssertEqual(model.campMarkers.count, 8, "expected one marker per camp")
        for i in 1..<model.campMarkers.count {
            XCTAssertGreaterThanOrEqual(model.campMarkers[i].dist, model.campMarkers[i - 1].dist)
        }
        for m in model.campMarkers {
            XCTAssertGreaterThanOrEqual(m.y, 0)
            XCTAssertLessThanOrEqual(m.y, ElevationProfileModel.logicalHeight)
        }

        // Known summit: the route tops out at 5874 m (Uhuru Peak elevation in the fixture).
        XCTAssertEqual(model.maxEle, 5874, "Kilimanjaro route max elevation")
        XCTAssertLessThanOrEqual(model.minEle, model.maxEle)
        // The highest camp marker should be at (or very near) the summit elevation.
        let highestCamp = try XCTUnwrap(model.campMarkers.max { $0.ele < $1.ele })
        XCTAssertEqual(highestCamp.ele, 5874, accuracy: 1)
    }

    func testKilimanjaroTotalDistanceMatchesRouteLength() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let model = try XCTUnwrap(ElevationProfileModel(journey: journey))
        let routeLength = DayStats.distance(route: journey.route.coordinates,
                                            from: 0, to: journey.route.coordinates.count - 1)
        // The profile's totalDist is the same cumulative Haversine length (within rounding).
        XCTAssertEqual(model.totalDist, routeLength, accuracy: 0.5)
        XCTAssertGreaterThan(model.totalDist, 0)
    }

    // MARK: - Lookup helpers

    func testNearestPointAndCampLookup() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let model = try XCTUnwrap(ElevationProfileModel(journey: journey))

        // A camp marker's own x resolves back to that camp within threshold.
        let marker = try XCTUnwrap(model.campMarkers.first)
        let found = model.nearestCampMarker(toLogicalX: marker.x, within: 5)
        XCTAssertEqual(found?.campID, marker.campID)

        // A logical x far from every camp yields no match within a tight threshold.
        XCTAssertNil(model.nearestCampMarker(toLogicalX: -50, within: 1))

        // nearestPoint returns the closest sample by projected x.
        let point = try XCTUnwrap(model.nearestPoint(toLogicalX: 0))
        XCTAssertEqual(point.x, model.points.first?.x)
    }
}
