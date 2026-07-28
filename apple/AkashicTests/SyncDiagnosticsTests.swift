import XCTest
import CloudKit
@testable import Akashic

/// DIFF-16: what a fresh install is allowed to SAY, and whether the device can be asked why.
///
/// ## The measurement behind every test here
///
/// DIFF-15 shipped green — 15 unit tests, four branches of a pure decision, a source-text guard on the
/// call site — and failed on the first real device. MEASURED BY THE OWNER on TestFlight build 101,
/// fresh install on cellular: the sized first-sync prompt APPEARED, so `RemotePhotoCounting` reached
/// CloudKit Production and returned a count, and the un-downloaded journey rows did not render. The one
/// path no simulator can exercise is the one that broke.
///
/// And it could not be diagnosed, which is the defect this file covers first. Every line that would
/// have explained it — including `remoteJourneySummaries:`'s own success and failure lines — goes
/// through `SyncLog`, whose `isEnabled` was a `static let` reading an environment variable. A
/// TestFlight install can set neither.
///
/// Four things are pinned, in the order they matter:
///   1. the persisted toggle actually flips logging AT RUNTIME — a `static let` is evaluated once, so
///      the cheap-looking declaration would have made the whole toggle a no-op that looks correct;
///   2. `nil` summaries while a deferral is active is `.couldNotCheck`, NOT the "Start your first
///      journey" hero, which is a confident false statement to a family whose archive exists;
///   3. the summary pre-fetch retries, so one transient failure is no longer permanent until relaunch;
///   4. a running first download says so, and only when there is evidence something is coming.
///
/// The view wiring for all four is guarded separately by `SyncDiagnosticsSurfaceTests`, which names no
/// symbol this task introduced — that is what keeps the whole set provable in both directions
/// (`scripts/prove.mjs` refuses a red that is really a compile error, and this file would be one).
@MainActor
final class SyncDiagnosticsTests: XCTestCase {

    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "diff16-\(UUID().uuidString)")!
    }

    private func summary(_ id: String, photos: Int) -> RemoteJourneySummary {
        RemoteJourneySummary(id: id, name: "Journey \(id)", country: "Tanzania",
                             dateStarted: "2023-09-29", dateEnded: "2023-10-09", photoCount: photos)
    }

    // MARK: - (1) The toggle flips logging at runtime

    func testLoggingIsStillOffByDefault() {
        XCTAssertFalse(SyncLog.isEnabled(in: freshDefaults()),
                       "off by default is the whole reason this is safe to ship to customers")
        XCTAssertFalse(SyncLog.isPersistentlyEnabled(defaults: freshDefaults()))
    }

    func testTheToggleFlipsLoggingAndFlipsItBack() {
        let defaults = freshDefaults()
        SyncLog.setPersistentlyEnabled(true, defaults: defaults)
        XCTAssertTrue(SyncLog.isEnabled(in: defaults))
        XCTAssertTrue(SyncLog.isPersistentlyEnabled(defaults: defaults))

        SyncLog.setPersistentlyEnabled(false, defaults: defaults)
        XCTAssertFalse(SyncLog.isEnabled(in: defaults))
        XCTAssertNil(defaults.object(forKey: SyncLog.persistedKey),
                     "off REMOVES the key: a device that never used the toggle and one that turned it "
                     + "off are the same state")

        SyncLog.setPersistentlyEnabled(true, defaults: defaults)
        XCTAssertTrue(SyncLog.isEnabled(in: defaults),
                      "and back on again — a `static let` cannot answer differently three times")
    }

    /// **The test that would have caught the trap.** `SyncLog.isEnabled` is what every call site reads,
    /// it reads `UserDefaults.standard`, and it used to be a `static let`: evaluated once, lazily, on
    /// FIRST USE. So the read below — deliberately taken before the toggle is flipped — is exactly what
    /// burns a cached `let`, after which a Settings switch would write the preference and change
    /// nothing, and the owner would conclude the toggle was broken rather than that sync was silent.
    func testTheShippingPropertyRereadsTheStoreEveryTimeItIsAsked() throws {
        try XCTSkipIf(ProcessInfo.processInfo.environment[SyncLog.environmentVariable] == "1",
                      "the environment switch is on for this run, so it ORs to true regardless")
        let key = SyncLog.persistedKey
        let saved = UserDefaults.standard.object(forKey: key)
        defer {
            if let saved {
                UserDefaults.standard.set(saved, forKey: key)
            } else {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }

        SyncLog.setPersistentlyEnabled(false)
        XCTAssertFalse(SyncLog.isEnabled, "the first read, which is the one a `static let` would cache")

        SyncLog.setPersistentlyEnabled(true)
        XCTAssertTrue(SyncLog.isEnabled,
                      "a toggle in front of a cached `static let` does nothing at all while looking right")

        SyncLog.setPersistentlyEnabled(false)
        XCTAssertFalse(SyncLog.isEnabled)
    }

    // MARK: - (2) Could not check, versus the hero, versus the rows

    /// THE DEVICE CASE. A deferral is active and the pre-fetch could not answer, which describes a
    /// family whose archive demonstrably exists (the count query answered — that is why the prompt
    /// appeared). "Start your first journey" is the one thing this surface must never say to them.
    func testAFailedPrefetchWhileDeferredNoLongerImpersonatesANewFamily() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: nil, isDownloadDeferred: true),
            .couldNotCheck,
            "nil is 'we could not find out', which is not the same fact as 'there is nothing there'")
    }

    /// THE BRANCH THAT MUST NEVER REGRESS, and the reason `nil` and `[]` had to become different: an
    /// answered pre-fetch that found nothing IS positive evidence of a new family.
    func testAnAnsweredEmptyPrefetchIsStillTheHero() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: [], isDownloadDeferred: true),
            .firstRunHero)
    }

    func testKnownRemoteJourneysAreStillTheWaitingRows() {
        let waiting = [summary("a", photos: 412)]
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: waiting, isDownloadDeferred: true),
            .awaitingDownload(waiting))
    }

    /// No deferral and no download in flight is an ordinary empty app — including when the pre-fetch
    /// failed, because with nothing being held back there is nothing to explain.
    func testNoDeferralAndNoDownloadIsTheHero() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: nil, isDownloadDeferred: false),
            .firstRunHero)
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: [summary("a", photos: 5)],
                                                       isDownloadDeferred: false),
            .firstRunHero,
            "nothing is being held back, so nothing may claim to be waiting")
    }

    // MARK: - (4) The download that is actually running

    func testARunningDownloadKeepsTheNamedRowsAndSaysItIsRunning() {
        let waiting = [summary("a", photos: 412), summary("b", photos: 300)]
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: waiting,
                                                       isDownloadDeferred: false,
                                                       isDownloadRunning: true),
            .downloading(waiting),
            "the rows must not blink to a blank at the moment the download starts working")
    }

    /// Build 101's shape: the count answered, the journey query did not. There are no names to show and
    /// the header alone is still strictly more than the void it replaces.
    func testARunningDownloadWithNoNamesStillReportsProgress() {
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: nil,
                                                       isDownloadDeferred: false,
                                                       isDownloadRunning: true),
            .downloading([]))
    }

    /// Running beats deferred: rows reading "Waiting for Wi-Fi to download" while the download is in
    /// flight would be a second false statement replacing the first one.
    func testRunningBeatsDeferred() {
        let waiting = [summary("a", photos: 412)]
        XCTAssertEqual(
            FirstSyncDownloadDecision.emptyListContent(remoteSummaries: waiting,
                                                       isDownloadDeferred: true,
                                                       isDownloadRunning: true),
            .downloading(waiting))
    }

    // MARK: - Through the engine seam

    /// QUA-08 / SE-0411: `nil`-defaulted and built in the body — every one of these doubles is
    /// main-actor isolated, and a default-argument expression is evaluated in a nonisolated context at
    /// the call site.
    private func makeDeferredEngine(store: FakeLocalStore? = nil,
                                    summarizer: RemoteJourneySummarizing?,
                                    counter: RemotePhotoCounting? = nil,
                                    engine mock: SyncEngineProtocol? = nil,
                                    progress: FirstSyncDownloadProgress? = nil)
        -> (AkashicSyncEngine, NetworkPolicy, SyncStatus, FirstSyncDownloadProgress) {
        let store = store ?? FakeLocalStore()
        // Expensive path + the Wi-Fi-only default ⇒ the activation pull defers, which is the state
        // every one of these tests starts from.
        let policy = NetworkPolicy(source: FakeNetworkPathSource(expensive: true), defaults: freshDefaults())
        policy.start()
        let status = SyncStatus()
        // A fresh progress object per test rather than `FirstSyncDownloadProgress.shared`: a leaked
        // `isRunning == true` would otherwise change what a later test's journey list renders.
        let progress = progress ?? FirstSyncDownloadProgress()
        let engine = AkashicSyncEngine(
            store: store,
            status: status,
            accountProvider: MockAccountProvider(status: .available),
            defaults: UserDefaults(suiteName: "diff16-engine-\(UUID().uuidString)")!,
            engine: mock ?? MockSyncEngine(),
            networkPolicy: policy,
            remotePhotoCounter: counter,
            remoteJourneySummarizer: summarizer,
            downloadProgress: progress)
        policy.onAllowsHeavyTransferBecameTrue = { [weak engine] in engine?.networkPolicyDidAllowHeavyTransfer() }
        return (engine, policy, status, progress)
    }

    /// What the list would render for a given published state — the same three inputs
    /// `JourneyListView.emptyContent` feeds the decision, so an engine that publishes the wrong state
    /// fails here rather than looking fine in isolation.
    private func rendered(_ status: SyncStatus,
                          _ progress: FirstSyncDownloadProgress) -> FirstSyncDownloadDecision.EmptyListContent {
        FirstSyncDownloadDecision.emptyListContent(
            remoteSummaries: status.remoteJourneySummaries,
            isDownloadDeferred: status.state == .waitingForWiFi,
            isDownloadRunning: progress.isRunning)
    }

    // MARK: - (3) The retry

    /// The whole of hypothesis (c): the preview ran ONCE per engine lifetime, so any transient failure
    /// was a permanent first-run hero until the app was relaunched.
    func testATransientSummaryFailureIsRetriedRatherThanPermanent() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let flaky = FlakyRemoteJourneySummarizer(failuresBeforeSuccess: 1, summaries: waiting)
        let (engine, _, status, progress) = makeDeferredEngine(store: store, summarizer: flaky)

        await engine.activate()
        await engine.awaitActivationFetch()

        XCTAssertEqual(engine.deferredPreviewAttempts, 1)
        XCTAssertNil(status.remoteJourneySummaries)
        XCTAssertEqual(rendered(status, progress), .couldNotCheck,
                       "attempt one failed, so the list says so — it does not invent a new family")

        // The foreground hook and the "Check again" button both land here.
        engine.retryDeferredDownloadPreview()
        await engine.awaitPreviewRetry()

        XCTAssertEqual(flaky.callCount, 2, "one bad round trip must not outlive itself")
        XCTAssertEqual(status.remoteJourneySummaries, waiting)
        XCTAssertEqual(rendered(status, progress), .awaitingDownload(waiting))
    }

    /// Idempotent and cheap: once the pre-fetch has ANSWERED there is nothing to retry, and a
    /// foreground in that state must not pay for a second query.
    func testARetryAfterASuccessfulAnswerCostsNothing() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let spy = SpyRemoteJourneySummarizer(summaries: [summary("a", photos: 412)])
        let (engine, _, _, _) = makeDeferredEngine(store: store, summarizer: spy)

        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(spy.callCount, 1)

        engine.retryDeferredDownloadPreview()
        await engine.awaitPreviewRetry()
        XCTAssertEqual(spy.callCount, 1, "the answer is in hand; a retry would be a query for nothing")
        XCTAssertEqual(engine.deferredPreviewAttempts, 1)
    }

    /// A PERMANENT failure — hypothesis (b), a `Journey` query the deployed Production schema will not
    /// serve — must not re-query on every foreground for the life of the install.
    func testTheRetryIsBounded() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let alwaysFails = FlakyRemoteJourneySummarizer(failuresBeforeSuccess: .max, summaries: [])
        let (engine, _, status, progress) = makeDeferredEngine(store: store, summarizer: alwaysFails)

        await engine.activate()
        await engine.awaitActivationFetch()
        for _ in 0..<12 {
            engine.retryDeferredDownloadPreview()
            await engine.awaitPreviewRetry()
        }

        XCTAssertEqual(engine.deferredPreviewAttempts, AkashicSyncEngine.maxDeferredPreviewAttempts)
        XCTAssertEqual(alwaysFails.callCount, AkashicSyncEngine.maxDeferredPreviewAttempts)
        XCTAssertEqual(rendered(status, progress), .couldNotCheck,
                       "and the surface stays honest for the rest of the session rather than reverting")
    }

    /// The retry is not a fetch. It must never spend the multi-megabyte download the deferral exists to
    /// hold back — that is the user's data plan.
    func testTheRetryNeverRunsTheHeavyFetch() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let mock = MockSyncEngine()
        let (engine, _, _, _) = makeDeferredEngine(
            store: store,
            summarizer: FlakyRemoteJourneySummarizer(failuresBeforeSuccess: .max, summaries: []),
            engine: mock)

        await engine.activate()
        await engine.awaitActivationFetch()
        engine.retryDeferredDownloadPreview()
        await engine.awaitPreviewRetry()

        XCTAssertEqual(mock.fetchCount, 0, "the archive is still deferred; only journey NAMES were asked for")
        XCTAssertTrue(engine.deferredHeavyFetch)
    }

    // MARK: - (4) Through the engine seam

    /// The owner's second point, end to end: from the moment the download is released until the records
    /// land, the list says a download is running instead of showing a void.
    ///
    /// Set up as build 101 was: the journey query fails, the photo COUNT answers. That count is the only
    /// evidence that survived on the device, and it is what makes this state honest with no names to show.
    func testTheListReportsProgressWhileTheFirstDownloadRuns() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let observer = ProgressObservingSyncEngine()
        let (engine, policy, status, progress) = makeDeferredEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: nil),
            counter: FakeRemotePhotoCounter(count: 1538),
            engine: observer)
        observer.onFetch = { [weak progress] in await MainActor.run { progress?.isRunning ?? false } }

        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertFalse(progress.isRunning, "nothing is downloading while the download is deferred")
        XCTAssertEqual(rendered(status, progress), .couldNotCheck)

        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(observer.fetchCount, 1)
        XCTAssertEqual(observer.wasRunningDuringFetch, true,
                       "the void between 'granted' and 'populated' is exactly where the list said nothing")
        XCTAssertFalse(progress.isRunning, "and it is cleared once the fetch returns")
    }

    /// A brand-new family's fetch returns nothing, and for as long as it runs the list must NOT claim a
    /// download is coming. This is DIFF-15's false statement pointing the other way, and it is the whole
    /// reason the progress flag needs evidence rather than `SyncStatus.state == .active`.
    func testABrandNewFamilyIsNeverToldSomethingIsDownloading() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let observer = ProgressObservingSyncEngine()
        let (engine, policy, status, progress) = makeDeferredEngine(
            store: store,
            // The pre-fetch ANSWERED and found nothing, and there are no remote photos either.
            summarizer: FakeRemoteJourneySummarizer(summaries: []),
            counter: FakeRemotePhotoCounter(count: 0),
            engine: observer)
        observer.onFetch = { [weak progress] in await MainActor.run { progress?.isRunning ?? false } }

        await engine.activate()
        await engine.awaitActivationFetch()
        XCTAssertEqual(rendered(status, progress), .firstRunHero)

        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(observer.fetchCount, 1)
        XCTAssertEqual(observer.wasRunningDuringFetch, false,
                       "there is no evidence anything is coming, so nothing may say it is")
        XCTAssertEqual(rendered(status, progress), .firstRunHero)
    }

    /// A fetch that THROWS must clear the progress state, or the list would report a download running
    /// forever. Same reasoning as DIFF-15's "a failed download must not blank the rows".
    func testAFailedDownloadClearsTheProgressState() async {
        let store = FakeLocalStore()
        store.photoCount = 0
        let waiting = [summary("a", photos: 412)]
        let mock = MockSyncEngine()
        mock.shouldThrowOnFetch = true
        let (engine, policy, status, progress) = makeDeferredEngine(
            store: store,
            summarizer: FakeRemoteJourneySummarizer(summaries: waiting),
            engine: mock)

        await engine.activate()
        await engine.awaitActivationFetch()
        policy.grantOneOccasionCellularDownload()
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1)
        XCTAssertFalse(progress.isRunning, "a thrown fetch is not a download still in flight")
        XCTAssertEqual(status.remoteJourneySummaries, waiting,
                       "and the rows survive, so the family can still see what is waiting (DIFF-15)")
    }
}

// MARK: - Test doubles

/// Fails its first `failuresBeforeSuccess` calls, then answers — the transient-failure shape the retry
/// exists for, and with `.max` the permanent-failure shape the attempt cap exists for.
final class FlakyRemoteJourneySummarizer: RemoteJourneySummarizing, @unchecked Sendable {
    let failuresBeforeSuccess: Int
    let summaries: [RemoteJourneySummary]
    private(set) var callCount = 0

    init(failuresBeforeSuccess: Int, summaries: [RemoteJourneySummary]) {
        self.failuresBeforeSuccess = failuresBeforeSuccess
        self.summaries = summaries
    }

    func remoteJourneySummaries() async -> [RemoteJourneySummary]? {
        callCount += 1
        return callCount <= failuresBeforeSuccess ? nil : summaries
    }
}

/// A `SyncEngineProtocol` double that samples a predicate WHILE `fetchChanges()` is running.
///
/// Asserting "progress is on" before and after the fetch cannot distinguish a flag that was set and
/// cleared from one that was never set at all — and the state this task exists to fill is, by
/// definition, only observable during the fetch.
final class ProgressObservingSyncEngine: SyncEngineProtocol, @unchecked Sendable {
    var pendingRecordZoneChanges: [CKSyncEngine.PendingRecordZoneChange] = []
    var pendingDatabaseChanges: [CKSyncEngine.PendingDatabaseChange] = []

    /// Sampled once, inside `fetchChanges()`. Nil until a fetch has happened.
    ///
    /// `async` and `@Sendable` because `fetchChanges()` is a nonisolated protocol requirement while
    /// `FirstSyncDownloadProgress` is `@MainActor` — the sample has to hop, and pretending otherwise is
    /// exactly the kind of thing strict concurrency exists to refuse.
    var onFetch: (@Sendable () async -> Bool)?
    private(set) var wasRunningDuringFetch: Bool?
    private(set) var fetchCount = 0

    func add(pendingDatabaseChanges changes: [CKSyncEngine.PendingDatabaseChange]) {
        pendingDatabaseChanges.append(contentsOf: changes)
    }
    func add(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        pendingRecordZoneChanges.append(contentsOf: changes)
    }
    func remove(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        pendingRecordZoneChanges.removeAll { changes.contains($0) }
    }

    func sendChanges() async throws {}
    func fetchChanges() async throws {
        fetchCount += 1
        wasRunningDuringFetch = await onFetch?()
    }
}
