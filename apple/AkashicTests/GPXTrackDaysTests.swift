import XCTest
@testable import Akashic

/// DIFF-09: days derived from a **timestamped GPX track**.
///
/// Two halves, tested separately because they are separate:
///   * `GPXParser` must *retain* each `<trkpt>`'s `<time>`, index-aligned with `route.coordinates`
///     (it parsed and then threw them away before this — the route is `[[Double]]`, with nowhere for
///     a timestamp to live).
///   * `GPXTrackDays` must cluster those times into one day per **local** calendar date, pure and
///     with no parse anywhere near it.
final class GPXTrackDaysTests: XCTestCase {

    private let iso = ISO8601DateFormatter()

    private func date(_ string: String) -> Date {
        guard let date = iso.date(from: string) else {
            XCTFail("bad test date \(string)"); return .distantPast
        }
        return date
    }

    // MARK: - Parser: per-trackpoint times are retained (the DIFF-09 prerequisite)

    func testTrackPointTimesAreRetainedIndexAlignedWithRouteCoordinates() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="-3.10" lon="37.25"><ele>1800</ele><time>2023-09-29T06:00:00Z</time></trkpt>
            <trkpt lat="-3.11" lon="37.26"><ele>1900</ele><time>2023-09-29T07:00:00Z</time></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)

        XCTAssertEqual(file.route.coordinates.count, 2)
        XCTAssertEqual(file.trackPointTimes.count, file.route.coordinates.count,
                       "times array must be index-aligned with the route")
        XCTAssertEqual(file.trackPointTimes, [date("2023-09-29T06:00:00Z"),
                                              date("2023-09-29T07:00:00Z")])
    }

    func testTrackPointWithoutTimeYieldsNilAtItsOwnIndex() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="-3.10" lon="37.25"><time>2023-09-29T06:00:00Z</time></trkpt>
            <trkpt lat="-3.11" lon="37.26"/>
            <trkpt lat="-3.12" lon="37.27"><time>2023-09-29T08:00:00Z</time></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)

        XCTAssertEqual(file.trackPointTimes.count, 3)
        XCTAssertNil(file.trackPointTimes[1], "the untimed point keeps its slot, as nil")
        XCTAssertEqual(file.trackPointTimes[0], date("2023-09-29T06:00:00Z"))
        XCTAssertEqual(file.trackPointTimes[2], date("2023-09-29T08:00:00Z"))
        XCTAssertEqual(file.timedTrackPoints.count, 2, "timedTrackPoints drops the untimed one")
    }

    /// A dropped point (out-of-range coordinate) must not shift the times of every later point.
    func testDroppedPointDoesNotBreakTimeAlignment() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="-3.10" lon="37.25"><time>2023-09-29T06:00:00Z</time></trkpt>
            <trkpt lat="99.0" lon="37.26"><time>2023-09-29T07:00:00Z</time></trkpt>
            <trkpt lat="-3.12" lon="37.27"><time>2023-09-29T08:00:00Z</time></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)

        XCTAssertEqual(file.droppedPointCount, 1)
        XCTAssertEqual(file.route.coordinates.count, 2)
        XCTAssertEqual(file.trackPointTimes, [date("2023-09-29T06:00:00Z"),
                                              date("2023-09-29T08:00:00Z")],
                       "the dropped point takes its time with it")
    }

    func testTimesSurviveMultipleSegmentsAndTrkptOutsideATrkseg() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk>
            <trkseg><trkpt lat="-3.10" lon="37.25"><time>2023-09-29T06:00:00Z</time></trkpt></trkseg>
            <trkseg><trkpt lat="-3.11" lon="37.26"><time>2023-09-30T06:00:00Z</time></trkpt></trkseg>
            <trkpt lat="-3.12" lon="37.27"><time>2023-10-01T06:00:00Z</time></trkpt>
          </trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)

        XCTAssertEqual(file.route.coordinates.count, 3)
        XCTAssertEqual(file.trackPointTimes, [date("2023-09-29T06:00:00Z"),
                                              date("2023-09-30T06:00:00Z"),
                                              date("2023-10-01T06:00:00Z")],
                       "every flush path (trkseg, trkseg, the trk fallback) carries times")
    }

    // MARK: - Local time / offset

    func testSolarOffsetFromLongitudeAndItsClamps() {
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: 0), 0)
        // Peru: -72.5° → -4.83h → -5h. This is the offset the Inca Trail case below depends on.
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: -72.5), -5 * 3600)
        // Kilimanjaro: 37.35° → +2.49h → +2h. Politically Tanzania is UTC+3 — a documented ±1h
        // approximation that only bites within an hour of local midnight.
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: 37.35), 2 * 3600)
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: 179.9), 12 * 3600)
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: -179.9), -12 * 3600,
                       "clamped to the real-world minimum")
        XCTAssertEqual(GPXTrackDays.solarUTCOffsetSeconds(medianLongitude: .nan), 0)
    }

    func testMedianLongitudeIgnoresAWildOutlierAndMalformedPoints() {
        let coordinates: [RouteCoordinate] = [[37.25, -3.10], [37.26, -3.11], [37.27, -3.12],
                                              [37.28, -3.13], [170.0, -3.14], [37.0]]
        // Five usable longitudes (the 1-element point drops out), so the median is the middle one.
        // Median, not mean — the 170° fix cannot drag the whole track into another zone, whereas the
        // mean of these would be ~65° and put the track five hours off.
        XCTAssertEqual(GPXTrackDays.medianLongitude(of: coordinates), 37.27, accuracy: 1e-9)
        XCTAssertEqual(GPXTrackDays.medianLongitude(of: []), 0)
    }

    // MARK: - Clustering

    func testSingleDayTrackYieldsExactlyOneDay() {
        // The stated failure mode to avoid: not zero, and not one day per hour.
        let coordinates: [RouteCoordinate] = (0..<12).map { [37.25 + Double($0) / 100, -3.10] }
        let times: [Date?] = (0..<12).map { date(String(format: "2023-09-29T%02d:00:00Z", 5 + $0)) }

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.count, 1)
        XCTAssertEqual(days[0].coordinates.count, 12)
        XCTAssertEqual(days[0].start, date("2023-09-29T05:00:00Z"))
        XCTAssertEqual(days[0].end, date("2023-09-29T16:00:00Z"))
    }

    func testMultiDayTrekWithOvernightGapsYieldsOneDayPerCalendarDay() {
        let coordinates: [RouteCoordinate] = [
            [37.25, -3.10, 1800], [37.30, -3.12, 2100],      // day 1: 06:00 → 14:00
            [37.32, -3.14, 2200], [37.36, -3.16, 2800],      // day 2 (after a 16h gap)
            [37.38, -3.18, 2900], [37.40, -3.20, 3900],      // day 3
        ]
        let times: [Date?] = [
            date("2023-09-29T06:00:00Z"), date("2023-09-29T14:00:00Z"),
            date("2023-09-30T06:00:00Z"), date("2023-09-30T14:00:00Z"),
            date("2023-10-01T06:00:00Z"), date("2023-10-01T14:00:00Z"),
        ]

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.map(\.localDateKey), ["2023-09-29", "2023-09-30", "2023-10-01"])
        XCTAssertEqual(days.map { $0.coordinates.count }, [2, 2, 2])
        XCTAssertEqual(days[1].start, date("2023-09-30T06:00:00Z"))
        XCTAssertEqual(days[1].end, date("2023-09-30T14:00:00Z"))
    }

    /// A recorder that never pauses has **no** overnight gap. Gap detection would return one day for
    /// the whole week; calendar grouping gets it right, which is the reason for the choice.
    func testContinuousRecordingWithNoGapStillSplitsAtTheLocalDateBoundary() {
        // Hourly points from 20:00 to 04:00 local at longitude 0 (offset 0) — straight through
        // midnight with no gap at all.
        let times: [Date?] = (0..<9).map { hour -> Date in
            hour < 4 ? date(String(format: "2023-09-29T%02d:00:00Z", 20 + hour))
                     : date(String(format: "2023-09-30T%02d:00:00Z", hour - 4))
        }
        let coordinates: [RouteCoordinate] = (0..<9).map { [0.0 + Double($0) / 100, 10.0] }

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.map(\.localDateKey), ["2023-09-29", "2023-09-30"])
        XCTAssertEqual(days.map { $0.coordinates.count }, [4, 5])
    }

    /// The timezone regression this feature must not repeat (the EXIF `DateTimeOriginal`-as-UTC
    /// finding). At UTC-5, an evening still on the trail has already crossed *UTC* midnight; bucketing
    /// by the UTC date would cut the day in the wrong place.
    func testEveningPointsStayOnTheirLocalDayWestOfUTC() {
        let coordinates: [RouteCoordinate] = [
            [-72.50, -13.16], [-72.52, -13.18],   // 08:00 and 19:30 LOCAL on 29 Sep
            [-72.54, -13.20],                     // 08:00 local on 30 Sep
        ]
        let times: [Date?] = [
            date("2023-09-29T13:00:00Z"),   // 08:00 local (UTC-5)
            date("2023-09-30T00:30:00Z"),   // 19:30 local, SAME local day — the trap
            date("2023-09-30T13:00:00Z"),   // 08:00 local next day
        ]

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.map(\.localDateKey), ["2023-09-29", "2023-09-30"])
        XCTAssertEqual(days[0].coordinates.count, 2,
                       "the 19:30-local point belongs to the day it was walked, not the next UTC date")
        XCTAssertEqual(days[1].coordinates.count, 1)
    }

    func testDeriveIsEmptyWhenNoPointCarriesATime() {
        let coordinates: [RouteCoordinate] = [[37.25, -3.10], [37.26, -3.11]]
        XCTAssertTrue(GPXTrackDays.derive(coordinates: coordinates, times: [nil, nil]).isEmpty,
                      "a track with no timestamps cannot say how many days it spans")
        XCTAssertTrue(GPXTrackDays.derive(coordinates: coordinates, times: []).isEmpty)
    }

    func testUntimedAndMalformedPointsAreSkippedWithoutLosingTheRest() {
        let coordinates: [RouteCoordinate] = [[37.25, -3.10], [37.26], [.nan, -3.11], [37.28, -3.12]]
        let times: [Date?] = [date("2023-09-29T06:00:00Z"), date("2023-09-29T07:00:00Z"),
                              date("2023-09-29T08:00:00Z"), nil]

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.count, 1)
        XCTAssertEqual(days[0].coordinates, [[37.25, -3.10]],
                       "short, non-finite and untimed points all drop out")
    }

    func testOutOfOrderPointsAreSortedBeforeGrouping() {
        let coordinates: [RouteCoordinate] = [[37.30, -3.12], [37.25, -3.10]]
        let times: [Date?] = [date("2023-09-29T14:00:00Z"), date("2023-09-29T06:00:00Z")]

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times)

        XCTAssertEqual(days.count, 1)
        XCTAssertEqual(days[0].start, date("2023-09-29T06:00:00Z"))
        XCTAssertEqual(days[0].coordinates.first, [37.25, -3.10], "chronological, not document, order")
    }

    // MARK: - Per-day route math

    func testEachDaysDistanceAndElevationComeFromOnlyItsOwnPoints() {
        // Day 1 climbs 1000 m over ~1° of longitude; day 2 descends 500 m over ~0.5°.
        let coordinates: [RouteCoordinate] = [
            [37.00, 0.0, 1000], [38.00, 0.0, 2000],
            [38.00, 0.0, 2000], [38.50, 0.0, 1500],
        ]
        let times: [Date?] = [
            date("2023-09-29T06:00:00Z"), date("2023-09-29T14:00:00Z"),
            date("2023-09-30T06:00:00Z"), date("2023-09-30T14:00:00Z"),
        ]

        let days = GPXTrackDays.derive(coordinates: coordinates, times: times, utcOffsetSeconds: 0)

        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days[0].elevationGain, 1000)
        XCTAssertEqual(days[0].elevationLoss, 0)
        XCTAssertEqual(days[1].elevationGain, 0)
        XCTAssertEqual(days[1].elevationLoss, 500)
        // Distances are each day's own span, and the two must sum to the whole track's length.
        XCTAssertEqual(days[0].distanceKm,
                       JourneyDraft.totalDistanceKm(route: Array(coordinates[0...1])), accuracy: 1e-6)
        XCTAssertEqual(days[1].distanceKm,
                       JourneyDraft.totalDistanceKm(route: Array(coordinates[2...3])), accuracy: 1e-6)
        XCTAssertGreaterThan(days[0].distanceKm, days[1].distanceKm)
    }

    func testDayIsLocatedAtWhereItEnded() {
        let coordinates: [RouteCoordinate] = [[37.00, 0.0, 1000], [38.00, 0.5, 2400]]
        let times: [Date?] = [date("2023-09-29T06:00:00Z"), date("2023-09-29T14:00:00Z")]

        let day = GPXTrackDays.derive(coordinates: coordinates, times: times, utcOffsetSeconds: 0)[0]

        XCTAssertEqual(day.endCoordinate, [38.00, 0.5], "the camp you reached, not the one you left")
        XCTAssertEqual(day.endElevation, 2400)
        XCTAssertEqual(day.duration, 8 * 3600)
    }

    // MARK: - DraftDay adapter

    func testDaysFromTrackPointsProposePlaceholderNamedDaysThatRoundTripTheirDateLabel() {
        let coordinates: [RouteCoordinate] = [[37.25, -3.10, 1800], [37.30, -3.12, 2100],
                                              [37.32, -3.14, 2200], [37.36, -3.16, 2800]]
        let times: [Date?] = [date("2023-09-29T06:00:00Z"), date("2023-09-29T14:00:00Z"),
                              date("2023-09-30T06:00:00Z"), date("2023-09-30T14:00:00Z")]

        let days = JourneyDraft.days(fromTrackPoints: coordinates, times: times)

        XCTAssertEqual(days.map(\.name), ["Day 1", "Day 2"])
        XCTAssertEqual(days.map(\.source), [.gpxTrackpoints, .gpxTrackpoints])
        XCTAssertEqual(days[0].coordinates, [37.30, -3.12], "located where the day ended")
        XCTAssertEqual(days[0].elevation, 2100)
        XCTAssertEqual(days.map(\.dateLabel), ["29 Sep 2023", "30 Sep 2023"])
        // The label must be readable back, or auto-dates and weather enrichment silently stop working.
        XCTAssertNotNil(JourneyDraft.date(fromDayLabel: days[0].dateLabel))
        let range = JourneyDraft.dateRange(fromDays: days)
        XCTAssertNotNil(range)
        // Placeholder names, so an untouched import stays replaceable by "Replace route".
        XCTAssertTrue(JourneyDraft.daysAreAllAutoSeeded(days))
        var renamed = days
        renamed[0].name = "Shira Camp"
        XCTAssertFalse(JourneyDraft.daysAreAllAutoSeeded(renamed),
                       "once named, a trackpoint day is the user's work")
    }

    // MARK: - days(fromGPX:) — the one call the creation flow needs

    func testDaysFromGPXPrefersAuthoredWaypointsWhenThereAreAny() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <wpt lat="-3.10" lon="37.25"><name>Machame Gate</name></wpt>
          <trk><trkseg>
            <trkpt lat="-3.10" lon="37.25"><time>2023-09-29T06:00:00Z</time></trkpt>
            <trkpt lat="-3.11" lon="37.26"><time>2023-09-30T06:00:00Z</time></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let days = JourneyDraft.days(fromGPX: try GPXParser.parse(gpx))

        XCTAssertEqual(days.map(\.name), ["Machame Gate"],
                       "real names from the file beat two placeholder days")
        XCTAssertEqual(days.map(\.source), [.gpxWaypoint])
    }

    /// The DIFF-09 headline: the Strava/Garmin shape — thousands of trackpoints, zero `<wpt>` —
    /// which used to yield a route and no days at all.
    func testDaysFromGPXDerivesDaysForAWaypointlessStravaStyleTrack() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx creator="StravaGPX" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><name>Kilimanjaro</name><trkseg>
            <trkpt lat="-3.10" lon="37.25"><ele>1800</ele><time>2023-09-29T06:00:00Z</time></trkpt>
            <trkpt lat="-3.12" lon="37.30"><ele>2100</ele><time>2023-09-29T14:00:00Z</time></trkpt>
            <trkpt lat="-3.14" lon="37.32"><ele>2200</ele><time>2023-09-30T06:00:00Z</time></trkpt>
            <trkpt lat="-3.16" lon="37.36"><ele>2800</ele><time>2023-09-30T14:00:00Z</time></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertTrue(file.waypoints.isEmpty, "precondition: the export carries no <wpt> markers")

        let days = JourneyDraft.days(fromGPX: file)

        XCTAssertEqual(days.count, 2, "two days of track, two proposed days — not zero")
        XCTAssertEqual(days.map(\.dateLabel), ["29 Sep 2023", "30 Sep 2023"])
        XCTAssertEqual(days[1].elevation, 2800)
    }

    func testDaysFromGPXIsEmptyForABareGeometryTrackWithNoTimesOrWaypoints() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="-3.10" lon="37.25"/>
            <trkpt lat="-3.11" lon="37.26"/>
          </trkseg></trk>
        </gpx>
        """
        let days = JourneyDraft.days(fromGPX: try GPXParser.parse(gpx))
        XCTAssertTrue(days.isEmpty, "nothing to derive days from, so nothing is invented")
    }

    // MARK: - Auto dates now reach trackpoint-only files

    func testDateRangeFromGPXUsesTrackPointTimesWhenThereAreNoWaypointTimes() throws {
        let file = GPXFile(route: Route(type: "LineString", coordinates: [[37.25, -3.10], [37.26, -3.11]]),
                           waypoints: [],
                           name: nil,
                           time: date("2023-01-01T00:00:00Z"),
                           droppedPointCount: 0,
                           trackPointTimes: [date("2023-09-29T06:00:00Z"),
                                             date("2023-10-01T14:00:00Z")])

        let range = try XCTUnwrap(JourneyDraft.dateRange(fromGPX: file))
        XCTAssertEqual(range.start, date("2023-09-29T06:00:00Z"))
        XCTAssertEqual(range.end, date("2023-10-01T14:00:00Z"),
                       "a true range from the track, not the degenerate metadata instant")
    }
}
