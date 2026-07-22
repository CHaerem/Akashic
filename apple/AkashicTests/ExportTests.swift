import XCTest
@testable import Akashic

/// T2.10 / D10 — the exit door. If this layer is wrong the family's way *out* of Apple is
/// wrong, so it is tested end to end: real files written to a real temporary directory,
/// then read back.
final class GPXBuilderTests: XCTestCase {

    /// The single most dangerous confusion in this file. GeoJSON is [lng, lat]; GPX writes
    /// lat then lon. Swap them and the export opens fine, in the wrong hemisphere.
    func testCoordinateOrderIsLatThenLonInOutput() {
        let journey = makeJourney(route: [[37.353, -3.067, 5895]])
        let gpx = GPXBuilder.gpx(for: journey)
        XCTAssertTrue(gpx.contains(#"<trkpt lat="-3.067000" lon="37.353000">"#), gpx)
    }

    func testElevationIsWrittenWhenPresentAndOmittedWhenNot() {
        let withElevation = GPXBuilder.gpx(for: makeJourney(route: [[10, 20, 300]]))
        XCTAssertTrue(withElevation.contains("<ele>300.000000</ele>"))

        let withoutElevation = GPXBuilder.gpx(for: makeJourney(route: [[10, 20]]))
        XCTAssertFalse(withoutElevation.contains("<ele>"), "no elevation must mean no <ele> element")
    }

    /// Better a shorter track than a track with a point in the ocean off West Africa.
    func testOutOfRangeAndMalformedCoordinatesAreDropped() {
        let journey = makeJourney(route: [
            [10, 20, 100],
            [200, 20],           // longitude out of range
            [10, 120],           // latitude out of range
            [10],                // too short
            [.nan, 20],          // not a number
            [11, 21, 110],
        ])
        let gpx = GPXBuilder.gpx(for: journey)
        XCTAssertEqual(gpx.components(separatedBy: "<trkpt").count - 1, 2)
    }

    func testCampsBecomeWaypointsOrderedByDay() {
        var journey = makeJourney(route: [[10, 20, 100]])
        journey.camps = [
            makeCamp(id: "c2", name: "Barafu", day: 2, coordinates: [37.4, -3.1]),
            makeCamp(id: "c1", name: "Shira", day: 1, coordinates: [37.2, -3.0]),
        ]
        let gpx = GPXBuilder.gpx(for: journey)
        let shira = try? XCTUnwrap(gpx.range(of: "Shira"))
        let barafu = try? XCTUnwrap(gpx.range(of: "Barafu"))
        XCTAssertNotNil(shira)
        XCTAssertNotNil(barafu)
        XCTAssertTrue(shira!.lowerBound < barafu!.lowerBound, "day 1 must come before day 2")
        XCTAssertEqual(gpx.components(separatedBy: "<wpt").count - 1, 2)
    }

    /// An ampersand in a journey name is ordinary ("Fire & Ice") and would otherwise produce a
    /// file that no XML parser will open.
    func testXMLSpecialCharactersAreEscaped() {
        var journey = makeJourney(route: [[10, 20]])
        journey.name = #"Fire & Ice <"Best" trip>"#
        let gpx = GPXBuilder.gpx(for: journey)
        XCTAssertTrue(gpx.contains("Fire &amp; Ice &lt;&quot;Best&quot; trip&gt;"))
        XCTAssertFalse(gpx.contains("Fire & Ice"))
    }

    /// The device is Norwegian. A comma decimal separator would make the coordinates invalid.
    func testNumberFormattingIsLocaleIndependent() {
        XCTAssertEqual(GPXBuilder.format(-3.0674), "-3.067400")
        XCTAssertFalse(GPXBuilder.format(1.5).contains(","))
    }

    func testEmptyRouteStillProducesValidGPXWithWaypoints() {
        var journey = makeJourney(route: [])
        journey.camps = [makeCamp(id: "c1", name: "Base", day: 1, coordinates: [10, 20])]
        let gpx = GPXBuilder.gpx(for: journey)
        XCTAssertFalse(gpx.contains("<trk>"))
        XCTAssertTrue(gpx.contains("<wpt"))
        XCTAssertTrue(gpx.hasSuffix("</gpx>\n"))
    }
}

// MARK: - Exporter

final class JourneyExporterTests: XCTestCase {

    private var workspace: URL!
    private var mediaDirectory: URL!

    override func setUpWithError() throws {
        workspace = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-export-\(UUID().uuidString)", isDirectory: true)
        mediaDirectory = workspace.appendingPathComponent("media", isDirectory: true)
        try FileManager.default.createDirectory(at: mediaDirectory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: workspace)
    }

    func testExportWritesRouteJSONAndReadme() throws {
        let result = try JourneyExporter().writeExport(
            journey: makeJourney(route: [[10, 20, 100]]), photos: [], comments: [], into: workspace)

        let files = try FileManager.default.contentsOfDirectory(atPath: result.fileURL.path)
        XCTAssertTrue(files.contains("route.gpx"))
        XCTAssertTrue(files.contains("journey.json"))
        XCTAssertTrue(files.contains("README.txt"))
    }

    /// The JSON is the durable half of the export — it must decode without this codebase, so
    /// at minimum it must decode as plain JSON with the documented top-level keys.
    func testJSONPayloadIsSelfDescribingAndComplete() throws {
        let journey = makeJourney(route: [[10, 20, 100]])
        let comment = DayComment(id: "cm1", waypointId: "c1", journeyId: journey.id,
                                 authorName: "Ada", content: "Cold up here",
                                 createdAt: Date(timeIntervalSince1970: 0),
                                 updatedAt: Date(timeIntervalSince1970: 0), isMine: true)
        let result = try JourneyExporter().writeExport(
            journey: journey, photos: [], comments: [comment], into: workspace)

        let data = try Data(contentsOf: result.fileURL.appendingPathComponent("journey.json"))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["format"] as? String, JourneyExporter.formatVersion)
        XCTAssertNotNil(object["exportedAt"])
        XCTAssertNotNil(object["journey"])
        XCTAssertEqual((object["comments"] as? [[String: Any]])?.count, 1)
    }

    func testPhotosAreCopiedInAlbumOrder() throws {
        let first = try makePhotoFile(named: "sunrise.jpg", id: "p1", sortOrder: 0)
        let second = try makePhotoFile(named: "summit.jpg", id: "p2", sortOrder: 1)

        let result = try JourneyExporter().writeExport(
            journey: makeJourney(route: []), photos: [second, first], comments: [], into: workspace)

        let names = try FileManager.default
            .contentsOfDirectory(atPath: result.fileURL.appendingPathComponent("photos").path)
            .sorted()
        XCTAssertEqual(result.photoCount, 2)
        XCTAssertTrue(result.isComplete)
        XCTAssertTrue(names[0].hasPrefix("0001-sunrise"), names.description)
        XCTAssertTrue(names[1].hasPrefix("0002-summit"), names.description)
    }

    /// A photo whose bytes are not on the device must be *reported*, never quietly skipped:
    /// the user would otherwise archive an incomplete export believing it whole.
    func testMissingPhotoBytesAreReportedAndNotedInTheReadme() throws {
        var ghost = try makePhotoFile(named: "gone.jpg", id: "p9", sortOrder: 0)
        try FileManager.default.removeItem(at: URL(fileURLWithPath: ghost.localOriginalPath!))
        ghost.localOriginalPath = nil
        ghost.url = "missing/gone.jpg"

        let result = try JourneyExporter().writeExport(
            journey: makeJourney(route: []), photos: [ghost], comments: [], into: workspace)

        XCTAssertEqual(result.photoCount, 0)
        XCTAssertEqual(result.missingPhotos, ["p9"])
        XCTAssertFalse(result.isComplete)

        let readme = try String(contentsOf: result.fileURL.appendingPathComponent("README.txt"),
                                encoding: .utf8)
        XCTAssertTrue(readme.contains("1 photo(s) could not be included"), readme)
    }

    func testPhotosCanBeExcluded() throws {
        let photo = try makePhotoFile(named: "sunrise.jpg", id: "p1", sortOrder: 0)
        var options = JourneyExporter.Options()
        options.includePhotos = false

        let result = try JourneyExporter().writeExport(
            journey: makeJourney(route: []), photos: [photo], comments: [],
            into: workspace, options: options)

        XCTAssertEqual(result.photoCount, 0)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: result.fileURL.appendingPathComponent("photos").path))
    }

    /// A journey called "Sør/Nord: 2024" must not create nested directories or an unopenable
    /// archive on Windows.
    func testFolderNamesAreFilesystemSafe() {
        var journey = makeJourney(route: [])
        journey.name = "Sør/Nord: 2024?"
        let name = JourneyExporter.safeFolderName(for: journey)
        XCTAssertFalse(name.contains("/"))
        XCTAssertFalse(name.contains(":"))
        XCTAssertFalse(name.contains("?"))
        XCTAssertTrue(name.contains("Sør"), "non-ASCII letters are fine and must survive")
    }

    func testFolderNameFallsBackWhenTheTitleSanitizesToNothing() {
        var journey = makeJourney(route: [])
        journey.name = "///"
        journey.slug = ""
        XCTAssertEqual(JourneyExporter.safeFolderName(for: journey), "journey-\(journey.id)")
    }

    func testExportingTwiceIntoTheSameFolderSucceeds() throws {
        let photo = try makePhotoFile(named: "sunrise.jpg", id: "p1", sortOrder: 0)
        let exporter = JourneyExporter()
        _ = try exporter.writeExport(journey: makeJourney(route: []), photos: [photo],
                                     comments: [], into: workspace)
        let second = try exporter.writeExport(journey: makeJourney(route: []), photos: [photo],
                                              comments: [], into: workspace)
        XCTAssertEqual(second.photoCount, 1)
    }

    func testZipProducesAFileThatOutlivesTheCoordinatedRead() throws {
        let result = try JourneyExporter().writeExport(
            journey: makeJourney(route: [[10, 20]]), photos: [], comments: [], into: workspace)

        let zip = try ExportArchive.zip(folder: result.fileURL)

        XCTAssertEqual(zip.pathExtension, "zip")
        XCTAssertTrue(FileManager.default.fileExists(atPath: zip.path),
                      "the archive must be copied out inside the accessor block, or it is gone")
        let size = try FileManager.default.attributesOfItem(atPath: zip.path)[.size] as? Int ?? 0
        XCTAssertGreaterThan(size, 0)
    }

    // MARK: Helpers

    private func makePhotoFile(named name: String, id: String, sortOrder: Int) throws -> Photo {
        let url = mediaDirectory.appendingPathComponent(name)
        try Data("not really a jpeg".utf8).write(to: url)
        var photo = Photo(id: id, journeyId: "j1", url: "photos/\(name)")
        photo.localOriginalPath = url.path
        photo.sortOrder = sortOrder
        return photo
    }
}

// MARK: - Shared fixtures

private func makeJourney(route coordinates: [[Double]]) -> Journey {
    Journey(id: "j1", slug: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania",
            description: "Lemosho route",
            stats: TrekStats(duration: 8, totalDistance: 70, totalElevationGain: 4500,
                             totalElevationLoss: 4200, highestPoint: nil),
            route: Route(type: "LineString", coordinates: coordinates),
            camps: [])
}

private func makeCamp(id: String, name: String, day: Int, coordinates: [Double]) -> Camp {
    Camp(id: id, name: name, dayNumber: day, elevation: 3900,
         coordinates: coordinates, notes: "", highlights: [])
}
