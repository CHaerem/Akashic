import XCTest
import CloudKit
@testable import Akashic

/// Photo architecture v2 (MAPPING §13): the PhotoMedia coder helpers, the direct-DB media service,
/// on-demand fetching, the one-time repack, and participant media-share auto-accept — all against
/// seam mocks, no container.
final class MediaV2Tests: XCTestCase {

    // MARK: - RecordCoder: media zone + record-name helpers

    func testMediaZoneNamingAndRoundTrip() {
        let zone = RecordCoder.mediaZoneID(forJourneyID: "abc-123")
        XCTAssertEqual(zone.zoneName, "journey-abc-123-media")
        XCTAssertTrue(RecordCoder.isMediaZone(zone))
        XCTAssertEqual(RecordCoder.journeyID(fromMediaZoneID: zone), "abc-123")
        // The ordinary journey-zone decoder must NOT claim a media zone (it would map to a bogus id).
        XCTAssertNil(RecordCoder.journeyID(fromZoneID: zone), "a media zone must not decode as a data zone")

        // A plain journey zone is not a media zone.
        let dataZone = RecordCoder.zoneID(forJourneyID: "abc-123")
        XCTAssertFalse(RecordCoder.isMediaZone(dataZone))
        XCTAssertEqual(RecordCoder.journeyID(fromZoneID: dataZone), "abc-123")
        XCTAssertNil(RecordCoder.journeyID(fromMediaZoneID: dataZone))
    }

    func testMediaRecordNameHelpers() {
        XCTAssertEqual(RecordCoder.mediaRecordName(forPhotoID: "p1"), "media-p1")
        XCTAssertEqual(RecordCoder.photoID(fromMediaRecordName: "media-p1"), "p1")
        XCTAssertNil(RecordCoder.photoID(fromMediaRecordName: "p1"), "a non-media name -> nil")
        XCTAssertNil(RecordCoder.photoID(fromMediaRecordName: "media-"), "empty photo id -> nil")
    }

    func testPhotoMediaRoundTrip() throws {
        let zone = RecordCoder.mediaZoneID(forJourneyID: "j1")
        let file = try tempFile(contents: "original-bytes")
        defer { try? FileManager.default.removeItem(at: file) }

        let record = RecordCoder.recordForPhotoMedia(photoID: "p1", journeyID: "j1", in: zone,
                                                     originalPath: file.path)
        XCTAssertEqual(record.recordType, "PhotoMedia")
        XCTAssertEqual(record.recordID.recordName, "media-p1")
        XCTAssertEqual(record.recordID.zoneID, zone)
        XCTAssertEqual(record["photoId"] as? String, "p1")
        XCTAssertEqual(record["journeyId"] as? String, "j1")
        XCTAssertNotNil(record["original"] as? CKAsset, "original bytes attach as an ASSET")

        let decoded = try XCTUnwrap(RecordCoder.photoMedia(from: record))
        XCTAssertEqual(decoded.photoID, "p1")
        XCTAssertEqual(decoded.journeyID, "j1")
        XCTAssertNotNil(decoded.originalURL)
        XCTAssertNil(RecordCoder.photoMedia(from: CKRecord(recordType: "Photo",
                                                           recordID: .init(recordName: "x", zoneID: zone))),
                     "decoder rejects the wrong record type")
    }

    func testPhotoMediaOmitsAssetWhenBytesMissing() {
        let zone = RecordCoder.mediaZoneID(forJourneyID: "j1")
        let record = RecordCoder.recordForPhotoMedia(photoID: "p1", journeyID: "j1", in: zone,
                                                     originalPath: "/nope/\(UUID().uuidString).jpg")
        XCTAssertNil(record["original"], "missing local bytes -> field left unset (never nil-assigned)")
    }

    // MARK: - Photo record no longer carries the original (v2)

    func testPhotoRecordDropsOriginalByDefaultButKeepsThumb() throws {
        let zone = RecordCoder.zoneID(forJourneyID: "j1")
        let original = try tempFile(contents: "orig")
        let thumb = try tempFile(contents: "thumb")
        defer { try? FileManager.default.removeItem(at: original); try? FileManager.default.removeItem(at: thumb) }
        var photo = makePhoto()
        photo.localOriginalPath = original.path
        photo.localThumbPath = thumb.path

        let record = RecordCoder.record(for: photo, in: zone)
        XCTAssertNil(record["original"], "v2: ingest/sync never writes Photo.original")
        XCTAssertNotNil(record["thumb"] as? CKAsset, "thumb still rides the Photo record")

        // The importer opt-in still attaches it (migration path).
        let importRecord = RecordCoder.record(for: photo, in: zone, includeOriginal: true)
        XCTAssertNotNil(importRecord["original"] as? CKAsset, "importer keeps attaching the original")
    }

    func testClearOriginalAssetRemovesTheField() {
        let zone = RecordCoder.zoneID(forJourneyID: "j1")
        let record = CKRecord(recordType: "Photo", recordID: .init(recordName: "p1", zoneID: zone))
        record["original"] = "placeholder"
        RecordCoder.clearOriginalAsset(on: record)
        XCTAssertNil(record["original"], "clearOriginalAsset deletes the field (the repack's clear step)")
    }

    // MARK: - PhotoMediaService (direct DB, chunked)

    func testServiceUploadsPerZoneAndSkipsMissingBytes() async throws {
        let db = MockMediaDatabase()
        let service = PhotoMediaService(database: db, batchSize: 50)
        let present = try tempFile(contents: "bytes")
        defer { try? FileManager.default.removeItem(at: present) }

        let result = await service.upload([
            MediaUploadItem(photoID: "p1", journeyID: "j1", originalPath: present.path),
            MediaUploadItem(photoID: "p2", journeyID: "j1", originalPath: nil),                     // skip
            MediaUploadItem(photoID: "p3", journeyID: "j1", originalPath: "/gone/\(UUID()).jpg"),   // skip
        ])

        XCTAssertEqual(result.savedPhotoIDs, ["p1"])
        XCTAssertEqual(result.skippedMissingBytes.sorted(), ["p2", "p3"])
        XCTAssertTrue(result.failedPhotoIDs.isEmpty)
        XCTAssertEqual(db.ensuredZones, [RecordCoder.mediaZoneID(forJourneyID: "j1")],
                       "the journey's media zone is ensured once")
        XCTAssertEqual(db.savedRecordNames, ["media-p1"])
    }

    func testServiceChunksLargeBatches() async throws {
        let db = MockMediaDatabase()
        let service = PhotoMediaService(database: db, batchSize: 2)
        let file = try tempFile(contents: "bytes")
        defer { try? FileManager.default.removeItem(at: file) }
        let items = (1...5).map { MediaUploadItem(photoID: "p\($0)", journeyID: "j1", originalPath: file.path) }

        let result = await service.upload(items)

        XCTAssertEqual(result.savedPhotoIDs.count, 5)
        XCTAssertEqual(db.modifyCallCount, 3, "5 items @ batch 2 -> 3 modify operations")
    }

    func testServiceDeleteIssuesDeletions() async {
        let db = MockMediaDatabase()
        let service = PhotoMediaService(database: db)
        await service.delete(photoIDs: ["p1", "p2"], journeyID: "j1")
        XCTAssertEqual(db.deletedRecordNames.sorted(), ["media-p1", "media-p2"])
    }

    // MARK: - MediaFetcher (on-demand originals)

    @MainActor
    func testFetcherLocalHitSkipsNetwork() async throws {
        let db = MockMediaDatabase()
        let local = try tempFile(contents: "orig")
        defer { try? FileManager.default.removeItem(at: local) }
        var photo = makePhoto()
        photo.localOriginalPath = local.path

        let fetcher = MediaFetcher(dependencies: .init(
            database: { _ in db }, zoneOwner: { _ in nil }, persist: { _, _ in nil }))
        let url = try await fetcher.originalURL(for: photo)

        XCTAssertEqual(url.path, local.path)
        XCTAssertEqual(db.fetchCallCount, 0, "a local hit never touches the database")
    }

    @MainActor
    func testFetcherRemoteFetchStoresThrough() async throws {
        let staging = try tempFile(contents: "downloaded")
        defer { try? FileManager.default.removeItem(at: staging) }
        let stable = FileManager.default.temporaryDirectory.appendingPathComponent("stable-\(UUID()).jpg")
        defer { try? FileManager.default.removeItem(at: stable) }

        let db = MockMediaDatabase()
        let photo = makePhoto()   // no local bytes
        db.seedMedia(photoID: photo.id, journeyID: photo.journeyId, ownerName: CKCurrentUserDefaultName,
                     assetURL: staging)

        var persisted: (Photo, URL)?
        let fetcher = MediaFetcher(dependencies: .init(
            database: { _ in db },
            zoneOwner: { _ in nil },
            persist: { photo, url in persisted = (photo, url); return stable }))

        let url = try await fetcher.originalURL(for: photo)
        XCTAssertEqual(url, stable, "store-through returns the stable media-root URL")
        XCTAssertEqual(persisted?.1, staging, "the staging URL was handed to persist")
        XCTAssertEqual(db.fetchCallCount, 1)
    }

    @MainActor
    func testFetcherSingleFlightPerPhoto() async throws {
        let staging = try tempFile(contents: "downloaded")
        defer { try? FileManager.default.removeItem(at: staging) }
        let db = MockMediaDatabase(fetchDelay: .milliseconds(40))
        let photo = makePhoto()
        db.seedMedia(photoID: photo.id, journeyID: photo.journeyId, ownerName: CKCurrentUserDefaultName,
                     assetURL: staging)
        let fetcher = MediaFetcher(dependencies: .init(
            database: { _ in db }, zoneOwner: { _ in nil }, persist: { _, url in url }))

        async let a = fetcher.originalURL(for: photo)
        async let b = fetcher.originalURL(for: photo)
        _ = try await (a, b)

        XCTAssertEqual(db.fetchCallCount, 1, "two concurrent requests coalesce onto one download")
    }

    @MainActor
    func testFetcherNotFoundThrows() async {
        let db = MockMediaDatabase()   // nothing seeded
        let fetcher = MediaFetcher(dependencies: .init(
            database: { _ in db }, zoneOwner: { _ in nil }, persist: { _, url in url }))
        do {
            _ = try await fetcher.originalURL(for: makePhoto())
            XCTFail("expected notFound")
        } catch {
            XCTAssertEqual(error as? MediaFetchError, .notFound)
        }
    }

    // MARK: - MediaRepackJob

    @MainActor
    func testRepackProcessesPendingMarksAndClears() async throws {
        let file = try tempFile(contents: "bytes")
        defer { try? FileManager.default.removeItem(at: file) }
        let store = FakeRepackStore(pending: (1...3).map {
            MediaUploadItem(photoID: "p\($0)", journeyID: "j1", originalPath: file.path)
        })
        let db = MockMediaDatabase()
        let job = MediaRepackJob(store: store, service: PhotoMediaService(database: db),
                                 batchSize: 2, sleep: { _ in })

        let progress = await job.run()
        XCTAssertEqual(progress.done, 3)
        XCTAssertEqual(progress.total, 3)
        XCTAssertTrue(progress.isFinished)
        XCTAssertEqual(Set(store.confirmed), ["p1", "p2", "p3"])
        XCTAssertEqual(Set(store.clearedPhotoIDs), ["p1", "p2", "p3"],
                       "each repacked photo's Photo.original is cleared via the engine")
    }

    @MainActor
    func testRepackIsIdempotentWhenNothingPending() async {
        let store = FakeRepackStore(pending: [], confirmed: ["p1", "p2"])
        let db = MockMediaDatabase()
        let job = MediaRepackJob(store: store, service: PhotoMediaService(database: db), sleep: { _ in })
        let progress = await job.run()
        XCTAssertEqual(progress.done, 2)
        XCTAssertEqual(progress.total, 2)
        XCTAssertEqual(db.modifyCallCount, 0, "a completed archive does no work")
    }

    @MainActor
    func testRepackResumesAfterPartialRun() async throws {
        let file = try tempFile(contents: "bytes")
        defer { try? FileManager.default.removeItem(at: file) }
        // 4 pending; first run processes all, marking them confirmed. A "kill" is simulated by a
        // fresh job over the same store — pending is recomputed (excludes confirmed) so it resumes.
        let store = FakeRepackStore(pending: (1...4).map {
            MediaUploadItem(photoID: "p\($0)", journeyID: "j1", originalPath: file.path)
        })
        let db = MockMediaDatabase()

        // Kill after the first batch: cap the DB to accept only 2, rest "fail" (stay pending).
        db.failAfterSaves = 2
        _ = await MediaRepackJob(store: store, service: PhotoMediaService(database: db),
                                 batchSize: 2, sleep: { _ in }).run()
        XCTAssertEqual(store.confirmed.count, 2, "only the first batch landed")

        // Resume: a new job, DB now healthy, picks up exactly the remainder.
        db.failAfterSaves = nil
        let progress = await MediaRepackJob(store: store, service: PhotoMediaService(database: db),
                                            batchSize: 2, sleep: { _ in }).run()
        XCTAssertEqual(store.confirmed.count, 4, "resume completes the rest")
        XCTAssertEqual(progress.total, 4, "the total still reflects the whole set (confirmed + pending)")
        XCTAssertTrue(progress.isFinished)
    }

    @MainActor
    func testRepackPausesOnCellularAndResumesOnWiFi() async throws {
        let file = try tempFile(contents: "bytes")
        defer { try? FileManager.default.removeItem(at: file) }
        let store = FakeRepackStore(pending: (1...4).map {
            MediaUploadItem(photoID: "p\($0)", journeyID: "j1", originalPath: file.path)
        })
        let gate = ToggleGate(allows: false)
        let db = MockMediaDatabase()
        let job = MediaRepackJob(store: store, service: PhotoMediaService(database: db),
                                 networkPolicy: gate, batchSize: 2, sleep: { _ in })

        let paused = await job.run()
        XCTAssertTrue(paused.isPaused, "a metered path pauses the batch upload")
        XCTAssertEqual(paused.done, 0)
        XCTAssertTrue(store.confirmed.isEmpty, "nothing uploaded while paused")

        gate.allows = true
        let finished = await job.run()
        XCTAssertFalse(finished.isPaused)
        XCTAssertTrue(finished.isFinished)
        XCTAssertEqual(store.confirmed.count, 4, "resumes and completes once Wi-Fi is available")
    }

    // MARK: - MediaShareAutoAccepter (participant side)

    @MainActor
    func testAutoAcceptCalledWhenUnaccepted() async {
        let defaults = UserDefaults(suiteName: "media-\(UUID())")!
        let accepter = RecordingAccepter()
        let sut = MediaShareAutoAccepter(accepter: accepter, defaults: defaults)

        let accepted = await sut.autoAcceptIfNeeded(journeyID: "j1",
                                                    mediaShareURL: "https://www.icloud.com/share/abc")
        XCTAssertTrue(accepted)
        XCTAssertEqual(accepter.acceptedURLs.map(\.absoluteString), ["https://www.icloud.com/share/abc"])
        XCTAssertTrue(sut.hasAccepted(journeyID: "j1"))

        // A second arrival must NOT re-accept.
        accepter.acceptedURLs.removeAll()
        let again = await sut.autoAcceptIfNeeded(journeyID: "j1",
                                                 mediaShareURL: "https://www.icloud.com/share/abc")
        XCTAssertFalse(again)
        XCTAssertTrue(accepter.acceptedURLs.isEmpty, "an already-accepted share is never re-attempted")
    }

    @MainActor
    func testAutoAcceptDegradesToThumbnailsOnFailure() async {
        let defaults = UserDefaults(suiteName: "media-\(UUID())")!
        let accepter = RecordingAccepter()
        accepter.shouldThrow = true
        let sut = MediaShareAutoAccepter(accepter: accepter, defaults: defaults)

        let accepted = await sut.autoAcceptIfNeeded(journeyID: "j1",
                                                    mediaShareURL: "https://www.icloud.com/share/abc")
        XCTAssertFalse(accepted, "a failure never throws — it degrades to thumbnails")
        XCTAssertFalse(sut.hasAccepted(journeyID: "j1"), "a failed accept is not recorded, so it retries")
    }

    @MainActor
    func testAutoAcceptNoOpWithoutURL() async {
        let defaults = UserDefaults(suiteName: "media-\(UUID())")!
        let accepter = RecordingAccepter()
        let sut = MediaShareAutoAccepter(accepter: accepter, defaults: defaults)
        let accepted = await sut.autoAcceptIfNeeded(journeyID: "j1", mediaShareURL: nil)
        XCTAssertFalse(accepted)
        XCTAssertTrue(accepter.acceptedURLs.isEmpty)
    }

    // MARK: - Helpers

    private func tempFile(contents: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mv2-\(UUID()).bin")
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func makePhoto(id: String = "p1", journeyId: String = "j1") -> Photo {
        Photo(id: id, journeyId: journeyId, waypointId: nil, url: "", thumbnailURL: nil,
              caption: nil, coordinates: nil, takenAt: nil, isHero: false, sortOrder: 0,
              rotation: 0, mediaType: "image", duration: nil, locationSource: nil,
              localOriginalPath: nil, localThumbPath: nil)
    }
}

// MARK: - Mocks

/// Recording fake `MediaDatabase`. Records saves/deletes/zone-ensures and serves seeded fetches.
final class MockMediaDatabase: MediaDatabase, @unchecked Sendable {
    private(set) var savedRecordNames: [String] = []
    private(set) var deletedRecordNames: [String] = []
    private(set) var ensuredZones: [CKRecordZone.ID] = []
    private(set) var modifyCallCount = 0
    private(set) var fetchCallCount = 0
    /// After this many total successful saves, further saves are reported as per-record failures.
    var failAfterSaves: Int?
    private var seeded: [CKRecord.ID: CKRecord] = [:]
    private let fetchDelay: Duration?
    private var totalSaved = 0

    init(fetchDelay: Duration? = nil) { self.fetchDelay = fetchDelay }

    func seedMedia(photoID: String, journeyID: String, ownerName: String, assetURL: URL) {
        let zone = RecordCoder.mediaZoneID(forJourneyID: journeyID, ownerName: ownerName)
        let record = RecordCoder.recordForPhotoMedia(photoID: photoID, journeyID: journeyID,
                                                     in: zone, originalPath: assetURL.path)
        seeded[record.recordID] = record
    }

    func modifyMediaRecords(saving: [CKRecord], deleting: [CKRecord.ID]) async throws
        -> (saved: [CKRecord], failed: [(id: CKRecord.ID, error: Error)]) {
        modifyCallCount += 1
        var saved: [CKRecord] = []
        var failed: [(id: CKRecord.ID, error: Error)] = []
        for record in saving {
            if let cap = failAfterSaves, totalSaved >= cap {
                failed.append((record.recordID, CKError(.limitExceeded)))
            } else {
                saved.append(record); savedRecordNames.append(record.recordID.recordName); totalSaved += 1
            }
        }
        deletedRecordNames.append(contentsOf: deleting.map { $0.recordName })
        return (saved, failed)
    }

    func fetchMediaRecords(for ids: [CKRecord.ID], desiredKeys: [CKRecord.FieldKey]?) async throws
        -> [CKRecord.ID: CKRecord] {
        fetchCallCount += 1
        if let fetchDelay { try? await Task.sleep(for: fetchDelay) }
        var out: [CKRecord.ID: CKRecord] = [:]
        for id in ids where seeded[id] != nil { out[id] = seeded[id] }
        return out
    }

    func ensureMediaZone(_ zoneID: CKRecordZone.ID) async throws {
        ensuredZones.append(zoneID)
    }
}

/// Recording fake `MediaRepackStore`. Pending is recomputed as (initial pending − confirmed), so a
/// re-run naturally resumes; `markMediaUploaded` moves ids into `confirmed`.
@MainActor
final class FakeRepackStore: MediaRepackStore {
    private let initialPending: [MediaUploadItem]
    private(set) var confirmed: [String] = []
    private(set) var clearedPhotoIDs: [String] = []

    init(pending: [MediaUploadItem], confirmed: [String] = []) {
        self.initialPending = pending
        self.confirmed = confirmed
    }

    func mediaRepackPending() -> [MediaUploadItem] {
        initialPending.filter { !confirmed.contains($0.photoID) }
    }
    func mediaRepackConfirmedCount() -> Int { confirmed.count }
    func markMediaUploaded(_ records: [CKRecord]) {
        confirmed.append(contentsOf: records.compactMap { RecordCoder.photoID(fromMediaRecordName: $0.recordID.recordName) })
    }
    func enqueuePhotoOriginalClear(photoIDs: [String]) { clearedPhotoIDs.append(contentsOf: photoIDs) }
}

/// Toggleable Wi-Fi gate for the repack pause/resume test.
@MainActor
final class ToggleGate: NetworkPolicyGate {
    var allows: Bool
    init(allows: Bool) { self.allows = allows }
    var allowsHeavyTransfer: Bool { allows }
    func heavyTransferDidComplete() {}
    /// DIFF-16: `allows` is flipped directly by the repack test, which polls the gate per batch rather
    /// than reacting to a transition — so there is nothing to notify. `MediaRepackJob` pauses itself.
    func observeHeavyTransferDisallowed(_ onDisallowed: @escaping () -> Void) {}
}

/// Recording fake `MediaShareAccepting`.
final class RecordingAccepter: MediaShareAccepting, @unchecked Sendable {
    var acceptedURLs: [URL] = []
    var shouldThrow = false
    struct Boom: Error {}
    func fetchAndAccept(shareURL: URL) async throws {
        if shouldThrow { throw Boom() }
        acceptedURLs.append(shareURL)
    }
}
