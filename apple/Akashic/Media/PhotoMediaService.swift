import Foundation
import CloudKit

/// One photo's original, ready to become a `PhotoMedia` record. `ownerName` routes the media zone
/// to the right database (owner = `CKCurrentUserDefaultName`; a journey shared with us = the
/// sharing owner's record name), exactly like the journey-zone routing.
struct MediaUploadItem: Equatable {
    let photoID: String
    let journeyID: String
    /// Canonical on-disk path to the original bytes (nil / missing → skipped, never a failure).
    let originalPath: String?
    let ownerName: String

    init(photoID: String, journeyID: String, originalPath: String?,
         ownerName: String = CKCurrentUserDefaultName) {
        self.photoID = photoID
        self.journeyID = journeyID
        self.originalPath = originalPath
        self.ownerName = ownerName
    }
}

/// Outcome of a PhotoMedia upload batch.
struct PhotoMediaUploadResult: Equatable {
    /// Records the server accepted (keyed for the caller to persist `media-<id>` completion meta).
    var savedRecords: [CKRecord] = []
    /// Photo ids skipped because their local original bytes were missing (participant device, a
    /// partial store) — reported, never a hard failure. The owner's complete device does the work.
    var skippedMissingBytes: [String] = []
    /// Photo ids that failed to save (transient or permanent) — the caller may retry later.
    var failedPhotoIDs: [String] = []

    var savedPhotoIDs: [String] {
        savedRecords.compactMap { RecordCoder.photoID(fromMediaRecordName: $0.recordID.recordName) }
    }

    static func == (lhs: PhotoMediaUploadResult, rhs: PhotoMediaUploadResult) -> Bool {
        lhs.savedPhotoIDs.sorted() == rhs.savedPhotoIDs.sorted()
            && lhs.skippedMissingBytes.sorted() == rhs.skippedMissingBytes.sorted()
            && lhs.failedPhotoIDs.sorted() == rhs.failedPhotoIDs.sorted()
    }
}

/// Writes and deletes `PhotoMedia` records (the v2 originals) DIRECTLY through a `MediaDatabase`,
/// chunked like the migration importer (default 50/batch). Used by three callers:
///   * ingest — a newly picked photo's original goes up as a PhotoMedia record (its Photo record
///     carries only the thumbnail, enqueued separately through the engine);
///   * delete — a deleted photo's PhotoMedia record is removed alongside its Photo/public mirror;
///   * the repack + media-zone-loss heal — bulk-upload from local bytes.
///
/// The service itself does NOT consult the Wi-Fi policy: a single user-initiated ingest (~4 MB) is
/// always allowed, and the batch repack does its own Wi-Fi gating before calling in (MAPPING §13).
final class PhotoMediaService {

    private let database: MediaDatabase
    private let batchSize: Int
    private let fileManager: FileManager

    init(database: MediaDatabase, batchSize: Int = 50, fileManager: FileManager = .default) {
        self.database = database
        self.batchSize = max(1, batchSize)
        self.fileManager = fileManager
    }

    /// Upload PhotoMedia records for the given items. Ensures each journey's media zone exists
    /// first, skips items whose local bytes are missing, and chunks the rest per media zone.
    @discardableResult
    func upload(_ items: [MediaUploadItem]) async -> PhotoMediaUploadResult {
        var result = PhotoMediaUploadResult()
        guard !items.isEmpty else { return result }

        // Split into "has readable bytes" vs "skip". A missing original is not a failure — the
        // owner's complete device repacks; other devices just see Photo.original go nil and fetch.
        var uploadable: [MediaUploadItem] = []
        for item in items {
            if let path = item.originalPath, fileManager.fileExists(atPath: path) {
                uploadable.append(item)
            } else {
                result.skippedMissingBytes.append(item.photoID)
            }
        }

        // Group by media zone so a batch never spans zones and each zone is ensured once.
        let byZone = Dictionary(grouping: uploadable) {
            RecordCoder.mediaZoneID(forJourneyID: $0.journeyID, ownerName: $0.ownerName)
        }
        for (zoneID, zoneItems) in byZone {
            do {
                try await database.ensureMediaZone(zoneID)
            } catch {
                SyncLog.error("PhotoMediaService: could not ensure media zone \(zoneID.zoneName): \(error)")
                result.failedPhotoIDs.append(contentsOf: zoneItems.map(\.photoID))
                continue
            }
            for chunk in zoneItems.chunked(into: batchSize) {
                let records = chunk.map {
                    RecordCoder.recordForPhotoMedia(photoID: $0.photoID, journeyID: $0.journeyID,
                                                    in: zoneID, originalPath: $0.originalPath)
                }
                do {
                    let (saved, failed) = try await database.modifyMediaRecords(saving: records, deleting: [])
                    result.savedRecords.append(contentsOf: saved)
                    for failure in failed {
                        if let pid = RecordCoder.photoID(fromMediaRecordName: failure.id.recordName) {
                            result.failedPhotoIDs.append(pid)
                        }
                    }
                } catch {
                    SyncLog.error("PhotoMediaService: batch save failed in \(zoneID.zoneName): \(error)")
                    result.failedPhotoIDs.append(contentsOf: chunk.map(\.photoID))
                }
            }
        }
        return result
    }

    /// Delete the PhotoMedia records for the given photo ids in a journey's media zone. Best-effort
    /// and failure-tolerant (a missing record is a success — nothing to remove).
    func delete(photoIDs: [String], journeyID: String,
                ownerName: String = CKCurrentUserDefaultName) async {
        guard !photoIDs.isEmpty else { return }
        let zoneID = RecordCoder.mediaZoneID(forJourneyID: journeyID, ownerName: ownerName)
        let ids = photoIDs.map {
            CKRecord.ID(recordName: RecordCoder.mediaRecordName(forPhotoID: $0), zoneID: zoneID)
        }
        for chunk in ids.chunked(into: batchSize) {
            do {
                _ = try await database.modifyMediaRecords(saving: [], deleting: chunk)
            } catch {
                SyncLog.error("PhotoMediaService: delete batch failed in \(zoneID.zoneName): \(error)")
            }
        }
    }
}

extension Array {
    /// Split into fixed-size chunks (the last may be smaller). Used to bound CloudKit batch sizes.
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
