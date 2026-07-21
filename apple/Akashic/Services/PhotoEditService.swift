import Foundation

/// The filesystem side of photo editing — the counterpart to `PhotoIngestService`.
///
/// Caption / rotation / hero / assignment edits are pure Core Data writes (see the
/// `PersistenceController` edit methods), but **delete** also has to remove the on-disk
/// original + thumbnail. That media-file lifecycle lives here so `JourneyStore` / the
/// persistence layer stay free of file I/O.
///
/// When the CloudKit write path lands (D4), the equivalent step deletes the Photo record's
/// CKAssets; this service's job (reclaiming the local bytes) stays exactly the same.
struct PhotoEditService {
    let media: MediaLibrary
    private let fileManager: FileManager

    init(media: MediaLibrary = .shared, fileManager: FileManager = .default) {
        self.media = media
        self.fileManager = fileManager
    }

    /// Remove a photo's original + thumbnail bytes. Tries the resolved absolute paths first,
    /// then the R2-relative keys under our media root (covers photos ingested locally whose
    /// absolute paths weren't persisted). Returns the paths actually deleted (for tests/logs).
    @discardableResult
    func deleteFiles(for photo: Photo) -> [String] {
        var candidates: [String] = []
        if let p = photo.localOriginalPath { candidates.append(p) }
        if let p = photo.localThumbPath { candidates.append(p) }
        // Fall back to R2-relative keys resolved under our writable media root.
        candidates.append(media.absoluteURL(forRelative: photo.url).path)
        if let thumb = photo.thumbnailURL {
            candidates.append(media.absoluteURL(forRelative: thumb).path)
        }

        var removed: [String] = []
        let rootPath = media.root.standardizedFileURL.path
        for path in Set(candidates) {
            // Only delete strictly *inside* our media root — never touch bytes owned by an
            // import bundle. Standardize (resolves "../") and require the `rootPath + "/"`
            // boundary so a sibling root ("<root>-old/…") or a traversal escape never matches.
            let resolved = URL(fileURLWithPath: path).standardizedFileURL.path
            guard resolved.hasPrefix(rootPath + "/") else { continue }
            guard fileManager.fileExists(atPath: resolved) else { continue }
            if (try? fileManager.removeItem(atPath: resolved)) != nil {
                removed.append(resolved)
            }
        }
        return removed
    }
}
