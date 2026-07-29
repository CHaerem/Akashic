import XCTest
import CoreLocation
@testable import Akashic

/// Pure-math tests for the signature globe / trek map (`MapGeoMath`): bearing-from-route,
/// day-segment slicing (day-1 + off-route + nearest-point-fallback edges), and the
/// zoom→distance mapping. The map UI itself is screenshot-verified.
final class MapMathTests: XCTestCase {

    private func coord(_ lat: Double, _ lon: Double) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    // MARK: - Bearing

    func testBearingCardinalDirections() {
        let origin = coord(0, 0)
        XCTAssertEqual(MapGeoMath.bearing(from: origin, to: coord(1, 0)), 0, accuracy: 0.5, "north")
        XCTAssertEqual(MapGeoMath.bearing(from: origin, to: coord(0, 1)), 90, accuracy: 0.5, "east")
        XCTAssertEqual(MapGeoMath.bearing(from: origin, to: coord(-1, 0)), 180, accuracy: 0.5, "south")
        XCTAssertEqual(MapGeoMath.bearing(from: origin, to: coord(0, -1)), 270, accuracy: 0.5, "west")
    }

    func testBearingIsAlwaysNormalisedToZeroThreeSixty() {
        // Every cardinal / intercardinal target must land in [0, 360).
        let origin = coord(0, 0)
        for (lat, lon) in [(1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0), (1.0, -1.0)] {
            let b = MapGeoMath.bearing(from: origin, to: coord(lat, lon))
            XCTAssertGreaterThanOrEqual(b, 0)
            XCTAssertLessThan(b, 360)
        }
    }

    // MARK: - Bearing from route (vertex 5-back, spec §1e)

    func testRouteBearingLooksBackFiveVertices() {
        // A due-east route: bearing from a point 5 back to the end vertex must read ~90°.
        let route = (0...10).map { coord(0, Double($0) * 0.1) }
        XCTAssertEqual(MapGeoMath.routeBearing(toVertex: 10, route: route), 90, accuracy: 1.0)
    }

    func testRouteBearingClampsLookbackOnShortRoutes() {
        // Route shorter than the 5-vertex lookback must still produce a sane bearing.
        let route = [coord(0, 0), coord(0, 0.2)] // due east
        XCTAssertEqual(MapGeoMath.routeBearing(toVertex: 1, route: route), 90, accuracy: 1.0)
    }

    func testRouteBearingEmptyRouteIsZero() {
        XCTAssertEqual(MapGeoMath.routeBearing(toVertex: 3, route: []), 0)
    }

    // MARK: - Day-segment slicing

    /// A due-east route of 11 vertices (index 0…10), with two camps carrying explicit
    /// route indices.
    private func eastRoute() -> Route {
        Route(type: "LineString", coordinates: (0...10).map { [Double($0) * 0.1, 0, 0] })
    }

    private func camp(_ id: String, day: Int, lng: Double, lat: Double, index: Int?) -> Camp {
        var c = Camp(id: id, name: "Camp \(day)", dayNumber: day, elevation: 0,
                     coordinates: [lng, lat], notes: "", highlights: [])
        c.routePointIndex = index
        return c
    }

    func testDayOneSegmentStartsAtRouteOrigin() {
        let route = eastRoute()
        let camps = [camp("a", day: 1, lng: 0.5, lat: 0, index: 5),
                     camp("b", day: 2, lng: 1.0, lat: 0, index: 10)]
        let seg = MapGeoMath.daySegment(dayIndex: 0, camps: camps, route: route.coordinates)
        XCTAssertEqual(seg.startIndex, 0, "day 1 starts at the route origin")
        XCTAssertEqual(seg.endIndex, 5)
        // route[0...5] (6 vertices) + the camp coordinate appended.
        XCTAssertEqual(seg.coordinates.count, 7)
    }

    func testMiddleDaySegmentSpansPreviousToCurrentCamp() {
        let route = eastRoute()
        let camps = [camp("a", day: 1, lng: 0.5, lat: 0, index: 5),
                     camp("b", day: 2, lng: 1.0, lat: 0, index: 10)]
        let seg = MapGeoMath.daySegment(dayIndex: 1, camps: camps, route: route.coordinates)
        XCTAssertEqual(seg.startIndex, 5)
        XCTAssertEqual(seg.endIndex, 10)
        XCTAssertEqual(seg.coordinates.count, 7) // route[5...10] (6) + camp
    }

    func testCampWithoutRoutePointIndexFallsBackToNearestVertex() {
        let route = eastRoute()
        // No explicit index; coordinate sits next to vertex 5 (lng 0.5).
        let camps = [camp("a", day: 1, lng: 0.52, lat: 0.01, index: nil)]
        let seg = MapGeoMath.daySegment(dayIndex: 0, camps: camps, route: route.coordinates)
        XCTAssertEqual(seg.endIndex, 5, "nearest-point fallback should snap to vertex 5")
    }

    func testOffRouteCampStillProducesValidSegment() {
        let route = eastRoute()
        // A far-off safari camp; nearest vertex is the easternmost (index 10).
        let campCoord: [Double] = [5, 5]
        let camps = [camp("a", day: 1, lng: campCoord[0], lat: campCoord[1], index: nil)]
        let seg = MapGeoMath.daySegment(dayIndex: 0, camps: camps, route: route.coordinates)
        XCTAssertEqual(seg.endIndex, 10)
        XCTAssertFalse(seg.coordinates.isEmpty)
        // The camp coordinate is appended so the segment reaches the off-route camp.
        XCTAssertEqual(seg.coordinates.last?.latitude ?? 0, 5, accuracy: 1e-9)
        XCTAssertEqual(seg.coordinates.last?.longitude ?? 0, 5, accuracy: 1e-9)
    }

    func testBacktrackingCampDoesNotInvertSlice() {
        let route = eastRoute()
        // Day 2's camp snaps to an EARLIER vertex than day 1 (a backtrack). lo/hi ordering
        // must keep the slice valid rather than crash on an inverted range.
        let camps = [camp("a", day: 1, lng: 0.8, lat: 0, index: 8),
                     camp("b", day: 2, lng: 0.3, lat: 0, index: 3)]
        let seg = MapGeoMath.daySegment(dayIndex: 1, camps: camps, route: route.coordinates)
        XCTAssertEqual(seg.startIndex, 8)
        XCTAssertEqual(seg.endIndex, 3)
        XCTAssertEqual(seg.coordinates.count, 7) // route[3...8] (6) + camp
    }

    func testDaySegmentOutOfRangeIsEmpty() {
        let route = eastRoute()
        let camps = [camp("a", day: 1, lng: 0.5, lat: 0, index: 5)]
        let seg = MapGeoMath.daySegment(dayIndex: 9, camps: camps, route: route.coordinates)
        XCTAssertTrue(seg.coordinates.isEmpty)
    }

    // MARK: - nearest route index

    func testNearestRouteIndex() {
        let route = [coord(0, 0), coord(1, 1), coord(2, 2)]
        XCTAssertEqual(MapGeoMath.nearestRouteIndex(to: coord(0.99, 1.01), in: route), 1)
        XCTAssertEqual(MapGeoMath.nearestRouteIndex(to: coord(-5, -5), in: route), 0)
        XCTAssertEqual(MapGeoMath.nearestRouteIndex(to: coord(0, 0), in: []), 0)
    }

    // MARK: - Zoom → camera distance

    func testZoomZeroIsEarthCircumference() {
        XCTAssertEqual(MapGeoMath.distance(forZoom: 0), MapGeoMath.earthCircumference, accuracy: 1)
    }

    func testZoomDistanceMatchesSpecAnchors() {
        // Spec anchors: z15 ≈ 1–2 km, z16 ≈ 0.5–1 km.
        let z15 = MapGeoMath.distance(forZoom: 15)
        let z16 = MapGeoMath.distance(forZoom: 16)
        XCTAssertTrue((1_000...2_500).contains(z15), "z15 was \(z15)")
        XCTAssertTrue((400...1_000).contains(z16), "z16 was \(z16)")
    }

    func testZoomDistanceIsMonotonicallyDecreasing() {
        var previous = Double.greatestFiniteMagnitude
        for z in stride(from: 1.0, through: 16.0, by: 0.5) {
            let d = MapGeoMath.distance(forZoom: z)
            XCTAssertLessThan(d, previous, "distance must shrink as zoom grows (z=\(z))")
            previous = d
        }
    }

    func testZoomDistanceHalvesPerLevel() {
        let z3 = MapGeoMath.distance(forZoom: 3)
        let z4 = MapGeoMath.distance(forZoom: 4)
        XCTAssertEqual(z3 / z4, 2, accuracy: 1e-9)
    }

    // MARK: - Bounding box

    func testBBoxCenterAndSpan() {
        let box = MapGeoMath.bbox(of: [coord(0, 0), coord(2, 4)])
        XCTAssertEqual(box.center.latitude, 1, accuracy: 1e-9)
        XCTAssertEqual(box.center.longitude, 2, accuracy: 1e-9)
        XCTAssertGreaterThan(box.maxSpanMeters, 0)
    }

    // MARK: - Pitch clamp (documents the MapKit ~35° ceiling)

    @MainActor
    func testDayPitchIsClampedToThirtyFive() {
        // The Mapbox ambition is 55–60°; MapKit hard-clamps route-framing pitch to ~35°.
        XCTAssertEqual(TrekCameraController.maxObliquePitch, 35, accuracy: 0.001)
    }
}

/// QUA-66: the day fly-in must land its subject in the region the day sheet leaves visible.
/// `fittingCamera` used to centre the bbox at SCREEN centre while the medium-detent sheet covered
/// the lower half (iPhone) or the 400pt panel the leading edge (iPad) — the signature interaction
/// hid its own subject. The bias is pure math: widen the distance for the visible remainder and
/// walk the centre toward the covered edge (screen-bottom = reverse bearing; leading = heading−90°).
final class SheetAwareFramingTests: XCTestCase {

    private let leg = [
        CLLocationCoordinate2D(latitude: -3.10, longitude: 37.20),
        CLLocationCoordinate2D(latitude: -3.05, longitude: 37.30),
    ]

    func testNoCoverIsByteForByteTheOldFraming() {
        let old = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 0,
                                           fitFactor: 2.0, minDistance: 2_800)
        let new = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 0,
                                           fitFactor: 2.0, minDistance: 2_800, covered: .none)
        XCTAssertEqual(old.centerCoordinate.latitude, new.centerCoordinate.latitude)
        XCTAssertEqual(old.centerCoordinate.longitude, new.centerCoordinate.longitude)
        XCTAssertEqual(old.centerCoordinateDistance, new.centerCoordinateDistance)
    }

    func testBottomCoverWalksTheCentreTowardTheViewerAndWidens() {
        let base = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 0,
                                            fitFactor: 2.0, minDistance: 2_800)
        let biased = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 0,
                                              fitFactor: 2.0, minDistance: 2_800,
                                              covered: .bottom(fraction: 0.45))
        // Heading 0 looks north; screen-bottom is south — the centre moves south so the leg
        // slides up into the visible top half.
        XCTAssertLessThan(biased.centerCoordinate.latitude, base.centerCoordinate.latitude)
        XCTAssertEqual(biased.centerCoordinate.longitude, base.centerCoordinate.longitude, accuracy: 1e-9)
        XCTAssertGreaterThan(biased.centerCoordinateDistance, base.centerCoordinateDistance,
                             "the subject must fit the visible remainder, so the camera widens")
    }

    func testLeadingCoverWalksTheCentreLeftOfTheHeading() {
        let base = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 90,
                                            fitFactor: 2.0, minDistance: 2_800)
        let biased = MapGeoMath.fittingCamera(coords: leg, pitch: 35, heading: 90,
                                              fitFactor: 2.0, minDistance: 2_800,
                                              covered: .leading(fraction: 0.35))
        // Heading 90 looks east; screen-left is north — the centre moves north so the leg
        // slides toward the uncovered trailing side.
        XCTAssertGreaterThan(biased.centerCoordinate.latitude, base.centerCoordinate.latitude)
        XCTAssertGreaterThan(biased.centerCoordinateDistance, base.centerCoordinateDistance)
    }

    func testGreatCircleStepMatchesCLLocationDistance() {
        let origin = CLLocationCoordinate2D(latitude: 61.6, longitude: 8.3)
        let stepped = MapGeoMath.coordinate(from: origin, bearingDegrees: 137, distanceMeters: 12_000)
        let measured = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
            .distance(from: CLLocation(latitude: stepped.latitude, longitude: stepped.longitude))
        // Measured: the spherical step differs from CLLocation's ellipsoidal distance by ~35 m
        // over 12 km at 61.6°N (0.3%) — far inside a pixel at camera-offset scales.
        XCTAssertEqual(measured, 12_000, accuracy: 60,
                       "spherical step within ellipsoid tolerance at camera-offset scales")
    }
}
