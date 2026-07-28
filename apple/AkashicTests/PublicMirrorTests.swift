import XCTest
import os
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

    // QUA-36: `@unchecked` for the reason the other doubles in this target use it — the mutable
    // properties below are scripting state, written before `publish` runs and read after it returns.
    // `PublicMirrorPublisher` uses no concurrency primitives at all, so nothing here is ever touched
    // from two places at once. Verified by grep rather than assumed, because the alternative on offer
    // was an actor and ~30 `await`s.
    final class MockPublicDatabase: PublicMirrorDatabase, @unchecked Sendable {
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

        /// Make the journey-existence lookup THROW. The real `CKDatabase` extension only swallows
        /// `.unknownItem` (that is the "keyspace is free" answer) and lets every other CKError out,
        /// so a presence check has to distinguish "asked, nothing there" from "could not ask" —
        /// which is untestable without a way to script the failure. (QUA-45.)
        var existingJourneyCreatorError: Error?

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
            if let existingJourneyCreatorError { throw existingJourneyCreatorError }
            return existingJourneyCreators[slug]
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
        // QUA-08: `progress` is `@Sendable` now, so a plain captured `var` would be "mutation of
        // captured var in concurrently-executing code". The publisher calls progress sequentially
        // from its own task, so a locked box is honest and keeps the assertion exactly as it was.
        let last = OSAllocatedUnfairLock<PublicMirrorProgress?>(initialState: nil)
        _ = await PublicMirrorPublisher(database: mock)
            .publish(journey: makeJourney(), photos: makePhotos()) { p in
                last.withLock { $0 = p }
            }
        let final = last.withLock { $0 }
        XCTAssertEqual(final?.fraction, 1.0)
        XCTAssertEqual(final?.phase, "Done")
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

    // MARK: - The per-journey published-photo cap (QUA-25)
    //
    // The public database is billed to us, not to the customer, so a published journey needs a size
    // bound. These pin the boundary (at, under, over), the day-spread that stops a flat prefix from
    // emptying the later days, and that a capped publish still SUCCEEDS and reports the shortfall.

    /// `n` photos with thumbnail bytes, `sortOrder` ascending, spread round-robin over `days`
    /// waypoints so `PhotoDayMatcher` resolves a real day for each one.
    private func makeCappablePhotos(_ n: Int, days: Int = 1) -> [Photo] {
        (0..<n).map { i in
            var photo = Photo(id: "P\(i)", journeyId: "J1",
                              waypointId: "W\((i % days) + 1)", url: "", sortOrder: i)
            photo.localThumbPath = makeThumbFile()
            return photo
        }
    }

    func testCapLeavesAJourneyExactlyAtTheLimitUntouched() {
        let photos = makeCappablePhotos(10)
        let result = PublicMirrorPublisher.capped(photos, limit: 10, dayOf: { _ in 1 })
        XCTAssertEqual(result.heldBack, 0)
        XCTAssertEqual(result.kept.map(\.id), photos.map(\.id), "at the cap, nothing moves")
    }

    func testCapLeavesAJourneyUnderTheLimitUntouched() {
        let photos = makeCappablePhotos(9)
        let result = PublicMirrorPublisher.capped(photos, limit: 10, dayOf: { _ in 1 })
        XCTAssertEqual(result.heldBack, 0)
        XCTAssertEqual(result.kept.count, 9)
    }

    func testCapHoldsBackTheExcessOnePastTheLimit() {
        let photos = makeCappablePhotos(11)
        let result = PublicMirrorPublisher.capped(photos, limit: 10, dayOf: { _ in 1 })
        XCTAssertEqual(result.kept.count, 10)
        XCTAssertEqual(result.heldBack, 1)
        XCTAssertFalse(result.kept.contains { $0.id == "P10" },
                       "within one day the cap keeps the leading sortOrder — which is where "
                       + "PhotoCurationService.applyingBestOf puts the curated picks")
    }

    /// The reason this is not `prefix(limit)`: a flat prefix over journey-global `sortOrder` would
    /// publish the first days and leave the later ones empty.
    func testCapSpreadsAcrossDaysRatherThanTakingTheFirstN() {
        // 40 photos over 4 days, interleaved, capped at 8 → 2 from each day, not 8 from day 1.
        let photos = makeCappablePhotos(40, days: 4)
        let dayOf: (Photo) -> Int? = { photo in
            (Int(photo.id.dropFirst()) ?? 0) % 4 + 1
        }
        let result = PublicMirrorPublisher.capped(photos, limit: 8, dayOf: dayOf)
        XCTAssertEqual(result.kept.count, 8)
        XCTAssertEqual(result.heldBack, 32)
        let perDay = Dictionary(grouping: result.kept, by: { dayOf($0)! }).mapValues(\.count)
        XCTAssertEqual(perDay, [1: 2, 2: 2, 3: 2, 4: 2], "every day contributes equally")
    }

    /// An uneven trek: a fat day must not starve a thin one, and the leftover budget must flow back
    /// to whoever still has photos rather than going unused.
    func testCapGivesEveryDaySomethingAndSpendsTheWholeBudget() {
        var photos: [Photo] = []
        var dayByID: [String: Int] = [:]
        // Day 1: 30 photos · day 2: 1 · day 3: 4
        for (day, count) in [(1, 30), (2, 1), (3, 4)] {
            for i in 0..<count {
                var photo = Photo(id: "D\(day)-\(i)", journeyId: "J1", url: "",
                                  sortOrder: day * 100 + i)
                photo.localThumbPath = makeThumbFile()
                dayByID[photo.id] = day
                photos.append(photo)
            }
        }
        let result = PublicMirrorPublisher.capped(photos, limit: 10, dayOf: { dayByID[$0.id] })
        XCTAssertEqual(result.kept.count, 10, "the whole budget is spent")
        XCTAssertEqual(result.heldBack, 25)
        let perDay = Dictionary(grouping: result.kept, by: { dayByID[$0.id]! }).mapValues(\.count)
        XCTAssertEqual(perDay[2], 1, "the thin day keeps its only photo")
        XCTAssertEqual(perDay[3], 4, "the small day keeps all four")
        XCTAssertEqual(perDay[1], 5, "the fat day absorbs the rest, it does not take it first")
    }

    /// Unassigned photos share ONE bucket. That is the guarantee that matters: however many loose
    /// photos a journey has, they compete with each other for a single day's worth of the budget
    /// instead of each claiming a round-robin slot and crowding out the days a visitor navigates to.
    /// So the split does not move when the loose pile grows.
    func testUnassignedPhotosShareOneBucketSoTheirCountCannotSkewTheSplit() {
        func photos(loose: Int) -> [Photo] {
            var all: [Photo] = []
            for i in 0..<3 {
                var photo = Photo(id: "DAY-\(i)", journeyId: "J1", url: "", sortOrder: i)
                photo.localThumbPath = makeThumbFile()
                all.append(photo)
            }
            for i in 0..<loose {
                var photo = Photo(id: "LOOSE-\(i)", journeyId: "J1", url: "", sortOrder: 100 + i)
                photo.localThumbPath = makeThumbFile()
                all.append(photo)
            }
            return all
        }
        let dayOf: (Photo) -> Int? = { $0.id.hasPrefix("DAY") ? 1 : nil }

        // Ten loose photos and a hundred produce the same 2/2 split: one day bucket, one loose
        // bucket. Weighting by photo count would have handed the hundred-photo pile ~97 % of it.
        for loose in [10, 100] {
            let result = PublicMirrorPublisher.capped(photos(loose: loose), limit: 4, dayOf: dayOf)
            XCTAssertEqual(result.kept.count, 4)
            XCTAssertEqual(result.kept.filter { $0.id.hasPrefix("DAY") }.count, 2,
                           "the day keeps its share regardless of \(loose) loose photos")
            XCTAssertEqual(result.kept.filter { $0.id.hasPrefix("LOOSE") }.count, 2)
        }
    }

    /// A journey whose photos have no day assignment at all — a fresh import before day matching —
    /// must still publish up to the cap rather than degrade to one bucket's worth.
    func testAJourneyWithNoDayAssignmentAtAllStillFillsTheBudget() {
        let photos = makeCappablePhotos(30)
        let result = PublicMirrorPublisher.capped(photos, limit: 12, dayOf: { _ in nil })
        XCTAssertEqual(result.kept.count, 12)
        XCTAssertEqual(result.heldBack, 18)
        XCTAssertEqual(result.kept.map(\.sortOrder), Array(0..<12),
                       "one bucket degrades to leading sortOrder, the app's default order")
    }

    func testCapIsStableAcrossRuns() {
        let photos = makeCappablePhotos(60, days: 5)
        let dayOf: (Photo) -> Int? = { (Int($0.id.dropFirst()) ?? 0) % 5 + 1 }
        let first = PublicMirrorPublisher.capped(photos, limit: 17, dayOf: dayOf).kept.map(\.id)
        for _ in 0..<5 {
            XCTAssertEqual(PublicMirrorPublisher.capped(photos, limit: 17, dayOf: dayOf).kept.map(\.id),
                           first, "the selection must not depend on dictionary iteration order")
        }
    }

    func testCapKeepsThePublishedSetInJourneyOrder() {
        let photos = makeCappablePhotos(20, days: 4)
        let dayOf: (Photo) -> Int? = { (Int($0.id.dropFirst()) ?? 0) % 4 + 1 }
        let kept = PublicMirrorPublisher.capped(photos, limit: 8, dayOf: dayOf).kept
        XCTAssertEqual(kept.map(\.sortOrder), kept.map(\.sortOrder).sorted(),
                       "the mirror reads chronologically like every other surface")
    }

    /// The whole point of the design: a journey over the cap still publishes.
    func testAPublishOverTheCapSucceedsAndReportsTheShortfall() async {
        let mock = MockPublicDatabase()
        var config = PublicMirrorConfig.default
        config.maxPublishedPhotos = 25
        let publisher = PublicMirrorPublisher(database: mock, config: config)

        let report = await publisher.publish(journey: makeJourney(),
                                             photos: makeCappablePhotos(80, days: 2))

        XCTAssertTrue(report.succeeded, "a capped publish is a SUCCESSFUL publish, never a failure")
        XCTAssertTrue(report.journeyPublished)
        XCTAssertEqual(report.photosPublished, 25, "exactly the cap reached the mirror")
        XCTAssertEqual(report.photosHeldBack, 55)
        XCTAssertEqual(report.skippedNoThumb, 0, "held back is not the same thing as thumbless")
        XCTAssertTrue(report.failures.isEmpty)
        XCTAssertNotNil(report.publishedSlug, "a capped publish still yields a shareable link")
    }

    func testAPublishUnderTheCapReportsNothingHeldBack() async {
        let mock = MockPublicDatabase()
        let report = await PublicMirrorPublisher(database: mock)
            .publish(journey: makeJourney(), photos: makePhotos())
        XCTAssertEqual(report.photosHeldBack, 0, "three photos are nowhere near 200")
        XCTAssertEqual(report.photosPublished, 2)
        XCTAssertEqual(report.skippedNoThumb, 1)
    }

    /// Thumbless photos are excluded BEFORE the cap, so they do not spend cap slots and the mirror
    /// receives the full budget it is allowed.
    func testThumblessPhotosDoNotConsumeCapSlots() async {
        let mock = MockPublicDatabase()
        var config = PublicMirrorConfig.default
        config.maxPublishedPhotos = 5
        var photos = makeCappablePhotos(5)
        for i in 0..<20 {   // 20 photos with no bytes at all
            photos.append(Photo(id: "NOBYTES\(i)", journeyId: "J1", url: "", sortOrder: 500 + i))
        }
        let report = await PublicMirrorPublisher(database: mock, config: config)
            .publish(journey: makeJourney(), photos: photos)
        XCTAssertEqual(report.photosPublished, 5, "the full budget is spent on publishable photos")
        XCTAssertEqual(report.skippedNoThumb, 20)
        XCTAssertEqual(report.photosHeldBack, 0, "nothing publishable was held back")
    }

    /// A journey published before the cap existed must shrink on the next publish: held-back photos
    /// are absent from the desired set, so the reconciliation pass deletes them from the mirror.
    func testRepublishingUnderTheCapDeletesTheNowExcessPhotosFromTheMirror() async {
        let mock = MockPublicDatabase()
        // The mirror already holds P0…P9 from an earlier, uncapped publish.
        mock.photoIDPages = [(0..<10).map { CKRecord.ID(recordName: "P\($0)") }]
        var config = PublicMirrorConfig.default
        config.maxPublishedPhotos = 4

        let report = await PublicMirrorPublisher(database: mock, config: config)
            .publish(journey: makeJourney(), photos: makeCappablePhotos(10))

        XCTAssertEqual(report.photosPublished, 4)
        XCTAssertEqual(report.photosHeldBack, 6)
        XCTAssertEqual(report.deleted, 6, "the six now-excess photos leave the showcase")
        XCTAssertTrue(mock.deleted.contains(CKRecord.ID(recordName: "P9")))
        XCTAssertFalse(mock.deleted.contains(CKRecord.ID(recordName: "P0")))
    }

    func testDefaultCapIsAtLeastTheFreeTierPhotoAllowance() {
        // A free account may hold 100 photos in its one journey and publishing is free (§5), so a
        // cap below that would make a free journey unpublishable in full.
        XCTAssertGreaterThanOrEqual(PublicMirrorConfig.default.maxPublishedPhotos,
                                    EntitlementPolicy.freePhotosPerOwnedJourney)
        XCTAssertEqual(PublicMirrorConfig.default.maxPublishedPhotos, 200)
    }

    /// Degenerate configuration must not publish an unbounded journey by accident.
    func testACapOfZeroPublishesNoPhotosRatherThanAllOfThem() {
        let photos = makeCappablePhotos(10)
        let result = PublicMirrorPublisher.capped(photos, limit: 0, dayOf: { _ in 1 })
        XCTAssertTrue(result.kept.isEmpty)
        XCTAssertEqual(result.heldBack, 10)
    }

    // MARK: - Presence: what the LIVE mirror says, not what the local flag claims (QUA-45)

    /// The measured defect, at the layer that can answer it. `isPublic` said published; the
    /// production public database held zero `PublicJourney` records. An empty mirror must read
    /// `.absent`, because that is what licenses the UI to stop claiming "published".
    func testPresenceIsAbsentWhenTheMirrorHoldsNothing() async {
        let mock = MockPublicDatabase()          // no existingJourneyCreators at all
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "_me")
        let presence = await publisher.presence(ofJourneySlug: "kilimanjaro")
        XCTAssertEqual(presence, .absent, "an empty mirror is not a published journey")
    }

    func testPresenceIsPresentWhenOurOwnRecordIsThere() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreators["kilimanjaro"] = "_me"
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "_me")
        let presence = await publisher.presence(ofJourneySlug: "kilimanjaro")
        XCTAssertEqual(presence, .present(slug: "kilimanjaro"))
    }

    /// A cross-owner collision publishes under `kilimanjaro-a1b2c3` while the local journey keeps the
    /// pretty slug. Checking only the pretty slug would report the mirror missing and prompt a
    /// needless re-publish — the same class of wrong answer `unpublish` had before it swept both.
    func testPresenceFindsAMirrorLivingUnderTheDisambiguatedSlug() async {
        let mock = MockPublicDatabase()
        let disambiguated = PublicMirrorBuilder.disambiguatedSlug("kilimanjaro", ownerRecordName: "_me")
        mock.existingJourneyCreators["kilimanjaro"] = "_someone-else"   // they hold the pretty slug
        mock.existingJourneyCreators[disambiguated] = "_me"             // ours is under the variant
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "_me")
        let presence = await publisher.presence(ofJourneySlug: "kilimanjaro")
        XCTAssertEqual(presence, .present(slug: disambiguated))
    }

    /// Someone else's record under our pretty slug is NOT evidence that we published. Treating it as
    /// present would re-assert the false "published" claim through the back door, and would offer a
    /// share link to a stranger's page.
    func testPresenceIgnoresAnotherOwnersRecordUnderTheSameSlug() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreators["kilimanjaro"] = "_someone-else"
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "_me")
        let presence = await publisher.presence(ofJourneySlug: "kilimanjaro")
        XCTAssertEqual(presence, .absent, "another family's page is not ours and not our evidence")
    }

    /// "We could not ask" must never be reported as "it is not published". Both are unhappy, but only
    /// one of them is a fact, and the UI renders them differently.
    func testPresenceIsUnknownWhenTheQueryFailsRatherThanAbsent() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreatorError = CKError(.networkUnavailable)
        let publisher = PublicMirrorPublisher(database: mock, ownerRecordName: "_me")
        guard case .unknown = await publisher.presence(ofJourneySlug: "kilimanjaro") else {
            return XCTFail("a failed lookup must be .unknown, never .absent")
        }
    }

    /// With no owner identity (the dev/test path) there is nothing to compare a creator against, so
    /// presence falls back to "a record exists under the pretty slug" — matching the assumption
    /// `resolveEffectiveSlug` already makes on that same path.
    func testPresenceWithNoOwnerIdentityAcceptsAnyRecordUnderThePrettySlug() async {
        let mock = MockPublicDatabase()
        mock.existingJourneyCreators["kilimanjaro"] = "_whoever"
        let publisher = PublicMirrorPublisher(database: mock)   // ownerRecordName nil
        let presence = await publisher.presence(ofJourneySlug: "kilimanjaro")
        XCTAssertEqual(presence, .present(slug: "kilimanjaro"))
    }
}

// MARK: - ShowcaseViewModel: flag flips only after the network op, and only for the owner

/// The Showcase flow's ordering + failure handling, which the review flagged as having zero
/// coverage. Driven against a fake publisher so publish/unpublish can succeed or fail on demand;
/// the injected `setPublic` closure stands in for `store.setJourneyPublic` and records the flip.
@MainActor
final class ShowcaseViewModelTests: XCTestCase {

    /// Fake mirror publisher: returns a preset report and records which op ran.
    final class FakePublisher: PublicMirrorPublishing, @unchecked Sendable {
        var report: PublicMirrorReport
        private(set) var publishCalled = false
        private(set) var unpublishCalled = false
        /// What the live mirror will claim when asked (QUA-45). Defaults to `.absent`, which is the
        /// state that matters: the flag says published and the web holds nothing.
        var presence: PublicMirrorPresence = .absent
        private(set) var presenceQueriedSlugs: [String] = []
        init(_ report: PublicMirrorReport) { self.report = report }
        func publish(journey: Journey, photos: [Photo],
                     progress: (@Sendable (PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport {
            publishCalled = true; return report
        }
        func unpublish(slug: String,
                       progress: (@Sendable (PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport {
            unpublishCalled = true; return report
        }
        func presence(ofJourneySlug slug: String) async -> PublicMirrorPresence {
            presenceQueriedSlugs.append(slug); return presence
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

    // MARK: Verification — the sheet may not assert "published" on the flag alone (QUA-45)

    /// The state that was measured: `isPublic` true, mirror empty. The model must settle on
    /// `.notOnShowcase`, which is what makes the sheet say "marked as published … but nothing for it
    /// was found on the live showcase" instead of stating that it is on the web.
    func testAnEmptyMirrorSettlesOnNotOnShowcase() async {
        let publisher = FakePublisher(publishedReport())
        publisher.presence = .absent
        let vm = model(publisher)

        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()

        XCTAssertEqual(publisher.presenceQueriedSlugs, ["kilimanjaro"], "the mirror is actually asked")
        XCTAssertEqual(vm.verification, .notOnShowcase)
    }

    func testAPresentMirrorIsTheOnlyStateThatLicensesThePublishedClaim() async {
        let publisher = FakePublisher(publishedReport())
        publisher.presence = .present(slug: "kilimanjaro-a1b2c3")
        let vm = model(publisher)

        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()

        XCTAssertEqual(vm.verification, .onShowcase(slug: "kilimanjaro-a1b2c3"),
                       "the verified slug is the disambiguated one the mirror actually lives under")
    }

    /// A failed lookup must land in `couldNotCheck`, never in `notOnShowcase`. Collapsing them would
    /// tell a household with flaky Wi-Fi that its showcase is gone.
    func testAFailedLookupIsUnverifiedNotUnpublished() async {
        let publisher = FakePublisher(publishedReport())
        publisher.presence = .unknown("networkUnavailable")
        let vm = model(publisher)

        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()

        XCTAssertEqual(vm.verification, .couldNotCheck("networkUnavailable"))
        XCTAssertNotEqual(vm.verification, .notOnShowcase)
    }

    /// No account / un-entitled build: the resolver fails before any publisher exists. That is still
    /// "could not check", not "not published" — and it is the resting state of every non-CloudKit run.
    func testNoAccountLeavesTheClaimUnverifiedRatherThanDenied() async {
        let vm = ShowcaseViewModel(resolveMirror: { .unavailable("No iCloud account available.") })

        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()

        XCTAssertEqual(vm.verification, .couldNotCheck("No iCloud account available."))
    }

    /// The model starts out asserting nothing at all. This is what the sheet renders for a build that
    /// cannot ask and for a journey shared into this account, so it has to be the default rather than
    /// an optimistic guess.
    func testVerificationStartsOutMakingNoClaim() {
        XCTAssertEqual(model(FakePublisher(publishedReport())).verification, .notChecked)
    }

    /// A publish that just succeeded is first-hand evidence about the mirror, so the sheet must not
    /// drop back to "not verified" immediately after watching it land.
    func testASuccessfulPublishIsItsOwnVerification() async {
        var report = publishedReport()
        report.publishedSlug = "kilimanjaro"
        let publisher = FakePublisher(report)
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.publish(journey: journey(), photos: [], isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertEqual(vm.verification, .onShowcase(slug: "kilimanjaro"))
    }

    /// The other direction: a publish whose journey record never landed reports no slug, so there is
    /// nothing verified and nothing claimed. (The flag is not flipped either — see the tests above.)
    func testAFailedPublishClaimsNothingAboutTheMirror() async {
        let publisher = FakePublisher(failedReport())
        let flag = FlagRecorder()
        let vm = model(publisher)

        vm.publish(journey: journey(), photos: [], isOwner: true, setPublic: flag.apply)
        await vm.awaitCurrentOperation()

        XCTAssertEqual(vm.verification, .notChecked)
    }

    /// One check per sheet presentation: the guard exists so re-evaluating the view's `.task` (or a
    /// second call racing the first) cannot restart a settled verification and flap the copy.
    func testVerificationDoesNotRestartOnceItHasAnAnswer() async {
        let publisher = FakePublisher(publishedReport())
        publisher.presence = .absent
        let vm = model(publisher)

        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()
        vm.verifyPresence(slug: "kilimanjaro")
        await vm.awaitVerification()

        XCTAssertEqual(publisher.presenceQueriedSlugs, ["kilimanjaro"], "asked once, not twice")
    }
}

/// QUA-45's WIRING, which nothing guarded until this test.
///
/// `ShowcaseViewModel.verifyPresence` has fifteen unit tests and they are good ones. But the thing that
/// CALLS it lives in a SwiftUI `.task` inside the view body, which no unit test can reach — and there is no
/// showcase UI test (`grep -rln howcase apple/AkashicUITests/` finds nothing). An adversarial pass deleted
/// that `.task` block, after which the sheet never asks the mirror and rests forever on "not checked", and
/// all 841 native tests stayed green.
///
/// So this reads the source. That is a deliberate choice and an established pattern in this repo rather than
/// a shortcut: `UniversalLinkTests` reads the shipped `.entitlements` to catch drift between the plist and
/// the parser, and MAP-03's `chrome.test.ts` read `src/index.css` for a rule it translated — and that one
/// fired correctly the moment MAP-05 deleted the rule, which is exactly the behaviour wanted here.
///
/// It is a coupling test, so it will go red if the wiring legitimately moves. That is the point: when it
/// does, check the new call site still runs on presentation and update the pattern below — do not delete the
/// assertion.
final class ShowcaseVerificationWiringTests: XCTestCase {

    private func sheetSource() throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()          // AkashicTests/
            .deletingLastPathComponent()          // apple/
            .appendingPathComponent("Akashic/Views/Showcase/JourneyShowcaseSheet.swift")
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            throw XCTSkip("JourneyShowcaseSheet.swift not readable from the test bundle")
        }
        return text
    }

    /// **The assertion the revert has to fail.** Without a call site, `verifyPresence` is unreachable code and
    /// the sheet's honest-but-uninformative resting state becomes its only state.
    func testTheSheetActuallyAsksTheMirrorOnPresentation() throws {
        let source = try sheetSource()
        XCTAssertTrue(source.contains("model.verifyPresence(slug:"),
                      "the sheet never calls verifyPresence, so the mirror is never asked and the status row "
                      + "can only ever say 'not verified' — see this class's doc comment")
        XCTAssertTrue(source.contains(".task {"),
                      "the verifyPresence call must run on presentation; a call from a button or an onAppear "
                      + "that no longer fires would satisfy the check above while doing nothing")
    }

    /// The gate matters as much as the call. Verifying a journey the user does not own, or one whose flag was
    /// never set, would ask the mirror about a slug this device has no claim to — and `presence` matches on
    /// creator, so the answer would be a confusing `absent` rather than a useful one.
    func testTheCallIsGatedOnThereBeingAClaimAndSomeoneWhoCanCheckIt() throws {
        let source = try sheetSource()
        for term in ["functional", "isOwner", "live.isPublic"] {
            XCTAssertTrue(source.contains(term),
                          "the presentation gate no longer mentions \(term); an ungated check asks the mirror "
                          + "about journeys this device has no claim to")
        }
    }
}
