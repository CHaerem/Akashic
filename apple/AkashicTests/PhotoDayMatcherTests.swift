import XCTest
@testable import Akashic

/// Unit tests for the 4-tier photo→day matcher, ported from the web's `usePhotoDay.ts`.
/// Each tier is isolated by disabling the earlier tiers' inputs.
final class PhotoDayMatcherTests: XCTestCase {

    // MARK: Builders

    private func camp(_ id: String, day: Int, coords: [Double], routeIdx: Int?) -> Camp {
        Camp(id: id, name: "Camp \(day)", dayNumber: day, elevation: 0,
             coordinates: coords, notes: "", highlights: [],
             terrain: nil, timeFromPrevious: nil, dateLabel: nil,
             routePointIndex: routeIdx, routeDistanceKm: nil, weather: nil)
    }

    private func journey(camps: [Camp], route: [[Double]], dateStarted: String?) -> Journey {
        Journey(id: "J", slug: "j", name: "J", country: "", description: "",
                heroImageURL: nil, dateStarted: dateStarted, dateEnded: nil,
                isPublic: false, summitElevation: nil, totalDistance: nil, totalDays: nil,
                centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
                stats: TrekStats(duration: 0, totalDistance: 0, totalElevationGain: 0,
                                 totalElevationLoss: nil, highestPoint: nil),
                route: Route(type: "LineString", coordinates: route),
                camps: camps)
    }

    private func photo(_ id: String = "p", waypointId: String? = nil,
                       takenAt: String? = nil, coords: [Double]? = nil) -> Photo {
        Photo(id: id, journeyId: "J", waypointId: waypointId, url: "u", thumbnailURL: nil,
              caption: nil, coordinates: coords, takenAt: takenAt, isHero: false,
              sortOrder: 0, rotation: 0, mediaType: "image", duration: nil,
              locationSource: nil, localOriginalPath: nil, localThumbPath: nil)
    }

    // MARK: Tier 1 — explicit waypoint id

    func testTier1WaypointAssignment() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10, 60], routeIdx: 2),
                                camp("W2", day: 2, coords: [10.1, 60.1], routeIdx: 5)],
                        route: [], dateStarted: nil)
        let m = PhotoDayMatcher(journey: j)
        XCTAssertEqual(m.day(for: photo(waypointId: "W1")), 1)
        XCTAssertEqual(m.day(for: photo(waypointId: "W2")), 2)
        // Unknown waypoint with no other signal → unassigned.
        XCTAssertNil(m.day(for: photo(waypointId: "ZZZ")))
    }

    // MARK: Tier 2 — date match vs journey start

    func testTier2DateMatch() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10, 60], routeIdx: nil),
                                camp("W2", day: 2, coords: [10.1, 60.1], routeIdx: nil)],
                        route: [], dateStarted: "2024-01-01")
        let m = PhotoDayMatcher(journey: j)
        XCTAssertEqual(m.day(for: photo(takenAt: "2024-01-01T05:00:00+00:00")), 1)
        XCTAssertEqual(m.day(for: photo(takenAt: "2024-01-02T10:00:00+00:00")), 2)
        // Out of range (past the last day), no coordinates → unassigned.
        XCTAssertNil(m.day(for: photo(takenAt: "2025-06-01T00:00:00+00:00")))
    }

    func testTier2AcceptsFractionalSeconds() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10, 60], routeIdx: nil)],
                        route: [], dateStarted: "2024-01-01")
        let m = PhotoDayMatcher(journey: j)
        XCTAssertEqual(m.day(for: photo(takenAt: "2024-01-01T00:00:00.123+00:00")), 1)
    }

    // MARK: Tier 3 — route-segment proximity (< 2 km)

    private var straightRoute: [[Double]] {
        (0...6).map { [10.0 + Double($0) * 0.01, 60.0, 0] }
    }

    func testTier3RouteSegment() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10.02, 60.0], routeIdx: 2),
                                camp("W2", day: 2, coords: [10.05, 60.0], routeIdx: 5)],
                        route: straightRoute, dateStarted: nil)
        let m = PhotoDayMatcher(journey: j)
        // Near vertex 1 → first camp whose routeIdx >= 1 is W1 (idx 2) → day 1.
        XCTAssertEqual(m.day(for: photo(coords: [10.01, 60.0])), 1)
        // Near vertex 3 → W1(2) skipped, W2(5) matches → day 2.
        XCTAssertEqual(m.day(for: photo(coords: [10.03, 60.0])), 2)
        // Past all camps (vertex 6) → falls to the last camp → day 2.
        XCTAssertEqual(m.day(for: photo(coords: [10.06, 60.0])), 2)
    }

    func testTier3TooFarFromRouteAndCampsIsUnassigned() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10.02, 60.0], routeIdx: 2),
                                camp("W2", day: 2, coords: [10.05, 60.0], routeIdx: 5)],
                        route: straightRoute, dateStarted: nil)
        let m = PhotoDayMatcher(journey: j)
        // ~55 km east: beyond the 2 km route band AND the 5 km camp fallback.
        XCTAssertNil(m.day(for: photo(coords: [11.0, 60.0])))
    }

    // MARK: Tier 4 — nearest camp (< 5 km), route disabled

    func testTier4NearestCamp() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10.0, 60.0], routeIdx: nil),
                                camp("W2", day: 2, coords: [10.5, 60.0], routeIdx: nil)],
                        route: [], dateStarted: nil)
        let m = PhotoDayMatcher(journey: j)
        XCTAssertEqual(m.day(for: photo(coords: [10.01, 60.0])), 1)   // ~0.5 km from W1
        XCTAssertEqual(m.day(for: photo(coords: [10.49, 60.0])), 2)   // ~0.5 km from W2
        XCTAssertNil(m.day(for: photo(coords: [12.0, 60.0])))         // > 5 km from both
    }

    // MARK: Grouping

    func testGroupByDayAndUnassigned() {
        let j = journey(camps: [camp("W1", day: 1, coords: [10, 60], routeIdx: nil),
                                camp("W2", day: 2, coords: [10.1, 60.1], routeIdx: nil)],
                        route: [], dateStarted: nil)
        let m = PhotoDayMatcher(journey: j)
        let photos = [
            photo("a", waypointId: "W1"),
            photo("b", waypointId: "W1"),
            photo("c", waypointId: "W2"),
            photo("d")   // no signal → unassigned
        ]
        let grouped = m.groupByDay(photos)
        XCTAssertEqual(grouped.byDay[1]?.count, 2)
        XCTAssertEqual(grouped.byDay[2]?.count, 1)
        XCTAssertEqual(grouped.unassigned.count, 1)
        XCTAssertEqual(m.photos(forDay: 1, from: photos).map(\.id), ["a", "b"])
    }

    // MARK: Geometry sanity

    func testHaversineMatchesKnownDistance() {
        // ~1.11 km per 0.01° latitude near the equator.
        let d = PhotoDayMatcher.distanceKm(0, 0, 0.01, 0)
        XCTAssertEqual(d, 1.11, accuracy: 0.02)
    }

    // MARK: QUA-94 — a position outranks a date, and camps need no routePointIndex
    //
    // Both of these are shaped from the owner's real archive rather than invented. Measured there:
    // sweeping the day anchor, Kilimanjaro's photos agree with the route at −1 day (513/673) and
    // Inca Trail's at −3 (146/165), because `dateStarted` is the first day of the TRIP and a trip
    // begins with travel. And no camp in that data carries `routePointIndex`, so the route tier was
    // dead code and the date tier answered everything by default.

    /// A journey whose `dateStarted` is a travel day: camp day 1 is the day AFTER it, and no camp
    /// carries an explicit route index — exactly the owner's Kilimanjaro shape.
    private var travelDayJourney: Journey {
        journey(camps: [camp("W1", day: 1, coords: [10.02, 60.0], routeIdx: nil),
                        camp("W2", day: 2, coords: [10.04, 60.0], routeIdx: nil),
                        camp("W3", day: 3, coords: [10.06, 60.0], routeIdx: nil)],
                route: (0...6).map { [10.0 + Double($0) * 0.01, 60.0, 0] },
                dateStarted: "2022-09-30")
    }

    func testPositionOutranksADateAnchoredOnATravelDay() {
        let m = PhotoDayMatcher(journey: travelDayJourney)
        // On day 2's leg (past camp 1 at vertex 2, before camp 2 at vertex 4), photographed on the
        // second camp day. The date tier would count 2022-10-02 as day 3, because it starts counting
        // from the travel day — off by one, which is the defect. The position says day 2.
        let onDayTwosLeg = photo(takenAt: "2022-10-02T09:00:00+00:00", coords: [10.03, 60.0])
        XCTAssertEqual(m.day(for: onDayTwosLeg), 2,
                       "a photo on day 2's leg must be day 2 — the date tier's off-by-one anchor "
                       + "must not overrule a measured position (QUA-94)")
    }

    func testRouteProximityWorksWithoutAnExplicitRoutePointIndex() {
        let m = PhotoDayMatcher(journey: travelDayJourney)
        // No timestamp at all, so only position can answer. Before QUA-94 `campsByRouteIndex` was
        // built solely from `routePointIndex` and came out EMPTY here, so this fell through to the
        // nearest-camp tier and returned day 1 (camp 1 is ~0.55 km away, camp 2 ~0.55 km further).
        XCTAssertEqual(m.day(for: photo(coords: [10.03, 60.0])), 2,
                       "the camp's route index must be derived from its coordinates when absent")
    }

    func testTheDateTierStillAnswersWhenPositionCannot() {
        let m = PhotoDayMatcher(journey: travelDayJourney)
        // No coordinates: the date tier is all there is, and it must still work. Its anchor is
        // unchanged — this is a fallback now, not a demotion to nothing.
        XCTAssertEqual(m.day(for: photo(takenAt: "2022-09-30T09:00:00+00:00")), 1)
        XCTAssertEqual(m.day(for: photo(takenAt: "2022-10-01T09:00:00+00:00")), 2)
    }

    func testAPhotoFarOffRouteFallsBackToItsDate() {
        let m = PhotoDayMatcher(journey: travelDayJourney)
        // The Cusco case: day 1 of a real journey can be a city 74 km from the trail. Position
        // cannot place it, so the date tier must — returning a day rather than nothing.
        let inTheCity = photo(takenAt: "2022-10-01T09:00:00+00:00", coords: [11.0, 60.0])
        XCTAssertEqual(m.day(for: inTheCity), 2,
                       "beyond the 2 km band and the 5 km camp radius, the date decides")
    }
}
