import Foundation
import CryptoKit
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
import AVFoundation

// MARK: - Media library (writable on-disk root)

/// Owns the app's writable media tree and the R2 object-key scheme.
///
/// Newly ingested originals/thumbnails are written under `<root>/journeys/<journeyId>/
/// photos/<photoId>.<ext>` (+ `_thumb.jpg`) — **the exact same relative key layout** the
/// Postgres/R2 export uses (`MediaResolver` / `ExportMapper`). The relative key is stored
/// on `CDPhoto.url` / `.thumbnailURL` (as the DB does), and the resolved absolute path on
/// `.localOriginalPath` / `.localThumbPath` (as the local importer does). Keeping the scheme
/// identical means the CloudKit import path (D4) can attach a CKAsset from the same key
/// without any migration.
// QUA-08: `Sendable` so the `shared` static is concurrency-safe.
//
// That required dropping a stored `FileManager`, which is not `Sendable`. It was an injection seam
// no caller ever used — every construction took the `.default` — so it is a computed property now.
// The struct's only stored state is the root `URL`; the files it manages live on disk, not in here.
struct MediaLibrary: Sendable {
    let root: URL

    /// `.default` rather than stored, so the struct stays `Sendable`. If a test ever genuinely needs
    /// to inject one, the honest move is a protocol seam over the handful of operations used below —
    /// not a stored `FileManager`, which would take `Sendable` away again.
    private var fileManager: FileManager { .default }

    init(root: URL) {
        self.root = root
    }

    /// App default: `<Application Support>/media`. Survives relaunches on the `.local` store;
    /// on the in-memory `.fixtures` store the files persist for the session so display works.
    static let shared = MediaLibrary(root: MediaLibrary.defaultRoot())

    static func defaultRoot() -> URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory,
                                                 in: .userDomainMask,
                                                 appropriateFor: nil,
                                                 create: true))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return base.appendingPathComponent("media", isDirectory: true)
    }

    /// Relative R2 key for an original, e.g. `journeys/<jid>/photos/<pid>.heic`.
    func relativeOriginalPath(journeyId: String, photoId: String, ext: String) -> String {
        "journeys/\(journeyId)/photos/\(photoId).\(ext)"
    }

    /// Relative R2 key for a thumbnail, e.g. `journeys/<jid>/photos/<pid>_thumb.jpg`.
    func relativeThumbPath(journeyId: String, photoId: String) -> String {
        "journeys/\(journeyId)/photos/\(photoId)_thumb.jpg"
    }

    func absoluteURL(forRelative relativePath: String) -> URL {
        let cleaned = relativePath.hasPrefix("/") ? String(relativePath.dropFirst()) : relativePath
        return root.appendingPathComponent(cleaned)
    }

    /// Ensure `<root>/journeys/<jid>/photos` exists and return it.
    @discardableResult
    func ensurePhotoDirectory(journeyId: String) throws -> URL {
        let dir = root.appendingPathComponent("journeys/\(journeyId)/photos", isDirectory: true)
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

// MARK: - EXIF metadata

/// The subset of EXIF/GPS fields the ingest pipeline extracts — mirrors the web app's
/// `src/lib/exif.ts` (`GPSLatitude/Longitude` + refs, `DateTimeOriginal`, `Make`/`Model`),
/// read here through ImageIO's `CGImageSource` property dictionaries instead of `exifr`.
struct PhotoMetadata: Equatable {
    /// GPS as `[lng, lat]` (GeoJSON order), sign-corrected via the N/S/E/W refs.
    var coordinates: [Double]?
    /// GPS altitude in metres (sign-corrected via `GPSAltitudeRef`: 1 = below sea level). Nil when
    /// the EXIF carried no altitude. Consumed by `RouteInference` to give the drafted route its
    /// `[lng, lat, ele]` elevation; not persisted on `Photo` (which stores only `[lng, lat]`).
    var altitude: Double?
    /// `DateTimeOriginal` as an ISO-8601 instant (interpreted UTC for deterministic day-matching).
    var takenAt: String?
    var cameraMake: String?
    var cameraModel: String?
    /// EXIF orientation (1...8); 1 when absent.
    var orientation: Int = 1

    var hasLocation: Bool { coordinates != nil }
}

enum ImageMetadata {

    /// Parse EXIF/GPS/TIFF from raw image bytes. Returns an empty `PhotoMetadata` (not nil)
    /// when the file carries no metadata — same graceful-degradation contract as the web.
    static func extract(from data: Data) -> PhotoMetadata {
        var meta = PhotoMetadata()
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return meta }

        if let orientation = props[kCGImagePropertyOrientation] as? Int {
            meta.orientation = orientation
        }

        // GPS → [lng, lat], applying hemisphere refs (S / W are negative).
        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any],
           let lat = gps[kCGImagePropertyGPSLatitude] as? Double,
           let lng = gps[kCGImagePropertyGPSLongitude] as? Double {
            let latRef = (gps[kCGImagePropertyGPSLatitudeRef] as? String) ?? "N"
            let lngRef = (gps[kCGImagePropertyGPSLongitudeRef] as? String) ?? "E"
            let signedLat = latRef.uppercased() == "S" ? -lat : lat
            let signedLng = lngRef.uppercased() == "W" ? -lng : lng
            meta.coordinates = [signedLng, signedLat]

            // GPS altitude, if present. GPSAltitudeRef == 1 means below sea level (negative).
            if let alt = gps[kCGImagePropertyGPSAltitude] as? Double {
                let ref = (gps[kCGImagePropertyGPSAltitudeRef] as? Int) ?? 0
                meta.altitude = ref == 1 ? -alt : alt
            }
        }

        // DateTimeOriginal ("yyyy:MM:dd HH:mm:ss") → ISO-8601 UTC.
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any],
           let raw = exif[kCGImagePropertyExifDateTimeOriginal] as? String,
           let date = exifDateFormatter.date(from: raw) {
            meta.takenAt = ISO8601Shared.string(from: date)
        }

        if let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any] {
            meta.cameraMake = tiff[kCGImagePropertyTIFFMake] as? String
            meta.cameraModel = tiff[kCGImagePropertyTIFFModel] as? String
        }

        return meta
    }

    /// EXIF timestamps are `yyyy:MM:dd HH:mm:ss` with no zone; interpret as UTC so day
    /// matching against the (UTC) journey start date is deterministic across machines.
    static let exifDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy:MM:dd HH:mm:ss"
        return f
    }()

    // QUA-08: was a private static ISO8601DateFormatter. See ISO8601Shared for why these are
    // serialised centrally rather than annotated nonisolated(unsafe) at each site.
}

// MARK: - Thumbnailing (400px max, JPEG q0.8, orientation-corrected)

/// Generates 400px-max JPEG thumbnails — the exact spec of the web `createThumbnail`
/// (`THUMBNAIL_MAX_SIZE = 400`, `THUMBNAIL_QUALITY = 0.8`, EXIF orientation applied).
/// Images go through `CGImageSource` thumbnailing (`WithTransform` bakes orientation);
/// videos through an `AVAssetImageGenerator` poster frame.
enum Thumbnailer {
    static let maxSize = 400
    static let quality = 0.8

    /// Orientation-corrected downscaled JPEG for an image, or nil if it can't be decoded.
    static func imageThumbnailJPEG(from data: Data, maxPixelSize: Int = maxSize) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,   // apply EXIF orientation
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let thumb = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }
        return encodeJPEG(thumb, quality: quality)
    }

    /// Poster-frame JPEG (~1s in, orientation-corrected) for a video file, or nil.
    static func videoThumbnailJPEG(fileURL: URL, maxPixelSize: Int = maxSize) async -> Data? {
        let asset = AVURLAsset(url: fileURL)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true          // apply track rotation
        generator.maximumSize = CGSize(width: maxPixelSize, height: maxPixelSize)
        let duration = (try? await asset.load(.duration)).map(CMTimeGetSeconds) ?? 0
        let seconds = duration > 2 ? 1.0 : max(duration / 2, 0)
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        return await withCheckedContinuation { continuation in
            generator.generateCGImagesAsynchronously(forTimes: [NSValue(time: time)]) { _, image, _, _, _ in
                continuation.resume(returning: image.flatMap { encodeJPEG($0, quality: quality) })
            }
        }
    }

    /// Encode a `CGImage` to JPEG at the given quality.
    static func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(
            data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [
            kCGImageDestinationLossyCompressionQuality: quality
        ] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }
        return data as Data
    }
}

// MARK: - Ingest service

/// Content hashing for duplicate detection (DIFF-14).
///
/// Across Kilimanjaro's 939 photo rows only about 449 images are unique, and that gap came from
/// repeated uploads over time rather than from one bad batch — so the detection that would actually
/// have prevented it has to work across sessions, which means the hash has to be stored. Within-batch
/// hashing alone would have caught none of it.
///
/// SHA-256 over the original bytes: exact-duplicate detection, deliberately distinct from
/// `VisionPhotoScorer`'s feature-print grouping, which finds *near* duplicates and is a heuristic. A
/// hash match is certainty, so it is the only one of the two safe to act on without asking.
enum ContentHash {
    /// Streamed in chunks rather than `Data(contentsOf:)` — a 4K video would otherwise be resident
    /// in full, which is the exact problem QUA-13 removed from this file.
    static func sha256(ofFileAt url: URL, chunkSize: Int = 1 << 20) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try? handle.read(upToCount: chunkSize), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func sha256(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

enum PhotoIngestError: LocalizedError {
    case emptyData
    case originalWriteFailed(String)
    case unsupportedType(String)
    /// QUA-13: refused by size before the copy, rather than being jetsammed during it.
    case movieTooLarge(maxBytes: Int)

    /// Localised (QUA-26). Every branch reaches an alert during "add photos", the single most-used
    /// write path in the app.
    var errorDescription: String? {
        switch self {
        case .emptyData:
            return String(localized: "The selected item had no data.",
                          comment: "Add-photos failure alert: the picked item yielded no bytes.")
        case let .originalWriteFailed(m):
            return String(localized: "Could not save the original file: \(m)",
                          comment: "Add-photos failure alert: writing the original to disk failed. The placeholder is the underlying system error.")
        case let .unsupportedType(t):
            return String(localized: "Unsupported media type: \(t)",
                          comment: "Add-photos failure alert: the picked item is not an image or a video. The placeholder is the uniform type identifier.")
        case let .movieTooLarge(maxBytes):
            // ByteCountFormatter is already locale-aware, so the size arrives formatted.
            let limit = ByteCountFormatter.string(fromByteCount: Int64(maxBytes), countStyle: .file)
            return String(localized: "That video is larger than \(limit). Trim it in Photos first, then add it.",
                          comment: "Add-photos failure alert: the picked video exceeds the ingest size cap. The placeholder is the already-formatted cap, e.g. \"500 MB\".")
        }
    }
}

/// Turns picked media (image / HEIC / video) into a stored `Photo`:
///   1. write the original bytes under the R2 key scheme,
///   2. extract EXIF (GPS / DateTimeOriginal / orientation) — images only,
///   3. generate a 400px JPEG thumbnail (image thumbnail or video poster frame),
///   4. build a domain `Photo` with `location_source = "exif"` (GPS present) or `"manual"`.
///
/// The `ingest(data:type:…)` core is Core Data-free and PhotosUI-free so it is unit-testable;
/// the `PhotosPicker` entry point (`ingest(pickerItem:…)`) lives in an extension below.
/// Waypoint/day *suggestion* is left to the caller via `PhotoDayMatcher` (see `suggestedWaypointId`)
/// so the UI can offer a manual override before committing.
final class PhotoIngestService {
    let media: MediaLibrary

    init(media: MediaLibrary = .shared) {
        self.media = media
    }

    /// Core ingest: write files + build the `Photo`. `sortOrder` positions the new photo at
    /// the end of its journey. Does not touch Core Data — the caller inserts the returned value.
    func ingest(data: Data,
                type: UTType,
                journeyId: String,
                waypointId: String? = nil,
                sortOrder: Int = 0) async throws -> Photo {
        guard !data.isEmpty else { throw PhotoIngestError.emptyData }
        try media.ensurePhotoDirectory(journeyId: journeyId)
        let photoId = UUID().uuidString.lowercased()

        if type.conforms(to: .movie) || type.conforms(to: .video) {
            return try await ingestVideo(data: data, type: type, photoId: photoId,
                                         journeyId: journeyId, waypointId: waypointId,
                                         sortOrder: sortOrder)
        }
        return try ingestImage(data: data, type: type, photoId: photoId,
                               journeyId: journeyId, waypointId: waypointId,
                               sortOrder: sortOrder)
    }

    /// Ingest a movie that is already a file on disk, without ever holding it in memory (QUA-13).
    ///
    /// The only difference from `ingest(data:type:)` is how the bytes reach their destination:
    /// `FileManager.copyItem` streams, where `Data.write` requires the whole thing resident. Record
    /// building is shared, so a video ingested either way produces an identical `Photo`.
    func ingest(fileURL: URL,
                type: UTType,
                journeyId: String,
                waypointId: String? = nil,
                sortOrder: Int = 0) async throws -> Photo {
        try media.ensurePhotoDirectory(journeyId: journeyId)
        let photoId = UUID().uuidString.lowercased()
        return try await ingestVideo(copyingFrom: fileURL, type: type, photoId: photoId,
                                     journeyId: journeyId, waypointId: waypointId,
                                     sortOrder: sortOrder)
    }

    /// Day suggestion for a freshly ingested photo (tiers 2–4 of `PhotoDayMatcher`, since a
    /// new photo has no explicit waypoint yet). Returns the suggested waypoint id, or nil.
    static func suggestedWaypointId(for photo: Photo, in journey: Journey) -> String? {
        guard let day = PhotoDayMatcher(journey: journey).day(for: photo) else { return nil }
        return journey.camps.first { $0.dayNumber == day }?.id
    }

    // MARK: Image

    private func ingestImage(data: Data, type: UTType, photoId: String,
                             journeyId: String, waypointId: String?, sortOrder: Int) throws -> Photo {
        // Keep HEIC as .heic (matches the media worker's allowed types); default others to jpg.
        let ext = originalExtension(for: type, imageFallback: "jpg")
        let originalRel = media.relativeOriginalPath(journeyId: journeyId, photoId: photoId, ext: ext)
        let originalURL = media.absoluteURL(forRelative: originalRel)
        do {
            try data.write(to: originalURL, options: .atomic)
        } catch {
            throw PhotoIngestError.originalWriteFailed(error.localizedDescription)
        }

        let meta = ImageMetadata.extract(from: data)

        // Thumbnail is always JPEG (HEIC originals get a JPEG thumb — matches the worker).
        var thumbRel: String?
        var thumbAbsolute: String?
        if let thumbData = Thumbnailer.imageThumbnailJPEG(from: data) {
            let rel = media.relativeThumbPath(journeyId: journeyId, photoId: photoId)
            let url = media.absoluteURL(forRelative: rel)
            if (try? thumbData.write(to: url, options: .atomic)) != nil {
                thumbRel = rel
                thumbAbsolute = url.path
            }
        }

        return Photo(
            id: photoId,
            journeyId: journeyId,
            waypointId: waypointId,
            url: originalRel,
            thumbnailURL: thumbRel,
            caption: nil,
            coordinates: meta.coordinates,
            takenAt: meta.takenAt,
            isHero: false,
            sortOrder: sortOrder,
            rotation: 0,
            mediaType: "image",
            duration: nil,
            locationSource: meta.hasLocation ? "exif" : "manual",
            localOriginalPath: originalURL.path,
            localThumbPath: thumbAbsolute,
            // DIFF-14: hashed from the file that actually landed, not from the input buffer —
            // the committed bytes are what a future re-import will be compared against.
            contentHash: ContentHash.sha256(ofFileAt: originalURL))
    }

    // MARK: Video

    private func ingestVideo(data: Data, type: UTType, photoId: String,
                             journeyId: String, waypointId: String?, sortOrder: Int) async throws -> Photo {
        try await ingestVideo(placingBytes: { url in try data.write(to: url, options: .atomic) },
                              type: type, photoId: photoId, journeyId: journeyId,
                              waypointId: waypointId, sortOrder: sortOrder)
    }

    /// File-to-file variant (QUA-13): `copyItem` streams, so peak memory is a copy buffer rather
    /// than the whole movie.
    private func ingestVideo(copyingFrom source: URL, type: UTType, photoId: String,
                             journeyId: String, waypointId: String?, sortOrder: Int) async throws -> Photo {
        try await ingestVideo(placingBytes: { url in
            if FileManager.default.fileExists(atPath: url.path) {
                try FileManager.default.removeItem(at: url)
            }
            try FileManager.default.copyItem(at: source, to: url)
        }, type: type, photoId: photoId, journeyId: journeyId,
           waypointId: waypointId, sortOrder: sortOrder)
    }

    /// Shared video ingest. `placeBytes` is the only difference between the in-memory and the
    /// file-to-file paths, so everything after it — duration, poster frame, record building — is
    /// identical and a video ingested either way yields an identical `Photo`.
    private func ingestVideo(placingBytes placeBytes: (URL) throws -> Void,
                             type: UTType, photoId: String,
                             journeyId: String, waypointId: String?, sortOrder: Int) async throws -> Photo {
        let ext = originalExtension(for: type, imageFallback: "mov")
        let originalRel = media.relativeOriginalPath(journeyId: journeyId, photoId: photoId, ext: ext)
        let originalURL = media.absoluteURL(forRelative: originalRel)
        do {
            try placeBytes(originalURL)
        } catch {
            throw PhotoIngestError.originalWriteFailed(error.localizedDescription)
        }

        let asset = AVURLAsset(url: originalURL)
        let durationSeconds = (try? await asset.load(.duration)).map { Int(CMTimeGetSeconds($0).rounded()) }
        let (coordinates, takenAt) = await Self.videoLocationAndDate(asset)

        var thumbRel: String?
        var thumbAbsolute: String?
        if let thumbData = await Thumbnailer.videoThumbnailJPEG(fileURL: originalURL) {
            let rel = media.relativeThumbPath(journeyId: journeyId, photoId: photoId)
            let url = media.absoluteURL(forRelative: rel)
            if (try? thumbData.write(to: url, options: .atomic)) != nil {
                thumbRel = rel
                thumbAbsolute = url.path
            }
        }

        return Photo(
            id: photoId,
            journeyId: journeyId,
            waypointId: waypointId,
            url: originalRel,
            thumbnailURL: thumbRel,
            caption: nil,
            coordinates: coordinates,
            takenAt: takenAt,
            isHero: false,
            sortOrder: sortOrder,
            rotation: 0,
            mediaType: "video",
            duration: durationSeconds,
            locationSource: coordinates != nil ? "exif" : "manual",
            localOriginalPath: originalURL.path,
            localThumbPath: thumbAbsolute,
            // DIFF-14: hashed from the file that actually landed, not from the input buffer —
            // the committed bytes are what a future re-import will be compared against.
            contentHash: ContentHash.sha256(ofFileAt: originalURL))
    }

    /// Best-effort location (ISO-6709) + creation date from a video's container metadata.
    private static func videoLocationAndDate(_ asset: AVURLAsset) async -> (coordinates: [Double]?, takenAt: String?) {
        guard let items = try? await asset.load(.metadata) else { return (nil, nil) }
        var coordinates: [Double]?
        var takenAt: String?
        for item in items {
            if let key = item.commonKey {
                if key == .commonKeyLocation,
                   let value = try? await item.load(.stringValue),
                   let parsed = parseISO6709(value) {
                    coordinates = parsed
                } else if key == .commonKeyCreationDate,
                          let date = try? await item.load(.dateValue) {
                    takenAt = ISO8601Shared.string(from: date)
                }
            }
        }
        return (coordinates, takenAt)
    }

    /// Parse an ISO-6709 location string ("+27.59+086.56/") into `[lng, lat]`.
    static func parseISO6709(_ string: String) -> [Double]? {
        let trimmed = string.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
        // Find the second sign (start of the longitude field).
        var signIndices: [String.Index] = []
        for idx in trimmed.indices where trimmed[idx] == "+" || trimmed[idx] == "-" {
            signIndices.append(idx)
        }
        guard signIndices.count >= 2 else { return nil }
        let latString = String(trimmed[trimmed.startIndex..<signIndices[1]])
        let rest = String(trimmed[signIndices[1]...])
        // Longitude ends at the next sign (altitude) if present.
        var lngEnd = rest.endIndex
        if let altSign = rest.indices.dropFirst().first(where: { rest[$0] == "+" || rest[$0] == "-" }) {
            lngEnd = altSign
        }
        let lngString = String(rest[rest.startIndex..<lngEnd])
        guard let lat = Double(latString), let lng = Double(lngString) else { return nil }
        return [lng, lat]
    }

    private func originalExtension(for type: UTType, imageFallback: String) -> String {
        guard let ext = type.preferredFilenameExtension?.lowercased() else { return imageFallback }
        // Normalise to the R2 scheme's canonical extension ("jpeg" → "jpg") so keys match the
        // web/export layout (`getJourneyPhotoPath` defaults to `jpg`).
        return ext == "jpeg" ? "jpg" : ext
    }
}

// MARK: - PhotosPicker entry point

#if canImport(PhotosUI)
import SwiftUI
import PhotosUI

/// A movie transferred as a **file** rather than as bytes in memory (QUA-13).
///
/// `loadTransferable(type: Data.self)` materialises the entire item as one contiguous `Data`. For a
/// photo that is fine; for a multi-minute 4K capture it is hundreds of megabytes of contiguous
/// allocation, and the app is jetsammed before it can write anything. A `FileRepresentation` lets
/// the system hand over a URL instead, so the bytes go disk-to-disk and peak memory is a copy
/// buffer rather than the whole movie.
///
/// The received file lives in a system-owned temporary location that is deleted when the closure
/// returns, so it must be copied somewhere we own before it can be used.
struct IngestedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("akashic-ingest-\(UUID().uuidString)")
                .appendingPathExtension(received.file.pathExtension.isEmpty
                                        ? "mov" : received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: destination)
            return IngestedMovie(url: destination)
        }
    }
}

extension PhotoIngestService {

    /// Largest movie we will ingest, mirroring `GPXParser.maxFileBytes` in intent: refuse by size
    /// before committing memory, and say so, rather than being killed mid-import.
    ///
    /// 1.5 GB is roughly 12 minutes of 4K60 — far beyond any plausible trip clip, so the guard only
    /// fires on something the user almost certainly picked by accident, while still bounding the
    /// copy. The failure is a message, not a crash, which is the whole point.
    static let maxMovieBytes = 1_500_000_000

    /// Load a `PhotosPickerItem` and run the core ingest. The picker itself cannot be driven
    /// headlessly, so tests exercise `ingest(data:type:…)` and `ingest(fileURL:type:…)` directly.
    ///
    /// Movies take the file path; still images keep the in-memory path, where `Data` is both
    /// harmless and what the EXIF and thumbnail work needs anyway.
    func ingest(pickerItem: PhotosPickerItem,
                journeyId: String,
                waypointId: String? = nil,
                sortOrder: Int = 0) async throws -> Photo {
        let type = pickerItem.supportedContentTypes.first ?? .image

        if type.conforms(to: .movie) {
            guard let movie = try await pickerItem.loadTransferable(type: IngestedMovie.self) else {
                throw PhotoIngestError.emptyData
            }
            defer { try? FileManager.default.removeItem(at: movie.url) }

            let size = (try? movie.url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            guard size > 0 else { throw PhotoIngestError.emptyData }
            guard size <= Self.maxMovieBytes else {
                throw PhotoIngestError.movieTooLarge(maxBytes: Self.maxMovieBytes)
            }
            return try await ingest(fileURL: movie.url, type: type, journeyId: journeyId,
                                    waypointId: waypointId, sortOrder: sortOrder)
        }

        guard let data = try await pickerItem.loadTransferable(type: Data.self), !data.isEmpty else {
            throw PhotoIngestError.emptyData
        }
        return try await ingest(data: data, type: type, journeyId: journeyId,
                                waypointId: waypointId, sortOrder: sortOrder)
    }
}
#endif
