import XCTest
@testable import Akashic

/// DIFF-15: the first-sync size estimate, pinned to what the engine ACTUALLY fetches.
///
/// Deliberately its own file, touching `SyncSizeEstimate` and nothing else. That is what makes the
/// estimate fix provable in both directions: `scripts/prove.mjs` can revert
/// `apple/Akashic/Sync/SyncDownloadPrompt.swift` to before the fix and this file still compiles, so
/// the red it produces is a failing assertion about gigabytes-versus-megabytes rather than a build
/// error about symbols the fix introduced. (prove.mjs rejects a red with zero tests run, correctly.)
///
/// ## The measurement, and where it comes from
///
/// Both figures were already recorded in the repo before this task; neither is invented here:
///   * `CloudKit/MAPPING.md` §8 — the family archive is **1538 photos** across 3 journeys, and a
///     thumbnail is **~20–50 KB** (400 px, JPEG q0.8 — `PhotoIngestService.Thumbnailer`).
///   * `ARCHITECTURE.md`, "Media: why originals live in their own zone" — after photo architecture v2
///     a fresh install pulls **~97 MB**, against ~11.2 GB before the split.
///
/// The estimate was 3.5 MB/photo and documented as "originals + thumbnail", which stopped being true
/// when v2 excluded the media zones from every engine fetch. It would have quoted ~5.4 GB for that
/// same ~97 MB pull — 55× — and a protective dialog that overstates by 55× teaches people to decline
/// it, which is the opposite of protecting them.
final class SyncSizeEstimateTests: XCTestCase {

    /// The family archive is the one case with two independent measurements to check against.
    func testFamilyArchiveEstimateMatchesTheMeasuredFreshInstall() {
        let archive = SyncSizeEstimate.estimatedBytes(photoCount: 1538)
        XCTAssertGreaterThan(archive, 70_000_000,
                             "MAPPING §13 measured ≈75 MB and ARCHITECTURE.md ≈97 MB — not kilobytes")
        XCTAssertLessThan(archive, 110_000_000,
                          "3.5 MB/photo quoted ~5.4 GB for this pull: originals the engine never fetches")
    }

    func testFamilyArchiveReadsInMegabytesNotGigabytes() {
        let text = SyncSizeEstimate.humanReadable(photoCount: 1538)
        XCTAssertTrue(text.contains("MB"), "the first sync of the whole archive is megabytes: \(text)")
        XCTAssertFalse(text.contains("GB"), "overstating by 55× teaches people to decline the dialog")
    }

    /// A per-photo guard, so the regression is caught even if the archive ever changes size: a
    /// thumbnail plus per-record metadata cannot plausibly approach a full original.
    func testPerPhotoAverageIsThumbnailScale() {
        XCTAssertLessThan(SyncSizeEstimate.averagePhotoBytes, 200_000,
                          "a ~20–50 KB thumbnail plus metadata — an original would mean originals crept back in")
        XCTAssertGreaterThan(SyncSizeEstimate.averagePhotoBytes, 10_000,
                             "below the measured thumbnail band the estimate would UNDERSTATE the download")
    }

    func testEstimateMathScalesAndClamps() {
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: 100),
                       100 * SyncSizeEstimate.averagePhotoBytes)
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: 0), 0)
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: -5), 0, "negative counts clamp to zero")
    }
}
