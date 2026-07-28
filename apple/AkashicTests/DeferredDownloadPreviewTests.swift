import XCTest
import CloudKit
@testable import Akashic

/// DIFF-15: what a fresh install on a metered connection is allowed to say.
///
/// The defect these cover was not a crash and not silence. `NetworkPolicy` correctly defers the
/// first fetch on an expensive path and `SyncStatus` correctly reports `.waitingForWiFi`; the
/// journey list then read `store.journeys.isEmpty` as "brand-new customer" and rendered the
/// "Start your first journey" hero at a family member whose whole archive was sitting in iCloud
/// waiting. And the estimate that dialog would have quoted was sized for originals the engine has
/// not fetched since photo architecture v2 — gigabytes for a ~97 MB thumbnail pull.
///
/// Two things are pinned here, in the order they matter:
///   1. the branch: named waiting rows when we have evidence, the hero when we do not — asserted
///      both purely and through the engine seam, so a decision the engine never publishes fails,
///   2. the one-occasion release: the surface's action runs the deferred fetch and does NOT turn
///      the user's Wi-Fi-only preference off.
///
/// The other two halves live in their own files, each importing nothing this task added, so each is
/// provable in both directions by reverting one product file: `SyncSizeEstimateTests` (the corrected
/// estimate) and `JourneyListWaitingSurfaceTests` (that the view actually asks the decision).
@MainActor
final class DeferredDownloadPreviewTests: XCTestCase {

    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "diff15-\(UUID().uuidString)")!
    }

    private func summary(_ id: String, photos: Int, start: String? = "2023-09-29") -> RemoteJourneySummary {
        RemoteJourneySummary(id: id, name: "Journey \(id)", country: "Tanzania",
                             dateStarted: start, dateEnded: "2023-10-09", photoCount: photos)
    }

    // MARK: - The branch (pure)

    func testDeferredWithSummariesShowsWaitingRowsNotTheHero() {
        let waiting = [summary("a", photos: 412), summary("b", photos: 300)]
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: waiting, isDownloadDeferred: true),
            .awaitingDownload(waiting),
            "an empty store plus a deferred download plus known remote journeys is not a new customer")
    }

    /// THE BRANCH THAT MUST NEVER REGRESS: a genuinely new family still gets the front door.
    func testNoRemoteJourneysStillShowsTheFirstRunHero() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: [], isDownloadDeferred: true),
            .firstRunHero,
            "nothing waiting in iCloud IS a new family — they must get the create hero")
    }

    /// The pre-fetch is best-effort, so `nil` (no account, no index, a transient error) has to be
    /// safe. Unproven is treated as "new family", never as an empty waiting screen that never
    /// resolves.
    func testFailedSummaryPrefetchShowsTheFirstRunHero() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: nil, isDownloadDeferred: true),
            .firstRunHero)
    }

    /// Rows saying "waiting for Wi-Fi" while the download is actually running would be a second
    /// false statement replacing the first one.
    func testSummariesWithoutADeferralShowTheHero() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: [summary("a", photos: 5)],
                                                       isDownloadDeferred: false),
            .firstRunHero,
            "no deferral means nothing is being held back, so nothing should claim to be")
    }

    // MARK: - Through the engine seam

    /// QUA-08 / SE-0411: `nil`-defaulted and built in the body — `FakeLocalStore` is main-actor
    /// isolated through `SyncLocalStore`, and a default-argument expression is evaluated in a
    /// nonisolated context at the call site.
    private func makeDeferredEngine(store: FakeLocalStore? = nil,
                                    summarizer: RemoteJourneySummarizing?,
                                    counter: RemotePhotoCounting? = nil,
                                    defaults: UserDefaults? = nil)
        -> (AkashicSyncEngine, MockSyncEngine, NetworkPolicy, SyncStatus) {
        let store = store ?? FakeLocalStore()
        let policyDefaults = defaults ?? freshDefaults()
        // Expensive path + the Wi-Fi-only default ⇒ the activation pull defers, which is the state
        // every one of these tests is about.
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: policyDefaults)
        policy.start()
        let status = SyncStatus()
        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(
            store: store,
            status: status,
            accountProvider: MockAccountProvider(status: .available),
            defaults: UserDefaults(suiteName: "diff15-engine-\(UUID().uuidString)")!,
            engine: mock,
            networkPolicy: policy,
            remotePhotoCounter: counter,
            remoteJourneySummarizer: summarizer)
        policy.onAllowsHeavyTransferBecameTrue = { [weak engine] in engine?.networkPolicyDidAllowHeavyTransfer() }
        return (engine, mock, policy, status)
    }

    /// The whole point: on a metered fresh install the list has something true to render.
    func testDeferringPublishesRemoteJourneySummaries() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412), summary("b", photos: 300)]
        let (engine, mock, _, status) = makeDeferredEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting))

        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertTrue(engine.deferredHeavyFetch)
        XCTAssertEqual(status.state, .waitingForWiFi)
        XCTAssertEqual(mock.fetchCount, 0, "the heavy pull is still deferred — only summaries were fetched")
        XCTAssertEqual(status.remoteJourneySummaries, waiting)
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: status.remoteJourneySummaries,
                                                       isDownloadDeferred: status.state == .waitingForWiFi),
            .awaitingDownload(waiting),
            "the state the engine published must drive the list to the waiting rows")
    }

    /// The summaries already carry a per-zone photo count, so the sized prompt costs no second round
    /// trip — and the number it quotes is the summaries' total at thumbnail scale.
    func testPromptEstimateIsDerivedFromTheSummaryPhotoCounts() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 1000), summary("b", photos: 538)]
        let (engine, _, _, status) = makeDeferredEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting))

        await engine.activate()
        await engine.awaitActivationFetch()

        guard case let .prompt(bytes, summary) = status.firstSyncPrompt else {
            return XCTFail("a fresh install with known remote journeys should publish a sized prompt")
        }
        XCTAssertEqual(bytes, SyncSizeEstimate.estimatedBytes(photoCount: 1538))
        XCTAssertTrue(summary.contains("MB"), "1538 thumbnails is megabytes, not gigabytes: \(summary)")
    }

    /// A failing pre-fetch must leave the list exactly as it was before this feature existed.
    func testFailedSummaryPrefetchLeavesTheHeroBranchIntact() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let (engine, _, _, status) = makeDeferredEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: nil),
            counter: FakeRemotePhotoCounter(count: 1538))

        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertNil(status.remoteJourneySummaries)
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: status.remoteJourneySummaries,
                                                       isDownloadDeferred: status.state == .waitingForWiFi),
            .firstRunHero)
        // The count seam is still the fallback, so the sized prompt survives a summary failure.
        guard case let .prompt(bytes, _) = status.firstSyncPrompt else {
            return XCTFail("the remote-count fallback should still size the prompt")
        }
        XCTAssertEqual(bytes, SyncSizeEstimate.estimatedBytes(photoCount: 1538))
    }

    /// An incremental sync already has journeys on screen: no rows to stand in for them, and no
    /// network paid to find that out.
    func testPopulatedStorePaysForNoPrefetch() async {
        let store = FakeLocalStore()
        store.photoCount = 500
        let spy = SpyRemoteJourneySummarizer(summaries: [summary("a", photos: 5)])
        let (engine, _, _, status) = makeDeferredEngine(store: store, summarizer: spy)

        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertEqual(spy.callCount, 0, "an incremental store must not pay for the pre-fetch")
        XCTAssertNil(status.remoteJourneySummaries)
        XCTAssertEqual(status.state, .waitingForWiFi, "it still defers, just without rows or a dialog")
    }

    // MARK: - The one-occasion release, end to end from the list surface

    /// The surface's single action, wired exactly as `JourneysAwaitingDownloadSection` wires it:
    /// release the pending download for this occasion, do not touch the user's standing preference.
    func testDownloadNowRunsTheDeferredFetchWithoutChangingTheSetting() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let defaults = freshDefaults()
        let waiting = [summary("a", photos: 412)]
        let (engine, mock, policy, status) = makeDeferredEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: waiting),
            defaults: defaults)

        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(mock.fetchCount, 0)
        XCTAssertEqual(status.remoteJourneySummaries, waiting)

        // This is the button's action, and nothing more than the button's action.
        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1, "the deferred download runs on the one-occasion pass")
        XCTAssertTrue(policy.wifiOnlyDownloads, "the standing Wi-Fi-only preference is untouched")
        XCTAssertNil(defaults.object(forKey: NetworkPolicy.wifiOnlyKey),
                     "a one-time yes must not be persisted as a preference")
        XCTAssertFalse(policy.oneOccasionExemption, "the pass is spent once the fetch completes")
        XCTAssertNil(status.remoteJourneySummaries,
                     "the real journeys have landed, so the placeholder rows are cleared")
        XCTAssertNil(status.firstSyncPrompt)
    }

    /// A fetch that THROWS must leave the rows up: the family can still see what is waiting, and can
    /// try again. Clearing them before the fetch would have blanked the surface on any error.
    func testSummariesSurviveAFailedDownload() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let (engine, mock, policy, status) = makeDeferredEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting))
        mock.shouldThrowOnFetch = true

        await engine.activate()
        await engine.awaitActivationFetch()
        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1)
        XCTAssertEqual(status.remoteJourneySummaries, waiting,
                       "a failed download must not blank the list of what is waiting")
    }
}

// MARK: - Test doubles

struct FakeRemoteJourneySummarizer: RemoteJourneySummarizing {
    let summaries: [RemoteJourneySummary]?
    func remoteJourneySummaries() async -> [RemoteJourneySummary]? { summaries }
}

/// Counts calls, so "an incremental store pays for no pre-fetch" is an assertion rather than a hope.
final class SpyRemoteJourneySummarizer: RemoteJourneySummarizing, @unchecked Sendable {
    let summaries: [RemoteJourneySummary]?
    private(set) var callCount = 0

    init(summaries: [RemoteJourneySummary]?) { self.summaries = summaries }

    func remoteJourneySummaries() async -> [RemoteJourneySummary]? {
        callCount += 1
        return summaries
    }
}
