import Foundation

/// Moves CloudKit `CKAsset` bytes out of CloudKit's **temporary** staging area and into the
/// app's own media root, under the same R2-style key scheme `PhotoIngestService` /
/// `MediaLibrary` use (`journeys/<journeyId>/photos/<photoId>.<ext>` + `_thumb.jpg`).
///
/// ## Why this exists (data-safety critical)
/// `CKAsset.fileURL` points at a file CloudKit owns and is free to purge once the fetch has
/// been handled. Persisting that path on `CDPhoto.localOriginalPath` means:
///   * the photo stops rendering as soon as the cache is purged, and — far worse —
///   * the next local edit re-encodes the record, finds no bytes at that path, and (before the
///     companion guard in `RecordCoder.record(for photo:)`) assigned `nil` to `original`/`thumb`,
///     which **deletes the asset server-side** — destroying the only remaining copy now that
///     the R2 source is decommissioned.
///
/// Every operation here is copy-only and failure-tolerant: it never deletes anything, and a
/// failed copy returns `nil` so the caller keeps whatever local path the row already had.
enum SyncMediaStaging {

    enum Kind {
        case original
        case thumbnail
    }

    /// Copy the bytes at `stagingURL` (a CloudKit-managed asset file) into the media root and
    /// return the **stable absolute path**, or `nil` if there is nothing to copy / the copy
    /// failed. `relativeKey`, when supplied (the row's existing R2 key), decides the
    /// destination so a synced photo lands exactly where the export/import would have put it.
    static func adopt(assetAt stagingURL: URL?,
                      kind: Kind,
                      journeyId: String,
                      photoId: String,
                      relativeKey: String?,
                      mediaType: String,
                      media: MediaLibrary = .shared,
                      fileManager: FileManager = .default) -> (absolutePath: String, relativeKey: String)? {
        guard let stagingURL, fileManager.fileExists(atPath: stagingURL.path) else { return nil }

        let key = relativeKey.flatMap { $0.isEmpty ? nil : $0 } ?? defaultKey(
            kind: kind, journeyId: journeyId, photoId: photoId,
            mediaType: mediaType, stagingURL: stagingURL, media: media)

        let destination = media.absoluteURL(forRelative: key)

        // If the row already points at these very bytes, there is nothing to do.
        if destination.standardizedFileURL == stagingURL.standardizedFileURL {
            return (destination.path, key)
        }

        do {
            try fileManager.createDirectory(at: destination.deletingLastPathComponent(),
                                            withIntermediateDirectories: true)
            // Copy to a sibling temp file first, then swap in atomically: a partially written
            // destination must never replace bytes that are already good.
            let scratch = destination.deletingLastPathComponent()
                .appendingPathComponent(".incoming-\(UUID().uuidString)")
            try? fileManager.removeItem(at: scratch)
            try fileManager.copyItem(at: stagingURL, to: scratch)
            if fileManager.fileExists(atPath: destination.path) {
                _ = try fileManager.replaceItemAt(destination, withItemAt: scratch)
            } else {
                try fileManager.moveItem(at: scratch, to: destination)
            }
        } catch {
            return nil          // keep the row's existing local path — never blank it
        }
        return (destination.path, key)
    }

    /// R2-style key for a photo that arrived from sync without one.
    private static func defaultKey(kind: Kind,
                                   journeyId: String,
                                   photoId: String,
                                   mediaType: String,
                                   stagingURL: URL,
                                   media: MediaLibrary) -> String {
        switch kind {
        case .thumbnail:
            return media.relativeThumbPath(journeyId: journeyId, photoId: photoId)
        case .original:
            // CloudKit's staging filename usually carries no meaningful extension, so only
            // trust it when it is one of the media extensions the export scheme uses.
            let known: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "mov", "mp4", "m4v"]
            let assetExt = stagingURL.pathExtension.lowercased()
            let fallback = mediaType == "video" ? "mov" : "jpg"
            let ext = known.contains(assetExt) ? (assetExt == "jpeg" ? "jpg" : assetExt) : fallback
            return media.relativeOriginalPath(journeyId: journeyId, photoId: photoId, ext: ext)
        }
    }
}
