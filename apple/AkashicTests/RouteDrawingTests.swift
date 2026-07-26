import XCTest
import MapKit
@testable import Akashic

/// Draw-on-map route authoring — sample thinning, metric simplification, how strokes attach to each
/// other (including the reversed and prepended orientations), stroke folding/undo, and the honest
/// no-elevation contract. All pure — no MapKit, no gestures.
@MainActor
final class RouteDrawingTests: XCTestCase {

    /// A point `metersEast` east of Kilimanjaro's approximate longitude at a fixed latitude.
    private func point(east metersEast: Double, lat: Double = -3.07) -> [Double] {
        let degreesPerMeter = RouteDrawing.degreesPerMeter(atLatitude: lat)
        return [37.0 + metersEast * degreesPerMeter, lat]
    }

    /// The two fixtures the join tests build on: an existing 0→100 m leg, and one 100→200 m further on.
    private var firstLeg: [[Double]] { [point(east: 0), point(east: 100)] }
    private var secondLeg: [[Double]] { [point(east: 100), point(east: 200)] }

    /// Longitudes only — the axis these fixtures vary, so assertions read as an order.
    private func longitudes(_ points: [[Double]]) -> [Double] { points.map { $0[0] } }

    // MARK: Capture thinning

    func testFirstPointOfAStrokeIsAlwaysKept() {
        XCTAssertTrue(RouteDrawing.shouldAppend(point(east: 0), to: []))
    }

    func testSamplesCloserThanTheSpacingAreDropped() {
        let stroke = [point(east: 0)]
        // 5 m apart with a 12 m minimum — finger tremor, not movement.
        XCTAssertFalse(RouteDrawing.shouldAppend(point(east: 5), to: stroke))
        XCTAssertTrue(RouteDrawing.shouldAppend(point(east: 30), to: stroke))
    }

    func testInvalidCoordinatesAreNeverAppended() {
        XCTAssertFalse(RouteDrawing.shouldAppend([200, 0], to: []))         // off-world longitude
        XCTAssertFalse(RouteDrawing.shouldAppend([0, 91], to: []))          // off-world latitude
        XCTAssertFalse(RouteDrawing.shouldAppend([.nan, 0], to: []))        // not finite
        XCTAssertFalse(RouteDrawing.shouldAppend([1], to: []))              // malformed
    }

    // MARK: Simplification

    func testShortStrokesPassThroughUntouched() {
        let two = [point(east: 0), point(east: 100)]
        XCTAssertEqual(RouteDrawing.simplify(two), two)
    }

    func testCollinearWobbleIsSimplifiedAwayButShapeSurvives() {
        // A straight line with dense samples collapses to its endpoints.
        let straight = (0...20).map { point(east: Double($0) * 50) }
        let simplified = RouteDrawing.simplify(straight)
        XCTAssertEqual(simplified.count, 2)
        XCTAssertEqual(simplified.first, straight.first)
        XCTAssertEqual(simplified.last, straight.last)

        // A real corner (a switchback 500 m off the straight line) must be kept.
        var withCorner = straight
        withCorner.insert([37.0 + 500 * RouteDrawing.degreesPerMeter(atLatitude: -3.07), -3.06],
                          at: 10)
        XCTAssertGreaterThan(RouteDrawing.simplify(withCorner).count, 2)
    }

    func testSimplificationRespectsThePointCap() {
        // A zig-zag that Douglas–Peucker cannot thin on shape alone — the cap must still hold.
        var zigzag: [[Double]] = []
        for i in 0..<900 {
            let lng: Double = 37.0 + Double(i) * 0.001
            let lat: Double = -3.07 + (i % 2 == 0 ? 0.001 : -0.001)
            zigzag.append([lng, lat])
        }
        let simplified = RouteDrawing.simplify(zigzag, maxPoints: 100)
        XCTAssertLessThanOrEqual(simplified.count, 100)
        XCTAssertGreaterThan(simplified.count, 2)
    }

    func testToleranceIsMetricAcrossLatitudes() {
        // The same shape near the equator and at 80°N must simplify to the same point count: a
        // degree of longitude is ~6x shorter up there, and a degrees-only tolerance would butcher it.
        // Every sub-expression is annotated and pulled apart deliberately: Xcode 16.4 (the CI
        // runner's default) gives up type-checking this as one literal expression, while Xcode 26
        // resolves it — so the terse version passes locally and fails in CI.
        func wobble(lat: Double) -> [[Double]] {
            let degreesPerMeter: Double = RouteDrawing.degreesPerMeter(atLatitude: lat)
            var points: [[Double]] = []
            for i in 0...40 {
                // 40 m steps east with a 30 m north-south wobble — well above the 8 m tolerance.
                let east: Double = Double(i) * 40 * degreesPerMeter
                let offset: Double = i % 2 == 0 ? 0.00027 : -0.00027
                points.append([10.0 + east, lat + offset])
            }
            return points
        }
        XCTAssertEqual(RouteDrawing.simplify(wobble(lat: 0.5)).count,
                       RouteDrawing.simplify(wobble(lat: 80)).count)
    }

    // MARK: Joining
    //
    // These assert on the resulting GEOMETRY — the order points end up in and whether a gap was
    // bridged — because that is the contract callers depend on. How `join` classified the seam is
    // its own business.

    func testFirstStrokeStartsThePolyline() {
        let result = RouteDrawing.join(existing: [], stroke: firstLeg)
        XCTAssertEqual(result.points, firstLeg)
        XCTAssertEqual(result.bridgeMeters, 0)
    }

    func testStrokeStartingAtTheEndIsAppendedWithoutDuplicatingTheSeam() {
        let result = RouteDrawing.join(existing: firstLeg, stroke: secondLeg)
        XCTAssertEqual(result.bridgeMeters, 0)
        XCTAssertEqual(result.points.count, 3)             // seam point counted once
        XCTAssertEqual(result.points.last, point(east: 200))
    }

    func testStrokeDrawnBackwardsFromTheEndIsReversed() {
        // Drawn from far away back towards the current end — the user traced it the other way.
        let stroke = [point(east: 300), point(east: 200), point(east: 100)]
        let result = RouteDrawing.join(existing: firstLeg, stroke: stroke)
        XCTAssertEqual(longitudes(result.points),
                       longitudes([point(east: 0), point(east: 100), point(east: 200), point(east: 300)]))
    }

    func testStrokeMeetingTheStartIsPrepended() {
        let stroke = [point(east: 0), point(east: 100)]     // ends where the route begins
        let result = RouteDrawing.join(existing: secondLeg, stroke: stroke)
        XCTAssertEqual(longitudes(result.points),
                       longitudes([point(east: 0), point(east: 100), point(east: 200)]))
    }

    func testStrokeDrawnOutwardsFromTheStartIsReversedAndPrepended() {
        // Started at the route's head and drew away from it.
        let stroke = [point(east: 100), point(east: 0)]
        let result = RouteDrawing.join(existing: secondLeg, stroke: stroke)
        XCTAssertEqual(longitudes(result.points),
                       longitudes([point(east: 0), point(east: 100), point(east: 200)]))
    }

    func testDetachedStrokeIsBridgedAndReported() {
        let stroke = [point(east: 5_000), point(east: 5_100)]   // 4.9 km away — a separate leg
        let result = RouteDrawing.join(existing: firstLeg, stroke: stroke)
        XCTAssertGreaterThan(result.bridgeMeters, 1_000)        // the UI says "straight leg"
        XCTAssertEqual(result.points.count, 4)                  // nothing dropped
    }

    func testStrokeTooShortToBeALegLeavesThePolylineAlone() {
        XCTAssertEqual(RouteDrawing.join(existing: firstLeg, stroke: [point(east: 100)]).points, firstLeg)
    }

    // MARK: Folding / undo

    func testFoldingStrokesJoinsEachToTheResultSoFar() {
        let third = [point(east: 200), point(east: 300)]
        let folded = RouteDrawing.fold(strokes: [firstLeg, secondLeg, third])
        XCTAssertEqual(longitudes(folded.points),
                       longitudes([point(east: 0), point(east: 100), point(east: 200), point(east: 300)]))
        XCTAssertEqual(folded.bridgedGaps, 0)
    }

    func testFoldCountsOneBridgedGapPerDetachedStroke() {
        let far = [point(east: 5_000), point(east: 5_100)]
        let further = [point(east: 20_000), point(east: 20_100)]
        XCTAssertEqual(RouteDrawing.fold(strokes: [firstLeg, far, further]).bridgedGaps, 2)
    }

    func testUndoIsExactBecauseFoldingIsPure() {
        let before = RouteDrawing.fold(strokes: [firstLeg]).points
        var strokes = [firstLeg, secondLeg]
        strokes.removeLast()                                   // what Undo does
        XCTAssertEqual(RouteDrawing.fold(strokes: strokes).points, before)
    }

    func testEmptyStrokeListFoldsToNothing() {
        XCTAssertTrue(RouteDrawing.fold(strokes: []).points.isEmpty)
    }

    // MARK: Route + stats contract

    func testRouteCarriesTwoElementCoordinatesSoElevationStaysAbsent() {
        let route = RouteDrawing.route(from: [point(east: 0), point(east: 100), point(east: 200)])
        XCTAssertEqual(route.type, "LineString")
        XCTAssertEqual(route.coordinates.count, 3)
        XCTAssertTrue(route.coordinates.allSatisfy { $0.count == 2 })

        // The consequence, pinned: no ascent, no descent, no summit — absent, not a wrong number.
        let (gain, loss) = JourneyDraft.elevationGainLoss(route: route.coordinates)
        XCTAssertEqual(gain, 0)
        XCTAssertEqual(loss, 0)
        XCTAssertNil(JourneyDraft.highestPoint(route: route.coordinates, name: "Drawn"))
        // Distance, by contrast, is real.
        XCTAssertEqual(JourneyDraft.totalDistanceKm(route: route.coordinates), 0.2, accuracy: 0.01)
    }

    func testASinglePointIsNotARoute() {
        XCTAssertEqual(RouteDrawing.route(from: [point(east: 0)]), .empty)
        XCTAssertEqual(RouteDrawing.route(from: []), .empty)
    }

    // MARK: Opening camera
    //
    // The sheet must open on a CONCRETE region: an `.automatic` camera re-frames itself to fit map
    // content, and the polyline being drawn IS content — so the map moved mid-stroke and the drawn
    // line diverged from the traced one (caught in the simulator). These pin what it opens on.

    func testOpeningRegionFollowsTheReferenceRoute() {
        let route = Route(type: "LineString", coordinates: [[37.0, -3.1], [37.2, -3.0]])
        let region = RouteDrawingSheet.initialRegion(referenceRoute: route, fallbackRegion: nil)
        XCTAssertEqual(region.center.longitude, 37.1, accuracy: 0.001)
        XCTAssertEqual(region.center.latitude, -3.05, accuracy: 0.001)
    }

    func testOpeningRegionFallsBackToTheGivenRegion() {
        let days: [RouteCoordinate] = [[11.0, 60.0], [11.4, 60.2]]
        let fallback = MKCoordinateRegion.fitting(days.clCoordinates)
        let region = RouteDrawingSheet.initialRegion(referenceRoute: nil, fallbackRegion: fallback)
        XCTAssertEqual(region.center.longitude, 11.2, accuracy: 0.001)
        XCTAssertEqual(region.center.latitude, 60.1, accuracy: 0.001)
        XCTAssertLessThan(region.span.latitudeDelta, 1)          // a trek-sized view, not the world
    }

    func testOpeningRegionWithNoHintsIsAWideButConcreteView() {
        let region = RouteDrawingSheet.initialRegion(referenceRoute: nil, fallbackRegion: nil)
        XCTAssertGreaterThan(region.span.latitudeDelta, 10)
        XCTAssertLessThanOrEqual(region.span.latitudeDelta, 180)
    }

    /// A single placed day must not open at street level — `fitting` floors the span.
    func testRegionForOneKnownPointHasAUsableFloor() {
        let onePlacedDay: [RouteCoordinate] = [[11.0, 60.0]]
        let region = MKCoordinateRegion.fitting(onePlacedDay.clCoordinates)
        XCTAssertEqual(region.span.latitudeDelta, 0.05, accuracy: 0.0001)
    }

    func testSummaryIsHonestAboutBridgedLegs() {
        let clean = RouteDrawing.drawnRoute(strokes: [firstLeg, secondLeg])
        XCTAssertFalse(clean.summary.contains("straight leg"))
        XCTAssertTrue(clean.summary.contains("3 points"))

        let detached = RouteDrawing.drawnRoute(
            strokes: [firstLeg, [point(east: 5_000), point(east: 5_100)]])
        XCTAssertEqual(detached.bridgedGaps, 1)
        XCTAssertTrue(detached.summary.contains("1 straight leg"))
    }

    /// The bridged-gap count must survive from the drawing to whatever consumes it — it was lost at
    /// this seam before `DrawnRoute` existed, so the Apply preview claimed a clean route.
    func testDrawnRouteCarriesItsProvenanceToTheCaller() {
        let drawn = RouteDrawing.drawnRoute(
            strokes: [firstLeg, [point(east: 9_000), point(east: 9_100)]])
        XCTAssertTrue(drawn.isUsable)
        XCTAssertEqual(drawn.bridgedGaps, 1)
        XCTAssertEqual(drawn.pointCount, 4)
        XCTAssertGreaterThan(drawn.distanceKm, 8)
    }

    func testDrawnRouteFromNothingIsNotUsable() {
        let drawn = RouteDrawing.drawnRoute(strokes: [])
        XCTAssertFalse(drawn.isUsable)
        XCTAssertEqual(drawn.route, .empty)
    }

    // MARK: The elevation contract, as a domain fact

    func testDrawnRoutesReportNoElevationAndGPXStyleRoutesDo() {
        // `Route.hasElevation` is what gates the elevation profile: without it, StatsView renders a
        // drawn route's profile pinned flat at 0 m as though sea level had been measured.
        let drawn = RouteDrawing.drawnRoute(strokes: [firstLeg, secondLeg]).route
        XCTAssertFalse(drawn.hasElevation)
        let withEle: [RouteCoordinate] = [[37.0, -3.1, 1800], [37.2, -3.0, 2100]]
        XCTAssertTrue(Route(type: "LineString", coordinates: withEle).hasElevation)
        XCTAssertFalse(Route.empty.hasElevation)
    }
}
