import XCTest
import UniformTypeIdentifiers
@testable import Akashic

/// QUA-11 — a full iCloud account must be visible, and must stay visible.
///
/// The original defect was not that `quotaExceeded` was mishandled; it was that it fell into the
/// `default:` "retryable" branch and therefore said nothing at all, so the Settings row went on
/// reading "Syncing · last update 3 min ago" while every save was being rejected. The subtler half
/// is that `markSynced` is called from four *fetch* paths, and fetching keeps working perfectly on a
/// full account — so even after adding the state, any successful fetch would have erased it.
final class SyncStatusStorageFullTests: XCTestCase {

    @MainActor
    func testStorageFullHasItsOwnConsumerFacingSummary() {
        let status = SyncStatus()
        status.set(.storageFull)
        XCTAssertEqual(status.summary, "Your iCloud is full — new photos are waiting to upload")
    }

    /// The regression that matters. A fetch succeeding is not evidence that space exists.
    @MainActor
    func testASuccessfulFetchDoesNotClearStorageFull() {
        let status = SyncStatus()
        status.set(.storageFull)
        status.markSynced()
        XCTAssertEqual(status.state, .storageFull,
                       "fetching works fine on a full account, so markSynced must not claim health")
    }

    /// …but the timestamp still moves, because the fetch genuinely happened. Suppressing that too
    /// would make the row look stale for a different and equally wrong reason.
    @MainActor
    func testASuccessfulFetchStillUpdatesTheTimestamp() {
        let status = SyncStatus()
        status.set(.storageFull)
        let when = Date(timeIntervalSince1970: 1_700_000_000)
        status.markSynced(when)
        XCTAssertEqual(status.lastSyncDate, when)
    }

    /// Only a save landing proves space exists again.
    @MainActor
    func testASuccessfulSaveClearsStorageFull() {
        let status = SyncStatus()
        status.set(.storageFull)
        status.clearStorageFullOnSuccessfulSave()
        XCTAssertEqual(status.state, .active)
    }

    /// The clear must be narrow: it may not resurrect a genuinely broken or signed-out state.
    @MainActor
    func testClearingIsANoOpFromAnyOtherState() {
        for state: SyncStatus.State in [.noAccount, .restricted, .error("boom"), .waitingForWiFi, .disabled] {
            let status = SyncStatus()
            status.set(state)
            status.clearStorageFullOnSuccessfulSave()
            XCTAssertEqual(status.state, state, "\(state) must be left alone")
        }
    }

    @MainActor
    func testStorageFullIsNotReportedAsActive() {
        let status = SyncStatus()
        status.set(.storageFull)
        XCTAssertFalse(status.isActive,
                       "anything keyed on isActive must not treat a stalled upload queue as healthy")
    }
}

/// QUA-13 — a movie must not be materialised in memory, and an implausible one is refused by size.
///
/// The picker cannot be driven headlessly, so what is testable here is the size guard, the error it
/// produces, and that the file path yields a `Photo` identical in shape to the in-memory path.
final class VideoIngestFilePathTests: XCTestCase {

    private var root: URL!
    private var service: PhotoIngestService!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("akashic-video-ingest-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        service = PhotoIngestService(media: MediaLibrary(root: root))
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// The cap exists so an accidental multi-minute 4K pick fails with a sentence instead of a
    /// jetsam. Pinned because a silently-raised cap would restore the original crash.
    func testTheMovieCapIsBoundedAndItsMessageIsActionable() {
        XCTAssertEqual(PhotoIngestService.maxMovieBytes, 1_500_000_000)
        let message = PhotoIngestError.movieTooLarge(maxBytes: PhotoIngestService.maxMovieBytes)
            .errorDescription
        XCTAssertNotNil(message)
        XCTAssertTrue(message!.contains("Trim it in Photos"),
                      "the error has to say what to do about it, not just that it happened")
    }

    /// The file path must produce the same record shape as the in-memory path — same relative key
    /// scheme, same mediaType — because everything downstream reads those fields.
    func testFilePathProducesAVideoPhotoWithTheStandardKeyScheme() async throws {
        let source = root.appendingPathComponent("clip.mov")
        // Not a decodable movie: duration and poster frame degrade to nil, which is the point —
        // ingest must still commit the original and return a usable record.
        try Data("not-a-real-movie".utf8).write(to: source)

        let photo = try await service.ingest(fileURL: source, type: .quickTimeMovie,
                                             journeyId: "J1", sortOrder: 3)

        XCTAssertEqual(photo.mediaType, "video")
        XCTAssertTrue(photo.isVideo)
        XCTAssertEqual(photo.journeyId, "J1")
        XCTAssertEqual(photo.sortOrder, 3)
        XCTAssertTrue(photo.url.hasPrefix("journeys/J1/photos/"), "got \(photo.url)")
        XCTAssertTrue(photo.url.hasSuffix(".mov"), "got \(photo.url)")
        let landed = try XCTUnwrap(photo.localOriginalPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: landed), "the original must be committed")
    }

    /// The source is a system-owned temporary file the caller deletes, so ingest must COPY it, not
    /// move it — a move would work in tests and then strand the original in production.
    func testTheSourceFileSurvivesIngest() async throws {
        let source = root.appendingPathComponent("keepme.mov")
        try Data("bytes".utf8).write(to: source)
        _ = try await service.ingest(fileURL: source, type: .quickTimeMovie, journeyId: "J2")
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path),
                      "ingest must copy, so the caller's cleanup stays its own business")
    }

    /// Re-ingesting over an existing destination must not throw: `copyItem` fails on an existing
    /// file, where `Data.write(options: .atomic)` silently replaced it.
    func testIngestingTwiceDoesNotFailOnTheDestination() async throws {
        let source = root.appendingPathComponent("twice.mov")
        try Data("bytes".utf8).write(to: source)
        _ = try await service.ingest(fileURL: source, type: .quickTimeMovie, journeyId: "J3")
        _ = try await service.ingest(fileURL: source, type: .quickTimeMovie, journeyId: "J3")
    }
}
