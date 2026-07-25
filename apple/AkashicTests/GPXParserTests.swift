import XCTest
@testable import Akashic

/// GPX import (§4.1). Pins the lat/lng swap, round-trips `GPXBuilder`'s export, and covers the
/// wild inputs the parser must tolerate (Strava/Garmin/komoot namespaces + extensions, CDATA,
/// missing elevation, out-of-range points, empty/malformed files).
final class GPXParserTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    // MARK: - The critical swap pin

    func testLatLonAttributesMapToLngLatOrder() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="10.5" lon="20.25"><ele>100</ele></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        // GPX is lat-first; the domain route is [lng, lat, ele]. This is THE swap.
        XCTAssertEqual(file.route.coordinates.first, [20.25, 10.5, 100])
    }

    // MARK: - Round-trip with GPXBuilder

    func testRoundTripsGPXBuilderOutput() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let gpx = GPXBuilder.gpx(for: journey)

        let file = try GPXParser.parse(gpx)

        // Route survives with identical [lng, lat, ele] triples (6-decimal export precision).
        XCTAssertEqual(file.route.coordinates.count, journey.route.coordinates.count)
        for (parsed, original) in zip(file.route.coordinates, journey.route.coordinates) {
            XCTAssertEqual(parsed[0], original[0], accuracy: 1e-4, "longitude")
            XCTAssertEqual(parsed[1], original[1], accuracy: 1e-4, "latitude")
            if original.count >= 3 {
                XCTAssertEqual(parsed[2], original[2], accuracy: 1e-3, "elevation")
            }
        }

        // Camps come back as waypoints, in day order, with names + elevations preserved.
        XCTAssertEqual(file.waypoints.count, journey.camps.count)
        let firstCamp = try XCTUnwrap(journey.camps.sorted { $0.dayNumber < $1.dayNumber }.first)
        let firstWpt = try XCTUnwrap(file.waypoints.first)
        XCTAssertEqual(firstWpt.name, firstCamp.name)
        XCTAssertEqual(firstWpt.coordinates[0], firstCamp.coordinates[0], accuracy: 1e-4)
        XCTAssertEqual(firstWpt.coordinates[1], firstCamp.coordinates[1], accuracy: 1e-4)
        XCTAssertEqual(Int(firstWpt.elevation ?? -1), firstCamp.elevation)
    }

    // MARK: - Strava-style (namespaces + extensions)

    func testStravaExtensionsAreIgnored() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx creator="StravaGPX" version="1.1"
             xmlns="http://www.topografix.com/GPX/1/1"
             xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
          <metadata><time>2023-09-29T06:00:00Z</time></metadata>
          <trk>
            <name>Morning Hike</name>
            <trkseg>
              <trkpt lat="-3.0031" lon="37.1479">
                <ele>2404</ele>
                <time>2023-09-29T06:00:00Z</time>
                <extensions>
                  <gpxtpx:TrackPointExtension><gpxtpx:hr>142</gpxtpx:hr></gpxtpx:TrackPointExtension>
                </extensions>
              </trkpt>
              <trkpt lat="-3.0041" lon="37.1489"><ele>2410</ele></trkpt>
            </trkseg>
          </trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertEqual(file.route.coordinates.count, 2, "the <hr> extension must not become a point")
        XCTAssertEqual(file.route.coordinates.first, [37.1479, -3.0031, 2404])
        XCTAssertEqual(file.name, "Morning Hike", "no metadata name → falls back to the track name")
        XCTAssertNotNil(file.time)
        XCTAssertEqual(file.droppedPointCount, 0)
    }

    // MARK: - Garmin-style (wpt-heavy, CDATA)

    func testGarminWaypointsWithCDATAAndNoRoute() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Garmin" xmlns="http://www.topografix.com/GPX/1/1">
          <wpt lat="-3.0764" lon="37.354">
            <ele>5895</ele>
            <name><![CDATA[Uhuru Peak]]></name>
            <desc>Summit of Kilimanjaro</desc>
            <time>2023-10-03T07:12:00Z</time>
          </wpt>
          <wpt lat="-3.0674" lon="37.3556">
            <name>Barafu Camp</name>
            <ele>4673</ele>
          </wpt>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertTrue(file.route.coordinates.isEmpty, "no track → no route")
        XCTAssertFalse(file.isEmpty, "waypoints alone make a valid file")
        XCTAssertEqual(file.waypoints.count, 2)

        let uhuru = try XCTUnwrap(file.waypoints.first)
        XCTAssertEqual(uhuru.name, "Uhuru Peak", "CDATA name decoded")
        XCTAssertEqual(uhuru.coordinates, [37.354, -3.0764, 5895])
        XCTAssertEqual(uhuru.elevation, 5895)
        XCTAssertEqual(uhuru.desc, "Summit of Kilimanjaro")
        XCTAssertNotNil(uhuru.time)
    }

    // MARK: - Missing elevation

    func testMissingElevationYieldsTwoElementCoordinate() throws {
        let gpx = """
        <gpx version="1.0" xmlns="http://www.topografix.com/GPX/1/0">
          <trk><trkseg><trkpt lat="59.9" lon="10.7"></trkpt></trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertEqual(file.route.coordinates.first, [10.7, 59.9], "2-element coord when <ele> absent")
    }

    // MARK: - Out-of-range points are dropped and counted

    func testOutOfRangePointsAreDroppedAndCounted() throws {
        let gpx = """
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk><trkseg>
            <trkpt lat="10.0" lon="20.0"><ele>5</ele></trkpt>
            <trkpt lat="200.0" lon="20.0"><ele>5</ele></trkpt>
            <trkpt lat="10.0" lon="400.0"><ele>5</ele></trkpt>
          </trkseg></trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertEqual(file.route.coordinates.count, 1)
        XCTAssertEqual(file.droppedPointCount, 2)
    }

    // MARK: - Multiple trksegs / trks concatenate in document order

    func testMultipleSegmentsAndTracksConcatenateInOrder() throws {
        let gpx = """
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk>
            <trkseg><trkpt lat="1" lon="1"/></trkseg>
            <trkseg><trkpt lat="2" lon="2"/></trkseg>
          </trk>
          <trk>
            <trkseg><trkpt lat="3" lon="3"/></trkseg>
          </trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertEqual(file.route.coordinates, [[1, 1], [2, 2], [3, 3]])
    }

    // MARK: - Error cases

    func testEmptyFileThrowsEmpty() {
        XCTAssertThrowsError(try GPXParser.parse("")) { XCTAssertEqual($0 as? GPXParseError, .empty) }
        XCTAssertThrowsError(try GPXParser.parse("   \n\t ")) { XCTAssertEqual($0 as? GPXParseError, .empty) }
    }

    func testMalformedXMLThrowsMalformed() {
        XCTAssertThrowsError(try GPXParser.parse("<gpx><trk><trkseg>")) { error in
            guard case GPXParseError.malformed = error else {
                return XCTFail("expected .malformed, got \(error)")
            }
        }
    }

    func testValidXMLWithNoPointsThrowsNoContent() {
        let gpx = """
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <metadata><name>Empty</name></metadata>
        </gpx>
        """
        XCTAssertThrowsError(try GPXParser.parse(gpx)) { XCTAssertEqual($0 as? GPXParseError, .noContent) }
    }

    func testErrorsAreUserPresentable() {
        XCTAssertFalse((GPXParseError.empty.errorDescription ?? "").isEmpty)
        XCTAssertFalse((GPXParseError.noContent.errorDescription ?? "").isEmpty)
        XCTAssertFalse((GPXParseError.malformed("x").errorDescription ?? "").isEmpty)
        XCTAssertFalse((GPXParseError.tooLarge(maxBytes: 25 * 1024 * 1024).errorDescription ?? "").isEmpty)
    }

    // MARK: - Route-only GPX (<rte>/<rtept>) — advertised Garmin/RideWithGPS/OsmAnd exports

    func testRouteOnlyGPXIsAcceptedAsARoute() throws {
        let gpx = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Garmin BaseCamp" xmlns="http://www.topografix.com/GPX/1/1">
          <rte>
            <name>Planned route</name>
            <rtept lat="-3.0031" lon="37.1479"><ele>2404</ele></rtept>
            <rtept lat="-3.0041" lon="37.1489"><ele>2410</ele></rtept>
            <rtept lat="-3.0051" lon="37.1499"></rtept>
          </rte>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertFalse(file.isEmpty, "a route-only file is valid, not .noContent")
        XCTAssertEqual(file.route.coordinates.count, 3, "<rtept> points become the route")
        XCTAssertEqual(file.route.coordinates.first, [37.1479, -3.0031, 2404], "lat/lng swap applies to rtept")
    }

    // MARK: - trkpt directly under <trk> (no <trkseg>) must still be flushed

    func testTrackPointsWithoutTrkSegAreFlushed() throws {
        let gpx = """
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <trk>
            <trkpt lat="59.9" lon="10.7"><ele>10</ele></trkpt>
            <trkpt lat="59.8" lon="10.6"><ele>12</ele></trkpt>
          </trk>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        XCTAssertEqual(file.route.coordinates.count, 2,
                       "trkpt under <trk> without a <trkseg> is flushed on </trk>, not discarded")
        XCTAssertEqual(file.droppedPointCount, 0)
    }

    // MARK: - Zone-less <time> parses (as UTC) instead of dropping the day label

    func testZonelessTimeParsesAsUTC() throws {
        let gpx = """
        <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
          <wpt lat="-3.0764" lon="37.354">
            <name>Camp</name>
            <time>2023-09-29T06:00:00</time>
          </wpt>
        </gpx>
        """
        let file = try GPXParser.parse(gpx)
        let wpt = try XCTUnwrap(file.waypoints.first)
        let time = try XCTUnwrap(wpt.time, "a zone-less <time> must parse, not drop to nil")
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        XCTAssertEqual(utc.component(.hour, from: time), 6, "parsed as UTC 06:00")
        // Zone-suffixed forms still work.
        XCTAssertNotNil(GPXParserDelegate.parseTime("2023-09-29T06:00:00Z"))
    }

    // MARK: - Oversized file is rejected before it can freeze the UI

    func testOversizedFileThrowsTooLarge() throws {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-big-\(UUID().uuidString).gpx")
        try Data(count: 40 * 1024 * 1024).write(to: url)   // 40 MB > 25 MB cap
        defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try GPXParser.parse(contentsOf: url)) { error in
            guard case GPXParseError.tooLarge = error else {
                return XCTFail("expected .tooLarge, got \(error)")
            }
        }
    }
}
