import XCTest
import CloudKit
@testable import Akashic

/// `AkashicSyncEngine` coordinator logic, exercised entirely against seam mocks — no live
/// container, no iCloud account. Covers: account gating, pending-change enqueue on local
/// writes, fetched-change routing, and the `serverRecordChanged` conflict-rebase path.
@MainActor
final class SyncEngineTests: XCTestCase {

    private let zoneName = "journey-j1"

    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: "sync-test-\(UUID().uuidString)")!
    }

    private func makeEngine(account: CKAccountStatus,
                            store: FakeLocalStore = FakeLocalStore(),
                            mock: MockSyncEngine = MockSyncEngine(),
                            status: SyncStatus = SyncStatus())
        -> (AkashicSyncEngine, MockSyncEngine, FakeLocalStore, SyncStatus) {
        let engine = AkashicSyncEngine(
            store: store,
            status: status,
            accountProvider: MockAccountProvider(status: account),
            defaults: makeDefaults(),
            engine: mock)
        return (engine, mock, store, status)
    }

    // MARK: - Account gating

    func testActivateWithNoAccountKeepsEngineOff() async {
        let store = FakeLocalStore()
        store.journeyIDs = ["j1"]
        store.identities["j1"] = [LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                                              recordName: "j1", journeyID: "j1")]
        let (engine, mock, _, status) = makeEngine(account: .noAccount, store: store)

        await engine.activate()

        XCTAssertFalse(engine.isRunning, "no account -> engine stays off")
        XCTAssertEqual(status.state, .noAccount)
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty, "no records enqueued without an account")
        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty, "no zones enqueued without an account")
    }

    func testActivateWithAvailableAccountEnqueuesInitialUpload() async {
        let store = FakeLocalStore()
        store.journeyIDs = ["j1"]
        store.identities["j1"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.waypoint, recordName: "w1", journeyID: "j1"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo, recordName: "p1", journeyID: "j1"),
        ]
        let (engine, mock, _, status) = makeEngine(account: .available, store: store)

        await engine.activate()

        XCTAssertTrue(engine.isRunning)
        XCTAssertTrue(status.isActive)
        // One zone-save for the journey.
        XCTAssertEqual(mock.pendingDatabaseChanges.count, 1)
        XCTAssertEqual(mock.savedZoneNames, ["journey-j1"])
        // Three record saves (journey + waypoint + photo).
        XCTAssertEqual(mock.savedRecordNames.sorted(), ["j1", "p1", "w1"])
    }

    // MARK: - Local write intake

    func testLocalWriteEnqueuesPendingChanges() async {
        // Empty store => activation enqueues nothing, giving a clean slate to observe writes.
        let (engine, mock, _, _) = makeEngine(account: .available)
        await engine.activate()
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty)

        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo, recordName: "p9", journeyID: "j1"),
        ])
        XCTAssertEqual(mock.savedZoneNames, ["journey-j1"], "new journey root -> zone save")
        XCTAssertEqual(mock.savedRecordNames.sorted(), ["j1", "p9"])

        engine.localStoreDidChange([
            LocalChange(kind: .delete, recordType: RecordCoder.RecordType.photo, recordName: "p9", journeyID: "j1"),
        ])
        XCTAssertEqual(mock.deletedRecordNames, ["p9"])
        XCTAssertEqual(mock.savedZoneNames, ["journey-j1"], "a photo delete does not add a zone save")
    }

    func testLocalWriteIgnoredWhenEngineNotRunning() async {
        let (engine, mock, _, _) = makeEngine(account: .noAccount)
        await engine.activate()   // not running
        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
        ])
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty)
        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty)
    }

    // MARK: - Fetched change routing

    func testFetchedChangesUpsertAndDeleteThroughStore() async {
        let (engine, _, store, status) = makeEngine(account: .available)
        await engine.activate()

        let journeyRecord = CKRecord(recordType: "Journey",
                                     recordID: CKRecord.ID(recordName: "j1",
                                                           zoneID: RecordCoder.zoneID(forJourneyID: "j1")))
        journeyRecord["name"] = "Fetched Journey"

        engine.handleFetchedChanges(modifications: [journeyRecord],
                                    deletions: [(recordName: "p1", recordType: "Photo")])

        XCTAssertEqual(store.appliedRecordNames, ["j1"], "modification -> applyFetchedRecord")
        XCTAssertEqual(store.deletedRecords.map { $0.recordType }, ["Photo"])
        XCTAssertEqual(store.beginCount, 1, "wrapped in begin/endRemoteApply (echo suppression)")
        XCTAssertEqual(store.endCount, 1)
        XCTAssertTrue(status.isActive)
    }

    // MARK: - Zone deletion (data-safety: NEVER delete local data)

    /// REWRITTEN (was `testZoneDeletionDeletesJourneyLocally`, which locked in the cascade that
    /// wiped a whole journey — waypoints, photos, comments — off the device whenever its zone
    /// vanished server-side. The local store is the authoritative archive; a missing zone means
    /// re-upload the mirror, not destroy the original.)
    func testZoneDeletionReEnqueuesMirrorAndDeletesNothingLocally() async {
        let store = FakeLocalStore()
        store.journeyIDs = ["j7"]
        store.identities["j7"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j7", journeyID: "j7"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.waypoint, recordName: "w7", journeyID: "j7"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo, recordName: "p7", journeyID: "j7"),
        ]
        let (engine, mock, _, _) = makeEngine(account: .available, store: store)
        await engine.activate()
        mock.reset()   // ignore the initial-upload enqueue

        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "j7")], reason: .deleted)

        XCTAssertTrue(store.deletedRecords.isEmpty, "a server-side zone deletion must NEVER delete local data")
        XCTAssertEqual(store.beginCount, 0, "no local mutation at all")
        XCTAssertEqual(mock.savedZoneNames, ["journey-j7"], "the zone is recreated")
        XCTAssertEqual(mock.savedRecordNames.sorted(), ["j7", "p7", "w7"], "the whole journey is re-uploaded")
    }

    /// Purges / encrypted-data resets are the classic "iCloud lost it, the device still has it"
    /// case — they must behave identically (re-upload, never delete).
    func testZoneDeletionByPurgeAlsoReEnqueues() async {
        let store = FakeLocalStore()
        store.identities["j7"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j7", journeyID: "j7"),
        ]
        let (engine, mock, _, _) = makeEngine(account: .available, store: store)
        await engine.activate()
        mock.reset()

        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "j7")], reason: .purged)

        XCTAssertTrue(store.deletedRecords.isEmpty)
        XCTAssertEqual(mock.savedRecordNames, ["j7"])
    }

    /// Even with the (default-off) honoring seam enabled, a purge must not delete — and the
    /// confirmation callback decides for a genuine delete.
    func testHonoredZoneDeletionRequiresRealDeleteAndConfirmation() async {
        let store = FakeLocalStore()
        store.identities["j7"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j7", journeyID: "j7"),
        ]
        let (engine, _, _, _) = makeEngine(account: .available, store: store)
        await engine.activate()
        engine.honorsRemoteZoneDeletion = true
        engine.confirmZoneDeletion = { _ in false }

        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "j7")], reason: .purged)
        XCTAssertTrue(store.deletedRecords.isEmpty, "purge is never a delete")

        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "j7")], reason: .deleted)
        XCTAssertTrue(store.deletedRecords.isEmpty, "unconfirmed delete does nothing")

        engine.confirmZoneDeletion = { _ in true }
        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "j7")], reason: .deleted)
        XCTAssertEqual(store.deletedRecords.first?.recordName, "j7",
                       "explicitly confirmed genuine delete is honored")
    }

    func testZoneDeletionForUnknownJourneyIsANoOp() async {
        let (engine, mock, store, _) = makeEngine(account: .available)
        await engine.activate()
        mock.reset()

        engine.handleZoneDeletions([RecordCoder.zoneID(forJourneyID: "not-local")], reason: .deleted)

        XCTAssertTrue(store.deletedRecords.isEmpty)
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty)
        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty)
    }

    // MARK: - Activation pull + the sign-in re-entrancy guard (T2.4 live-test regressions)

    /// The pull that makes a fresh install populate at all. A clean `.cloudKit` install has no
    /// change token, so this single call is what discovers the zones and every record in them;
    /// the Simulator never receives the silent push that would otherwise trigger it.
    func testActivationPullFetchesOnce() async {
        let (engine, mock, _, _) = makeEngine(account: .available)
        await engine.activate()

        // Await the pull rather than racing it: it runs in a detached task, so calling
        // `fetchOnActivation()` again here counted either one fetch or two depending on
        // scheduling — the test itself was the flake.
        await engine.awaitActivationFetch()

        XCTAssertEqual(mock.fetchCount, 1, "activation must pull explicitly")
    }

    /// Regression, live-found: `CKSyncEngine` posts `.signIn` right after it starts on an
    /// already signed-in device — while `activate()` is still running. The old handler
    /// re-entered `activate()` from inside the delegate callback, and awaiting into the engine
    /// from there is an uncatchable `fatalError` ("Cannot await a call into CKSyncEngine from
    /// within a delegate callback"). The app died mid-pull on every clean CloudKit install, with
    /// the UI still claiming "Syncing".
    func testSignInWhileAlreadyRunningDoesNotReactivate() async {
        let (engine, mock, _, _) = makeEngine(account: .available)
        await engine.activate()
        await engine.awaitActivationFetch()
        let fetchesAfterActivation = mock.fetchCount

        engine.handleAccountSignIn()

        XCTAssertTrue(engine.isRunning)
        XCTAssertEqual(mock.fetchCount, fetchesAfterActivation,
                       "a redundant sign-in must not re-enter activation")
    }

    /// The guard must not break the real case: a sign-in that finds the engine stopped still
    /// reactivates it (that path is covered end-to-end by `testSignOutThenSignInResumesEnqueueing`).
    func testSignInAfterSignOutIsNotSuppressed() async {
        let (engine, _, _, _) = makeEngine(account: .available)
        await engine.activate()
        engine.accountDidSignOut()
        XCTAssertFalse(engine.isRunning)

        await engine.accountDidSignIn()

        XCTAssertTrue(engine.isRunning, "a genuine sign-in must still reactivate")
    }

    /// The UI does not observe Core Data; it publishes a snapshot taken by `JourneyStore.reload()`.
    /// This callback is the only thing that re-takes that snapshot after a pull, so a clean
    /// install showed "No journeys" over a fully populated store without it.
    func testAppliedRemoteChangesNotifyObservers() async {
        let (engine, _, _, _) = makeEngine(account: .available)
        await engine.activate()
        var notifications = 0
        engine.onRemoteChangesApplied = { notifications += 1 }

        let record = CKRecord(recordType: RecordCoder.RecordType.journey,
                              recordID: CKRecord.ID(recordName: "j1",
                                                    zoneID: CKRecordZone.ID(zoneName: zoneName)))
        engine.handleFetchedChanges(modifications: [record], deletions: [])

        XCTAssertEqual(notifications, 1, "each applied batch must re-publish the UI snapshot")
    }

    // MARK: - Account changes

    /// Sign-out then sign-in used to leave `isRunning == false` while the status read
    /// "Syncing with iCloud" — every edit made until the next relaunch was dropped silently.
    func testSignOutThenSignInResumesEnqueueing() async {
        let (engine, mock, _, status) = makeEngine(account: .available)
        await engine.activate()
        mock.reset()

        engine.accountDidSignOut()
        XCTAssertFalse(engine.isRunning)
        XCTAssertEqual(status.state, .noAccount)
        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
        ])
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty, "signed out -> nothing enqueued")

        await engine.accountDidSignIn()
        XCTAssertTrue(engine.isRunning, "sign-in must re-run activation, not just mark synced")
        XCTAssertTrue(status.isActive)

        mock.reset()
        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
        ])
        XCTAssertEqual(mock.savedRecordNames, ["j1"], "local writes are enqueued again after sign-in")
    }

    /// A different account has an empty private DB, so the full archive must be uploaded again.
    func testSwitchAccountsClearsInitialUploadFlagAndReUploads() async {
        let defaults = makeDefaults()
        let store = FakeLocalStore()
        store.journeyIDs = ["j1"]
        store.identities["j1"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
        ]
        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(store: store, status: SyncStatus(),
                                       accountProvider: MockAccountProvider(status: .available),
                                       defaults: defaults, engine: mock)
        await engine.activate()
        XCTAssertEqual(mock.savedRecordNames, ["j1"])
        defaults.set(true, forKey: "akashic.sync.didInitialUpload")   // simulate a confirmed upload

        engine.accountDidSwitchAccounts()
        XCTAssertFalse(defaults.bool(forKey: "akashic.sync.didInitialUpload"))

        mock.reset()
        await engine.accountDidSignIn()
        XCTAssertEqual(mock.savedRecordNames, ["j1"], "new account gets the whole archive again")
    }

    /// The flag must not be committed until CKSyncEngine reports its pending state is durable,
    /// otherwise a kill in that window skips the archive upload forever.
    func testInitialUploadFlagIsNotCommittedAtEnqueueTime() async {
        let defaults = makeDefaults()
        let store = FakeLocalStore()
        store.journeyIDs = ["j1"]
        store.identities["j1"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j1", journeyID: "j1"),
        ]
        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(store: store, status: SyncStatus(),
                                       accountProvider: MockAccountProvider(status: .available),
                                       defaults: defaults, engine: mock)
        await engine.activate()

        XCTAssertFalse(defaults.bool(forKey: "akashic.sync.didInitialUpload"),
                       "flag stays unset until the engine persists its state")
    }

    // MARK: - Conflict resolution (serverRecordChanged -> rebase onto server record)

    func testServerRecordChangedRebasesAndReenqueues() async throws {
        let (engine, mock, _, _) = makeEngine(account: .available)
        await engine.activate()
        mock.reset()   // clear any activation noise

        let recordID = CKRecord.ID(recordName: "j1", zoneID: RecordCoder.zoneID(forJourneyID: "j1"))
        let clientRecord = CKRecord(recordType: "Journey", recordID: recordID)
        clientRecord["name"] = "Local edit"          // our value should win on the resend
        let serverRecord = CKRecord(recordType: "Journey", recordID: recordID)
        serverRecord["name"] = "Server value"
        serverRecord["country"] = "Tanzania"         // a field only the server had

        let error = Self.serverRecordChanged(server: serverRecord, client: clientRecord)
        engine.handleSentChanges(saved: [], failed: [(record: clientRecord, error: error)], deleted: [])

        // The conflicted record is re-enqueued for resend.
        XCTAssertEqual(mock.savedRecordNames, ["j1"], "conflict -> re-enqueue the record")

        // The next batch resends the MERGED record: our value on top of the server record.
        let batch = await engine.nextBatch(for: [.saveRecord(recordID)])
        let merged = try XCTUnwrap(batch?.recordsToSave.first { $0.recordID == recordID })
        XCTAssertEqual(merged["name"] as? String, "Local edit", "last-writer-wins: our value kept")
        XCTAssertEqual(merged["country"] as? String, "Tanzania", "rebased onto the server record")
    }

    // MARK: - Batch materialization

    func testNextBatchUsesStoreRecordsAndSkipsMissing() async {
        let store = FakeLocalStore()
        let present = CKRecord(recordType: "Journey",
                               recordID: CKRecord.ID(recordName: "j1",
                                                     zoneID: RecordCoder.zoneID(forJourneyID: "j1")))
        store.records["j1"] = present
        let (engine, _, _, _) = makeEngine(account: .available, store: store)
        await engine.activate()

        let presentID = present.recordID
        let missingID = CKRecord.ID(recordName: "gone", zoneID: RecordCoder.zoneID(forJourneyID: "j1"))
        let batch = await engine.nextBatch(for: [.saveRecord(presentID), .saveRecord(missingID)])

        XCTAssertEqual(batch?.recordsToSave.map { $0.recordID.recordName }, ["j1"],
                       "present record built; missing row skipped")
    }

    /// A rebased record that overflowed the batch (CloudKit caps records/bytes per operation)
    /// must stay in the merge cache. Evicting it dropped the only copy carrying the server's
    /// change tag, so the save conflicted, rebased and ping-ponged without converging.
    func testNextBatchKeepsMergedRecordsThatOverflowedTheBatch() async {
        let (engine, _, _, _) = makeEngine(account: .available)
        await engine.activate()

        let zone = RecordCoder.zoneID(forJourneyID: "j1")
        var ids: [CKRecord.ID] = []
        for index in 0..<600 {
            let id = CKRecord.ID(recordName: "r\(index)", zoneID: zone)
            ids.append(id)
            let client = CKRecord(recordType: "Journey", recordID: id)
            client["name"] = "local \(index)"
            let server = CKRecord(recordType: "Journey", recordID: id)
            server["country"] = "Tanzania"
            engine.handleSentChanges(
                saved: [], failed: [(record: client, error: Self.serverRecordChanged(server: server, client: client))],
                deleted: [])
        }
        XCTAssertEqual(engine.pendingMergedRecordIDs.count, 600)

        let batch = await engine.nextBatch(for: ids.map { .saveRecord($0) })
        let sent = Set(batch?.recordsToSave.map { $0.recordID } ?? [])
        XCTAssertLessThan(sent.count, 600, "precondition: CloudKit truncates a 600-record batch")

        let remaining = engine.pendingMergedRecordIDs
        XCTAssertEqual(remaining, Set(ids).subtracting(sent),
                       "exactly the records the batch did not materialize stay cached")
        XCTAssertTrue(remaining.isDisjoint(with: sent), "sent records are evicted")
    }

    // MARK: - Entitlement gate (regression for the CKContainer-without-entitlement SIGTRAP)

    /// The unit target builds under Debug (no `AKASHIC_CLOUDKIT_BUILD`), so the real provider
    /// MUST be the no-op variant that never constructs a CKContainer (which would trap).
    func testAccountProviderIsNoOpInNonCloudKitBuild() async {
        let provider = CloudKitAccountStatusProvider(containerIdentifier: "iCloud.no.akashic")
        let status = await provider.accountStatus()
        #if AKASHIC_CLOUDKIT_BUILD
        _ = status   // entitled build: value depends on the environment; asserting it returns is enough
        #else
        XCTAssertEqual(status, .couldNotDetermine, "no-op provider must not touch CloudKit")
        #endif
    }

    /// Real provider + no injected engine (the production shape) under the Debug test build:
    /// `activate()` must return safely, engine off, without ever constructing a CKContainer.
    func testActivateWithRealProviderStaysSafeInNonCloudKitBuild() async {
        let engine = AkashicSyncEngine(
            store: FakeLocalStore(),
            status: SyncStatus(),
            accountProvider: CloudKitAccountStatusProvider(containerIdentifier: "iCloud.no.akashic"),
            defaults: makeDefaults())   // no injected engine -> would hit buildRealEngine if account available
        await engine.activate()
        XCTAssertFalse(engine.isRunning, "no entitlement / no account -> engine stays off, no crash")
    }

    // MARK: - CKError builder

    private static func serverRecordChanged(server: CKRecord, client: CKRecord) -> CKError {
        let nsError = NSError(domain: CKErrorDomain,
                              code: CKError.Code.serverRecordChanged.rawValue,
                              userInfo: [
                                CKRecordChangedErrorServerRecordKey: server,
                                CKRecordChangedErrorClientRecordKey: client,
                              ])
        return nsError as! CKError
    }
}

// MARK: - Seam mocks

/// Recording mock for `SyncEngineProtocol`.
final class MockSyncEngine: SyncEngineProtocol {
    private(set) var pendingRecordZoneChanges: [CKSyncEngine.PendingRecordZoneChange] = []
    private(set) var pendingDatabaseChanges: [CKSyncEngine.PendingDatabaseChange] = []
    private(set) var sendCount = 0
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
    func sendChanges() async throws { sendCount += 1 }
    func fetchChanges() async throws { fetchCount += 1 }

    func reset() {
        pendingRecordZoneChanges = []
        pendingDatabaseChanges = []
    }

    // Convenience projections for assertions.
    var savedZoneNames: [String] {
        pendingDatabaseChanges.compactMap { if case .saveZone(let z) = $0 { return z.zoneID.zoneName } else { return nil } }
    }
    var savedRecordNames: [String] {
        pendingRecordZoneChanges.compactMap { if case .saveRecord(let id) = $0 { return id.recordName } else { return nil } }
    }
    var deletedRecordNames: [String] {
        pendingRecordZoneChanges.compactMap { if case .deleteRecord(let id) = $0 { return id.recordName } else { return nil } }
    }
}

/// Recording fake for `SyncLocalStore`.
final class FakeLocalStore: SyncLocalStore {
    var journeyIDs: [String] = []
    var identities: [String: [LocalChange]] = [:]
    var records: [String: CKRecord] = [:]
    /// journeyID -> sharing owner. Absent means we own it (private database).
    var zoneOwners: [String: String] = [:]

    private(set) var appliedRecords: [CKRecord] = []
    private(set) var deletedRecords: [(recordName: String, recordType: String)] = []
    private(set) var beginCount = 0
    private(set) var endCount = 0

    var appliedRecordNames: [String] { appliedRecords.map { $0.recordID.recordName } }

    func makeRecord(forRecordName recordName: String, zoneID: CKRecordZone.ID, existing: CKRecord?) -> CKRecord? {
        records[recordName]
    }
    func applyFetchedRecord(_ record: CKRecord) { appliedRecords.append(record) }
    func applyDeletedRecord(recordName: String, recordType: String) {
        deletedRecords.append((recordName, recordType))
    }
    func allLocalJourneyIDs() -> [String] { journeyIDs }
    func zoneOwnerName(forJourneyID journeyID: String) -> String? { zoneOwners[journeyID] }
    func recordIdentities(forJourneyID journeyID: String) -> [LocalChange] { identities[journeyID] ?? [] }
    func beginRemoteApply() { beginCount += 1 }
    func endRemoteApply() { endCount += 1 }
}

/// Injectable account status.
struct MockAccountProvider: AccountStatusProviding {
    let status: CKAccountStatus
    func accountStatus() async -> CKAccountStatus { status }
}
