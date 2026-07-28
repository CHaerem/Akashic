import XCTest
import CloudKit
@testable import Akashic

/// DIFF-16 ROOT CAUSE: the path-monitor race that made a cellular first launch say "Syncing" forever.
///
/// ## The defect, and why a green suite twice failed to see it
///
/// `NetworkPolicy` seeds `isExpensivePath` from `NWPathMonitor.currentPath`, which before the monitor's
/// first update always reports not-expensive. On a CELLULAR launch that seed is not approximate, it is
/// wrong: activation's gate passes, `fetchChanges()` starts, the status says Syncing — and milliseconds
/// later the real path arrives, after which `nextFetchChangesOptions` hands CloudKit
/// `allowsCellularAccess = false` for every subsequent request and CloudKit defers them with no error
/// and no event. Measured on the owner's phone on TestFlight builds 101 and 102: "Syncing · 0 journeys ·
/// 0 photos", indefinitely. **A simulator path is never expensive, so nothing automated could reproduce
/// it** — which is exactly why the fix is a transition the tests can drive rather than a path they must
/// have.
///
/// ## What these tests pin, and why they live in their own file
///
/// Every symbol named below predates the fix, deliberately: this file is the `prove.mjs` proof for
/// DIFF-16's root-cause change, and a test that referenced the new callback could only ever fail to
/// BUILD against the revert, which proves nothing about whether its assertions can fail. (DIFF-15 split
/// `SyncSizeEstimateTests` out of `DeferredDownloadPreviewTests` for the same reason.) The policy-level
/// tests that DO name the new observer API live in `NetworkPolicyTests`.
///
/// The pinned claims, in the order they matter:
///   1. the real (expensive) path arriving after the pull started puts the engine into the SAME honest
///      deferred state the activation branch produces — `.waitingForWiFi`, a pending deferral, and the
///      published download preview the DIFF-15/16 list surfaces read;
///   2. a fetch that returns while the policy has turned against it claims NO round trip — without
///      that, the in-flight fetch's own success path immediately overwrote everything (1) had just set,
///      and the fix would have been inert on the one path it exists for;
///   3. the resume still composes: the pre-existing became-true wiring re-runs the deferred fetch;
///   4. the two things it must NOT do — claim a deferral once the archive has started landing, or
///      contradict a one-occasion cellular pass the user explicitly granted.
@MainActor
final class CellularLaunchRaceTests: XCTestCase {

    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "diff16-race-\(UUID().uuidString)")!
    }

    private func summary(_ id: String, photos: Int) -> RemoteJourneySummary {
        RemoteJourneySummary(id: id, name: "Journey \(id)", country: "Tanzania",
                             dateStarted: "2023-09-29", dateEnded: "2023-10-09", photoCount: photos)
    }

    /// An engine on the path state a cellular launch actually starts in: **the monitor's pre-update lie**
    /// (`expensive: false`), with the protective Wi-Fi-only default on. So activation does NOT defer —
    /// reproducing the race rather than the state the race is mistaken for.
    ///
    /// QUA-08 / SE-0411: `nil`-defaulted and built in the body, like the sibling helpers in
    /// `NetworkPolicyTests` and `DeferredDownloadPreviewTests` — `FakeLocalStore` is main-actor isolated
    /// through `SyncLocalStore`, and a default-argument expression is evaluated in a nonisolated context.
    private func makeEngine(store: FakeLocalStore? = nil,
                            summarizer: RemoteJourneySummarizing? = nil,
                            counter: RemotePhotoCounting? = nil,
                            engine syncEngine: SyncEngineProtocol? = nil,
                            expensiveAtLaunch: Bool = false,
                            policyDefaults: UserDefaults? = nil)
        -> (AkashicSyncEngine, NetworkPolicy, FakeNetworkPathSource, SyncStatus) {
        let store = store ?? FakeLocalStore()
        let source = FakeNetworkPathSource(expensive: expensiveAtLaunch)
        let policy = NetworkPolicy(source: source, defaults: policyDefaults ?? freshDefaults())
        policy.start()
        let status = SyncStatus()
        let engine = AkashicSyncEngine(
            store: store,
            status: status,
            accountProvider: MockAccountProvider(status: .available),
            defaults: UserDefaults(suiteName: "diff16-engine-\(UUID().uuidString)")!,
            engine: syncEngine ?? MockSyncEngine(),
            networkPolicy: policy,
            remotePhotoCounter: counter,
            remoteJourneySummarizer: summarizer)
        // Exactly the wiring `PersistenceController.startSync()` installs for the true direction.
        policy.onAllowsHeavyTransferBecameTrue = { [weak engine] in engine?.networkPolicyDidAllowHeavyTransfer() }
        return (engine, policy, source, status)
    }

    // MARK: - (1) The correction is acted on

    /// THE DEFECT: the pull went ahead on a lie, and the truth arriving changed nothing.
    func testTheRealPathArrivingAfterActivationEntersTheHonestDeferredState() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412), summary("b", photos: 300)]
        let mock = MockSyncEngine()
        let (engine, _, source, status) = makeEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting), engine: mock)

        await engine.activate()
        await engine.awaitActivationFetch()

        // The race, reproduced: the seeded path claimed cheap, so nothing was deferred.
        XCTAssertEqual(mock.fetchCount, 1, "the pre-update seed says not-expensive, so the heavy pull runs")
        XCTAssertFalse(engine.deferredHeavyFetch)
        XCTAssertTrue(status.isActive)

        // Milliseconds later on a real phone: the monitor delivers the actual cellular path.
        source.simulate(expensive: true)

        XCTAssertTrue(engine.deferredHeavyFetch,
                      "the policy turned against an undelivered first download — that IS a deferral")
        XCTAssertEqual(status.state, .waitingForWiFi,
                       "CloudKit is now deferring every operation silently; the status must stop saying Syncing")

        await engine.awaitPreviewRetry()

        XCTAssertEqual(engine.deferredPreviewAttempts, 1, "the download preview must be published for this deferral")
        XCTAssertEqual(status.remoteJourneySummaries, waiting)
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: status.remoteJourneySummaries,
                                                       isDownloadDeferred: status.state == .waitingForWiFi),
            .awaitingDownload(waiting),
            "the state the transition published must drive the list to the named waiting rows")
        XCTAssertEqual(mock.fetchCount, 1, "entering the deferred state must not start a second heavy pull")
    }

    /// The same transition when the summary pre-fetch cannot answer: the neutral could-not-check state,
    /// never the first-run hero — DIFF-16's other finding, reached through the new trigger.
    func testAFailedPrefetchOnTheTransitionRendersCouldNotCheckNotTheHero() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let (engine, _, source, status) = makeEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: nil),
            counter: FakeRemotePhotoCounter(count: 1538))

        await engine.activate()
        await engine.awaitActivationFetch()
        source.simulate(expensive: true)
        await engine.awaitPreviewRetry()

        XCTAssertNil(status.remoteJourneySummaries)
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: status.remoteJourneySummaries,
                                                       isDownloadDeferred: status.state == .waitingForWiFi),
            .couldNotCheck,
            "a family whose archive demonstrably exists must never be invited to create their first journey")
        guard case .prompt = status.firstSyncPrompt else {
            return XCTFail("the remote-count fallback should still size the prompt for this deferral")
        }
    }

    /// The sibling transition site: the user turns Wi-Fi-only ON while on cellular, before the first
    /// download has delivered. Same honest state, same reason.
    func testTurningWiFiOnlyOnWhileOnCellularDefersAnUndeliveredFirstDownload() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let defaults = freshDefaults()
        defaults.set(false, forKey: NetworkPolicy.wifiOnlyKey)   // cellular downloads were allowed …
        let mock = MockSyncEngine()
        let (engine, policy, _, status) = makeEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: waiting),
            engine: mock,
            expensiveAtLaunch: true,
            policyDefaults: defaults)

        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(mock.fetchCount, 1, "cellular downloads were permitted, so the pull ran")

        policy.wifiOnlyDownloads = true                          // … and now they are not
        await engine.awaitPreviewRetry()

        XCTAssertTrue(engine.deferredHeavyFetch)
        XCTAssertEqual(status.state, .waitingForWiFi)
        XCTAssertEqual(status.remoteJourneySummaries, waiting)
    }

    // MARK: - (2) The in-flight fetch must not overwrite the correction

    /// The half without which the fix is inert on the device path: the pull is ALREADY RUNNING when the
    /// real path arrives, so `fetchChanges()` returns a moment later — successfully, having transferred
    /// nothing, because CloudKit deferred its operations. Everything the success path then does is a
    /// false claim about that non-event.
    func testAFetchThatReturnsAfterThePolicyTurnedAgainstItClaimsNoRoundTrip() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let mock = MidFetchHookEngine()
        let (engine, _, source, status) = makeEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting), engine: mock)
        var freshInstallDecisions = 0
        engine.onFreshInstallDetermined = { freshInstallDecisions += 1 }
        // The ordering of the device race, made deterministic: the path turns expensive DURING the pull.
        mock.duringFetch = { source.simulate(expensive: true) }

        await engine.activate()
        await engine.awaitActivationFetch()
        await engine.awaitPreviewRetry()

        XCTAssertEqual(mock.fetchCount, 1)
        XCTAssertEqual(status.state, .waitingForWiFi,
                       "markSynced() would put this back to Syncing — the fetch transferred nothing")
        XCTAssertTrue(engine.deferredHeavyFetch, "the deferral must survive the fetch returning")
        XCTAssertEqual(status.remoteJourneySummaries, waiting,
                       "clearing the rows is only honest when the real journeys have LANDED")
        XCTAssertEqual(freshInstallDecisions, 0,
                       "an empty store proves nothing about the account while the download is deferred — "
                       + "burning the once-ever demo-seed decision here seeds a sample into a real archive")
    }

    // MARK: - (3) The resume direction still composes

    /// The deferral entered by the transition must be released by the pre-existing became-true wiring —
    /// no second mechanism, and nothing to remember at the call site.
    func testTheDeferralEnteredByAPathChangeResumesWhenThePathBecomesCheap() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let mock = MockSyncEngine()
        let (engine, _, source, status) = makeEngine(
            store: store, summarizer: FakeRemoteJourneySummarizer(summaries: waiting), engine: mock)

        await engine.activate()
        await engine.awaitActivationFetch()
        source.simulate(expensive: true)
        await engine.awaitPreviewRetry()
        XCTAssertTrue(engine.deferredHeavyFetch)

        source.simulate(expensive: false)                        // Wi-Fi, at last
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 2,
                       "the deferral the transition created resumes through onAllowsHeavyTransferBecameTrue")
        XCTAssertFalse(engine.deferredHeavyFetch)
        XCTAssertTrue(status.isActive)
        XCTAssertNil(status.remoteJourneySummaries,
                     "the real journeys have landed, so the placeholder rows are cleared")
    }

    // MARK: - (4) What it must not do

    /// A partially- or fully-delivered archive already renders real journey cards, so none of the
    /// empty-list surfaces apply and "Waiting for Wi-Fi" would replace one wrong statement with another.
    /// The bill is still protected there by `nextFetchChangesOptions`, which is unconditional.
    func testAPopulatedStoreIsNeverToldItIsWaitingForWiFi() async {
        let store = FakeLocalStore()
        store.photoCount = 500
        let (engine, _, source, status) = makeEngine(store: store)

        await engine.activate()
        await engine.awaitActivationFetch()
        source.simulate(expensive: true)

        XCTAssertFalse(engine.deferredHeavyFetch, "nothing is waiting to be downloaded for the first time")
        XCTAssertTrue(status.isActive)
        XCTAssertEqual(engine.deferredPreviewAttempts, 0, "and no network is paid for a preview nobody reads")
    }

    /// A one-occasion cellular pass is the user saying "yes, spend my data on this download". The path
    /// being expensive is the premise of that answer, not news — so it must not defer what they allowed.
    func testAnOutstandingOneOccasionPassSurvivesThePathTurningExpensive() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let (engine, policy, source, status) = makeEngine(store: store)

        await engine.activate()
        await engine.awaitActivationFetch()
        policy.grantOneOccasionCellularDownload()

        source.simulate(expensive: true)

        XCTAssertFalse(engine.deferredHeavyFetch, "the user already answered this question with yes")
        XCTAssertTrue(status.isActive)
    }
}

// MARK: - Test doubles

/// A `SyncEngineProtocol` that runs a hook **mid-fetch**, so a test can make the network path turn
/// expensive while the pull is in flight — the exact ordering of the device race, made deterministic.
///
/// QUA-08: `@unchecked Sendable` for the same reason `MockSyncEngine` is — the mutable state here is test
/// scripting, written only from a `@MainActor` XCTestCase, so it is one isolation domain and the promise
/// holds. `@MainActor` is not the alternative: three of the seam's requirements are synchronous.
final class MidFetchHookEngine: SyncEngineProtocol, @unchecked Sendable {
    private(set) var fetchCount = 0
    private(set) var sendCount = 0

    /// Run on the MAIN ACTOR from inside `fetchChanges()`, before it returns.
    var duringFetch: (() -> Void)?

    var pendingRecordZoneChanges: [CKSyncEngine.PendingRecordZoneChange] = []
    var pendingDatabaseChanges: [CKSyncEngine.PendingDatabaseChange] = []

    func add(pendingDatabaseChanges changes: [CKSyncEngine.PendingDatabaseChange]) {
        pendingDatabaseChanges.append(contentsOf: changes)
    }
    func add(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        pendingRecordZoneChanges.append(contentsOf: changes)
    }
    func remove(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        pendingRecordZoneChanges.removeAll { changes.contains($0) }
    }

    func sendChanges() async throws { sendCount += 1 }

    func fetchChanges() async throws {
        fetchCount += 1
        await MainActor.run { self.duringFetch?() }
    }
}
