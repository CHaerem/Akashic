import Foundation
import CloudKit

/// A local-store mutation the scheduler observed, expressed in sync terms. The coordinator
/// turns each into a pending record-zone change (plus a zone-save for a new journey root).
struct LocalChange: Equatable {
    enum Kind: Equatable { case save, delete }

    let kind: Kind
    let recordType: String   // one of RecordCoder.RecordType.*
    let recordName: String   // the domain UUID (== CKRecord recordName)
    let journeyID: String    // zone routing: journey-<journeyID>

    var isJourneyRoot: Bool { recordType == RecordCoder.RecordType.journey }

    func recordID(ownerName: String = CKCurrentUserDefaultName) -> CKRecord.ID {
        CKRecord.ID(recordName: recordName,
                    zoneID: RecordCoder.zoneID(forJourneyID: journeyID, ownerName: ownerName))
    }
}

// MARK: - Engine seam

/// Seam over the underlying `CKSyncEngine` so the coordinator's enqueue / flush logic is
/// testable against a mock. Only the surface the coordinator actually drives is exposed;
/// the real implementation is `CKSyncEngineAdapter`, tests inject a recording mock.
protocol SyncEngineProtocol: AnyObject {
    var pendingRecordZoneChanges: [CKSyncEngine.PendingRecordZoneChange] { get }
    var pendingDatabaseChanges: [CKSyncEngine.PendingDatabaseChange] { get }

    func add(pendingDatabaseChanges changes: [CKSyncEngine.PendingDatabaseChange])
    func add(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange])
    func remove(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange])

    func sendChanges() async throws
    func fetchChanges() async throws
}

/// Wraps a real `CKSyncEngine` behind `SyncEngineProtocol`. Constructed only when an iCloud
/// account is available and CloudKit is enabled (see `AkashicSyncEngine.activate`).
final class CKSyncEngineAdapter: SyncEngineProtocol {
    let engine: CKSyncEngine

    init(_ engine: CKSyncEngine) { self.engine = engine }

    var pendingRecordZoneChanges: [CKSyncEngine.PendingRecordZoneChange] {
        engine.state.pendingRecordZoneChanges
    }
    var pendingDatabaseChanges: [CKSyncEngine.PendingDatabaseChange] {
        engine.state.pendingDatabaseChanges
    }

    func add(pendingDatabaseChanges changes: [CKSyncEngine.PendingDatabaseChange]) {
        engine.state.add(pendingDatabaseChanges: changes)
    }
    func add(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        engine.state.add(pendingRecordZoneChanges: changes)
    }
    func remove(pendingRecordZoneChanges changes: [CKSyncEngine.PendingRecordZoneChange]) {
        engine.state.remove(pendingRecordZoneChanges: changes)
    }

    func sendChanges() async throws { try await engine.sendChanges() }
    func fetchChanges() async throws { try await engine.fetchChanges() }
}

// MARK: - Local store seam

/// Seam over the local Core Data store so the coordinator can (a) materialize a `CKRecord`
/// for a pending upload and (b) apply fetched server records — without the coordinator
/// knowing Core Data. Implemented by `PersistenceController` (see `PersistenceController+Sync`).
protocol SyncLocalStore: AnyObject {
    /// Build the `CKRecord` for a pending upload by record name; nil if the row is gone
    /// (the coordinator then drops the pending save). `existing` carries a server-provided
    /// base record — its change tag — when rebasing a conflicted change onto the server copy.
    func makeRecord(forRecordName recordName: String,
                    zoneID: CKRecordZone.ID,
                    existing: CKRecord?) -> CKRecord?

    /// Upsert a fetched server record into the local store (server-authoritative).
    func applyFetchedRecord(_ record: CKRecord)

    /// Apply a fetched server deletion by record name + type.
    func applyDeletedRecord(recordName: String, recordType: String)

    /// Bracket a batch of fetched-change applications so the store can suppress the local-save
    /// echo (`beginRemoteApply`) and commit once (`endRemoteApply`).
    func beginRemoteApply()
    func endRemoteApply()

    /// Every journey id currently in the local store (for the initial upload + zone creation).
    func allLocalJourneyIDs() -> [String]

    /// All record identities for a journey in dependency order (journey root → waypoints →
    /// photos → comments) — used to enqueue a journey's initial upload.
    func recordIdentities(forJourneyID journeyID: String) -> [LocalChange]
}
