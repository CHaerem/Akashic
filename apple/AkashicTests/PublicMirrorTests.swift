import XCTest
import CloudKit
import CoreLocation
@testable import Akashic

/// Tests for the public showcase mirror (T3.3): `PublicMirrorBuilder` record construction
/// (field mapping incl. the lat/lng swap both ways, recordName conventions, dayNumber via the
/// matcher, skip-and-report on missing thumb bytes, statsJSON/waypointsJSON round-trip) and
/// `PublicMirrorPublisher` orchestration (chunking boundaries, `.allKeys`, cursor-following,
/// stale-photo diffing on update, full unpublish).
///
/// Everything runs against a mock `PublicMirrorDatabase` — no container, no iCloud account
/// (none exists in any simulator yet). Thumbnail "bytes" are real temp files.
final class PublicMirrorTests: XCTestCase {

    // MARK: - Mock public database

    final class MockPublicDatabase: PublicMirrorDatabase {
        private(set) var saved: [CKRecord.ID: CKRecord] = [:]
        private(set) var deleted: Set<CKRecord.ID> = []
        private(set) var lastSavePolicy: CKModifyRecordsOperation.RecordSavePolicy?
        private(set) var modifyCallCount = 0
        private(set) var queryCallCount = 0

        /// Pages of `PublicPhoto` IDs to hand back, consumed in order (cursor = next page index).
        var photoIDPages: [[CKRecord.ID]] = []

        func ckModifyRecords(
            saving recordsToSave: [CKRecord],
            deleting recordIDsToDelete: [CKRecord.ID],
            savePolicy: CKModifyRecordsOperation.RecordSavePolicy
        ) async throws -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>],
                           deleteResults: [CKRecord.ID: Result<Void, Error>]) {
            modifyCallCount += 1
            lastSavePolicy = savePolicy
            var saveResults: [CKRecord.ID: Result<CKRecord, Error>] = [:]
            for record in recordsToSave {
                saved[record.recordID] = record
                saveResults[record.recordID] = .success(record)
            }
            var deleteResults: [CKRecord.ID: Result<Void, Error>] = [:]
            for id in recordIDsToDelete {
                deleted.insert(id)
                saved[id] = nil
                deleteResults[id] = .success(())
            }
            return (saveResults, deleteResults)
        }

        func ckQueryPublicPhotoIDs(
            journeySlug slug: String,
            cursor: PublicMirrorCursor?,
            resultsLimit: Int
        ) async throws -> (ids: [CKRecord.ID], cursor: PublicMirrorCursor?) {
            queryCallCount += 1
            let page = (cursor?.underlying as? Int) ?? 0
            guard page < photoIDPages.count else { return ([], nil) }
            let next: PublicMirrorCursor? = (page + 1 < photoIDPages.count)
                ? PublicMirrorCursor(underlying: page + 1) : nil
            return (photoIDPages[page], next)
        }
    }

    // MARK: - Fixtures

    /// A temp file standing in for on-disk thumbnail bytes.
    private func makeThumbFile() -> String {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-public-thumb-\(UUID().uuidString).jpg")
        try? Data("thumb-bytes".utf8).write(to: url)
        return url.path
    }

    private func makeJourney(camps: [Camp]? = nil) -> Journey {
        let route = Route(type: "LineString",
                          coordinates: [[37.35, -3.07, 1800], [37.40, -3.10, 3000], [37.45, -3.07, 5895]])
        let day1 = Camp(id: "W1", name: "Machame Camp", dayNumber: 1, elevation: 3000,
                        coordinates: [37.40, -3.10], notes: "Rainforest", highlights: ["Rainforest"],
                        routePointIndex: 0, routeDistanceKm: 0)
        let day2 = Camp(id: "W2", name: "Shira Camp", dayNumber: 2, elevation: 3800,
                        coordinates: [37.45, -3.07], notes: "Moorland", highlights: ["Moorland"],
                        routePointIndex: 2, routeDistanceKm: 5.2)
        let stats = TrekStats(duration: 2, totalDistance: 62, totalElevationGain: 4200,
                              totalElevationLoss: 4200,
                              highestPoint: HighestPoint(name: "Uhuru", elevation: 5895, coordinates: [37.45, -3.07]))
        return Journey(
            id: "J1", slug: "kilimanjaro", name: "Kilimanjaro - Lemosho", country: "Tanzania",
            description: "Roof of Africa", heroImageURL: nil,
            dateStarted: "2024-01-01", dateEnded: "2024-01-07", isPublic: true,
            summitElevation: 5895, totalDistance: 62, totalDays: 7,
            centerCoordinates: [37.35, -3.07], preferredBearing: 120, preferredPitch: 55,
            stats: stats, route: route, camps: camps ?? [day1, day2])
    }

    /// P1 hero (thumb, explicit day-1 waypoint) · P2 (thumb, day-2 by date) · P3 (NO thumb).
    private func makePhotos() -> [Photo] {
        var p1 = Photo(id: "P1", journeyId: "J1", waypointId: "W1", url: "",
                       caption: "Summit sign", coordinates: [37.45, -3.07],
                       takenAt: "2024-01-01T08:00:00Z", isHero: true, sortOrder: 0)
        p1.localThumbPath = makeThumbFile()

        var p2 = Photo(id: "P2", journeyId: "J1", waypointId: nil, url: "",
                       caption: "Moorland", coordinates: [37.40, -3.10],
                       takenAt: "2024-01-02T09:00:00Z", isHero: false, sortOrder: 1)
        p2.localThumbPath = makeThumbFile()

        let p3 = Photo(id: "P3", journeyId: "J1", waypointId: nil, url: "",
                       caption: "No bytes", coordinates: nil, takenAt: nil,
                       isHero: false, sortOrder: 2)   // no localThumbPath, empty url → no bytes
        return [p1, p2, p3]
    }

    override func tearDown() {
        PublicMirrorBuilder.purgeAssetScratch()
        super.tearDown()
    }

    // MARK: - Originals must never leak (MAPPING §8 / D9)

    /// `Photo.thumbnailFileURL` falls back to the original bytes for display purposes.
    /// The public mirror must NOT inherit that fallback: a photo whose only bytes on
    /// disk are the full-resolution original is skipped, never published as a "thumb".
    func testPhotoWithOnlyOriginalBytesIsSkippedNotLeaked() {
        var photo = Photo(id: "P-ORIG", journeyId: "J1", url: "",
                          caption: "only original bytes", isHero: false, sortOrder: 0)
        photo.localOriginalPath = makeThumbFile()   // real bytes on disk — but ORIGINAL bytes

        // Display accessor still resolves (that fallback is correct for the UI)…
        XCTAssertNotNil(photo.thumbnailFileURL)
        // …but the mirror refuses it.
        XCTAssertNil(PublicMirrorBuilder.strictThumbURL(for: photo))
        XCTAssertNil(PublicMirrorBuilder.photoRecord(for: photo, journeySlug: "kilimanjaro",
                                                     dayNumber: 1))
    }

    /// A hero photo without thumb bytes must not sink the cover image: the first photo
    /// that HAS real thumb bytes becomes the heroThumb instead.
    func testHeroFallsThroughToFirstPhotoWithRealThumbBytes() {
        var hero = Photo(id: "P-HERO", journeyId: "J1", url: "",
                         caption: nil, isHero: true, sortOrder: 0)
        hero.localOriginalPath = makeThumbFile()    // original bytes only — not eligible
        var second = Photo(id: "P-2", journeyId: "J1", url: "",
                           caption: nil, isHero: false, sortOrder: 1)
        let thumbPath = makeThumbFile()
        second.localThumbPath = thumbPath

        XCTAssertEqual(PublicMirrorBuilder.heroThumbURL(photos: [hero, second])?.path, thumbPath)
    }

    // MARK: - PublicJourney field mapping

    func testJourneyRecordNameAndZone() {
        let record = PublicMirrorBuilder.journeyRecord(for: makeJourney(), photos: makePhotos())
        XCTAssertEqual(record.recordType, "PublicJourney")
        XCTAssertEqual(record.recordID.recordName, "kilimanjaro", "recordName == slug (stable upsert key)")
        XCTAssertEqual(record.recordID.zoneID, CKRecordZone.default().zoneID, "public DB has no custom zones")
    }

    func testJourneyScalarFields() {
        let j = makeJourney()
        let record = PublicMirrorBuilder.journeyRecord(for: j, photos: makePhotos())
        XCTAssertEqual(record["slug"] as? String, "kilimanjaro")
        XCTAssertEqual(record["name"] as? String, "Kilimanjaro - Lemosho")
        XCTAssertEqual(record["description"] as? String, "Roof of Africa")
        XCTAssertEqual(record["country"] as? String, "Tanzania")
        XCTAssertEqual(record["journeyType"] as? String, "trek")
        XCTAssertEqual(record["summitElevation"] as? Int, 5895)
        XCTAssertEqual(record["totalDistance"] as? Double, 62.0)
        XCTAssertEqual(record["totalDays"] as? Int, 7)
        XCTAssertEqual(record["preferredBearing"] as? Double, 120.0)
        XCTAssertEqual(record["preferredPitch"] as? Double, 55.0)
        XCTAssertEqual(record["dateStarted"] as? Date, DateOnly.date(from: "2024-01-01"))
        XCTAssertEqual(record["dateEnded"] as? Date, DateOnly.date(from: "2024-01-07"))
    }

    func testJourneyCenterLocationSwap() {
        // Domain [lng, lat] = [37.35, -3.07] must become CLLocation(latitude: -3.07, longitude: 37.35).
        let record = PublicMirrorBuilder.journeyRecord(for: makeJourney(), photos: makePhotos())
        let loc = try? XCTUnwrap(record["centerLocation"] as? CLLocation)
        XCTAssertEqual(loc?.coordinate.latitude ?? .nan, -3.07, accuracy: 1e-9, "latitude, NOT longitude")
        XCTAssertEqual(loc?.coordinate.longitude ?? .nan, 37.35, accuracy: 1e-9, "longitude, NOT latitude")
    }

    func testStatsJSONRoundTrips() throws {
        let j = makeJourney()
        let record = PublicMirrorBuilder.journeyRecord(for: j, photos: makePhotos())
        let string = try XCTUnwrap(record["statsJSON"] as? String)
        let decoded = try XCTUnwrap(JSONCoding.decode(TrekStats.self, from: Data(string.utf8)))
        XCTAssertEqual(decoded, j.stats, "statsJSON must decode back to the exact stats")
    }

    func testRouteJSONAssetRoundTrips() throws {
        let j = makeJourney()
        let record = PublicMirrorBuilder.journeyRecord(for: j, photos: makePhotos())
        let asset = try XCTUnwrap(record["routeJSON"] as? CKAsset)
        let url = try XCTUnwrap(asset.fileURL)
        let decoded = try XCTUnwrap(JSONCoding.decode(Route.self, from: Data(contentsOf: url)))
        XCTAssertEqual(decoded, j.route)
    }

    func testWaypointsJSONAssetRoundTripsFullCampPayload() throws {
        let j = makeJourney()
        let record = PublicMirrorBuilder.journeyRecord(for: j, photos: makePhotos())
        let asset = try XCTUnwrap(record["waypointsJSON"] as? CKAsset)
        let url = try XCTUnwrap(asset.fileURL)
        let decoded = try XCTUnwrap(JSONCoding.decode([Camp].self, from: Data(contentsOf: url)))
        XCTAssertEqual(decoded, j.camps, "waypointsJSON must carry the full camp payload, byte-faithful")
    }

    // MARK: - heroThumb selection

    func testHeroThumbUsesHeroPhoto() throws {
        let photos = makePhotos()                       // P1 is the hero
        let record = PublicMirrorBuilder.journeyRecord(for: makeJourney(), photos: photos)
        let asset = try XCTUnwrap(record["heroThumb"] as? CKAsset)
        XCTAssertEqual(asset.fileURL?.path, photos[0].localThumbPath)
    }

    func testHeroThumbFallsBackToFirstBySortOrder() throws {
        // No hero flagged: pick the lowest sortOrder that has thumb bytes.
        var p1 = Photo(id: "P1", journeyId: "J1", url: "", isHero: false, sortOrder: 5)
        p1.localThumbPath = makeThumbFile()
        var p2 = Photo(id: "P2", journeyId: "J1", url: "", isHero: false, sortOrder: 1)
        p2.localThumbPath = makeThumbFile()
        let record = PublicMirrorBuilder.journeyRecord(for: makeJourney(), photos: [p1, p2])
        let asset = try XCTUnwrap(record["heroThumb"] as? CKAsset)
        XCTAssertEqual(asset.fileURL?.path, p2.localThumbPath, "sortOrder 1 wins over sortOrder 5")
    }

    func testHeroThumbSkippedWhenNoThumbBytes() {
        let p = Photo(id: "P1", journeyId: "J1", url: "", isHero: true, sortOrder: 0)   // no bytes
        let record = PublicMirrorBuilder.journeyRecord(for: makeJourney(), photos: [p])
        XCTAssertNil(record["heroThumb"] as? CKAsset, "no field when there are no thumb bytes")
    }

    // MARK: - PublicPhoto field mapping

    func testPhotoRecordNameZoneAndFields() throws {
        let photos = makePhotos()
        let record = try XCTUnwrap(PublicMirrorBuilder.photoRecord(for: photos[0], journeySlug: "kilimanjaro", dayNumber: 1))
        XCTAssertEqual(record.recordType, "PublicPhoto")
        XCTAssertEqual(record.recordID.recordName, "P1", "recordName == photo.id")
        XCTAssertEqual(record.recordID.zoneID, CKRecordZone.default().zoneID)
        XCTAssertEqual(record["journeySlug"] as? String, "kilimanjaro")
        XCTAssertEqual(record["caption"] as? String, "Summit sign")
        XCTAssertEqual(record["sortOrder"] as? Int, 0)
        XCTAssertEqual(record["dayNumber"] as? Int, 1)
        XCTAssertEqual(record["takenAt"] as? Date, ISO8601DateFormatter().date(from: "2024-01-01T08:00:00Z"))
        XCTAssertEqual((record["thumb"] as? CKAsset)?.fileURL?.path, photos[0].localThumbPath)
    }

    func testPhotoCoordinatesSwap() throws {
        // [lng, lat] = [37.45, -3.07] → CLLocation(latitude: -3.07, longitude: 37.45).
        let photos = makePhotos()
        let record = try XCTUnwrap(PublicMirrorBuilder.photoRecord(for: photos[0], journeySlug: "kilimanjaro", dayNumber: 1))
        let loc = try XCTUnwrap(record["coordinates"] as? CLLocation)
        XCTAssertEqual(loc.coordinate.latitude, -3.07, accuracy: 1e-9)
        XCTAssertEqual(loc.coordinate.longitude, 37.45, accuracy: 1e-9)
    }

    func testPhotoDayNumberOmittedWhenNil() throws {
        let photos = makePhotos()
        let record = try XCTUnwrap(PublicMirrorBuilder.photoRecord(for: photos[1], journeySlug: "kilimanjaro", dayNumber: nil))
        XCTAssertNil(record["dayNumber"], "an unmatched day writes no field (never a sentinel)")
    }

    func testPhotoWithoutThumbBytesIsNil() {
        let photos = makePhotos()   // P3 has no bytes
        XCTAssertNil(PublicMirrorBuilder.photoRecord(for: photos[2], journeySlug: "kilimanjaro", dayNumber: nil),
                     "a photo without thumbnail bytes yields nil so the caller can skip + count it")
    }

    // MARK: - dayNumber via the 4-tier matcher

    func testDayNumberComesFromPhotoDayMatcher() {
        let j = makeJourney()
        let matcher = PhotoDayMatcher(journey: j)
        let photos = makePhotos()
        XCTAssertEqual(matcher.day(for: photos[0]), 1, "P1 has explicit waypoint W1 → day 1 (tier 1)")
        XCTAssertEqual(matcher.day(for: photos[1]), 2, "P2 taken on 2024-01-02 → day 2 (tier 2)")
    }

    // MARK: - Chunking boundaries

    func testChunkingBoundary120PhotosThreeOps() {
        let items = Array(0..<120)
        let chunks = PublicMirrorPublisher.chunked(items, size: 50)
        XCTAssertEqual(chunks.map(\.count), [50, 50, 20])
        XCTAssertEqual(chunks.flatMap { $0 }, items, "no item lost or reordered")
    }

    func testChunkingExactMultipleAndEmpty() {
        XCTAssertEqual(PublicMirrorPublisher.chunked(Array(0..<100), size: 50).map(\.count), [50, 50])
        XCTAssertTrue(PublicMirrorPublisher.chunked([Int](), size: 50).isEmpty)
    }

    // MARK: - Publish orchestration

    func testPublishSavesJourneyAndPhotosWithAllKeys() async {
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock).publish(journey: makeJourney(), photos: makePhotos())

        XCTAssertTrue(report.journeyPublished)
        XCTAssertEqual(report.photosPublished, 2, "P1 + P2 (P3 skipped)")
        XCTAssertEqual(report.skippedNoThumb, 1, "P3 has no thumbnail bytes")
        XCTAssertEqual(report.published, 3, "1 metadata + 2 photos")
        XCTAssertTrue(report.failures.isEmpty)
        XCTAssertEqual(mock.lastSavePolicy, .allKeys, "the mirror is last-write-wins")

        let names = Set(mock.saved.keys.map(\.recordName))
        XCTAssertTrue(names.isSuperset(of: ["kilimanjaro", "P1", "P2"]))
        XCTAssertFalse(names.contains("P3"))
        XCTAssertTrue(mock.saved.keys.allSatisfy { $0.zoneID == CKRecordZone.default().zoneID })
    }

    func testPublishChunksPhotosAt50PerOp() async {
        // 120 photos with thumbs → journey op (1) + 3 photo ops (50/50/20) = 4 modify calls.
        var photos: [Photo] = []
        for i in 0..<120 {
            var p = Photo(id: "P\(i)", journeyId: "J1", url: "", sortOrder: i)
            p.localThumbPath = makeThumbFile()
            photos.append(p)
        }
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock).publish(journey: makeJourney(), photos: photos)
        XCTAssertEqual(report.photosPublished, 120)
        XCTAssertEqual(mock.modifyCallCount, 4, "1 metadata op + 3 chunked photo ops (50/50/20)")
    }

    /// Update semantics: a photo removed locally must be deleted from the mirror. The stale ID is
    /// only reachable on the SECOND query page, so this also proves cursor-following.
    func testPublishDeletesStalePhotosFollowingCursors() async {
        let mock = MockPublicDatabase()
        let idP1 = CKRecord.ID(recordName: "P1")
        let idP2 = CKRecord.ID(recordName: "P2")
        let idOld = CKRecord.ID(recordName: "OLD")     // no longer present locally
        mock.photoIDPages = [[idP1], [idP2, idOld]]     // two pages

        let report = await PublicMirrorPublisher(database: mock).publish(journey: makeJourney(), photos: makePhotos())

        XCTAssertGreaterThanOrEqual(mock.queryCallCount, 2, "must follow the cursor past page one")
        XCTAssertEqual(report.deleted, 1)
        XCTAssertTrue(mock.deleted.contains(idOld), "the stale photo is removed")
        XCTAssertFalse(mock.deleted.contains(idP1), "still-present photos are kept")
        XCTAssertFalse(mock.deleted.contains(idP2))
    }

    func testPublishReportsProgressToOne() async {
        let mock = MockPublicDatabase()
        var last: PublicMirrorProgress?
        _ = await PublicMirrorPublisher(database: mock).publish(journey: makeJourney(), photos: makePhotos()) { last = $0 }
        XCTAssertEqual(last?.fraction, 1.0)
        XCTAssertEqual(last?.phase, "Done")
    }

    // MARK: - Unpublish

    func testUnpublishDeletesAllPhotosAndMetadataFollowingCursors() async {
        let mock = MockPublicDatabase()
        mock.photoIDPages = [[CKRecord.ID(recordName: "P1"), CKRecord.ID(recordName: "P2")],
                             [CKRecord.ID(recordName: "P3")]]

        let report = await PublicMirrorPublisher(database: mock).unpublish(slug: "kilimanjaro")

        XCTAssertEqual(report.deleted, 4, "3 photos + the PublicJourney record")
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P1")))
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P3")))
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "kilimanjaro")), "metadata record removed last")
        XCTAssertTrue(report.failures.isEmpty)
    }

    func testUnpublishWithNothingPublishedStillRemovesMetadata() async {
        let mock = MockPublicDatabase()        // no photo pages
        let report = await PublicMirrorPublisher(database: mock).unpublish(slug: "kilimanjaro")
        XCTAssertEqual(report.deleted, 1, "just the PublicJourney record")
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "kilimanjaro")))
    }
}
