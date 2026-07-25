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

    /// Persist the encoded CloudKit system fields (identity + change tag) for records the server
    /// just accepted, so a later edit of the same row is sent as an update rather than an insert
    /// that always conflicts (server error 14). This is what makes the SECOND edit of a locally
    /// created record carry a tag — the fetch-apply path only ever sees records the server
    /// originated, never ones this device just uploaded.
    func recordsDidSave(_ records: [CKRecord])

    /// Drop the persisted system fields for records the server just deleted (local deletes that
    /// landed), so a row later re-created under the same name is not rehydrated onto a dead tag.
    func recordsDidDelete(_ recordIDs: [CKRecord.ID])

    /// Purge the persisted system fields (change tags) for a journey and **all** its child
    /// records (waypoints / photos / comments).
    ///
    /// Called when a zone vanishes server-side (`handleZoneDeletions`, or the `.zoneNotFound`
    /// send-recovery): the zone is gone or about to be recreated empty, so the protective
    /// re-upload must send every record as a FRESH insert. A rehydrated dead change tag would
    /// make the save fail permanently with `unknownItem` ("record not found"), silently losing
    /// the CloudKit mirror of the journey. Does not delete any domain data.
    func purgeSystemFields(forJourneyID journeyID: String)

    /// Purge the persisted system fields for a specific set of record names (no-op for names
    /// with no row). The record-name-granular counterpart to `purgeSystemFields(forJourneyID:)`.
    func purgeSystemFields(forRecordNames names: [String])

    /// Purge **every** persisted system-fields row. Used on an account switch: the new account's
    /// databases hold none of these records, so every retained change tag is a dead pointer that
    /// would make the whole archive's re-upload fail with `unknownItem`.
    func purgeAllSystemFields()

    /// Bracket a batch of fetched-change applications so the store can suppress the local-save
    /// echo (`beginRemoteApply`) and commit once (`endRemoteApply`).
    func beginRemoteApply()
    func endRemoteApply()

    /// Every journey id currently in the local store (for the initial upload + zone creation).
    func allLocalJourneyIDs() -> [String]

    /// Count of photos currently in the local store. Drives the first-sync prompt's
    /// fresh-install-vs-incremental classification (an empty/near-empty store == fresh install).
    func localPhotoCount() -> Int

    /// Whether the store has ever seen a server copy of this record — i.e. persisted CloudKit
    /// system fields (a change tag) for it. False for a record created purely locally that has
    /// never been uploaded. Used by the activation heal to find owned journeys that never reached
    /// CloudKit (e.g. created while the engine was stopped) and re-enqueue them.
    func hasUploadedRecord(forRecordName recordName: String) -> Bool

    /// The CloudKit zone owner for a journey, or nil when we own it ourselves.
    ///
    /// This is what routes a journey to the right database (T2.8): ours live in the private
    /// database under `CKCurrentUserDefaultName`, a journey shared with us lives in the shared
    /// database under the *sharing owner's* record name, and its zone id must carry that name
    /// or every read and write misses.
    func zoneOwnerName(forJourneyID journeyID: String) -> String?

    /// All record identities for a journey in dependency order (journey root → waypoints →
    /// photos → comments) — used to enqueue a journey's initial upload.
    func recordIdentities(forJourneyID journeyID: String) -> [LocalChange]

    /// Whether this journey is the bundled demo sample (D9) — or, in `.fixtures` dev mode, one of
    /// the bundled dev fixtures — rather than the family's own content. `handles(journeyID:)` is
    /// the ONE place this is consulted, and every sync path (the initial bulk upload, the
    /// activation heal for a never-uploaded journey, and every observed local write) already
    /// funnels through `handles`, so gating there is what makes "never syncs" hold everywhere at
    /// once instead of needing a matching guard at each call site.
    func isSeededFixture(journeyID: String) -> Bool
}
