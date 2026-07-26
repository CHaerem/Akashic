import XCTest
import Accessibility
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

    // MARK: - Audio Graph descriptor (QUA-07)

    /// The `AXChartDescriptor` is what makes the elevation profile explorable rather than merely
    /// announced — VoiceOver's Audio Graph steps its data points and can play the ascent as a tone.
    /// It is also the one piece of this work with real logic in it (downsampling, unit conversion),
    /// so it is the piece worth a test rather than an eyeball.
    ///
    /// The axes are asserted to be in REAL units — km and metres — not the chart's internal 300 × 120
    /// drawing space. That distinction is the whole point: reading "0 to 300" and "0 to 120" aloud
    /// would be worse than silence, because it sounds like measurements.
    func testChartDescriptorDescribesTheRouteInRealUnits() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let model = try XCTUnwrap(ElevationProfileModel(journey: journey))
        let descriptor = InteractiveElevationProfileView(model: model).makeChartDescriptor()

        let xAxis = try XCTUnwrap(descriptor.xAxis as? AXNumericDataAxisDescriptor)
        XCTAssertEqual(xAxis.range.upperBound, model.totalDist, accuracy: 0.5,
                       "x axis must span the route's real length in km, not the 300 pt drawing space")
        let yAxis = try XCTUnwrap(descriptor.yAxis)
        XCTAssertEqual(yAxis.range.upperBound, model.plotMaxEle, accuracy: 0.5,
                       "y axis must be metres above sea level, not the 120 pt drawing space")
        XCTAssertGreaterThan(yAxis.range.upperBound, 5000, "Kilimanjaro tops out near 5 900 m")
        // The axes read their values back with units — an unlabelled "1 234" is a number, not a height.
        XCTAssertTrue(yAxis.valueDescriptionProvider(1234).contains("m"))
        XCTAssertTrue(xAxis.valueDescriptionProvider(12).contains("km"))

        // Two series: the continuous profile, and the days as discrete points to navigate by.
        XCTAssertEqual(descriptor.series.count, 2)
        let profile = try XCTUnwrap(descriptor.series.first)
        XCTAssertTrue(profile.isContinuous)
        let days = try XCTUnwrap(descriptor.series.last)
        XCTAssertFalse(days.isContinuous)
        XCTAssertEqual(days.dataPoints.count, model.campMarkers.count,
                       "one navigable point per day, so 'which day is the climb' is answerable")
        XCTAssertEqual(days.dataPoints.first?.label,
                       "Day \(model.campMarkers[0].dayNumber) — \(model.campMarkers[0].name)")

        // Downsampled: a real route runs to hundreds or thousands of vertices, and stepping through
        // every one of them is not exploring a chart.
        XCTAssertGreaterThan(model.points.count, 120, "fixture must exceed the limit to test thinning")
        XCTAssertLessThanOrEqual(profile.dataPoints.count, 120)
        XCTAssertGreaterThan(profile.dataPoints.count, 60, "downsampling must not flatten the shape")
    }

    /// The sampling itself, where the only real logic in the descriptor lives. `AXDataPointValue` is
    /// opaque from Swift, so the points inside a built descriptor cannot be read back — testing the
    /// function that produces them is both possible and the more useful test anyway.
    func testChartSamplingKeepsTheEndsAndThinsTheMiddle() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let model = try XCTUnwrap(ElevationProfileModel(journey: journey))

        let sampled = InteractiveElevationProfileView.sample(model.points, limit: 120)
        XCTAssertLessThanOrEqual(sampled.count, 120)
        // The described route must start where the route starts and END WHERE IT ENDS. A plain
        // `stride` drops the last vertex whenever the count is not a multiple of it, which silently
        // shortens the profile a listener hears.
        XCTAssertEqual(sampled.first?.dist, model.points.first?.dist)
        XCTAssertEqual(sampled.last?.dist, model.points.last?.dist)
        XCTAssertEqual(sampled.last?.ele, model.points.last?.ele)

        // The limit is honoured just above it, not only at twice it. `count / limit` rounds down, so
        // 188 points against a limit of 120 produced a stride of 1 and returned all 188 — every route
        // fixture in the repo lands in exactly that band.
        XCTAssertGreaterThan(model.points.count, 120)
        XCTAssertLessThan(model.points.count, 240)
        XCTAssertLessThan(sampled.count, model.points.count, "nothing was thinned")

        // Below the limit nothing is thrown away.
        let short = Array(model.points.prefix(10))
        XCTAssertEqual(InteractiveElevationProfileView.sample(short, limit: 120).count, 10)
    }

    /// A route with no camps must not describe an empty second series — an Audio Graph offering a
    /// "Days" series with nothing in it is a dead end the reader has to discover by entering it.
    func testChartDescriptorOmitsTheDaySeriesWhenThereAreNoDays() throws {
        let coords: [[Double]] = [[0, 0, 0], [0, 0.01, 100], [0, 0.02, 50]]
        let model = try XCTUnwrap(ElevationProfileModel(coordinates: coords))
        XCTAssertTrue(model.campMarkers.isEmpty)

        let descriptor = InteractiveElevationProfileView(model: model).makeChartDescriptor()
        XCTAssertEqual(descriptor.series.count, 1)
        XCTAssertEqual(descriptor.series[0].dataPoints.count, model.points.count,
                       "a short route is described whole, with no downsampling to do")
    }
}
