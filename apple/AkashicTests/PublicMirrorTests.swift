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
        /// Every slug the publisher asked about, in order — lets a test assert *which* keyspace
        /// was swept, not merely that something was deleted.
        private(set) var queriedSlugs: [String] = []

        /// Pages of `PublicPhoto` IDs to hand back, consumed in order (cursor = next page index).
        /// Slug-agnostic: every slug sees these pages.
        var photoIDPages: [[CKRecord.ID]] = []

        /// Pages keyed by the slug they are stored under. Needed to express the case where the
        /// mirror lives under a disambiguated slug while the caller only knows the pretty one —
        /// a slug-agnostic mock cannot tell a correct sweep from a sweep of the wrong keyspace.
        /// Takes precedence over `photoIDPages` when the queried slug has an entry.
        var photoIDPagesBySlug: [String: [[CKRecord.ID]]] = [:]

        /// slug -> creatorUserRecordID.recordName of an existing PublicJourney (for collision tests).
        var existingJourneyCreators: [String: String] = [:]

        /// Make every save fail per-record (not by throwing), which is the shape CloudKit actually
        /// returns for a partial failure. Lets a test assert what the report says when nothing
        /// landed — e.g. that no share link is offered for a page that does not exist.
        var failSaves = false

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
                if failSaves {
                    saveResults[record.recordID] = .failure(CKError(.networkFailure))
                    continue
                }
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
            queriedSlugs.append(slug)
            let pages = photoIDPagesBySlug[slug] ?? photoIDPages
            let page = (cursor?.underlying as? Int) ?? 0
            guard page < pages.count else { return ([], nil) }
            let next: PublicMirrorCursor? = (page + 1 < pages.count)
                ? PublicMirrorCursor(underlying: page + 1) : nil
            return (pages[page], next)
        }

        func ckExistingPublicJourneyCreator(slug: String) async throws -> String? {
            existingJourneyCreators[slug]
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

    /// S2: the public mirror must carry the owner's actual `journeyType`, not a hardcoded
    /// "trek" — this record is world-readable, so a fossilised wrong value here is exactly as
    /// permanent as on the private Journey record.
    func testJourneyTypeMirrorsNonDefaultValue() {
        var j = makeJourney()
        j.journeyType = "diary"
        let record = PublicMirrorBuilder.journeyRecord(for: j, photos: makePhotos())
        XCTAssertEqual(record["journeyType"] as? String, "diary")
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

    // MARK: - The share link must use the slug that was published (DIFF-02)

    func testPublishReportsThePrettySlugWhenThereIsNoCollision() async {
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock, ownerRecordName: "ownerA")
            .publish(journey: makeJourney(), photos: makePhotos())
        XCTAssertEqual(report.publishedSlug, "kilimanjaro")
    }

    /// The case a naive `ShareLink(item: journey.slug)` gets wrong: the mirror lives under the
    /// owner-scoped variant, so a link built from the domain object 404s for the second family.
    func testPublishReportsTheDisambiguatedSlugUnderACollision() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreators["kilimanjaro"] = "someoneElse"
        let owner = "ownerA"
        let report = await PublicMirrorPublisher(database: mock, ownerRecordName: owner)
            .publish(journey: makeJourney(), photos: makePhotos())

        let expected = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: owner)
        XCTAssertEqual(report.publishedSlug, expected)
        XCTAssertNotEqual(report.publishedSlug, "kilimanjaro",
                          "a link built from the pretty slug would 404 for the second family")
    }

    func testFailedPublishReportsNoSlugSoNoLinkIsOffered() async {
        let mock = MockPublicDatabase()
        mock.failSaves = true
        let report = await PublicMirrorPublisher(database: mock).publish(journey: makeJourney(),
                                                                        photos: makePhotos())
        XCTAssertNil(report.publishedSlug, "no metadata record saved means there is no page to link to")
    }

    func testUnpublishReportsNoSlug() async {
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock).unpublish(slug: "kilimanjaro")
        XCTAssertNil(report.publishedSlug)
    }

    func testShowcaseURLIsTheFormTheWebClientAndAASABothRead() {
        // `?journey=<slug>` is what useTrekData.parseUrlParams reads and what the AASA declares.
        XCTAssertEqual(AppInfo.showcaseURL(slug: "kilimanjaro")?.absoluteString,
                       "https://akashic.no/?journey=kilimanjaro")
    }

    func testShowcaseURLPercentEncodesASlugThatNeedsIt() {
        // Slugs are locally minted, so an unencoded one would silently truncate the query.
        XCTAssertEqual(AppInfo.showcaseURL(slug: "a b&c")?.absoluteString,
                       "https://akashic.no/?journey=a%20b%26c")
    }

    // MARK: - Unpublish must sweep the slug it actually published under (DIFF-01)

    /// The leak this closes: `publish` moves the mirror to an owner-scoped slug when another family
    /// already holds the pretty one, but the Showcase sheet only ever knows `journey.slug`. The old
    /// `unpublish` swept the pretty slug, found nothing, and — because `delete` treats an absent
    /// record as success — reported OK. The caller then flipped `isPublic` to false, which removed
    /// the Remove button, leaving GPS-tagged world-readable thumbnails online with no way back.
    func testUnpublishSweepsTheDisambiguatedSlugItActuallyPublishedUnder() async {
        let mock = MockPublicDatabase()
        let owner = "ownerA"
        // Another family already owns the pretty slug, so publish resolves to the variant.
        mock.existingJourneyCreators["kilimanjaro"] = "someoneElse"
        let effective = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: owner)
        XCTAssertNotEqual(effective, "kilimanjaro", "precondition: the slugs must differ")

        // The mirror's photos live under the disambiguated slug; the pretty slug holds nothing.
        mock.photoIDPagesBySlug[effective] = [[CKRecord.ID(recordName: "P1"),
                                               CKRecord.ID(recordName: "P2")]]
        mock.photoIDPagesBySlug["kilimanjaro"] = []

        // The caller passes the PRETTY slug — that is all JourneyShowcaseSheet has.
        let report = await PublicMirrorPublisher(database: mock, ownerRecordName: owner)
            .unpublish(slug: "kilimanjaro")

        XCTAssertTrue(mock.queriedSlugs.contains(effective),
                      "the disambiguated keyspace must be swept, not just the pretty slug")
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P1")),
                      "the world-readable thumbnail must actually be deleted")
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P2")))
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: effective)),
                      "the metadata record that was really published must be removed")
        XCTAssertTrue(report.succeeded)
    }

    /// Round trip: whatever `publish` wrote, `unpublish` must be able to remove using only the
    /// pretty slug. Guards the pairing rather than either half in isolation.
    func testPublishThenUnpublishLeavesNothingBehindUnderACollidedSlug() async {
        let mock = MockPublicDatabase()
        let owner = "ownerA"
        mock.existingJourneyCreators["kilimanjaro"] = "someoneElse"
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: owner)

        let photos = makePhotos()
        _ = await publisher.publish(journey: makeJourney(), photos: photos)
        let publishedNames = Set(mock.saved.keys.map(\.recordName))
        XCTAssertFalse(publishedNames.isEmpty, "precondition: publish wrote something")

        // Feed the mirror's real contents back as the query result, keyed by the slug used.
        let effective = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: owner)
        mock.photoIDPagesBySlug[effective] = [photos.map { CKRecord.ID(recordName: $0.id) }]

        _ = await publisher.unpublish(slug: "kilimanjaro")

        XCTAssertTrue(mock.saved.isEmpty,
                      "every record publish created must be gone — left over: \(mock.saved.keys.map(\.recordName))")
    }

    /// With no owner identity (dev and test paths) there is only ever one keyspace, so the sweep
    /// must not invent a second query — that would double the CloudKit calls for every unpublish.
    func testUnpublishQueriesOneSlugWhenThereIsNoOwnerIdentity() async {
        let mock = MockPublicDatabase()
        _ = await PublicMirrorPublisher(database: mock).unpublish(slug: "kilimanjaro")
        XCTAssertEqual(mock.queriedSlugs, ["kilimanjaro"])
    }

    // MARK: - Cross-user slug collision in the global public keyspace (quality gate)

    func testDisambiguatedSlugIsStableAndOwnerScoped() {
        let a = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: "ownerA")
        let b = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: "ownerB")
        XCTAssertTrue(a.hasPrefix("kilimanjaro-"))
        XCTAssertNotEqual(a, b, "different owners of the same pretty slug get different suffixes")
        XCTAssertEqual(a, PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: "ownerA"),
                       "deterministic across calls, so re-publishing keeps the same recordName")
    }

    /// When someone ELSE already published under this slug, the second family must publish under a
    /// disambiguated slug — never save a PublicJourney/PublicPhoto under the first family's slug.
    func testPublishUnderColludingSlugUsesDisambiguatedSlug() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreators = ["kilimanjaro": "some-other-family"]
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "me")

        let report = await publisher.publish(journey: makeJourney(), photos: makePhotos())

        let expectedSlug = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: "me")
        XCTAssertTrue(report.journeyPublished)
        let names = Set(mock.saved.keys.map(\.recordName))
        XCTAssertTrue(names.contains(expectedSlug), "published under the disambiguated slug")
        XCTAssertFalse(names.contains("kilimanjaro"), "never writes under the other family's slug")
        // The PublicPhoto records must carry the disambiguated journeySlug too, so the web (keyed on
        // recordName == slug) stays consistent.
        let photoSlugs = Set(mock.saved.values
            .filter { $0.recordType == PublicMirrorBuilder.photoType }
            .compactMap { $0["journeySlug"] as? String })
        XCTAssertEqual(photoSlugs, [expectedSlug])
    }

    /// A slug already published by US (or free) is kept as-is — no needless suffix.
    func testPublishKeepsPrettySlugWhenOwnedOrFree() async {
        let mockFree = MockPublicDatabase()   // no existing record
        let r1 = await PublicMirrorPublisher(database: mockFree, ownerRecordName: "me")
            .publish(journey: makeJourney(), photos: makePhotos())
        XCTAssertTrue(r1.journeyPublished)
        XCTAssertTrue(Set(mockFree.saved.keys.map(\.recordName)).contains("kilimanjaro"))

        let mockOwn = MockPublicDatabase()
        mockOwn.existingJourneyCreators = ["kilimanjaro": "me"]   // already ours
        let r2 = await PublicMirrorPublisher(database: mockOwn, ownerRecordName: "me")
            .publish(journey: makeJourney(), photos: makePhotos())
        XCTAssertTrue(r2.journeyPublished)
        XCTAssertTrue(Set(mockOwn.saved.keys.map(\.recordName)).contains("kilimanjaro"),
                      "re-publishing our own journey keeps its pretty slug")
    }

    // MARK: - Best-effort targeted photo removal (finding #7)

    func testDeletePublicPhotosRemovesByRecordName() async {
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock).deletePublicPhotos(ids: ["P1", "P2"])
        XCTAssertEqual(report.deleted, 2)
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P1")))
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P2")))
        XCTAssertTrue(report.failures.isEmpty)
    }
}

// MARK: - ShowcaseViewModel: flag flips only after the network op, and only for the owner

/// The Showcase flow's ordering + failure handling, which the review flagged as having zero
/// coverage. Driven against a fake publisher so publish/unpublish can succeed or fail on demand;
/// the injected `setPublic` closure stands in for `store.setJourneyPublic` and records the flip.
@MainActor
final class ShowcaseViewModelTests: XCTestCase {

    /// Fake mirror publisher: returns a preset report and records which op ran.
    final class FakePublisher: PublicMirrorPublishing {
        var report: PublicMirrorReport
        private(set) var publishCalled = false
        private(set) var unpublishCalled = false
        init(_ report: PublicMirrorReport) { self.report = report }
        func publish(journey: Journey, photos: [Photo],
                     progress: ((PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport {
            publishCalled = true; return report
        }
        func unpublish(slug: String,
                       progress: ((PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport {
            unpublishCalled = true; return report
        }
    }

    /// Records every isPublic flip the model asks for, and can be told to reject the write.
    final class FlagRecorder {
        private(set) var flips: [Bool] = []
        var succeeds = true
        func apply(_ value: Bool) -> Bool { flips.append(value); return succeeds }
    }

    private func journey() -> Journey {
        Journey(id: "J1", slug: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania",
                description: "", heroImageURL: nil, dateStarted: nil, dateEnded: nil, isPublic: false,
                summitElevation: nil, totalDistance: nil, totalDays: nil, centerCoordinates: nil,
                preferredBearing: nil, preferredPitch: nil,
                stats: TrekStats(duration: 0, totalDistance: 0, totalElevationGain: 0,
                                 totalElevationLoss: nil, highestPoint: nil),
                route: Route(type: "LineString", coordinates: []), camps: [])
    }

    private func publishedReport() -> PublicMirrorReport {
        var r = PublicMirrorReport(); r.journeyPublished = true; r.photosPublished = 2; return r
    }
    private func failedReport() -> PublicMirrorReport {
        var r = PublicMirrorReport()
        r.failures = [RecordFailure(recordName: "P1", recordType: "PublicPhoto",
                                    zoneName: "_defaultZone", code: 6, message: "network")]
        return r
    }

    private func model(_ publisher: FakePublisher) -> ShowcaseViewModel {
        ShowcaseViewModel(resolveMirror: { .ready(publisher) })
    }

    // MARK: Publish

    func testPublishFlipsPublicOnlyAfterSuccessfulWrite() async {
        let publisher = FakePublisher(publishedReport())
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.publish(journey: journey(), photos: [], isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertTrue(publisher.publishCalled, "the mirror is written first")
        XCTAssertEqual(flag.flips, [true], "isPublic flipped to true — and only once the write succeeded")
        XCTAssertEqual(vm.phase, .done(publishedReport()))
    }

    func testFailedPublishNeverFlipsPublic() async {
        // No account: the resolver reports unavailable before any publisher runs.
        let flag = FlagRecorder()
        let vm = ShowcaseViewModel(resolveMirror: { .unavailable("No iCloud account available.") })

        vm.publish(journey: journey(), photos: [], isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertTrue(flag.flips.isEmpty, "a failed publish must never mark the journey Public")
        XCTAssertEqual(vm.phase, .failed("No iCloud account available."))
    }

    func testPublishSurfacesFlagWriteFailure() async {
        // The mirror write lands but the local flag write is rejected — must be surfaced, not
        // silently claimed as success (finding #9).
        let publisher = FakePublisher(publishedReport())
        let flag = FlagRecorder(); flag.succeeds = false
        let vm = model(publisher)

        vm.publish(journey: journey(), photos: [], isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertEqual(flag.flips, [true], "the flip was attempted")
        guard case .failed = vm.phase else {
            return XCTFail("a rejected flag write must land in a retryable .failed state, got \(vm.phase)")
        }
    }

    // MARK: Unpublish

    func testUnpublishFlipsPrivateOnlyAfterEverythingRemoved() async {
        var report = PublicMirrorReport(); report.deleted = 3
        let publisher = FakePublisher(report)
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.remove(slug: "kilimanjaro", isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertTrue(publisher.unpublishCalled, "the mirror is removed first")
        XCTAssertEqual(flag.flips, [false], "isPublic flipped to false only after a clean unpublish")
    }

    func testFailedUnpublishLeavesJourneyPublic() async {
        // A partial/failed unpublish must NOT flip to Private — world-readable records may remain,
        // so the UI must keep showing Public (and its Remove button). (findings #5 / #13.)
        let publisher = FakePublisher(failedReport())
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.remove(slug: "kilimanjaro", isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertTrue(publisher.unpublishCalled)
        XCTAssertTrue(flag.flips.isEmpty, "a failed unpublish must NOT claim the journey is Private")
        guard case .done(let r) = vm.phase else {
            return XCTFail("failure lands in a visible .done(report) state, got \(vm.phase)")
        }
        XCTAssertFalse(r.succeeded, "the report carries the failures for the UI to show")
    }

    // MARK: Ownership guard (finding #6)

    func testParticipantCannotPublishSomeoneElsesJourney() async {
        let publisher = FakePublisher(publishedReport())
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.publish(journey: journey(), photos: [], isOwner: false, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertFalse(publisher.publishCalled, "a non-owner must never write the public mirror")
        XCTAssertTrue(flag.flips.isEmpty)
        XCTAssertEqual(vm.phase, .failed(ShowcaseViewModel.notOwnerMessage))
    }

    func testParticipantCannotRemoveSomeoneElsesJourney() async {
        let publisher = FakePublisher(publishedReport())
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.remove(slug: "kilimanjaro", isOwner: false, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertFalse(publisher.unpublishCalled)
        XCTAssertTrue(flag.flips.isEmpty)
        XCTAssertEqual(vm.phase, .failed(ShowcaseViewModel.notOwnerMessage))
    }
}
