import Foundation

/// Honest, pre-fetch size estimate for the first-sync download prompt.
///
/// The whole point is to turn a vague "your archive can be several GB" into a concrete number
/// BEFORE a single asset byte is fetched — the difference between a scary dialog and an honest one.
/// The per-photo average is exactly that: an ESTIMATE; the true total is only known once the assets
/// download. We never claim otherwise in the UI ("about …").
enum SyncSizeEstimate {
    /// Estimated bytes per photo for **what the first sync actually fetches**: the `Photo` record's
    /// metadata plus its `thumb` asset. Originals are deliberately NOT in this number.
    ///
    /// MEASURED, from two independent figures already recorded in the repo:
    /// * `ARCHITECTURE.md` §"Media: why originals live in their own zone" — after photo architecture
    ///   v2 a fresh install pulls **~97 MB** for the family archive, rather than ~11.2 GB.
    /// * `CloudKit/MAPPING.md` §8 — that archive is **1538 photos** across 3 journeys, and a
    ///   thumbnail is **~20–50 KB** (400 px, JPEG q0.8 — `PhotoIngestService.Thumbnailer`).
    ///
    /// 97 MB ÷ 1538 ≈ 63 KB, which is a ~20–50 KB thumbnail plus per-record metadata — the two
    /// measurements agree, so 63 KB is used. MAPPING §13's "≈ 75 MB" is the same pull measured at
    /// the low end of the thumbnail band (≈ 49 KB/photo); the higher figure is taken deliberately so
    /// the dialog never *understates* what it is about to spend.
    ///
    /// **This was 3.5 MB and documented as "originals + thumbnail", which was wrong by ~55×** once
    /// v2 stopped fetching originals on first sync (media zones are excluded from every engine
    /// fetch; `MediaFetcher` streams an original when a photo is opened). A protective dialog that
    /// overstates by that much teaches people to decline it, which is the opposite of protection.
    static let averagePhotoBytes: Int64 = 63_000

    static func estimatedBytes(photoCount: Int) -> Int64 {
        Int64(max(0, photoCount)) * averagePhotoBytes
    }

    /// Human-readable estimate string (e.g. "97.2 MB" for the family archive) for a remote photo
    /// count.
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

// MARK: - Journey summary pre-fetch (DIFF-15)

/// One remote journey, known by NAME before a single byte of it has been downloaded.
///
/// This is what makes a deferred first sync honest instead of misleading: the whole archive is
/// waiting for Wi-Fi, so `JourneyStore` is empty, so `JourneyListView` used to render the
/// "Start your first journey" hero at a family member who has three journeys sitting in iCloud.
/// A handful of these — a few KB over any connection — lets that surface say what is actually there.
///
/// Deliberately a flat value type with no assets and no route: it exists to fill a row, not to
/// stand in for a `Journey`. Dates are ISO `yyyy-MM-dd` day strings, the same shape
/// `Formatters.dateRange` already takes, so the placeholder row formats identically to a real card.
struct RemoteJourneySummary: Identifiable, Equatable, Sendable {
    /// The journey's id — its CloudKit `recordName`, and the id its local row will get when the
    /// download lands, so a row here and the eventual card are the same journey.
    let id: String
    let name: String
    let country: String
    let dateStarted: String?
    let dateEnded: String?
    /// Photo records in this journey's zone. Counted with `desiredKeys: []`, so no asset bytes.
    let photoCount: Int
}

/// Best-effort, **ungated** pre-fetch of remote journey summaries — names, dates and photo counts,
/// no asset bytes at all.
///
/// Ungated on purpose, and it is the one thing here that is not subject to `NetworkPolicy`: three
/// `Journey` records with `desiredKeys` plus a `recordName`-only photo count is kilobytes, which is
/// not the transfer the Wi-Fi-only default exists to protect anyone from. The multi-megabyte
/// thumbnail pull stays deferred exactly as before.
///
/// Same shape as `RemotePhotoCounting` above for the same reasons: a seam so the decision logic is
/// unit-testable, and so the CloudKit implementation (which needs a live container, and would trap
/// in an unentitled build) stays isolated behind the `*-CloudKit` build. Returns `nil` on ANY
/// failure — no account, no queryable index, a transient error — in which case the surface falls
/// back to the first-run hero, which is the correct thing to show when we cannot prove otherwise.
protocol RemoteJourneySummarizing: Sendable {
    func remoteJourneySummaries() async -> [RemoteJourneySummary]?
}

// MARK: - What an empty journey list should render

extension FirstSyncDownloadDecision {

    /// What `JourneyListView` puts on screen when the local store holds no journeys.
    enum EmptyListContent: Equatable {
        /// The "Start your first journey" hero — a genuinely new family.
        case firstRunHero
        /// Named, visibly un-downloaded rows for journeys we know are waiting in iCloud.
        case awaitingDownload([RemoteJourneySummary])
        /// DIFF-16: a download IS being held back, but the pre-fetch could not say what is in it.
        /// A neutral waiting state with a retry — never the hero, which would be a false statement
        /// to a family whose archive exists.
        case couldNotCheck
        /// DIFF-16: the heavy first download is running right now and nothing has landed yet.
        /// Carries the named rows when we have them, so the surface gains a progress affordance
        /// rather than being replaced by a blank.
        case downloading([RemoteJourneySummary])
    }

    /// Decide between the first-run hero, the waiting-to-download rows, the could-not-check state
    /// and the in-progress state.
    ///
    /// Lives on `FirstSyncDownloadDecision` rather than in a decision type of its own because it is
    /// the same judgement `decide(localPhotoCount:remotePhotoCount:)` makes, asked about a different
    /// surface: *do we have honest evidence that content is waiting?* Both answer "no evidence ⇒ say
    /// nothing about a download", and a second enum would be free to drift out of agreement with the
    /// first about what `nil` means.
    ///
    /// - `remoteSummaries`: `nil` when the pre-fetch was impossible or failed, `[]` when it answered
    ///   and the account genuinely holds no journeys. **The difference between those two is the
    ///   DIFF-16 fix**: they used to collapse into the hero together.
    /// - `isDownloadDeferred`: whether a heavy download is actually being held back right now
    ///   (`SyncStatus.State.waitingForWiFi`). Required, because "Waiting for Wi-Fi" rows shown while
    ///   a download is in flight would be a second false statement replacing the first one.
    /// - `isDownloadRunning`: whether the heavy first download — the one whose deferral produced the
    ///   rows — is in flight *right now* (`FirstSyncDownloadProgress`). Defaulted, so the DIFF-15
    ///   call sites and their tests keep their exact meaning.
    ///
    /// ## What changed in DIFF-16, and why the hero branch is still safe
    ///
    /// MEASURED BY THE OWNER on TestFlight build 101, fresh install on cellular: the sized prompt
    /// appeared — so the remote photo COUNT query reached Production and answered — and no journey
    /// rows rendered. `nil` summaries plus an active deferral therefore describes a family whose
    /// archive demonstrably exists, and "Start your first journey" is the one thing that surface must
    /// never say to them. It now says it only for `[]` (the pre-fetch answered: nothing is there) or
    /// for no deferral context at all — both of which are positive evidence of a new family rather
    /// than the absence of evidence about an old one.
    ///
    /// The caller keeps the "is the local store empty?" test — that is `store.journeys.isEmpty` in
    /// the view, and once it is false the view renders real cards and never asks this question.
    static func emptyListContent(remoteSummaries: [RemoteJourneySummary]?,
                                 isDownloadDeferred: Bool,
                                 isDownloadRunning: Bool = false) -> EmptyListContent {
        // Running beats deferred: the download is no longer being held back, so nothing may claim it
        // is. `FirstSyncDownloadProgress` is only ever true when the engine has evidence that content
        // is coming, which is what keeps a brand-new family off this branch entirely.
        if isDownloadRunning { return .downloading(remoteSummaries ?? []) }
        guard isDownloadDeferred else { return .firstRunHero }
        guard let summaries = remoteSummaries else { return .couldNotCheck }
        guard !summaries.isEmpty else { return .firstRunHero }
        return .awaitingDownload(summaries)
    }
}

// MARK: - Is the first download running? (DIFF-16)

/// The one fact the journey list needs that `SyncStatus` cannot express: **the heavy first download
/// is in flight right now, and we know it has content.**
///
/// ## Why this is not a `SyncStatus.State`
///
/// `.active` means "the engine is running", which is also the steady state of a fully synced app —
/// so `.active` plus an empty local store cannot tell a first sync in progress from a brand-new
/// family whose fetch is about to return nothing. Rendering "Downloading your journeys…" at a new
/// family, even for the second the empty fetch takes, is the same class of false statement DIFF-15
/// existed to remove; it just points the other way. So this flag is set only where the engine has
/// already established that there IS something to download — a non-empty summary pre-fetch, or a
/// positive remote photo count (which is exactly the evidence the device had when DIFF-15 failed).
///
/// One published fact, one writer (`AkashicSyncEngine`), one reader (`JourneyListView`). Deliberately
/// NOT a second copy of `SyncStatus.remoteJourneySummaries`: two sources for one fact is how the
/// hero-versus-rows branch would start disagreeing with itself.
@MainActor
final class FirstSyncDownloadProgress: ObservableObject {

    /// Process-wide, like `NetworkPolicy.shared`: there is one first download, not one per view.
    static let shared = FirstSyncDownloadProgress()

    /// True from just before the heavy fetch starts until it returns, success or failure.
    @Published private(set) var isRunning = false

    /// Tests build their own; production uses `shared`.
    init() {}

    func begin() { isRunning = true }
    func end() { isRunning = false }
}

