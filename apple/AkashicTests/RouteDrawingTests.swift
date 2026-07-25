import XCTest
import MapKit
@testable import Akashic

/// Draw-on-map route authoring — sample thinning, metric simplification, how strokes attach to each
/// other (including the reversed and prepended orientations), stroke folding/undo, and the honest
/// no-elevation contract. All pure — no MapKit, no gestures.
final class RouteDrawingTests: XCTestCase {

    /// A point `metersEast` east of Kilimanjaro's approximate longitude at a fixed latitude.
    private func point(east metersEast: Double, lat: Double = -3.07) -> [Double] {
        let degreesPerMeter = RouteDrawing.degreesPerMeter(atLatitude: lat)
        return [37.0 + metersEast * degreesPerMeter, lat]
    }

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
        let zigzag = (0..<900).map { i -> [Double] in
            [37.0 + Double(i) * 0.001, -3.07 + (i % 2 == 0 ? 0.001 : -0.001)]
        }
        let simplified = RouteDrawing.simplify(zigzag, maxPoints: 100)
        XCTAssertLessThanOrEqual(simplified.count, 100)
        XCTAssertGreaterThan(simplified.count, 2)
    }

    func testToleranceIsMetricAcrossLatitudes() {
        // The same shape near the equator and at 80°N must simplify to the same point count: a
        // degree of longitude is ~6x shorter up there, and a degrees-only tolerance would butcher it.
        func wobble(lat: Double) -> [[Double]] {
            let dpm = RouteDrawing.degreesPerMeter(atLatitude: lat)
            return (0...40).map { i in
                // 40 m steps east with a 30 m north-south wobble — well above the 8 m tolerance.
                [10.0 + Double(i) * 40 * dpm, lat + (i % 2 == 0 ? 0.00027 : -0.00027)]
            }
        }
        XCTAssertEqual(RouteDrawing.simplify(wobble(lat: 0.5)).count,
                       RouteDrawing.simplify(wobble(lat: 80)).count)
    }

    // MARK: Joining

    func testFirstStrokeStartsThePolyline() {
        let stroke = [point(east: 0), point(east: 100)]
        let result = RouteDrawing.join(existing: [], stroke: stroke)
        XCTAssertEqual(result.join.kind, .started)
        XCTAssertEqual(result.points, stroke)
    }

    func testStrokeStartingAtTheEndIsAppendedWithoutDuplicatingTheSeam() {
        let existing = [point(east: 0), point(east: 100)]
        let stroke = [point(east: 100), point(east: 200)]   // starts exactly where we left off
        let result = RouteDrawing.join(existing: existing, stroke: stroke)
        XCTAssertEqual(result.join, RouteDrawing.Join(kind: .appended, bridgeMeters: 0))
        XCTAssertEqual(result.points.count, 3)             // seam point counted once
        XCTAssertEqual(result.points.last, point(east: 200))
    }

    func testStrokeDrawnBackwardsFromTheEndIsReversed() {
        let existing = [point(east: 0), point(east: 100)]
        // Drawn from far away back towards the current end — the user traced it the other way.
        let stroke = [point(east: 300), point(east: 200), point(east: 100)]
        let result = RouteDrawing.join(existing: existing, stroke: stroke)
        XCTAssertEqual(result.join.kind, .appendedReversed)
        XCTAssertEqual(result.points.map { $0[0] },
                       [point(east: 0), point(east: 100), point(east: 200), point(east: 300)].map { $0[0] })
    }

    func testStrokeMeetingTheStartIsPrepended() {
        let existing = [point(east: 100), point(east: 200)]
        let stroke = [point(east: 0), point(east: 100)]     // ends where the route begins
        let result = RouteDrawing.join(existing: existing, stroke: stroke)
        XCTAssertEqual(result.join.kind, .prepended)
        XCTAssertEqual(result.points.first, point(east: 0))
        XCTAssertEqual(result.points.count, 3)
    }

    func testStrokeDrawnOutwardsFromTheStartIsReversedAndPrepended() {
        let existing = [point(east: 100), point(east: 200)]
        // Started at the route's head and drew away from it.
        let stroke = [point(east: 100), point(east: 0)]
        let result = RouteDrawing.join(existing: existing, stroke: stroke)
        XCTAssertEqual(result.join.kind, .prependedReversed)
        XCTAssertEqual(result.points.first, point(east: 0))
        XCTAssertEqual(result.points.count, 3)
    }

    func testDetachedStrokeIsBridgedAndReported() {
        let existing = [point(east: 0), point(east: 100)]
        let stroke = [point(east: 5_000), point(east: 5_100)]   // 4.9 km away — a separate leg
        let result = RouteDrawing.join(existing: existing, stroke: stroke)
        XCTAssertEqual(result.join.kind, .appended)
        XCTAssertGreaterThan(result.join.bridgeMeters, 1_000)   // the UI says "straight leg"
        XCTAssertEqual(result.points.count, 4)                  // nothing dropped
    }

    func testStrokeTooShortToBeALegLeavesThePolylineAlone() {
        let existing = [point(east: 0), point(east: 100)]
        XCTAssertEqual(RouteDrawing.join(existing: existing, stroke: [point(east: 100)]).points, existing)
    }

    // MARK: Folding / undo

    func testFoldingStrokesEqualsSequentialJoining() {
        let a = [point(east: 0), point(east: 100)]
        let b = [point(east: 100), point(east: 200)]
        let c = [point(east: 200), point(east: 300)]
        let folded = RouteDrawing.fold(strokes: [a, b, c])
        XCTAssertEqual(folded.points.count, 4)
        XCTAssertEqual(folded.joins.map(\.kind), [.started, .appended, .appended])
    }

    func testUndoIsExactBecauseFoldingIsPure() {
        let a = [point(east: 0), point(east: 100)]
        let b = [point(east: 100), point(east: 200)]
        let before = RouteDrawing.polyline(strokes: [a])
        var strokes = [a, b]
        strokes.removeLast()                                   // what Undo does
        XCTAssertEqual(RouteDrawing.polyline(strokes: strokes), before)
    }

    func testEmptyStrokeListFoldsToNothing() {
        XCTAssertTrue(RouteDrawing.polyline(strokes: []).isEmpty)
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
        let region = RouteDrawingSheet.initialRegion(referenceRoute: route, fallbackCenter: nil)
        XCTAssertEqual(region.center.longitude, 37.1, accuracy: 0.001)
        XCTAssertEqual(region.center.latitude, -3.05, accuracy: 0.001)
    }

    func testOpeningRegionFallsBackToTheGivenCentre() {
        let region = RouteDrawingSheet.initialRegion(referenceRoute: nil, fallbackCenter: [11.0, 60.0])
        XCTAssertEqual(region.center.longitude, 11.0, accuracy: 0.001)
        XCTAssertEqual(region.center.latitude, 60.0, accuracy: 0.001)
        XCTAssertLessThan(region.span.latitudeDelta, 1)          // a trek-sized view, not the world
    }

    func testOpeningRegionWithNoHintsIsAWideButConcreteView() {
        let region = RouteDrawingSheet.initialRegion(referenceRoute: nil, fallbackCenter: nil)
        XCTAssertGreaterThan(region.span.latitudeDelta, 10)
        XCTAssertLessThanOrEqual(region.span.latitudeDelta, 180)
    }

    func testSummaryIsHonestAboutBridgedLegs() {
        XCTAssertFalse(RouteDrawing.summary(pointCount: 12, distanceKm: 4.2, bridgedGaps: 0)
            .contains("straight leg"))
        let bridged = RouteDrawing.summary(pointCount: 12, distanceKm: 4.2, bridgedGaps: 2)
        XCTAssertTrue(bridged.contains("2 straight legs"))
        XCTAssertTrue(bridged.contains("12 points"))
    }
}
