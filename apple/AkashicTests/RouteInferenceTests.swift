import XCTest
@testable import Akashic

/// Assisted creation §1 — drafting a route from photo EXIF. Ordering, GPS-outlier rejection,
/// Douglas–Peucker simplification bounds, elevation passthrough/omission, UTC-day segmentation,
/// and the confidence/coverage-gap signals. All pure — no PhotosUI, no CoreLocation.
final class RouteInferenceTests: XCTestCase {

    private let t0 = Date(timeIntervalSince1970: 1_695_960_000)   // fixed epoch

    private func fix(_ lng: Double, _ lat: Double, minutes: Double, ele: Double? = nil) -> PhotoFix {
        PhotoFix(coordinate: [lng, lat], timestamp: t0.addingTimeInterval(minutes * 60), altitude: ele)
    }

    // MARK: Ordering

    func testOrdersByTimestampRegardlessOfInputOrder() {
        // Fed out of order; the route must come out chronological.
        let fixes = [
            fix(37.30, -3.08, minutes: 120),
            fix(37.10, -3.10, minutes: 0),
            fix(37.20, -3.09, minutes: 60),
        ]
        let result = RouteInference.infer(from: fixes)
        let lngs = result.route.coordinates.map { $0[0] }
        XCTAssertEqual(lngs, [37.10, 37.20, 37.30])
    }

    // MARK: Outlier rejection

    func testDropsImplausibleSpeedSpike() {
        // A ~200 km jump in one minute is impossible on foot — dropped.
        let fixes = [
            fix(37.00, -3.10, minutes: 0),
            fix(39.00, -3.10, minutes: 1),   // spike
            fix(37.01, -3.10, minutes: 30),
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.confidence.droppedOutliers, 1)
        XCTAssertEqual(result.route.coordinates.count, 2)
        XCTAssertFalse(result.route.coordinates.contains { $0[0] == 39.00 })
    }

    func testMergesStationaryBurstDuplicates() {
        // Three photos essentially in one spot across seconds — collapse to one point, none dropped.
        let fixes = [
            fix(37.0000, -3.1000, minutes: 0),
            fix(37.00001, -3.10001, minutes: 0.2),
            fix(37.00002, -3.10000, minutes: 0.4),
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.route.coordinates.count, 1)
        XCTAssertEqual(result.confidence.droppedOutliers, 0)
    }

    // MARK: Simplification bounds

    func testSimplifiesToAtMostMaxPoints() throws {
        // A dense but plausible winding walk (each step ~50 m over 5 min → 0.6 km/h) of 1000
        // points. A lat wiggle keeps it non-collinear so simplification must retain intermediate
        // detail rather than collapse the whole thing to two endpoints.
        var fixes: [PhotoFix] = []
        for i in 0..<1000 {
            let lng = 37.0 + Double(i) * 0.0005
            let lat = -3.1 + sin(Double(i) * 0.3) * 0.002
            fixes.append(fix(lng, lat, minutes: Double(i) * 5))
        }
        let result = RouteInference.infer(from: fixes, maxPoints: 300)
        XCTAssertLessThanOrEqual(result.route.coordinates.count, 300)
        XCTAssertGreaterThan(result.route.coordinates.count, 2)
        // Endpoints are always preserved.
        XCTAssertEqual(result.route.coordinates.first?[0], 37.0)
        XCTAssertEqual(try XCTUnwrap(result.route.coordinates.last)[0], 37.0 + 999 * 0.0005, accuracy: 1e-9)
    }

    func testKeepsAllPointsWhenUnderCap() {
        let fixes = (0..<5).map { fix(37.0 + Double($0) * 0.01, -3.1, minutes: Double($0) * 60) }
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.route.coordinates.count, 5)
    }

    // MARK: Elevation passthrough / omission

    func testElevationPresentWhenAltitudeGivenAndOmittedOtherwise() {
        let fixes = [
            fix(37.0, -3.1, minutes: 0, ele: 1800),
            fix(37.05, -3.1, minutes: 60),           // no altitude
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.route.coordinates[0].count, 3)
        XCTAssertEqual(result.route.coordinates[0][2], 1800)
        XCTAssertEqual(result.route.coordinates[1].count, 2, "no altitude → 2-element coordinate")
    }

    // MARK: Day segmentation

    func testSegmentsByUTCDayContiguously() {
        // Two calendar days. QUA-69 moved the day boundary to 04:00 (photos before it belong to
        // the previous evening), so the fixes sit mid-morning where the boundary is unambiguous;
        // the boundary itself is pinned in EarlyMorningBoundaryTests.
        let day0 = Date(timeIntervalSince1970: 1_695_945_600) // 2023-09-29 00:00 UTC
        func f(_ lng: Double, offset: TimeInterval) -> PhotoFix {
            PhotoFix(coordinate: [lng, -3.1], timestamp: day0.addingTimeInterval(offset), altitude: nil)
        }
        let fixes = [
            f(37.0, offset: 28_800),        // day 1, 08:00
            f(37.1, offset: 32_400),        // day 1, 09:00
            f(37.2, offset: 118_800),       // day 2, 09:00 (25h later)
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.daySegments.count, 2)
        XCTAssertEqual(result.daySegments[0].startIndex, 0)
        XCTAssertEqual(result.daySegments[0].endIndex, 1)
        XCTAssertEqual(result.daySegments[0].pointCount, 2)
        XCTAssertEqual(result.daySegments[1].startIndex, 2)
        XCTAssertEqual(result.daySegments[1].dayKey, "2023-09-30")
    }

    func testAfterMidnightFixesStayWithTheEveningSegment() {
        // QUA-69: a 00:30 photo-fix (aurora, late arrival) must not split the route into a
        // spurious extra day-segment — same boundary the draft's photo bucketing uses.
        let day0 = Date(timeIntervalSince1970: 1_695_945_600) // 2023-09-29 00:00 UTC
        func f(_ lng: Double, offset: TimeInterval) -> PhotoFix {
            PhotoFix(coordinate: [lng, -3.1], timestamp: day0.addingTimeInterval(offset), altitude: nil)
        }
        let fixes = [
            f(37.0, offset: 75_600),        // day 1, 21:00
            f(37.1, offset: 88_200),        // 00:30 the next calendar date — same day segment
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.daySegments.count, 1,
                       "the after-midnight fix belongs to the evening it ended")
        XCTAssertEqual(result.daySegments[0].pointCount, 2)
    }

    // MARK: Confidence / gaps

    func testConfidenceReportsSourceCountAndCoverageGaps() {
        let fixes = [
            fix(37.0, -3.1, minutes: 0),
            fix(37.01, -3.1, minutes: 30),
            fix(37.02, -3.1, minutes: 30 + 4 * 60),   // 4h gap → a coverage gap
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.confidence.sourcePointCount, 3)
        XCTAssertEqual(result.confidence.gapCount, 1)
        XCTAssertEqual(result.confidence.largestGapHours, 4, accuracy: 0.01)
        XCTAssertTrue(result.confidence.summary.contains("3 photo locations"))
    }

    func testEmptyInputProducesEmptyResult() {
        let result = RouteInference.infer(from: [])
        XCTAssertTrue(result.isEmpty)
        XCTAssertEqual(result.confidence.sourcePointCount, 0)
        XCTAssertTrue(result.daySegments.isEmpty)
    }

    func testInvalidCoordinatesAreIgnored() {
        let fixes = [
            PhotoFix(coordinate: [200, 100], timestamp: t0, altitude: nil), // out of range
            fix(37.0, -3.1, minutes: 10),
        ]
        let result = RouteInference.infer(from: fixes)
        XCTAssertEqual(result.route.coordinates.count, 1)
        XCTAssertEqual(result.route.coordinates.first?[0], 37.0)
    }
}
