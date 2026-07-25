import Foundation

/// Zips an export folder using the system's own zipping, so nothing has to be vendored.
///
/// `NSFileCoordinator`'s `.forUploading` intent produces a `.zip` of a directory — the same
/// mechanism Finder's "Compress" uses. The catch that makes this worth its own file: the zip
/// exists only for the duration of the coordinated read, so it MUST be copied out inside the
/// accessor block. Returning the URL and copying afterwards yields a file that is already gone.
enum ExportArchive {

    enum ArchiveError: LocalizedError {
        case zipFailed(String)

        var errorDescription: String? {
            switch self {
            case .zipFailed(let detail): return "Could not package the export: \(detail)"
            }
        }
    }

    /// Zip `folder` and place the archive next to it as `<folder name>.zip`.
    static func zip(folder: URL, fileManager: FileManager = .default) throws -> URL {
        let destination = folder.deletingLastPathComponent()
            .appendingPathComponent(folder.lastPathComponent)
            .appendingPathExtension("zip")
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }

        var coordinatorError: NSError?
        var copyError: Error?
        NSFileCoordinator().coordinate(readingItemAt: folder,
                                       options: [.forUploading],
                                       error: &coordinatorError) { temporaryZip in
            do {
                // Inside the block, on purpose — see the note above.
                try fileManager.copyItem(at: temporaryZip, to: destination)
            } catch {
                copyError = error
            }
        }
        if let coordinatorError { throw ArchiveError.zipFailed(coordinatorError.localizedDescription) }
        if let copyError { throw ArchiveError.zipFailed(copyError.localizedDescription) }
        return destination
    }
}
