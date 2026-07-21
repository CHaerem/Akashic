import XCTest
import CoreData
@testable import Akashic

/// Tests for the export reader (`ExportBundle`) and the local importer (`LocalImporter`),
/// both against tiny inline fixtures and — when the real export is present on disk — the
/// actual family data (filesystem-gated, so CI without the export still passes).
final class ImportTests: XCTestCase {

    private var bundleForTests: Bundle { Bundle(for: type(of: self)) }

    private func inMemoryContext() -> NSManagedObjectContext {
        PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundleForTests)
            .container.viewContext
    }

    // MARK: - GeoCoordinate: both encodings

    func testGeoCoordinateDecodesGeoJSONPoint() throws {
        let data = #"{"type":"Point","coordinates":[37.31,-0.15]}"#.data(using: .utf8)!
        let c = try ExportBundle.decoder.decode(GeoCoordinate.self, from: data)
        XCTAssertEqual(c.longitude, 37.31, accuracy: 1e-9)
        XCTAssertEqual(c.latitude, -0.15, accuracy: 1e-9)
        XCTAssertEqual(c.lngLat, [37.31, -0.15])
    }

    func testGeoCoordinateDecodesBareArray() throws {
        let data = "[37.44, -0.16]".data(using: .utf8)!
        let c = try ExportBundle.decoder.decode(GeoCoordinate.self, from: data)
        XCTAssertEqual(c.lngLat, [37.44, -0.16])
    }

    // MARK: - Row decoding (tolerant, snake_case, nested JSONB)

    func testJourneyRowDecodesNestedStatsAndRoute() throws {
        let json = #"""
        [{"id":"J1","slug":"j1","name":"Test","country":"Norway","description":"d",
          "date_started":"2024-01-01","is_public":true,"total_days":2,"total_distance":10,
          "center_coordinates":[10.0,60.0],"unknown_future_column":"ignored",
          "route":{"type":"LineString","coordinates":[[10.0,60.0,100],[10.02,60.0,150]]},
          "stats":{"duration":2,"totalDistance":10,"totalElevationGain":100,
                   "totalElevationLoss":50,
                   "highestPoint":{"name":"Top","elevation":200,"coordinates":[10.01,60.0]}}}]
        """#.data(using: .utf8)!
        let rows = try ExportBundle.decodeRows([JourneyRow].self, from: json)
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row.id, "J1")
        XCTAssertEqual(row.isPublic, true)
        XCTAssertEqual(row.centerCoordinates?.lngLat, [10.0, 60.0])
        XCTAssertEqual(row.route?.coordinates.count, 2)
        XCTAssertEqual(row.stats?.duration, 2)
        XCTAssertEqual(row.stats?.highestPoint?.name, "Top")
        XCTAssertEqual(row.stats?.totalElevationGain, 100)
    }

    func testWaypointRowDecodesWeatherAndHighlights() throws {
        let json = #"""
        [{"id":"W1","journey_id":"J1","name":"Camp","day_number":1,"coordinates":[10.0,60.0],
          "elevation":100,"sort_order":0,"route_distance_km":1.5,"route_point_index":3,
          "highlights":["A","B"],
          "weather":{"temperature_max":5.0,"temperature_min":1.0,"weather_code":2}}]
        """#.data(using: .utf8)!
        let rows = try ExportBundle.decodeRows([WaypointRow].self, from: json)
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row.coordinates.lngLat, [10.0, 60.0])
        XCTAssertEqual(row.highlights, ["A", "B"])
        XCTAssertEqual(row.routeDistanceKm, 1.5)
        XCTAssertEqual(row.routePointIndex, 3)
        XCTAssertEqual(row.weather?.temperatureMax, 5.0)
        XCTAssertEqual(row.weather?.weatherCode, 2)
    }

    func testPhotoRowDecodesBothCoordinateEncodingsAndNull() throws {
        let json = #"""
        [{"id":"P1","journey_id":"J1","url":"a.jpg",
          "coordinates":{"type":"Point","coordinates":[1.0,2.0]}},
         {"id":"P2","journey_id":"J1","url":"b.jpg","coordinates":[3.0,4.0]},
         {"id":"P3","journey_id":"J1","url":"c.jpg","coordinates":null}]
        """#.data(using: .utf8)!
        let rows = try ExportBundle.decodeRows([PhotoRow].self, from: json)
        XCTAssertEqual(rows[0].coordinates?.lngLat, [1.0, 2.0])
        XCTAssertEqual(rows[1].coordinates?.lngLat, [3.0, 4.0])
        XCTAssertNil(rows[2].coordinates)
    }

    // MARK: - Inline bundle for importer tests

    private func makeInlineBundle() throws -> ExportBundle {
        let journeys = #"""
        [{"id":"J1","slug":"j1","name":"Test Journey","country":"Norway","description":"d",
          "date_started":"2024-01-01","is_public":true,"total_days":2,"total_distance":10,
          "center_coordinates":[10.0,60.0],
          "route":{"type":"LineString","coordinates":[[10.0,60.0,100],[10.01,60.0,200],[10.02,60.0,150]]},
          "stats":{"duration":2,"totalDistance":10,"totalElevationGain":100,"totalElevationLoss":50,
                   "highestPoint":{"name":"Top","elevation":200,"coordinates":[10.01,60.0]}}}]
        """#.data(using: .utf8)!
        let waypoints = #"""
        [{"id":"W1","journey_id":"J1","name":"Camp 1","day_number":1,"coordinates":[10.0,60.0],
          "elevation":100,"sort_order":0,"route_point_index":0,"route_distance_km":0.0,"highlights":["View"]},
         {"id":"W2","journey_id":"J1","name":"Camp 2","day_number":2,"coordinates":[10.02,60.0],
          "elevation":150,"sort_order":1,"route_point_index":2,"route_distance_km":1.5}]
        """#.data(using: .utf8)!
        let photos = #"""
        [{"id":"P1","journey_id":"J1","waypoint_id":"W1","url":"journeys/J1/photos/P1.jpg",
          "thumbnail_url":"journeys/J1/photos/P1_thumb.jpg",
          "coordinates":{"type":"Point","coordinates":[10.0,60.0]},
          "taken_at":"2024-01-01T10:00:00+00:00","sort_order":0,"rotation":90,"media_type":"image"},
         {"id":"P2","journey_id":"J1","url":"journeys/J1/photos/P2.jpg",
          "thumbnail_url":"journeys/J1/photos/P2_thumb.jpg","coordinates":[10.01,60.0],
          "sort_order":1,"media_type":"video","duration":12},
         {"id":"P3","journey_id":"J1","url":"journeys/J1/photos/P3.jpg",
          "thumbnail_url":"journeys/J1/photos/P3_thumb.jpg","coordinates":null,"sort_order":2},
         {"id":"P4","journey_id":"ORPHAN","url":"journeys/ORPHAN/photos/P4.jpg","sort_order":0}]
        """#.data(using: .utf8)!
        return ExportBundle(
            journeys: try ExportBundle.decodeRows([JourneyRow].self, from: journeys),
            waypoints: try ExportBundle.decodeRows([WaypointRow].self, from: waypoints),
            photos: try ExportBundle.decodeRows([PhotoRow].self, from: photos))
    }

    /// Temp media root with SOME files present (P1 original+thumb, P2 original only, P3 none).
    private func makeMediaRoot() throws -> URL {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-media-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("journeys/J1/photos")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let bytes = Data("jpeg".utf8)
        try bytes.write(to: dir.appendingPathComponent("P1.jpg"))
        try bytes.write(to: dir.appendingPathComponent("P1_thumb.jpg"))
        try bytes.write(to: dir.appendingPathComponent("P2.jpg"))
        return root
    }

    // MARK: - Importer

    func testImportReportCountsAndMediaResolution() throws {
        let context = inMemoryContext()
        let bundle = try makeInlineBundle()
        let media = MediaResolver(root: try makeMediaRoot())

        let report = LocalImporter(context: context).run(bundle: bundle, media: media)

        XCTAssertEqual(report.journeysCreated, 1)
        XCTAssertEqual(report.journeysUpdated, 0)
        XCTAssertEqual(report.waypointsImported, 2)
        XCTAssertEqual(report.photosCreated, 3)          // P1, P2, P3
        XCTAssertEqual(report.photosSkipped, 1)          // P4 (orphan journey)
        XCTAssertEqual(report.originalsResolved, 2)      // P1.jpg, P2.jpg
        XCTAssertEqual(report.thumbsResolved, 1)         // P1_thumb.jpg
        XCTAssertEqual(report.photosMissingMedia, 1)     // P3 has nothing on disk
    }

    func testImportPreservesUUIDsAndLinksRelationships() throws {
        let context = inMemoryContext()
        LocalImporter(context: context).run(bundle: try makeInlineBundle(),
                                            media: MediaResolver(root: try makeMediaRoot()))

        // Journey / waypoint / photo keep their original ids.
        let jr = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        jr.predicate = NSPredicate(format: "id == %@", "J1")
        XCTAssertEqual(try context.fetch(jr).count, 1)

        let pr = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        pr.predicate = NSPredicate(format: "id == %@", "P1")
        let p1 = try XCTUnwrap(try context.fetch(pr).first)
        XCTAssertEqual(p1.journeyId, "J1")
        XCTAssertEqual(p1.waypointId, "W1")
        XCTAssertEqual(p1.rotation, 90)
        XCTAssertEqual(p1.mediaType, "image")
        XCTAssertNotNil(p1.journey, "photo should link to its journey")
        XCTAssertEqual(p1.waypoint?.id, "W1", "photo should link to its waypoint")
        XCTAssertTrue(p1.localThumbPath?.hasSuffix("P1_thumb.jpg") ?? false)
        XCTAssertTrue(p1.localOriginalPath?.hasSuffix("P1.jpg") ?? false)

        // P2: video, original present, no thumb resolved.
        pr.predicate = NSPredicate(format: "id == %@", "P2")
        let p2 = try XCTUnwrap(try context.fetch(pr).first)
        XCTAssertEqual(p2.mediaType, "video")
        XCTAssertEqual(p2.duration, 12)
        XCTAssertTrue(p2.localOriginalPath?.hasSuffix("P2.jpg") ?? false)
        XCTAssertNil(p2.localThumbPath)
    }

    func testImportIsIdempotent() throws {
        let context = inMemoryContext()
        let media = MediaResolver(root: try makeMediaRoot())
        let importer = LocalImporter(context: context)

        _ = importer.run(bundle: try makeInlineBundle(), media: media)

        // Simulate native edits between imports: a photo caption + rotation and a waypoint name.
        let pReq = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        pReq.predicate = NSPredicate(format: "id == %@", "P1")
        let editedPhoto = try XCTUnwrap(try context.fetch(pReq).first)
        editedPhoto.caption = "Native caption"
        editedPhoto.rotation = 180                    // bundle says 90; the edit must win
        let wReq = NSFetchRequest<CDWaypoint>(entityName: "CDWaypoint")
        wReq.predicate = NSPredicate(format: "id == %@", "W1")
        let editedWaypoint = try XCTUnwrap(try context.fetch(wReq).first)
        editedWaypoint.name = "Native Camp Name"      // bundle says "Camp 1"
        try context.save()

        let second = importer.run(bundle: try makeInlineBundle(), media: media)

        // Second run updates in place — no duplicates.
        XCTAssertEqual(second.journeysCreated, 0)
        XCTAssertEqual(second.journeysUpdated, 1)
        XCTAssertEqual(second.photosCreated, 0)
        XCTAssertEqual(second.photosUpdated, 3)

        let jCount = try context.count(for: NSFetchRequest<CDJourney>(entityName: "CDJourney"))
        let wCount = try context.count(for: NSFetchRequest<CDWaypoint>(entityName: "CDWaypoint"))
        let pCount = try context.count(for: NSFetchRequest<CDPhoto>(entityName: "CDPhoto"))
        XCTAssertEqual(jCount, 1)
        XCTAssertEqual(wCount, 2)
        XCTAssertEqual(pCount, 3)

        // Native edits survive the re-import (only structural/media fields are refreshed).
        let photoAfter = try XCTUnwrap(try context.fetch(pReq).first)
        XCTAssertEqual(photoAfter.caption, "Native caption", "edited caption must survive re-import")
        XCTAssertEqual(photoAfter.rotation, 180, "edited rotation must survive re-import")
        let waypointAfter = try XCTUnwrap(try context.fetch(wReq).first)
        XCTAssertEqual(waypointAfter.name, "Native Camp Name", "edited waypoint name must survive re-import")
    }

    func testDomainMappingProducesDisplayableJourneyAndPhotos() throws {
        let bundle = try makeInlineBundle()
        let journeys = ExportMapper.journeys(from: bundle)
        let j = try XCTUnwrap(journeys.first)
        XCTAssertEqual(j.id, "J1")
        XCTAssertEqual(j.slug, "j1")
        XCTAssertEqual(j.camps.count, 2)
        XCTAssertEqual(j.camps.map(\.dayNumber), [1, 2])
        // Per-day stats were recomputed from the route (day 2 has a positive distance).
        XCTAssertGreaterThan(j.camps[1].dayDistance, 0)

        let media = MediaResolver(root: try makeMediaRoot())
        let photos = ExportMapper.photos(from: bundle, media: media)
        let p1 = try XCTUnwrap(photos.first { $0.id == "P1" })
        XCTAssertNotNil(p1.thumbnailFileURL)
        XCTAssertEqual(p1.coordinates, [10.0, 60.0])
    }

    // MARK: - Filesystem-gated integration against the REAL export

    /// Path of the real export produced tonight (read-only). Tests below are skipped when
    /// it isn't present, so the suite still passes on machines without the family data.
    private static let realExportRoot = URL(fileURLWithPath: "/Users/cher/Privat/AkashicExport-20260722")

    private func realExportAvailable() -> Bool {
        FileManager.default.fileExists(
            atPath: Self.realExportRoot.appendingPathComponent("supabase/journeys.json").path)
    }

    func testRealExportBundleLoads() throws {
        try XCTSkipUnless(realExportAvailable(), "Real export not present; skipping integration test")
        let bundle = try ExportBundle.load(exportRoot: Self.realExportRoot)
        XCTAssertEqual(bundle.journeys.count, 3)
        XCTAssertEqual(bundle.waypoints.count, 18)
        XCTAssertEqual(bundle.photos.count, 1538)
        XCTAssertEqual(bundle.profiles.count, 3)
        XCTAssertEqual(Set(bundle.journeys.map(\.slug)), ["mount-kenya", "inca-trail", "kilimanjaro"])
    }

    func testRealImportRunProducesReport() throws {
        try XCTSkipUnless(realExportAvailable(), "Real export not present; skipping integration test")
        let context = inMemoryContext()
        let mediaRoot = Self.realExportRoot.appendingPathComponent("r2/objects")
        let report = try LocalImporter(context: context)
            .run(exportRoot: Self.realExportRoot, mediaRoot: mediaRoot)

        // Structural assertions that don't depend on how much media has downloaded.
        XCTAssertEqual(report.journeysCreated, 3)
        XCTAssertEqual(report.waypointsImported, 18)
        XCTAssertEqual(report.photosTotal, 1538)
        XCTAssertEqual(report.photosSkipped, 0, "every photo belongs to one of the 3 journeys")
        XCTAssertGreaterThanOrEqual(report.thumbsResolved, 0)

        // Emit the live numbers so the run can be reported.
        print("REAL IMPORT REPORT → \(report.summary)")
    }
}
