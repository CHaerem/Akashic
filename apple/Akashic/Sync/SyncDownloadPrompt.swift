import Foundation

/// Honest, pre-fetch size estimate for the first-sync download prompt.
///
/// The whole point is to turn a vague "your archive can be several GB" into a concrete number
/// BEFORE a single asset byte is fetched — the difference between a scary dialog and an honest one.
/// The per-photo average is exactly that: an ESTIMATE. Real Akashic originals average ~3.5 MB
/// after processing; the true total is only known once the assets download. We never claim
/// otherwise in the UI ("about …").
enum SyncSizeEstimate {
    /// Estimated bytes per photo (originals + thumbnail). An order-of-magnitude figure, not a
    /// measurement — CloudKit's own scheduling API works the same way (`expectedReceiveSize`).
    static let averagePhotoBytes: Int64 = 3_500_000

    static func estimatedBytes(photoCount: Int) -> Int64 {
        Int64(max(0, photoCount)) * averagePhotoBytes
    }

    /// Human-readable estimate string (e.g. "5.4 GB") for the given remote photo count.
    static func humanReadable(photoCount: Int) -> String {
        ByteCount.string(estimatedBytes(photoCount: photoCount))
    }
}

/// Pure decision for whether to show the one-time first-sync Wi-Fi prompt, or just defer silently
/// with the generic "Waiting for Wi-Fi" status. Free of CloudKit and UI so the branch logic is
/// unit-tested directly; the engine feeds it a local photo count and a best-effort remote count.
enum FirstSyncDownloadDecision: Equatable {
    /// Fresh install, a heavy pull pending, and a usable remote estimate — show the prompt.
    case prompt(estimatedBytes: Int64, summary: String)
    /// Incremental sync (the store already holds data), or no usable estimate — defer silently.
    case deferSilently

    /// A "fresh install" holds at most this many local photos. The tolerance absorbs a handful of
    /// seeded/fixture rows; above it the pull is incremental and no full-archive dialog is
    /// warranted (the scary number would be wrong).
    static let freshInstallPhotoCeiling = 10

    /// Decide from the local store size and a best-effort remote count.
    ///
    /// - `localPhotoCount`: photos already in the local store. Above the ceiling ⇒ incremental.
    /// - `remotePhotoCount`: best-effort count of downloadable photos, or `nil` when the pre-fetch
    ///   count query was impossible/failed. `nil` or `0` ⇒ no honest number to show ⇒ defer silently.
    static func decide(localPhotoCount: Int, remotePhotoCount: Int?) -> FirstSyncDownloadDecision {
        guard localPhotoCount <= freshInstallPhotoCeiling else { return .deferSilently }
        guard let remote = remotePhotoCount, remote > 0 else { return .deferSilently }
        let bytes = SyncSizeEstimate.estimatedBytes(photoCount: remote)
        return .prompt(estimatedBytes: bytes, summary: ByteCount.string(bytes))
    }
}

// MARK: - Remote count seam (best-effort, pre-fetch)

/// Best-effort pre-fetch count of downloadable Photo records — WITHOUT fetching any asset bytes.
/// A seam so the decision is testable and so the CloudKit implementation (which needs a live
/// container) stays isolated behind the `*-CloudKit` build. Returns `nil` when the count cannot be
/// determined, in which case the prompt falls back to deferring silently.
protocol RemotePhotoCounting: Sendable {
    func remotePhotoCount() async -> Int?
}
