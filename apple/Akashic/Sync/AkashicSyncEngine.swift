import Foundation
import CloudKit
// DIFF-16: the foreground notification is the only retry trigger for the deferred-download preview
// that does not depend on the network path changing (see `applicationWillEnterForeground`).
import UIKit

/// Coordinates CloudKit sync for the `.cloudKit` persistence mode using `CKSyncEngine`
/// (D4 = FINAL: custom record types, zone-per-journey, Core Data as the local store).
///
/// It sits behind two seams so its logic is unit-testable **without a live container**:
///   * `SyncEngineProtocol` — the underlying `CKSyncEngine` (mocked in tests),
///   * `SyncLocalStore`     — the local Core Data store (faked in tests).
/// The delegate callbacks (`handleEvent` / `nextRecordZoneChangeBatch`) are thin adapters
/// over the plain, testable methods below (`handleFetchedChanges`, `handleSentChanges`,
/// `nextBatch`, `handleZoneDeletions`), which take ordinary `CKRecord`s that tests can build.
///
/// ## Conflict policy (chosen)
/// **Last-writer-wins, server-authoritative.** Fetched server records overwrite the local
/// copy (`applyFetchedRecord`). On a send conflict (`serverRecordChanged`) the local edit is
/// **rebased onto the server record** — our changed field values are copied onto the server
/// record so the resend carries the correct change tag and our latest values ultimately land.
/// Future refinement (documented, not built tonight): field-level merge keyed on the domain
/// edit timestamps the app already keeps (`DayComment.modifiedAt`, `Journey.updatedAt`).
///
/// SCOPE TONIGHT: a clean, compiling, unit-tested foundation. The real-engine wiring compiles
/// and is gated behind `Config.cloudKitEnabled` + an available iCloud account, but end-to-end
/// sync is untested until an account is signed into a simulator (see README activation guide).
/// Why a record zone disappeared server-side. Mirrors CloudKit's reason so the (default-off)
/// honor-a-real-delete path can never be reached by a purge / encrypted-data reset, and so the
/// handler stays unit-testable without constructing a CloudKit event.
enum ZoneDeletionReason: Equatable {
    case deleted
    case purged
    case encryptedDataReset
    case unknown
}

@MainActor
final class AkashicSyncEngine: NSObject, CKSyncEngineDelegate {

    private let store: SyncLocalStore
    let status: SyncStatus
    private let accountProvider: AccountStatusProviding
    private let containerIdentifier: String
    private let defaults: UserDefaults

    /// Wi-Fi-only download policy. Read at our explicit fetch trigger (`fetchOnActivation`) and,
    /// for the engine's own automatic fetches, applied natively via the `fetchChangesOptions`
    /// delegate hook below. Defaults to an always-allow stand-in so the existing engine unit tests
    /// (which never exercise the policy) are untouched; production injects the real `NetworkPolicy`.
    private let networkPolicy: NetworkPolicyGate

    /// Best-effort pre-fetch count of downloadable photos, used to turn the first-sync deferral's
    /// generic status into an honest sized prompt. Nil (the default, and in non-CloudKit builds)
    /// means "no estimate available" → the prompt is skipped and the generic status shown.
    private let remotePhotoCounter: RemotePhotoCounting?

    /// DIFF-15: best-effort, **ungated** pre-fetch of what is waiting in iCloud by name, so a
    /// deferred first sync can show real un-downloaded rows instead of the first-run hero.
    ///
    /// Unlike `remotePhotoCounter` this is NOT injected only from `startSync` — the initializer
    /// defaults it to the real `CloudKitRemoteJourneySummarizer`. That is safe and deliberate:
    /// constructing one touches nothing (it holds a container *identifier*, and the container itself
    /// is only built inside `#if AKASHIC_CLOUDKIT_BUILD`), so outside an entitled build it returns
    /// `nil` instantly with no network and no trap. Defaulting it means a future engine call site
    /// cannot silently ship without the surface this task exists to provide, which is the failure
    /// mode a nil default invites. Tests override it with a fake.
    private let remoteJourneySummarizer: RemoteJourneySummarizing?

    /// DIFF-16: publishes "the heavy first download is running right now" to `JourneyListView`, so
    /// the void between the user granting the download and the first records landing says what is
    /// happening instead of showing an empty list or the first-run hero. See
    /// `FirstSyncDownloadProgress` for why this is not a `SyncStatus.State`.
    private let downloadProgress: FirstSyncDownloadProgress

    /// True once the preview established that there IS something to download — a non-empty summary
    /// pre-fetch, or a positive remote photo count. The gate on `downloadProgress`: without it,
    /// "Downloading your journeys…" would render at a brand-new family for as long as their empty
    /// fetch takes, which is DIFF-15's false statement pointing the other way.
    private var firstDownloadHasKnownContent = false

    /// Set once the deferred-download preview has actually ANSWERED — a summary pre-fetch that
    /// returned (even empty), or a store too full for the preview to be relevant.
    ///
    /// DIFF-16 replaced a `hasEvaluatedFirstSyncPrompt` flag set at the top of the method: it made
    /// the preview run exactly once per engine lifetime, so a single transient failure was a
    /// permanent first-run hero until the app was relaunched. That is hypothesis (c) of the device
    /// report, and it costs nothing to remove.
    private var hasPublishedDeferredDownloadPreview = false

    /// Separate from the flag above because the two answer different questions: the prompt is a
    /// SHEET the user can dismiss (`RootView` nils `status.firstSyncPrompt` when they do), and a
    /// retry must never resurrect a dialog they already answered.
    private var hasPublishedFirstSyncPrompt = false

    /// Re-entrancy guard: everything here is `@MainActor`, but two triggers can still interleave at
    /// the `await`, and paying for the same network query twice is exactly what "keep it cheap"
    /// rules out.
    private var isPublishingDeferredPreview = false

    /// Attempts spent on the deferred-download preview. Bounded, because a PERMANENT failure —
    /// hypothesis (b), a Journey query the deployed Production schema will not serve — would
    /// otherwise re-run on every foreground and every push for the life of the install.
    /// Test-visible, so "the retry actually retried" is an assertion rather than an inference.
    private(set) var deferredPreviewAttempts = 0

    static let maxDeferredPreviewAttempts = 5

    /// Which CloudKit database this engine drives.
    ///
    /// `.private` — journeys we own; `.shared` — journeys someone else shared with us
    /// (T2.8). Two engines run side by side because a `CKSyncEngine` is bound to exactly one
    /// database, and the two behave differently in three ways that matter:
    ///   * only the private engine performs the initial upload (a participant must never try
    ///     to push the owner's archive back up as if it were their own),
    ///   * only the private engine recreates a vanished zone — in the shared database a zone
    ///     disappearing means *the share was revoked*, and recreating it is both impossible
    ///     and wrong,
    ///   * each keeps its own state file and only handles journeys on its side of the fence.
    let databaseScope: CKDatabase.Scope

    /// The underlying engine seam. `nil` until `activate()` builds it (production) or the test
    /// injects one. Only used to enqueue/flush once `isRunning` is true. Dropped (set to nil) on
    /// an account switch so `activate()` rebuilds a fresh engine bound to the new account.
    private var engine: SyncEngineProtocol?

    /// Test seam: overrides `buildRealEngine()` so `activate()` can rebuild the engine after it is
    /// dropped (e.g. on an account switch, which nils it out). nil in production → the real
    /// `CKSyncEngine` is built. Production never sets this; only tests inject it.
    var engineBuilder: (() -> SyncEngineProtocol?)?

    /// True only after `activate()` confirmed an available account and started the engine.
    private(set) var isRunning = false
    private var hasActivated = false
    private var hasPurgedRouteScratch = false

    /// Server records to resend on the next batch, keyed by id — populated when rebasing a
    /// `serverRecordChanged` conflict so the resend carries the server's change tag.
    private var mergedRecordCache: [CKRecord.ID: CKRecord] = [:]

    /// Test seam: the rebased records still waiting to be sent.
    var pendingMergedRecordIDs: Set<CKRecord.ID> { Set(mergedRecordCache.keys) }

    /// Test/observation hook fired after fetched server changes are applied locally.
    var onRemoteChangesApplied: (() -> Void)?

    /// D9: fired the ONE time it becomes safe to decide whether to seed the bundled demo journey
    /// — either there is no iCloud account (sync can never deliver anything, so seeding right now
    /// can never collide with real data), or the FIRST fetch attempt just SUCCEEDED (the local
    /// store now reflects whatever the account actually holds, so "is it still empty?" is a real
    /// answer). Deliberately NOT fired when the fetch is deferred (Wi-Fi-only policy) or throws —
    /// in both cases whether the family's own journeys are about to land is still unknown, and
    /// seeding a sample into an account about to receive real data is worse than not shipping the
    /// feature. Wired by `PersistenceController.startSync()`; only meaningful on the private
    /// engine (a shared-in participant's account status has nothing to do with seeding a LOCAL
    /// sample of the owner's own journeys — `startSync` never wires this on `sharedCoordinator`).
    var onFreshInstallDetermined: (() -> Void)?

    /// Handle on the activation pull. Held so a test can await it instead of racing it — the
    /// pull is deliberately detached (see `fetchOnActivation`), so without this a test that
    /// checked "did activation fetch?" passed or failed on timing alone.
    private(set) var activationFetch: Task<Void, Never>?

    /// Await the activation pull, if one is in flight.
    func awaitActivationFetch() async { await activationFetch?.value }

    /// True when the activation pull was deferred by the Wi-Fi-only policy and is waiting for an
    /// eligible (cheap) path. Cleared once the pull actually runs. Test-visible.
    private(set) var deferredHeavyFetch = false

    /// Retry a heavy fetch that the Wi-Fi-only policy deferred, as soon as the path becomes
    /// eligible (NWPathMonitor callback) or the user turns the setting off. Wired by `startSync`
    /// to `NetworkPolicy.onAllowsHeavyTransferBecameTrue`. No-op unless a fetch is actually pending
    /// and the engine is running — so a path flap without a deferred fetch costs nothing.
    ///
    /// Detached, like every other reach back into the engine (see `fetchOnActivation`): this fires
    /// from the path-monitor callback, never from inside a CKSyncEngine delegate callback.
    func networkPolicyDidAllowHeavyTransfer() {
        guard isRunning, deferredHeavyFetch else { return }
        SyncLog.log("networkPolicy: path now allows heavy transfer — running the deferred fetch")
        activationFetch = Task.detached { [weak self] in await self?.fetchOnActivation() }
    }

    /// Handle on a preview retry, for the same reason `activationFetch` exists: so a test awaits it
    /// rather than racing it.
    private(set) var previewRetry: Task<Void, Never>?

    /// Await a deferred-download-preview retry, if one is in flight.
    func awaitPreviewRetry() async { await previewRetry?.value }

    /// DIFF-16: re-attempt the deferred-download preview. Driven by the foreground notification below
    /// and by the "Check again" button on the could-not-check surface.
    ///
    /// ## Why foregrounding, and why this is the trigger that was missing
    ///
    /// Every OTHER trigger that could retry the preview funnels through `fetchOnActivation`'s
    /// deferral branch — activation, a silent push (`fetchChangesForPush`), and the path-change
    /// retry above — and each of those now retries for free, because
    /// `publishDeferredDownloadPreview` is no longer once-per-lifetime. What none of them covers is
    /// the ordinary case: the app was backgrounded while deferred and the user comes back to look.
    /// `NetworkPolicy` fires only on false → true (there is no became-*disallowed* callback), so a
    /// path change that leaves the download deferred reaches nothing at all.
    ///
    /// No-op unless a deferral is genuinely outstanding AND the preview has never answered, so a
    /// foreground in the steady state costs a comparison and nothing else. Deliberately does NOT
    /// touch the heavy fetch: this is kilobytes of journey names, not the archive.
    func retryDeferredDownloadPreview() {
        guard databaseScope == .private, isRunning, deferredHeavyFetch else { return }
        guard !hasPublishedDeferredDownloadPreview else { return }
        guard deferredPreviewAttempts < Self.maxDeferredPreviewAttempts else {
            SyncLog.log("foreground: deferred-download preview has spent its \(Self.maxDeferredPreviewAttempts) attempts — not retrying")
            return
        }
        SyncLog.log("foreground: retrying the deferred-download preview")
        previewRetry = Task { [weak self] in await self?.publishDeferredDownloadPreview() }
    }

    /// Owns the foreground-notification token and removes it when released.
    ///
    /// Copied in shape from `SyncScheduler.ObserverToken` and for the same measured reason (QUA-08):
    /// a `@MainActor` type's `deinit` is nonisolated and may not READ its isolated stored properties,
    /// but it may destroy them — so `removeObserver` lives in the token's own deinit. Deliberately
    /// NOT `@MainActor` itself: its deinit touches only its own storage and
    /// `NotificationCenter.removeObserver` is thread-safe.
    private final class ObserverToken {
        private let token: NSObjectProtocol
        init(_ token: NSObjectProtocol) { self.token = token }
        deinit { NotificationCenter.default.removeObserver(token) }
    }

    private var foregroundObserver: ObserverToken?

    /// Subscribe to the foreground notification. Called from `init` rather than `activate()` so the
    /// subscription does not depend on the order two async activations happen to complete in;
    /// `applicationWillEnterForeground` guards on `isRunning`, so an early notification is a no-op.
    private func observeForeground() {
        // `queue: .main` because `applicationWillEnterForeground` is main-actor isolated and the
        // notification's own delivery thread is not part of UIKit's contract in a way worth relying
        // on. With the main queue named explicitly, `assumeIsolated` is a statement the runtime can
        // check rather than a hope.
        foregroundObserver = ObserverToken(NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.retryDeferredDownloadPreview() }
            })
    }

    /// Media zones discovered from server database-change events, so they are excluded from fetch
    /// even before this device has the corresponding journey locally — the fresh-install / restore
    /// case, where `mediaZoneIDsToExclude()` would otherwise be empty on the first pull and let the
    /// engine materialize every original. Persisted per scope so a relaunch keeps excluding them.
    private var discoveredMediaZoneKeys: Set<String> = []

    /// Fired when a per-journey MEDIA zone (`journey-<uuid>-media`) vanishes server-side, with the
    /// journey id. The media zone holds the v2 `PhotoMedia` originals; losing it server-side is the
    /// same "iCloud lost it, this device still has the bytes" case as a data-zone loss, so the
    /// owner re-uploads that journey's PhotoMedia from local bytes (see `MediaRepackJob`/
    /// `PhotoMediaService`). Wired by `startSync`; nil in tests that only assert the hook fired.
    var onMediaZoneLost: ((String) -> Void)?

    /// OFF by design: a server-side zone deletion never destroys local data (see
    /// `handleZoneDeletions`). Nothing in the app sets this; it exists so that if honoring
    /// genuine deletes is ever wanted, it must be turned on deliberately AND paired with
    /// `confirmZoneDeletion`.
    var honorsRemoteZoneDeletion = false

    /// User-confirmation gate for the above. Returns true only if the user explicitly agreed
    /// to destroy that journey locally.
    var confirmZoneDeletion: ((String) -> Bool)?

    /// True once the initial upload was enqueued in this process but the engine has not yet
    /// confirmed it persisted its pending state. See the `.stateUpdate` handling.
    private var initialUploadEnqueued = false

    private static let didInitialUploadKey = "akashic.sync.didInitialUpload"

    init(store: SyncLocalStore,
         status: SyncStatus,
         accountProvider: AccountStatusProviding,
         containerIdentifier: String = Config.cloudKitContainerIdentifier,
         databaseScope: CKDatabase.Scope = .private,
         defaults: UserDefaults = .standard,
         engine: SyncEngineProtocol? = nil,
         networkPolicy: NetworkPolicyGate = AlwaysAllowHeavyTransfer(),
         remotePhotoCounter: RemotePhotoCounting? = nil,
         remoteJourneySummarizer: RemoteJourneySummarizing? = nil,
         // SE-0411 again, and this one WOULD have broken: `FirstSyncDownloadProgress` is
         // `@MainActor`, and a default-argument expression is evaluated in a nonisolated context at
         // the call site — so `= .shared` here does not compile under Swift 5 mode with strict
         // concurrency. `nil` plus a body resolution is the shape that survives.
         downloadProgress: FirstSyncDownloadProgress? = nil) {
        self.store = store
        self.status = status
        self.accountProvider = accountProvider
        self.containerIdentifier = containerIdentifier
        self.databaseScope = databaseScope
        self.defaults = defaults
        self.engine = engine
        self.networkPolicy = networkPolicy
        self.remotePhotoCounter = remotePhotoCounter
        // Built in the body rather than as a default argument for a concrete reason: it needs
        // `containerIdentifier`, and a Swift default-argument expression cannot reference another
        // parameter. Taking `nil` and resolving here is also the SE-0411-safe shape by default — a
        // default-argument expression is evaluated in a NONISOLATED context at the call site, so the
        // day this seam gains any main-actor isolation, nothing has to be untangled.
        self.remoteJourneySummarizer = remoteJourneySummarizer
            ?? CloudKitRemoteJourneySummarizer(containerIdentifier: containerIdentifier)
        self.downloadProgress = downloadProgress ?? FirstSyncDownloadProgress.shared
        super.init()
        discoveredMediaZoneKeys = Set(defaults.stringArray(forKey: Self.discoveredMediaZonesKey(databaseScope)) ?? [])
        if databaseScope == .private { observeForeground() }
    }

    private static func discoveredMediaZonesKey(_ scope: CKDatabase.Scope) -> String {
        scope == .shared ? "akashic.sync.discoveredMediaZones.shared" : "akashic.sync.discoveredMediaZones"
    }

    /// Encode a media zone id (name + owner) to a persistable key and back.
    private static func key(for zoneID: CKRecordZone.ID) -> String { zoneID.zoneName + "\t" + zoneID.ownerName }
    private static func zoneID(fromKey key: String) -> CKRecordZone.ID? {
        let parts = key.split(separator: "\t", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        return CKRecordZone.ID(zoneName: String(parts[0]), ownerName: String(parts[1]))
    }

    /// Record media zones seen in a server database-change event so they are excluded from every
    /// subsequent fetch (and after relaunch). Returns true if the known set changed.
    @discardableResult
    func recordDiscoveredMediaZones(_ zoneIDs: [CKRecordZone.ID]) -> Bool {
        let keys = zoneIDs.filter(RecordCoder.isMediaZone).map(Self.key(for:))
        guard !keys.isEmpty else { return false }
        let before = discoveredMediaZoneKeys.count
        discoveredMediaZoneKeys.formUnion(keys)
        guard discoveredMediaZoneKeys.count != before else { return false }
        defaults.set(Array(discoveredMediaZoneKeys), forKey: Self.discoveredMediaZonesKey(databaseScope))
        return true
    }

    // MARK: - Zone routing (who owns which journey)

    /// The zone owner for a journey: `CKCurrentUserDefaultName` for our own, the sharing
    /// owner's record name for one shared with us. Journeys predating T2.8 have no stored
    /// owner and are ours by definition.
    private func ownerName(forJourneyID journeyID: String) -> String {
        store.zoneOwnerName(forJourneyID: journeyID) ?? CKCurrentUserDefaultName
    }

    private func zoneID(forJourneyID journeyID: String) -> CKRecordZone.ID {
        RecordCoder.zoneID(forJourneyID: journeyID, ownerName: ownerName(forJourneyID: journeyID))
    }

    /// Whether this engine's database is the one holding the journey. Every journey belongs to
    /// exactly one of the two engines, so this is what keeps them from fighting over it.
    ///
    /// D9: the bundled demo journey is local sample content, never the family's real data, and
    /// must never reach CloudKit — on the owner's device or any other. Excluding it here, the one
    /// gate every upload path already funnels through (the initial bulk upload, the activation
    /// heal, and every observed local write), is what makes "never syncs" hold everywhere instead
    /// of needing a matching guard at each call site.
    func handles(journeyID: String) -> Bool {
        guard !store.isSeededFixture(journeyID: journeyID) else { return false }
        let isMine = ownerName(forJourneyID: journeyID) == CKCurrentUserDefaultName
        return databaseScope == .shared ? !isMine : isMine
    }

    // MARK: - Activation (account-gated)

    /// Check the iCloud account and, only if available, start the engine and enqueue the
    /// initial upload. With no account (the simulator tonight) the engine stays OFF and the
    /// app keeps working locally — `status` reflects why.
    func activate() async {
        guard !hasActivated else { return }
        // First activation only — a genuinely quiescent point, nothing has been uploaded yet,
        // so it is safe to sweep the route ASSET scratch files left behind by previous runs.
        // (CKAsset reads its file lazily; deleting one while a modify operation is in flight
        // would corrupt the upload, so this must never run mid-session.)
        if !hasPurgedRouteScratch {
            hasPurgedRouteScratch = true
            RecordCoder.purgeRouteAssetDirectory()
        }
        status.set(.checkingAccount)

        let account = await accountProvider.accountStatus()
        SyncLog.log("activate: accountStatus=\(account.rawValue) state=\(String(describing: Self.loadState() != nil))")
        if let blocked = SyncStatus.state(for: account) {
            status.set(blocked)          // .noAccount / .restricted / .unavailable -> engine OFF
            // No usable account => sync can never deliver anything this session. Safe to decide the
            // demo-seed question right now — but ONLY for a status that actually says that; see
            // `accountStatusIsConclusiveForDemoSeed`, which is the QUA-48 half of this branch.
            if databaseScope == .private, Self.accountStatusIsConclusiveForDemoSeed(account) {
                onFreshInstallDetermined?()
            }
            return
        }

        if engine == nil { engine = engineBuilder?() ?? buildRealEngine() }
        guard engine != nil else {
            // Localised (QUA-26): this becomes the `%@` inside "Sync error: %@" on the Settings row,
            // so leaving it English produced a half-Norwegian sentence.
            status.set(.error(String(localized: "Could not create the CloudKit sync engine",
                                     comment: "Settings › iCloud sync status row, after \"Sync error:\" — the sync engine could not be constructed at all.")))
            return
        }

        hasActivated = true
        isRunning = true
        enqueueInitialUploadIfNeeded()
        enqueueUnsyncedJourneysIfNeeded()
        // Active as soon as the engine is running — the pull below refreshes the timestamp,
        // but the engine's state must not depend on an async task having finished.
        status.markSynced()

        // Pull once, explicitly, on activation.
        //
        // `automaticallySync = true` leaves *sending* to the engine's own scheduler — and a
        // manual `sendChanges()` here traps inside CloudKit (SIGTRAP, not a catchable error;
        // `try?` does not save you), so that call is deliberately absent.
        //
        // Fetching is different: the engine learns about server-side changes from silent
        // pushes, so without an explicit pull a launch shows stale data until one arrives.
        // The Simulator never receives them at all — which is exactly how this surfaced: a
        // clean install sat at 0 journeys while the container held 1559 records.
        //
        // `Task.detached`, NEVER `Task {}` — see `fetchOnActivation`.
        activationFetch = Task.detached { [weak self] in await self?.fetchOnActivation() }
    }

    /// Whether an account status is a CONCLUSIVE answer to "can sync deliver anything into this
    /// store?" — the only kind of answer that may fire the once-ever `onFreshInstallDetermined`
    /// decision without a fetch (QUA-48).
    ///
    /// This branch used to fire for every non-available status, on the strength of a comment that
    /// read "No account => sync can never deliver anything this session". Two of the four say no
    /// such thing. `.couldNotDetermine` is what CloudKit reports when it cannot reach the account at
    /// all — the ordinary state of a cold launch with no network yet, i.e. exactly a fresh install
    /// opened the moment it finishes downloading — and `.temporarilyUnavailable` says "retry" in its
    /// name. Both mean *we do not know*, and both burned the irreversible seed decision anyway, so
    /// the sample went in and the family's real archive arrived on top of it minutes later. Measured
    /// on the tree before this fix, with a throwaway probe over all four statuses: every one of them
    /// fired the hook, `.couldNotDetermine` (rawValue 0) and `.temporarilyUnavailable` (4) included.
    /// `SampleJourneyRetirementTests` is that probe turned into the standing guard.
    ///
    /// `.available` returns false here too, and is not a bug: an available account defers the
    /// decision to the first successful fetch (`fetchOnActivation`), which is a strictly better
    /// answer than the account status could give.
    ///
    /// The cost of the narrowing is that a first launch with no network makes no decision at all —
    /// no sample until the next launch. That is the right trade: a missing sample is a poorer first
    /// screen, a duplicated one is the app inventing a fake copy of the family's own trip. Note
    /// there is nothing to retry it with in-session — `engine` is not built on this path, so no
    /// `.accountChange` event can arrive; the next launch decides.
    static func accountStatusIsConclusiveForDemoSeed(_ status: CKAccountStatus) -> Bool {
        switch status {
        case .noAccount, .restricted:
            return true                      // a known, decided state of this device
        case .available:
            return false                     // the first successful fetch decides instead
        case .couldNotDetermine, .temporarilyUnavailable:
            return false                     // "we do not know" is not a decision
        @unknown default:
            return false                     // a status we cannot reason about is not a decision
        }
    }

    /// The explicit activation pull, isolated in its own method so every caller reaches it the
    /// same way: through a **detached** task.
    ///
    /// `CKSyncEngine` refuses (`fatalError`, uncatchable) any awaited call into the engine that
    /// happens inside one of its own delegate callbacks — it cannot then guarantee serial
    /// delivery. It detects "inside a callback" with a task-local, and a plain `Task { }`
    /// *inherits task-locals*, so an inherited task is still "inside the callback" as far as
    /// CloudKit is concerned. `Task.detached` starts with a clean task-local context and is the
    /// only safe way to call back in. (Apple's own trap message says exactly this.)
    ///
    /// This is what actually broke the pull: `activate()` fetches, and the engine posts an
    /// `.accountChange(.signIn)` event right after it starts — whose handler re-entered
    /// `activate()` from inside `handleEvent`, hitting the trap and killing the app mid-fetch.
    func fetchOnActivation() async {
        // Wi-Fi-only download policy (default on). The activation pull is the multi-GB photo
        // archive on a fresh install — the transfer we must never silently run up a cellular bill
        // with. On an expensive path with the setting on, defer it and show an HONEST status
        // instead of pulling. The retry is driven by the network path becoming cheap OR the user
        // flipping the setting off (see `networkPolicyDidAllowHeavyTransfer`) — not the next launch.
        //
        // This only defers the *fetch*. Pending LOCAL changes keep queueing to the engine
        // regardless (see `localStoreDidChange`, unaffected by this policy), so no edit made while
        // a download is deferred is ever lost.
        guard networkPolicy.allowsHeavyTransfer else {
            deferredHeavyFetch = true
            status.set(.waitingForWiFi)
            SyncLog.log("activate: heavy fetch deferred — Wi-Fi-only policy on an expensive path")
            await publishDeferredDownloadPreview()
            return
        }
        deferredHeavyFetch = false
        // The download is proceeding now, so any pending first-sync prompt is moot — clear it so a
        // presented sheet dismisses instead of lingering behind the download.
        status.firstSyncPrompt = nil
        // DIFF-16: the owner's second point, and it stands on its own — sync happens invisibly in the
        // background, so even the WORKING path "just appears eventually", which reads as broken. From
        // here until the fetch returns, `JourneyListView` says a download is running instead of
        // showing a void. Gated on `firstDownloadHasKnownContent` so a brand-new family, whose fetch
        // will return nothing, never sees a claim that something is coming.
        let showsDownloadProgress = firstDownloadHasKnownContent
            && store.localPhotoCount() <= FirstSyncDownloadDecision.freshInstallPhotoCeiling
        if showsDownloadProgress {
            downloadProgress.begin()
            SyncLog.log("activate: first heavy download starting — the journey list shows progress")
        }
        defer { if showsDownloadProgress { downloadProgress.end() } }
        do {
            SyncLog.log("activate: fetchChanges() starting")
            try await engine?.fetchChanges()
            SyncLog.log("activate: fetchChanges() returned")
            status.markSynced()
            // DIFF-15: the real journeys have landed, so the un-downloaded placeholder rows have
            // nothing left to stand in for. Cleared HERE rather than before the fetch, so a fetch
            // that throws leaves the family still able to see what is waiting.
            status.remoteJourneySummaries = nil
            // The heavy fetch completed: spend any one-occasion cellular exemption so the next one
            // re-evaluates the policy fresh.
            networkPolicy.heavyTransferDidComplete()
            // The FIRST successful fetch is the earliest point the local store can be trusted to
            // reflect the account's real contents — safe to decide the demo-seed question now (see
            // `onFreshInstallDetermined`'s doc comment). Deliberately not fired on the deferred or
            // error paths below: both leave "is real data about to land?" still unanswered.
            if databaseScope == .private { onFreshInstallDetermined?() }
        } catch {
            SyncLog.error("activate: fetchChanges() threw \(error)")
            status.set(.error(String(localized: "Initial fetch failed: \(error.localizedDescription)",
                                     comment: "Settings › iCloud sync status row, after \"Sync error:\" — the first fetch after activation threw. The placeholder is the underlying system error.")))
        }
    }

    /// On a fresh install whose heavy download was just deferred, replace two silences with facts:
    /// **what** is waiting (named journey rows for `JourneyListView`) and **how big** it is (the
    /// sized first-sync prompt). Only ever run by the private engine — there is a single prompt and a
    /// single list, not one per database.
    ///
    /// Both halves are best-effort and independently nil-tolerant. Nothing here can make the state
    /// worse than it was: a failed summary query renders the neutral could-not-check state (DIFF-16;
    /// it used to render the first-run hero, which is a false statement to a family whose archive
    /// exists), and a failed count falls back to the plain "Waiting for Wi-Fi" status.
    ///
    /// ## Retryable as of DIFF-16
    ///
    /// This used to be guarded by a flag set on ENTRY, so it ran exactly once per engine lifetime and
    /// one transient failure was a permanent first-run hero until the app was relaunched. The guard is
    /// now "has it ANSWERED", which makes every trigger that lands in the deferral branch — activation,
    /// a push, the path-change retry, and the foreground hook above — a free retry. Bounded by
    /// `maxDeferredPreviewAttempts`, because a permanent failure must not re-query forever, and
    /// re-entrancy-guarded, because two triggers can interleave at the `await` below.
    private func publishDeferredDownloadPreview() async {
        guard databaseScope == .private, !hasPublishedDeferredDownloadPreview else { return }
        guard !isPublishingDeferredPreview else { return }
        guard deferredPreviewAttempts < Self.maxDeferredPreviewAttempts else { return }
        isPublishingDeferredPreview = true
        defer { isPublishingDeferredPreview = false }
        deferredPreviewAttempts += 1
        let local = store.localPhotoCount()
        // Only pay for the (network) pre-fetch for a plausible fresh install. An incremental sync
        // already has journeys on screen and needs neither the rows nor the dialog — and that is a
        // settled answer, not a failed one, so no retry is ever warranted for it.
        guard local <= FirstSyncDownloadDecision.freshInstallPhotoCeiling else {
            hasPublishedDeferredDownloadPreview = true
            return
        }

        // (a) The ungated summary pre-fetch — kilobytes, so it runs on the metered path the heavy
        // fetch was just deferred from.
        let summaries = await remoteJourneySummarizer?.remoteJourneySummaries()
        if let summaries {
            // Never overwrite rows we already have with nothing: the assignment is inside the `if let`
            // so a retry that fails leaves the previous answer standing.
            status.remoteJourneySummaries = summaries
            hasPublishedDeferredDownloadPreview = true
            if !summaries.isEmpty { firstDownloadHasKnownContent = true }
            SyncLog.log("remoteJourneySummaries: attempt \(deferredPreviewAttempts) answered — \(summaries.count) journey(s) waiting")
        } else {
            // The line the owner could not read on build 101. It is an `error`, so it is logged even
            // with the diagnostics toggle off — this is the one sentence that distinguishes "nothing
            // is there" from "we could not find out".
            SyncLog.error("remoteJourneySummaries: attempt \(deferredPreviewAttempts) of \(Self.maxDeferredPreviewAttempts) could NOT name the remote journeys — the list shows the could-not-check state, not the first-run hero")
        }

        // The summaries already carry a per-zone photo count, so when they arrive the estimate is
        // free and no second network round trip is spent. `remotePhotoCounter` remains the fallback
        // for when they do not (and is what the CloudKit-less builds and the engine tests exercise).
        let remote: Int?
        if let summaries, !summaries.isEmpty {
            remote = summaries.reduce(0) { $0 + $1.photoCount }
        } else {
            remote = await remotePhotoCounter?.remotePhotoCount()
        }
        // A positive remote count is evidence in its own right that there IS an archive to download —
        // and on build 101 it was the ONLY evidence that survived, because the count query answered
        // while the journey query did not. That is what makes the progress state honest even when the
        // rows could never be named.
        if let remote, remote > 0 { firstDownloadHasKnownContent = true }
        let decision = FirstSyncDownloadDecision.decide(localPhotoCount: local, remotePhotoCount: remote)
        // `hasPublishedFirstSyncPrompt` and not `status.firstSyncPrompt == nil`: the sheet nils that
        // property when the user answers it, so a retry would otherwise re-present a dialog they have
        // already dismissed.
        if case .prompt = decision, !hasPublishedFirstSyncPrompt {
            hasPublishedFirstSyncPrompt = true
            status.firstSyncPrompt = decision
        }
    }

    private func buildRealEngine() -> SyncEngineProtocol? {
        // A CKContainer instantiated without the icloud-services entitlement TRAPS, so this is
        // only ever built in an entitled `*-CloudKit` build. (Defense in depth: `startSync`
        // already no-ops in non-CloudKit builds, and the account provider returns a sentinel.)
        #if AKASHIC_CLOUDKIT_BUILD
        let container = CKContainer(identifier: containerIdentifier)
        let database = databaseScope == .shared
            ? container.sharedCloudDatabase
            : container.privateCloudDatabase
        var configuration = CKSyncEngine.Configuration(
            database: database,
            stateSerialization: Self.loadState(scope: databaseScope),
            delegate: self)
        configuration.automaticallySync = true
        return CKSyncEngineAdapter(CKSyncEngine(configuration))
        #else
        return nil
        #endif
    }

    /// Push existing local (imported) data up on first activation only. Gated on a flag so a
    /// relaunch — where `CKSyncEngine` restores its own pending state from disk — does not
    /// re-enqueue everything.
    private func enqueueInitialUploadIfNeeded() {
        // Private database only. A participant's local copy of a shared journey arrived *from*
        // the owner; pushing it back up as a fresh upload would be a no-op at best and, on a
        // read-only share, a permanent stream of rejected writes.
        guard databaseScope == .private else { return }
        guard !defaults.bool(forKey: Self.didInitialUploadKey) else { return }
        guard let engine else { return }
        for journeyID in store.allLocalJourneyIDs() where handles(journeyID: journeyID) {
            let zoneID = zoneID(forJourneyID: journeyID)
            engine.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
            let saves = store.recordIdentities(forJourneyID: journeyID)
                .map { CKSyncEngine.PendingRecordZoneChange.saveRecord($0.recordID(ownerName: zoneID.ownerName)) }
            if !saves.isEmpty { engine.add(pendingRecordZoneChanges: saves) }
        }
        // The flag is committed only once CKSyncEngine reports it persisted this pending state
        // (see the `.stateUpdate` case). Until then every activate() re-runs the enqueue, which
        // is harmless: pending changes are keyed by record id.
        initialUploadEnqueued = true
    }

    /// Incremental heal at activation: re-enqueue any OWNED local journey that has never reached
    /// CloudKit (no persisted system fields for its root record), mirroring the initial upload but
    /// case-by-case. This is the recovery for a journey created — or edited — while the engine was
    /// stopped (signed out of iCloud, launched offline): `localStoreDidChange` dropped those writes
    /// behind `guard isRunning` and nothing re-enumerated them, so they lived on one device forever
    /// while the UI claimed "synced". (quality gate: journey created while sync stopped never
    /// uploaded.)
    ///
    /// Only runs AFTER the one-shot bulk upload has been confirmed (`didInitialUploadKey`), so it
    /// never double-enqueues the first archive; before that, `enqueueInitialUploadIfNeeded` owns the
    /// whole set. Private database only (a participant never re-uploads the owner's archive).
    private func enqueueUnsyncedJourneysIfNeeded() {
        guard databaseScope == .private else { return }
        guard defaults.bool(forKey: Self.didInitialUploadKey) else { return }
        guard let engine else { return }
        for journeyID in store.allLocalJourneyIDs() where handles(journeyID: journeyID) {
            // The journey root's presence in the meta table is the proxy for "this journey reached
            // CloudKit". If it is there, the ordinary observe path keeps it current; if not, the
            // whole journey (zone + records) must go up as a fresh incremental upload.
            guard !store.hasUploadedRecord(forRecordName: journeyID) else { continue }
            let identities = store.recordIdentities(forJourneyID: journeyID)
            guard !identities.isEmpty else { continue }
            let zoneID = zoneID(forJourneyID: journeyID)
            engine.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
            engine.add(pendingRecordZoneChanges: identities.map {
                .saveRecord($0.recordID(ownerName: zoneID.ownerName))
            })
        }
    }

    /// Enqueue server-side deletion of a journey's zones (journey + media). The zone is the
    /// cascade boundary by design (MAPPING §9), so this is THE delete path: two zone deletes
    /// remove every record and asset, on every device, without ever enumerating 1500+ records.
    /// Owner-only by construction — zone deletion in the shared database is not ours to do,
    /// so this is a no-op outside the private scope.
    func deleteZones(forJourneyID journeyID: String) {
        guard isRunning, let engine, databaseScope == .private else { return }
        // Never had a zone in the first place (`handles(journeyID:)` excludes it from every
        // upload path) — skip the wasted round trip when the demo journey is deleted.
        guard !store.isSeededFixture(journeyID: journeyID) else { return }
        engine.add(pendingDatabaseChanges: [
            .deleteZone(RecordCoder.zoneID(forJourneyID: journeyID)),
            .deleteZone(RecordCoder.mediaZoneID(forJourneyID: journeyID)),
        ])
        SyncLog.log("deleteZones: enqueued zone deletes for journey \(journeyID)")
    }

    // MARK: - Local write intake (called by SyncScheduler)

    /// Translate observed local writes into pending record-zone changes (and a zone-save for a
    /// newly-created journey root). No-op unless the engine is running.
    func localStoreDidChange(_ changes: [LocalChange]) {
        guard isRunning, let engine, !changes.isEmpty else { return }
        var databaseChanges: [CKSyncEngine.PendingDatabaseChange] = []
        var recordChanges: [CKSyncEngine.PendingRecordZoneChange] = []
        for change in changes where handles(journeyID: change.journeyID) {
            let recordID = change.recordID(ownerName: ownerName(forJourneyID: change.journeyID))
            // Only the owner creates zones. In the shared database the zone already exists and
            // is not ours to save; CloudKit rejects the attempt.
            if change.isJourneyRoot, change.kind == .save, databaseScope == .private {
                databaseChanges.append(.saveZone(CKRecordZone(zoneID: recordID.zoneID)))
            }
            switch change.kind {
            case .save:   recordChanges.append(.saveRecord(recordID))
            case .delete: recordChanges.append(.deleteRecord(recordID))
            }
        }
        if !databaseChanges.isEmpty { engine.add(pendingDatabaseChanges: databaseChanges) }
        if !recordChanges.isEmpty { engine.add(pendingRecordZoneChanges: recordChanges) }
    }

    // MARK: - CKSyncEngineDelegate

    func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        SyncLog.log("event: \(Self.describe(event))")
        switch event {
        case .stateUpdate(let update):
            // Only now — once the engine's pending changes are durable — is it safe to record
            // that the initial upload happened. Committing the flag at enqueue time meant a
            // kill in between left the archive permanently un-uploaded with nothing retrying.
            if Self.persistState(update.stateSerialization, scope: databaseScope), initialUploadEnqueued {
                defaults.set(true, forKey: Self.didInitialUploadKey)
                initialUploadEnqueued = false
            }

        case .accountChange(let change):
            handleAccountChange(change)

        case .fetchedRecordZoneChanges(let changes):
            handleFetchedChanges(
                modifications: changes.modifications.map(\.record),
                deletions: changes.deletions.map { (recordName: $0.recordID.recordName, recordType: $0.recordType) })

        case .fetchedDatabaseChanges(let changes):
            // Remember any media zones the server just told us about, so they are excluded from the
            // record-fetch phase and every future pull — even before we hold the journey locally.
            recordDiscoveredMediaZones(changes.modifications.map { $0.zoneID })
            for deletion in changes.deletions {
                handleZoneDeletions([deletion.zoneID], reason: Self.reason(for: deletion.reason))
            }

        case .sentRecordZoneChanges(let changes):
            handleSentChanges(
                saved: changes.savedRecords,
                failed: changes.failedRecordSaves.map { (record: $0.record, error: $0.error) },
                deleted: changes.deletedRecordIDs)

        case .didFetchChanges, .didSendChanges:
            status.markSynced()

        case .willFetchChanges, .willSendChanges, .sentDatabaseChanges,
             .willFetchRecordZoneChanges, .didFetchRecordZoneChanges:
            break

        @unknown default:
            break
        }
    }

    func nextRecordZoneChangeBatch(_ context: CKSyncEngine.SendChangesContext,
                                   syncEngine: CKSyncEngine) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let scope = context.options.scope
        let pending = syncEngine.state.pendingRecordZoneChanges.filter { scope.contains($0) }
        let batch = await nextBatch(for: pending)
        SyncLog.log("nextBatch: pending=\(pending.count) -> saves=\(batch?.recordsToSave.count ?? 0) deletes=\(batch?.recordIDsToDelete.count ?? 0)")
        return batch
    }

    /// Native cellular gate for the engine's OWN fetches — the automatic (push-triggered /
    /// scheduled) pulls we do not otherwise control, AND any explicit `fetchChanges()`. CKSyncEngine
    /// calls this before each server request while fetching (`context.reason` is `.scheduled` or
    /// `.manual`), so it is the one hook that reaches the automatic pulls the trigger-point check in
    /// `fetchOnActivation` cannot see.
    ///
    /// When the Wi-Fi-only policy forbids a heavy transfer on the current expensive path, we hand
    /// CloudKit an operation group whose configuration disallows cellular access. CloudKit then
    /// defers the fetch and retries it natively once Wi-Fi is available (a `networkUnavailable` the
    /// engine handles for us — see the class docs). There is deliberately NO send-side equivalent:
    /// uploads are the user's own edits and stay allowed.
    ///
    /// Only ever invoked by a real `CKSyncEngine` (the `*-CloudKit` builds); compiles everywhere
    /// because these CloudKit types are always available — only `CKContainer` traps unentitled.
    /// Async (the Swift refinement makes it so), which is what lets it read the main-actor policy.
    func nextFetchChangesOptions(_ context: CKSyncEngine.FetchChangesContext,
                                 syncEngine: CKSyncEngine) async -> CKSyncEngine.FetchChangesOptions {
        var options = context.options
        // v2: never fetch the per-journey MEDIA zones — that is the whole point of the split
        // (first sync ≈ 75 MB, originals streamed on demand). Derived dynamically from the local
        // journeys, so a journey created after the engine was built is covered without a rebuild.
        // Composes with the cellular gate below (both mutate the same `options`).
        let mediaZones = mediaZoneIDsToExclude()
        if !mediaZones.isEmpty { options.scope = .allExcluding(mediaZones) }
        guard !networkPolicy.allowsHeavyTransfer else { return options }
        let group = options.operationGroup
        group.name = "AkashicWiFiOnlyFetch"
        let configuration = group.defaultConfiguration ?? CKOperation.Configuration()
        configuration.allowsCellularAccess = false
        group.defaultConfiguration = configuration
        options.operationGroup = group
        return options
    }

    /// The media zone ids this engine must exclude from every fetch: one per local journey it
    /// handles, in that journey's owner/database. Derived at call time (not cached) so a
    /// newly-created journey's media zone is excluded on the very next fetch. Testable without a
    /// live engine (the untestable part is only handing the result to CloudKit's `Scope`).
    func mediaZoneIDsToExclude() -> [CKRecordZone.ID] {
        // Local journeys' media zones (covers new journeys without a rebuild) ...
        var zones = Set(store.allLocalJourneyIDs()
            .filter { handles(journeyID: $0) }
            .map { RecordCoder.mediaZoneID(forJourneyID: $0, ownerName: ownerName(forJourneyID: $0)) })
        // ... plus any discovered from server database-change events (the fresh-install / restore
        // case, where the local store is empty on the first pull).
        zones.formUnion(discoveredMediaZoneKeys.compactMap(Self.zoneID(fromKey:)))
        return Array(zones)
    }

    // MARK: - Testable event handling (plain inputs, no live engine required)

    /// Apply fetched server changes to the local store (server-authoritative). Suppresses the
    /// scheduler while writing so the applied changes do not echo back as fresh local writes.
    func handleFetchedChanges(modifications: [CKRecord],
                              deletions: [(recordName: String, recordType: String)]) {
        guard !modifications.isEmpty || !deletions.isEmpty else { return }
        SyncLog.log("handleFetchedChanges: applying mods=\(modifications.count) dels=\(deletions.count)")
        store.beginRemoteApply()
        for record in modifications { store.applyFetchedRecord(record) }
        for deletion in deletions {
            store.applyDeletedRecord(recordName: deletion.recordName, recordType: deletion.recordType)
        }
        store.endRemoteApply()
        onRemoteChangesApplied?()
        status.markSynced()
    }

    /// A whole zone (journey) vanished server-side.
    ///
    /// **This never deletes local data.** The local Core Data store is the authoritative family
    /// archive; CloudKit is the mirror. A zone can disappear for reasons that have nothing to do
    /// with an intent to delete photos — iCloud account reset, the user toggling iCloud off and
    /// on, a storage purge, a stray delete in the CloudKit dashboard during this migration, an
    /// errant client. The old behavior (`applyDeletedRecord(.journey)`) cascaded the Core Data
    /// delete to every waypoint, photo and comment of that journey, with no confirmation and no
    /// undo. So instead we re-establish the mirror: re-enqueue the zone and all of its records,
    /// exactly like the `.zoneNotFound` send-path recovery.
    ///
    /// Honoring a genuine remote delete would require BOTH `reason == .deleted` and an explicit
    /// user confirmation; `honorsRemoteZoneDeletion` is the (default-off, currently unset) seam
    /// for that and deliberately has no code path that sets it to true.
    func handleZoneDeletions(_ zoneIDs: [CKRecordZone.ID],
                             reason: ZoneDeletionReason = .unknown) {
        // v2: a lost MEDIA zone is handled separately — it holds no domain data (only PhotoMedia
        // originals), so there is nothing to protect locally and nothing to re-create through this
        // engine (media records go DIRECT via CKDatabase). The owner re-uploads that journey's
        // PhotoMedia from local bytes via the hook; a participant (who has no local originals) does
        // nothing and simply keeps streaming on demand from whatever remains. Handled BEFORE the
        // data-zone path because `journeyID(fromZoneID:)` deliberately returns nil for media zones.
        let mediaJourneyIDs = zoneIDs.compactMap(RecordCoder.journeyID(fromMediaZoneID:))
        if !mediaJourneyIDs.isEmpty, databaseScope == .private {
            for journeyID in mediaJourneyIDs {
                SyncLog.log("handleZoneDeletions: media zone lost for \(journeyID) — re-uploading PhotoMedia from local bytes")
                onMediaZoneLost?(journeyID)
            }
        }

        let journeyIDs = zoneIDs.compactMap(RecordCoder.journeyID(fromZoneID:))
        guard !journeyIDs.isEmpty else { return }

        if honorsRemoteZoneDeletion, reason == .deleted, let confirm = confirmZoneDeletion {
            let approved = journeyIDs.filter { confirm($0) }
            guard !approved.isEmpty else { return }
            store.beginRemoteApply()
            for journeyID in approved {
                store.applyDeletedRecord(recordName: journeyID,
                                         recordType: RecordCoder.RecordType.journey)
            }
            store.endRemoteApply()
            onRemoteChangesApplied?()
            return
        }

        // In the SHARED database a vanished zone means the owner stopped sharing the journey
        // with us (or removed us as a participant). Keep the local copy — it is the family
        // archive and losing access must not erase it — but do not try to re-create the zone:
        // it is not ours, the write would be rejected, and CKSyncEngine would retry forever.
        guard databaseScope == .private else {
            SyncLog.log("handleZoneDeletions: shared scope, share revoked for \(journeyIDs) — keeping local copy")
            return
        }

        guard let engine else { return }
        for journeyID in journeyIDs {
            let identities = store.recordIdentities(forJourneyID: journeyID)
            guard !identities.isEmpty else { continue }   // nothing local to protect / re-upload
            // Drop the dead server change tags BEFORE re-enqueueing. The zone is gone (or about
            // to be recreated empty), so every record must go up as a FRESH insert. Rehydrating a
            // tag for a record the server no longer has turns each save into a permanent
            // `unknownItem` failure — the protective re-upload would silently never land, losing
            // the journey's only cloud copy. (CRITICAL, review finding #1.)
            store.purgeSystemFields(forJourneyID: journeyID)
            let zoneID = zoneID(forJourneyID: journeyID)
            engine.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
            engine.add(pendingRecordZoneChanges: identities.map {
                .saveRecord($0.recordID(ownerName: zoneID.ownerName))
            })
        }
    }

    /// Handle the outcome of a send. The conflict path (`serverRecordChanged`) rebases the
    /// local edit onto the server record and re-enqueues it (last-writer-wins).
    func handleSentChanges(saved: [CKRecord],
                           failed: [(record: CKRecord, error: CKError)],
                           deleted: [CKRecord.ID]) {
        // Persist the server change tag for everything that landed, so the SECOND edit of a
        // locally created record diffs against the server version instead of re-inserting (the
        // fetch-apply path never sees a record this device uploaded, so this is its only source).
        store.recordsDidSave(saved)
        store.recordsDidDelete(deleted)
        var rebased: [CKSyncEngine.PendingRecordZoneChange] = []
        var zonesToRecreate: Set<CKRecordZone.ID> = []
        var journeysToPurge: Set<String> = []
        var revokedDrops: [CKSyncEngine.PendingRecordZoneChange] = []
        for failure in failed {
            SyncLog.log("sendFailure \(failure.record.recordType)/\(failure.record.recordID.recordName) code=\(failure.error.code.rawValue) \(failure.error.localizedDescription)")
            switch failure.error.code {
            case .serverRecordChanged:
                if let serverRecord = failure.error.serverRecord {
                    let merged = merge(client: failure.record, onto: serverRecord)
                    mergedRecordCache[merged.recordID] = merged
                    rebased.append(.saveRecord(merged.recordID))
                }
            case .zoneNotFound, .userDeletedZone:
                let zoneID = failure.record.recordID.zoneID
                // In the SHARED database a vanished zone means the share was revoked. Recreating
                // the zone there is owner-only and always rejected, so CKSyncEngine would retry
                // forever (same reasoning `handleZoneDeletions` already applies to fetched zone
                // deletions). Treat it as revocation: drop the pending change, keep the local
                // copy, do not re-enqueue. (review finding #2.)
                guard databaseScope == .private else {
                    SyncLog.log("sendFailure zoneNotFound in shared scope — share revoked; dropping \(failure.record.recordID.recordName)")
                    revokedDrops.append(.saveRecord(failure.record.recordID))
                    continue
                }
                // Private scope: recreate the zone and resend as a FRESH insert. Purge the dead
                // change tags for the whole journey first — the recreated zone is empty, so every
                // record must upload as an insert; a rehydrated tag fails permanently with
                // `unknownItem`. (CRITICAL, review finding #1 — the send-recovery half.)
                zonesToRecreate.insert(zoneID)
                if let journeyID = RecordCoder.journeyID(fromZoneID: zoneID) {
                    journeysToPurge.insert(journeyID)
                } else {
                    store.purgeSystemFields(forRecordNames: [failure.record.recordID.recordName])
                }
                rebased.append(.saveRecord(failure.record.recordID))
            case .quotaExceeded:
                // The owner's iCloud is full (QUA-11). Distinct from `.error` on both counts that
                // matter: it is not a fault, and no amount of retrying resolves it — only the user
                // freeing space or buying more does. Before this, the case fell into `default` as
                // "retryable", so the Settings row went on reading "Syncing · last update 3 min
                // ago" while every save was being rejected.
                //
                // Nothing is lost while this is true: local originals are never pruned, and
                // `mediaRepackPending()` is state-derived, so a quota-failed photo is retried on
                // the next activation and lands by itself once space exists. So this is an honesty
                // fix, not a data-loss fix — which is exactly why it was invisible.
                status.set(.storageFull)
            case .serverRejectedRequest, .invalidArguments, .unknownItem:
                // Non-retryable for this record: surface, do not loop.
                status.set(.error(failure.error.localizedDescription))
            default:
                // Retryable/batch errors: CKSyncEngine reschedules automatically.
                break
            }
        }
        // Purge each affected journey's tags exactly once, then recreate its zone, before the
        // records are re-enqueued.
        for journeyID in journeysToPurge { store.purgeSystemFields(forJourneyID: journeyID) }
        if !zonesToRecreate.isEmpty {
            engine?.add(pendingDatabaseChanges: zonesToRecreate.map { .saveZone(CKRecordZone(zoneID: $0)) })
        }
        if !revokedDrops.isEmpty { engine?.remove(pendingRecordZoneChanges: revokedDrops) }
        if !rebased.isEmpty { engine?.add(pendingRecordZoneChanges: rebased) }
        if !saved.isEmpty || !deleted.isEmpty {
            // A save that actually landed is the only evidence that space exists again, so this is
            // where `.storageFull` clears — not in `markSynced`, which fetches also call and which
            // would therefore clear it while uploads were still being rejected (QUA-11).
            status.clearStorageFullOnSuccessfulSave()
            status.markSynced()
        }
    }

    /// Materialize the CKRecords for a set of pending changes. Prefers a rebased record from
    /// the conflict cache; otherwise asks the local store to build it. A `saveRecord` whose
    /// row is gone yields `nil` from the provider and is skipped by the batch.
    func nextBatch(for changes: [CKSyncEngine.PendingRecordZoneChange]) async
        -> CKSyncEngine.RecordZoneChangeBatch? {
        guard !changes.isEmpty else { return nil }
        let cache = mergedRecordCache
        // QUA-08 — this was a real data race, not a warning to satisfy.
        //
        // `recordProvider` is `@Sendable` and CloudKit calls it on its OWN queue, so hoisting
        // `let store = self.store` out and calling `store.makeRecord` inside the closure read the
        // main-QUEUE Core Data context from a cooperative-pool thread. Core Data does not diagnose
        // that; it corrupts quietly. It only became visible once `PersistenceController` and
        // `SyncLocalStore` carried `@MainActor` — which is the whole reason that annotation is worth
        // more than the warning count it moves.
        //
        // The provider is `async`, so the fix is a real hop rather than a suppression: `record(for:)`
        // below is main-actor isolated, and `CKRecord` is `Sendable` in this SDK so the result may
        // cross back out. Behaviour is unchanged — still lazy per record ID, so `RecordZoneChangeBatch`
        // still materializes only what fits CloudKit's per-operation limits and leaves the rest pending.
        let batch = await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { [self] recordID in
            if let merged = cache[recordID] { return merged }
            return await record(for: recordID)
        }
        // Evict ONLY what the batch actually materialized. `RecordZoneChangeBatch` honors
        // CloudKit's per-operation record/byte limits and leaves the overflow pending, so
        // clearing the whole `changes` list threw away rebased records (the ones carrying the
        // server change tag) before they were ever sent — the same save then conflicted,
        // rebased and ping-ponged indefinitely. Very likely during the asset-heavy archive
        // upload, where batches hit the byte ceiling constantly.
        if let batch {
            for record in batch.recordsToSave { mergedRecordCache[record.recordID] = nil }
        }
        return batch
    }

    /// Materialize one pending record on the main actor.
    ///
    /// Exists so `nextBatch`'s `@Sendable` provider closure has something main-actor isolated to
    /// `await` into, instead of reaching a main-queue Core Data context from CloudKit's queue.
    /// Isolation is inherited from the class — the annotation is not repeated. (QUA-08)
    private func record(for recordID: CKRecord.ID) -> CKRecord? {
        store.makeRecord(forRecordName: recordID.recordName, zoneID: recordID.zoneID, existing: nil)
    }

    // MARK: - Helpers

    private func handleAccountChange(_ change: CKSyncEngine.Event.AccountChange) {
        switch change.changeType {
        case .signIn:
            handleAccountSignIn()
        case .signOut:
            accountDidSignOut()
        case .switchAccounts:
            accountDidSwitchAccounts()
        @unknown default:
            break
        }
    }

    /// Handle a `.signIn` account change.
    ///
    /// `CKSyncEngine` posts one immediately after it starts on an already signed-in device —
    /// i.e. while `activate()` is still in flight — so this fires on every ordinary launch, not
    /// only when a user actually signs in. Re-entering `activate()` there is both pointless and
    /// **fatal**: `activate()` awaits `fetchChanges()`, and awaiting into the engine from inside
    /// a delegate callback trips an uncatchable `fatalError` (see `fetchOnActivation`). That
    /// killed the app mid-pull on every clean CloudKit install.
    ///
    /// So only a sign-in that finds the engine stopped reactivates, and it does so detached.
    func handleAccountSignIn() {
        guard !isRunning else {
            SyncLog.log("accountChange(.signIn) ignored: engine already running")
            return
        }
        Task.detached { [weak self] in await self?.accountDidSignIn() }
    }

    /// Sign-in must go back through `activate()`. Only marking the status synced left
    /// `isRunning == false` (cleared on sign-out) while the UI claimed "Syncing with iCloud",
    /// so every local edit made before the next relaunch was silently dropped — and
    /// `activate()` could not recover because `hasActivated` was still true.
    func accountDidSignIn() async {
        hasActivated = false
        isRunning = false
        await activate()
    }

    func accountDidSignOut() {
        // Absent account: stop trusting pending state, but allow a later sign-in to reactivate.
        isRunning = false
        hasActivated = false
        status.set(.noAccount)
    }

    func accountDidSwitchAccounts() {
        isRunning = false
        hasActivated = false
        // A different account's private DB is empty: the initial upload must run again, and
        // the previous account's engine state (change tokens, pending changes) is meaningless.
        initialUploadEnqueued = false
        defaults.removeObject(forKey: Self.didInitialUploadKey)
        Self.discardState()
        // The new account's databases contain NONE of the old account's records, so every persisted
        // change tag is now a dead pointer. Rehydrating one on the re-upload sends an update against
        // a record the server has never seen — `unknownItem` per record, and the whole archive never
        // uploads. Drop them all so the initial upload sends fresh inserts. (review finding #3.)
        store.purgeAllSystemFields()
        // Drop the cached engine so the next `activate()` builds one bound to the new account.
        // Keeping the old instance would let its next `.stateUpdate` re-persist the OLD account's
        // serialization to the state file `discardState()` just deleted.
        engine = nil
        status.set(.noAccount)
    }

    /// One-line description of a sync event for `SyncLog`. Counts matter more than contents:
    /// the question this answers is "which events fire, and with how many records".
    private static func describe(_ event: CKSyncEngine.Event) -> String {
        switch event {
        case .stateUpdate:
            return "stateUpdate"
        case .accountChange(let change):
            return "accountChange(\(change.changeType))"
        case .fetchedDatabaseChanges(let changes):
            let zones = changes.modifications.map { $0.zoneID.zoneName }.joined(separator: ",")
            return "fetchedDatabaseChanges mods=\(changes.modifications.count) dels=\(changes.deletions.count) [\(zones)]"
        case .fetchedRecordZoneChanges(let changes):
            var byType: [String: Int] = [:]
            for modification in changes.modifications {
                byType[modification.record.recordType, default: 0] += 1
            }
            return "fetchedRecordZoneChanges mods=\(changes.modifications.count) dels=\(changes.deletions.count) \(byType)"
        case .sentRecordZoneChanges(let changes):
            return "sentRecordZoneChanges saved=\(changes.savedRecords.count) failedSaves=\(changes.failedRecordSaves.count) deleted=\(changes.deletedRecordIDs.count) failedDeletes=\(changes.failedRecordDeletes.count)"
        case .sentDatabaseChanges(let changes):
            return "sentDatabaseChanges savedZones=\(changes.savedZones.count) failedZoneSaves=\(changes.failedZoneSaves.count)"
        case .willFetchChanges:            return "willFetchChanges"
        case .didFetchChanges:             return "didFetchChanges"
        case .willFetchRecordZoneChanges(let e): return "willFetchRecordZoneChanges(\(e.zoneID.zoneName))"
        case .didFetchRecordZoneChanges(let e):  return "didFetchRecordZoneChanges(\(e.zoneID.zoneName)) error=\(String(describing: e.error))"
        case .willSendChanges:             return "willSendChanges"
        case .didSendChanges:              return "didSendChanges"
        @unknown default:                  return "unknown"
        }
    }

    private static func reason(for reason: CKDatabase.DatabaseChange.Deletion.Reason) -> ZoneDeletionReason {
        switch reason {
        case .deleted:             return .deleted
        case .purged:              return .purged
        case .encryptedDataReset:  return .encryptedDataReset
        @unknown default:          return .unknown
        }
    }

    /// Last-writer-wins rebase: copy our changed field values onto the server record so the
    /// resend adopts the server's change tag while keeping our latest values.
    private func merge(client: CKRecord, onto server: CKRecord) -> CKRecord {
        for key in client.allKeys() { server[key] = client[key] }
        return server
    }

    // MARK: - Engine state persistence

    /// Returns true only when the serialization actually reached disk (the caller uses that to
    /// decide whether the initial-upload flag may be committed).
    @discardableResult
    static func persistState(_ serialization: CKSyncEngine.State.Serialization,
                             scope: CKDatabase.Scope = .private) -> Bool {
        guard let url = stateURL(scope: scope) else { return false }
        do {
            let data = try JSONEncoder().encode(serialization)
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            // State persistence is best-effort; a lost token triggers a full re-fetch next launch.
            return false
        }
    }

    /// Drop the persisted engine state (used when switching accounts). Clears **both** scopes:
    /// a different account's shared-database state is just as meaningless as its private one.
    static func discardState() {
        for scope in [CKDatabase.Scope.private, .shared] {
            guard let url = stateURL(scope: scope) else { continue }
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func loadState(scope: CKDatabase.Scope = .private) -> CKSyncEngine.State.Serialization? {
        guard let url = stateURL(scope: scope), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
    }

    /// `<Application Support>/Akashic/cksyncengine-state[-shared].json`.
    ///
    /// One file per database scope. The two engines hold entirely different change tokens and
    /// pending-change sets; sharing a file would have them overwrite each other's state on every
    /// update, and a restored engine would resume from the other database's token.
    ///
    /// The private scope keeps the original, un-suffixed filename so existing installs restore
    /// their state instead of silently re-fetching the whole archive.
    static func stateURL(scope: CKDatabase.Scope = .private) -> URL? {
        let fm = FileManager.default
        guard let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("Akashic", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let name = scope == .shared ? "cksyncengine-state-shared.json" : "cksyncengine-state.json"
        return dir.appendingPathComponent(name)
    }
}
