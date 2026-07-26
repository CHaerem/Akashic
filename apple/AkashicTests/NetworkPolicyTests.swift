import XCTest
import CloudKit
@testable import Akashic

/// The Wi-Fi-only download policy: the truth table, persistence, the path-change and one-occasion
/// exemption semantics, the pure size-estimate/decision logic, and — driven through the engine seam
/// — that heavy fetches defer while local edits keep queuing, and that a deferral fires again the
/// moment the path (or the user) allows it.
@MainActor
final class NetworkPolicyTests: XCTestCase {

    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "netpolicy-\(UUID().uuidString)")!
    }

    // MARK: - Default + persistence

    func testDefaultIsWifiOnlyTrue() {
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: false), defaults: freshDefaults())
        XCTAssertTrue(policy.wifiOnlyDownloads, "Wi-Fi-only downloads must default to ON")
    }

    func testStoredFalseIsHonored() {
        let defaults = freshDefaults()
        defaults.set(false, forKey: NetworkPolicy.wifiOnlyKey)
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: defaults)
        XCTAssertFalse(policy.wifiOnlyDownloads, "an explicitly stored false overrides the default")
    }

    func testTogglePersists() {
        let defaults = freshDefaults()
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: false), defaults: defaults)
        policy.wifiOnlyDownloads = false
        XCTAssertFalse(defaults.bool(forKey: NetworkPolicy.wifiOnlyKey))
    }

    // MARK: - Truth table (wifiOnly × path)

    func testTruthTable() {
        func allows(wifiOnly: Bool, expensive: Bool) -> Bool {
            let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: expensive), defaults: freshDefaults())
            policy.wifiOnlyDownloads = wifiOnly
            return policy.allowsHeavyTransfer
        }
        XCTAssertFalse(allows(wifiOnly: true,  expensive: true),  "Wi-Fi-only on an expensive path defers")
        XCTAssertTrue(allows(wifiOnly: true,  expensive: false), "Wi-Fi-only on a cheap path allows")
        XCTAssertTrue(allows(wifiOnly: false, expensive: true),  "cellular allowed → expensive path allows")
        XCTAssertTrue(allows(wifiOnly: false, expensive: false), "cellular allowed → cheap path allows")
    }

    // MARK: - Path change + toggle release the deferred fetch

    func testPathBecomingCheapFiresAllowanceCallback() {
        let source = FakeNetworkPathSource(expensive: true)
        let policy = NetworkPolicy(source: source, defaults: freshDefaults())   // wifiOnly default true
        var fired = 0
        policy.onAllowsHeavyTransferBecameTrue = { fired += 1 }
        policy.start()

        XCTAssertFalse(policy.allowsHeavyTransfer)
        source.simulate(expensive: false)

        XCTAssertTrue(policy.allowsHeavyTransfer)
        XCTAssertEqual(fired, 1, "path becoming cheap must release the deferred fetch exactly once")
    }

    func testFlippingSettingOffOnExpensivePathFiresCallback() {
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: freshDefaults())
        var fired = 0
        policy.onAllowsHeavyTransferBecameTrue = { fired += 1 }

        policy.wifiOnlyDownloads = false
        XCTAssertTrue(policy.allowsHeavyTransfer)
        XCTAssertEqual(fired, 1)
    }

    // MARK: - One-occasion exemption

    func testOneOccasionExemptionAllowsWithoutFlippingToggle() {
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: freshDefaults())
        var fired = 0
        policy.onAllowsHeavyTransferBecameTrue = { fired += 1 }

        XCTAssertFalse(policy.allowsHeavyTransfer)
        policy.grantOneOccasionCellularDownload()

        XCTAssertTrue(policy.allowsHeavyTransfer, "exemption permits this download")
        XCTAssertTrue(policy.wifiOnlyDownloads, "the GLOBAL setting must be untouched by a one-occasion pass")
        XCTAssertEqual(fired, 1, "granting the exemption releases the deferred fetch")
    }

    func testHeavyTransferDidCompleteSpendsExemption() {
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: freshDefaults())
        policy.grantOneOccasionCellularDownload()
        XCTAssertTrue(policy.allowsHeavyTransfer)

        policy.heavyTransferDidComplete()

        XCTAssertFalse(policy.oneOccasionExemption, "the exemption is spent on completion")
        XCTAssertFalse(policy.allowsHeavyTransfer, "the next heavy fetch re-evaluates the policy fresh")
    }

    func testExemptionIsNotPersistedAcrossRelaunch() {
        let defaults = freshDefaults()
        let first = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: defaults)
        first.grantOneOccasionCellularDownload()
        XCTAssertTrue(first.oneOccasionExemption)

        // A new instance stands in for a relaunch: the exemption is in-memory only and gone, while
        // the persisted Wi-Fi-only setting survives.
        let relaunched = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: defaults)
        XCTAssertFalse(relaunched.oneOccasionExemption)
        XCTAssertFalse(relaunched.allowsHeavyTransfer)
        XCTAssertTrue(relaunched.wifiOnlyDownloads)
    }

    // MARK: - Status rendering

    func testWaitingForWiFiStatusSummary() {
        let status = SyncStatus()
        status.set(.waitingForWiFi)
        XCTAssertEqual(status.summary, "Waiting for Wi-Fi to download")
    }

    // MARK: - Size estimate + first-sync decision (pure)

    func testEstimateMath() {
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: 1543),
                       Int64(1543) * SyncSizeEstimate.averagePhotoBytes)
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: 0), 0)
        XCTAssertEqual(SyncSizeEstimate.estimatedBytes(photoCount: -5), 0, "negative counts clamp to zero")
        // 1543 × 3.5 MB ≈ 5.4 GB — the number the prompt should show.
        XCTAssertTrue(SyncSizeEstimate.humanReadable(photoCount: 1543).contains("GB"))
    }

    func testDecisionFreshInstallWithRemoteCountPrompts() {
        let decision = FirstSyncDownloadDecision.decide(localPhotoCount: 0, remotePhotoCount: 1543)
        guard case let .prompt(bytes, summary) = decision else { return XCTFail("expected a prompt") }
        XCTAssertEqual(bytes, SyncSizeEstimate.estimatedBytes(photoCount: 1543))
        XCTAssertFalse(summary.isEmpty)
    }

    func testDecisionIncrementalDefersSilently() {
        XCTAssertEqual(FirstSyncDownloadDecision.decide(localPhotoCount: 500, remotePhotoCount: 1543),
                       .deferSilently, "a populated store is an incremental sync — no scary dialog")
    }

    func testDecisionNilOrZeroRemoteDefersSilently() {
        XCTAssertEqual(FirstSyncDownloadDecision.decide(localPhotoCount: 0, remotePhotoCount: nil),
                       .deferSilently, "no estimate → fall back to the generic status")
        XCTAssertEqual(FirstSyncDownloadDecision.decide(localPhotoCount: 0, remotePhotoCount: 0),
                       .deferSilently, "nothing to download → no prompt")
    }

    // MARK: - Through the engine seam

    // QUA-08: `nil`-defaulted and built in the body — see the same note on
    // `SyncEngineTests.makeEngine`. `FakeLocalStore` is main-actor isolated via the `@MainActor`
    // `SyncLocalStore` protocol, and a default argument expression must be nonisolated in Swift 5
    // language mode. Callers are unchanged.
    @MainActor
    private func makeDeferredEngine(store: FakeLocalStore? = nil,
                                    mock: MockSyncEngine = MockSyncEngine(),
                                    counter: RemotePhotoCounting? = nil)
        -> (AkashicSyncEngine, MockSyncEngine, NetworkPolicy, FakeNetworkPathSource, SyncStatus) {
        let store = store ?? FakeLocalStore()
        let source = FakeNetworkPathSource(expensive: true)
        let policy = NetworkPolicy(source: source, defaults: freshDefaults())   // wifiOnly default true
        policy.start()
        let status = SyncStatus()
        let engine = AkashicSyncEngine(
            store: store,
            status: status,
            accountProvider: MockAccountProvider(status: .available),
            defaults: UserDefaults(suiteName: "engine-\(UUID().uuidString)")!,
            engine: mock,
            networkPolicy: policy,
            remotePhotoCounter: counter)
        policy.onAllowsHeavyTransferBecameTrue = { [weak engine] in engine?.networkPolicyDidAllowHeavyTransfer() }
        return (engine, mock, policy, source, status)
    }

    /// CRITICAL: while a heavy fetch is deferred, local edits must still queue to the engine —
    /// nothing is lost by the download policy.
    func testHeavyFetchDefersWhileLocalChangesStillQueue() async {
        let (engine, mock, _, _, status) = makeDeferredEngine()
        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertTrue(engine.isRunning)
        XCTAssertTrue(engine.deferredHeavyFetch)
        XCTAssertEqual(status.state, .waitingForWiFi)
        XCTAssertEqual(mock.fetchCount, 0, "no download runs on an expensive path with Wi-Fi-only on")

        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo, recordName: "p1", journeyID: "j1"),
        ])
        XCTAssertEqual(mock.savedRecordNames.sorted(), ["j1", "p1"], "edits keep queuing while the fetch waits")
        XCTAssertEqual(mock.fetchCount, 0, "queuing a local edit does not trigger the deferred download")
    }

    func testDeferredFetchFiresWhenPathBecomesCheap() async {
        let (engine, mock, _, source, status) = makeDeferredEngine()
        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(mock.fetchCount, 0)

        source.simulate(expensive: false)
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1, "the deferred download runs the moment Wi-Fi is available")
        XCTAssertTrue(status.isActive)
        XCTAssertFalse(engine.deferredHeavyFetch)
    }

    func testOneOccasionExemptionRunsDeferredFetchWithoutChangingSetting() async {
        let (engine, mock, policy, _, _) = makeDeferredEngine()
        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(mock.fetchCount, 0)

        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1, "the one-occasion pass runs the pending download")
        XCTAssertTrue(policy.wifiOnlyDownloads, "the global setting stays ON")
        XCTAssertFalse(policy.oneOccasionExemption, "the exemption is spent once the fetch completes")
    }

    func testFirstSyncPromptPublishedOnFreshInstallDeferral() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let (engine, _, _, _, status) = makeDeferredEngine(store: store,
                                                           counter: FakeRemotePhotoCounter(count: 1543))
        await engine.activate()
        await engine.awaitActivationFetch()

        guard case let .prompt(bytes, _) = status.firstSyncPrompt else {
            return XCTFail("a fresh install with an estimate should publish a prompt")
        }
        XCTAssertEqual(bytes, SyncSizeEstimate.estimatedBytes(photoCount: 1543))
    }

    func testFirstSyncPromptSkippedForIncrementalStore() async {
        let store = FakeLocalStore()
        store.photoCount = 500
        let (engine, _, _, _, status) = makeDeferredEngine(store: store,
                                                           counter: FakeRemotePhotoCounter(count: 1543))
        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertNil(status.firstSyncPrompt, "an already-populated store gets no first-sync prompt")
        XCTAssertEqual(status.state, .waitingForWiFi, "it still defers, just without the sized dialog")
    }
}

// MARK: - Test doubles

/// Drives path changes synchronously so deferred-fetch tests are deterministic.
final class FakeNetworkPathSource: NetworkPathSource {
    private(set) var isExpensivePath: Bool
    private var handler: ((Bool) -> Void)?

    init(expensive: Bool) { isExpensivePath = expensive }

    func start(onChange: @escaping (Bool) -> Void) { handler = onChange }

    /// Push a new path state to the policy, synchronously (the production source delivers on the
    /// main thread, which in a `@MainActor` test is exactly here).
    func simulate(expensive: Bool) {
        isExpensivePath = expensive
        handler?(expensive)
    }
}

struct FakeRemotePhotoCounter: RemotePhotoCounting {
    let count: Int?
    func remotePhotoCount() async -> Int? { count }
}
