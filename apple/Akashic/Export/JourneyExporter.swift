import Foundation

/// Per-journey export (T2.10 / D10): a single `.zip` holding the journey as portable formats —
/// GPX for the route, JSON for everything else, and the original photo files.
///
/// This is the exit door. The migration accepts Apple lock-in on the sync layer precisely
/// because the *data* never becomes Apple-shaped: what comes out here opens in any GPS tool,
/// any text editor and any photo viewer, with no Akashic and no iCloud involved.
///
/// Everything below is deliberately free of CloudKit, Core Data and SwiftUI so it can be
/// exercised whole in tests.
struct JourneyExporter {

    struct Options {
        var includePhotos = true
        /// Named after the journey by default; the caller may override for a fixed filename.
        var folderName: String?
    }

    /// What actually ended up in the archive. `missingPhotos` is not a soft detail: photos whose
    /// bytes are not on this device (never downloaded, or lost with a stale path) would
    /// otherwise vanish silently from an export the user believes is complete.
    struct Result: Equatable {
        let fileURL: URL
        let photoCount: Int
        let missingPhotos: [String]

        var isComplete: Bool { missingPhotos.isEmpty }
    }

    /// The JSON payload. A flat, self-describing document rather than the app's internal
    /// shapes, so it stays readable without this codebase.
    struct Payload: Codable {
        let exportedAt: Date
        let format: String
        let journey: Journey
        let comments: [DayComment]
        let photos: [Photo]
    }

    static let formatVersion = "akashic-journey-export/1"

    let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    /// Build the export directory and return its location. The caller zips it (or hands the
    /// folder straight to the share sheet).
    ///
    /// - Parameter destination: parent directory to build into — a caller-owned temporary
    ///   directory, so cleanup is the caller's and this stays testable.
    @discardableResult
    func writeExport(journey: Journey,
                     photos: [Photo],
                     comments: [DayComment],
                     into destination: URL,
                     options: Options = Options(),
                     progress: ((Double) -> Void)? = nil) throws -> Result {
        let folderName = options.folderName ?? Self.safeFolderName(for: journey)
        let root = destination.appendingPathComponent(folderName, isDirectory: true)
        try fileManager.createDirectory(at: root, withIntermediateDirectories: true)

        // 1. Route as GPX.
        let gpx = GPXBuilder.gpx(for: journey, generatedAt: Date())
        try gpx.write(to: root.appendingPathComponent("route.gpx"), atomically: true, encoding: .utf8)

        // 2. Everything as JSON.
        let payload = Payload(exportedAt: Date(),
                              format: Self.formatVersion,
                              journey: journey,
                              comments: comments,
                              photos: photos)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(payload).write(to: root.appendingPathComponent("journey.json"), options: .atomic)

        // 3. Original photo bytes.
        var copied = 0
        var missing: [String] = []
        if options.includePhotos, !photos.isEmpty {
            let photosDirectory = root.appendingPathComponent("photos", isDirectory: true)
            try fileManager.createDirectory(at: photosDirectory, withIntermediateDirectories: true)

            let ordered = photos.sorted { $0.sortOrder < $1.sortOrder }
            for (index, photo) in ordered.enumerated() {
                defer { progress?(Double(index + 1) / Double(ordered.count)) }
                guard let source = photo.originalFileURL else {
                    missing.append(photo.id)
                    continue
                }
                let destination = photosDirectory.appendingPathComponent(
                    Self.photoFilename(for: photo, index: index))
                do {
                    // A rerun into the same folder must not abort halfway through.
                    if fileManager.fileExists(atPath: destination.path) {
                        try fileManager.removeItem(at: destination)
                    }
                    try fileManager.copyItem(at: source, to: destination)
                    copied += 1
                } catch {
                    missing.append(photo.id)
                }
            }
        }

        // 4. A note for whoever opens this in five years, on any machine.
        try Self.readme(journey: journey, photoCount: copied, missing: missing.count)
            .write(to: root.appendingPathComponent("README.txt"), atomically: true, encoding: .utf8)

        return Result(fileURL: root, photoCount: copied, missingPhotos: missing)
    }

    // MARK: - Naming

    /// A filesystem- and zip-safe folder name. Falls back to the id when a name reduces to
    /// nothing (an emoji-only title, say) rather than producing an empty path component.
    static func safeFolderName(for journey: Journey) -> String {
        let base = journey.name.isEmpty ? journey.slug : journey.name
        let sanitized = sanitize(base)
        return sanitized.isEmpty ? "journey-\(journey.id)" : sanitized
    }

    /// Keep the original extension so files stay openable, and prefix with the running order so
    /// a plain alphabetical listing matches the album order. The id keeps names unique when two
    /// photos share a filename.
    static func photoFilename(for photo: Photo, index: Int) -> String {
        let source = photo.originalFileURL?.lastPathComponent ?? photo.url
        let ext = (source as NSString).pathExtension
        let suffix = ext.isEmpty ? "" : ".\(ext)"
        let stem = sanitize((source as NSString).deletingPathExtension)
        let name = stem.isEmpty ? photo.id : "\(stem)-\(photo.id.prefix(8))"
        return String(format: "%04d-%@%@", index + 1, name, suffix)
    }

    /// Strip path separators, control characters and the Windows-reserved set, so the archive
    /// also unpacks cleanly off a Mac.
    static func sanitize(_ text: String) -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|")
            .union(.controlCharacters)
            .union(.illegalCharacters)
        let cleaned = text.components(separatedBy: forbidden).joined(separator: " ")
        return cleaned
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))   // no leading/trailing dots
    }

    private static func readme(journey: Journey, photoCount: Int, missing: Int) -> String {
        var text = """
        \(journey.name)

        Exported from Akashic (\(formatVersion)).

        route.gpx     The route and each camp, as GPX 1.1. Opens in any GPS or mapping tool.
        journey.json  Everything else: the journey, its days, photo metadata and comments.
        photos/       The original photo files, in album order.

        Photos included: \(photoCount)
        """
        if missing > 0 {
            text += """


            NOTE: \(missing) photo(s) could not be included because their files were not on
            this device. Open the journey in Akashic while signed in to iCloud so the photos
            download, then export again.
            """
        }
        return text + "\n"
    }
}
