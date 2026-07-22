import Foundation
import CloudKit

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
    /// injects one. Only used to enqueue/flush once `isRunning` is true.
    private var engine: SyncEngineProtocol?

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

    /// Handle on the activation pull. Held so a test can await it instead of racing it — the
    /// pull is deliberately detached (see `fetchOnActivation`), so without this a test that
    /// checked "did activation fetch?" passed or failed on timing alone.
    private(set) var activationFetch: Task<Void, Never>?

    /// Await the activation pull, if one is in flight.
    func awaitActivationFetch() async { await activationFetch?.value }

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
         engine: SyncEngineProtocol? = nil) {
        self.store = store
        self.status = status
        self.accountProvider = accountProvider
        self.containerIdentifier = containerIdentifier
        self.databaseScope = databaseScope
        self.defaults = defaults
        self.engine = engine
        super.init()
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
    func handles(journeyID: String) -> Bool {
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
            return
        }

        if engine == nil { engine = buildRealEngine() }
        guard engine != nil else {
            status.set(.error("Could not create the CloudKit sync engine"))
            return
        }

        hasActivated = true
        isRunning = true
        enqueueInitialUploadIfNeeded()
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
        do {
            SyncLog.log("activate: fetchChanges() starting")
            try await engine?.fetchChanges()
            SyncLog.log("activate: fetchChanges() returned")
            status.markSynced()
        } catch {
            SyncLog.error("activate: fetchChanges() threw \(error)")
            status.set(.error("Initial fetch failed: \(error.localizedDescription)"))
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
        var rebased: [CKSyncEngine.PendingRecordZoneChange] = []
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
                // Zone missing server-side: recreate it and resend the record. Needs live-test.
                let zoneID = failure.record.recordID.zoneID
                engine?.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
                rebased.append(.saveRecord(failure.record.recordID))
            case .serverRejectedRequest, .invalidArguments, .unknownItem:
                // Non-retryable for this record: surface, do not loop.
                status.set(.error(failure.error.localizedDescription))
            default:
                // Retryable/batch errors: CKSyncEngine reschedules automatically.
                break
            }
        }
        if !rebased.isEmpty { engine?.add(pendingRecordZoneChanges: rebased) }
        if !saved.isEmpty || !deleted.isEmpty { status.markSynced() }
    }

    /// Materialize the CKRecords for a set of pending changes. Prefers a rebased record from
    /// the conflict cache; otherwise asks the local store to build it. A `saveRecord` whose
    /// row is gone yields `nil` from the provider and is skipped by the batch.
    func nextBatch(for changes: [CKSyncEngine.PendingRecordZoneChange]) async
        -> CKSyncEngine.RecordZoneChangeBatch? {
        guard !changes.isEmpty else { return nil }
        let cache = mergedRecordCache
        let store = self.store
        let batch = await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { recordID in
            if let merged = cache[recordID] { return merged }
            return store.makeRecord(forRecordName: recordID.recordName, zoneID: recordID.zoneID, existing: nil)
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
