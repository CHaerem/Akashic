import Foundation
import CloudKit

/// Seam over the CloudKit database for the v2 media path (MAPPING §13).
///
/// PhotoMedia records (the full-resolution originals) are written, deleted, and fetched **directly**
/// through a `CKDatabase` — NOT through `CKSyncEngine`. The reasoning (documented once, here):
///
///  * The sync engines deliberately EXCLUDE the `-media` zones from every fetch (that is the whole
///    point of the split — first sync ≈ 75 MB). Pushing media records through the engine would
///    make its send/fetch bookkeeping asymmetric: it would track change tags for records it never
///    fetches back, on every device. Direct DB writes keep the engine's world purely metadata.
///  * On-demand originals are a `CKDatabase.records(for:)` by a derived record name — the natural
///    symmetric counterpart to a direct save.
///  * The migration importer already proved chunked `modifyRecords(.allKeys)` at this scale; the
///    repack mirrors it (50/batch), so a direct database is the shape that reuses that machine.
///
/// Everything here is a seam so `PhotoMediaService`, `MediaFetcher`, and `MediaRepackJob` are unit
/// tested against a mock — no container, no iCloud account. The real `CKDatabase`-backed adapter
/// (`CKMediaDatabase`) is compiled only in the entitled `*-CloudKit` build, exactly like every
/// other CloudKit touchpoint (a `CKContainer` traps unentitled).
protocol MediaDatabase: AnyObject, Sendable {

    /// Save/delete media records. Per-record failures are returned (not thrown) so a partial batch
    /// still reports what landed — the caller retries or records the rest, like the importer.
    func modifyMediaRecords(saving: [CKRecord],
                            deleting: [CKRecord.ID]) async throws
        -> (saved: [CKRecord], failed: [(id: CKRecord.ID, error: Error)])

    /// Fetch specific records by id. `desiredKeys == []` fetches metadata only (no asset bytes);
    /// `nil` fetches everything. Ids with no server record are simply absent from the result.
    func fetchMediaRecords(for ids: [CKRecord.ID],
                           desiredKeys: [CKRecord.FieldKey]?) async throws
        -> [CKRecord.ID: CKRecord]

    /// Ensure a media zone exists (idempotent — a save of an existing zone is a no-op server-side).
    func ensureMediaZone(_ zoneID: CKRecordZone.ID) async throws
}

#if AKASHIC_CLOUDKIT_BUILD
/// Real `CKDatabase`-backed implementation. Constructed only in the entitled build; the caller
/// picks `privateCloudDatabase` (owner) or `sharedCloudDatabase` (a journey shared with us).
final class CKMediaDatabase: MediaDatabase {
    private let database: CKDatabase

    init(database: CKDatabase) { self.database = database }

    func modifyMediaRecords(saving: [CKRecord],
                            deleting: [CKRecord.ID]) async throws
        -> (saved: [CKRecord], failed: [(id: CKRecord.ID, error: Error)]) {
        // `.allKeys` + `atomically: false`: media records carry the byte-for-byte current original,
        // so overwriting is correct, and a partial failure must not roll back the ones that saved.
        let (saveResults, _) = try await database.modifyRecords(
            saving: saving, deleting: deleting, savePolicy: .allKeys, atomically: false)
        var saved: [CKRecord] = []
        var failed: [(id: CKRecord.ID, error: Error)] = []
        for (id, result) in saveResults {
            switch result {
            case .success(let record): saved.append(record)
            case .failure(let error): failed.append((id, error))
            }
        }
        return (saved, failed)
    }

    func fetchMediaRecords(for ids: [CKRecord.ID],
                           desiredKeys: [CKRecord.FieldKey]?) async throws
        -> [CKRecord.ID: CKRecord] {
        guard !ids.isEmpty else { return [:] }
        let results = try await database.records(for: ids, desiredKeys: desiredKeys)
        var out: [CKRecord.ID: CKRecord] = [:]
        for (id, result) in results {
            if case .success(let record) = result { out[id] = record }
        }
        return out
    }

    func ensureMediaZone(_ zoneID: CKRecordZone.ID) async throws {
        _ = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: zoneID)], deleting: [])
    }
}
#endif
