import XCTest
import CoreData
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import Akashic

/// Tests for the native photo pipeline: EXIF extraction (ImageIO), 400px JPEG thumbnailing
/// with orientation, and the ingest → files + `CDPhoto` round-trip (incl. the R2 key scheme).
/// Fixtures are generated in-test with ImageIO so no binary assets are needed.
@MainActor
final class PhotoIngestTests: XCTestCase {

    private var bundleForTests: Bundle { Bundle(for: type(of: self)) }

    private func tempMediaRoot() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-ingest-\(UUID().uuidString)")
    }

    // MARK: - JPEG fixture generation (ImageIO)

    /// Build a JPEG carrying optional GPS + DateTimeOriginal + orientation, entirely in memory.
    private func makeJPEG(width: Int, height: Int,
                          lat: Double? = nil, lng: Double? = nil,
                          dateOriginal: String? = nil,
                          orientation: Int = 1) -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(data: nil, width: width, height: height,
                                bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let cgImage = context.makeImage()!

        var props: [CFString: Any] = [kCGImagePropertyOrientation: orientation]
        if let lat, let lng {
            props[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: abs(lat),
                kCGImagePropertyGPSLatitudeRef: lat < 0 ? "S" : "N",
                kCGImagePropertyGPSLongitude: abs(lng),
                kCGImagePropertyGPSLongitudeRef: lng < 0 ? "W" : "E"
            ] as [CFString: Any]
        }
        if let dateOriginal {
            props[kCGImagePropertyExifDictionary] = [
                kCGImagePropertyExifDateTimeOriginal: dateOriginal
            ] as [CFString: Any]
        }

        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, cgImage, props as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        return out as Data
    }

    private func pixelSize(of jpeg: Data) -> (width: Int, height: Int)? {
        guard let src = CGImageSourceCreateWithData(jpeg as CFData, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
              let w = props[kCGImagePropertyPixelWidth] as? Int,
              let h = props[kCGImagePropertyPixelHeight] as? Int else { return nil }
        return (w, h)
    }

    // MARK: - EXIF extraction

    func testExtractGPSAppliesHemisphereSigns() throws {
        // Kilimanjaro-ish: southern + eastern hemisphere.
        let jpeg = makeJPEG(width: 64, height: 48, lat: -3.0674, lng: 37.3556,
                            dateOriginal: "2024:06:15 08:30:00")
        let meta = ImageMetadata.extract(from: jpeg)

        let coords = try XCTUnwrap(meta.coordinates)
        XCTAssertEqual(coords.count, 2)
        XCTAssertEqual(coords[0], 37.3556, accuracy: 1e-3, "coordinates are [lng, lat]")
        XCTAssertEqual(coords[1], -3.0674, accuracy: 1e-3, "S hemisphere → negative latitude")
        XCTAssertEqual(meta.takenAt, "2024-06-15T08:30:00Z")
        XCTAssertTrue(meta.hasLocation)
    }

    func testExtractReturnsEmptyForNoMetadata() {
        let jpeg = makeJPEG(width: 32, height: 32)
        let meta = ImageMetadata.extract(from: jpeg)
        XCTAssertNil(meta.coordinates)
        XCTAssertNil(meta.takenAt)
        XCTAssertFalse(meta.hasLocation)
    }

    // MARK: - Thumbnailing (400px max, orientation)

    func testThumbnailDownscalesLandscapeTo400() throws {
        let jpeg = makeJPEG(width: 1000, height: 600)
        let thumb = try XCTUnwrap(Thumbnailer.imageThumbnailJPEG(from: jpeg))
        let size = try XCTUnwrap(pixelSize(of: thumb))
        XCTAssertEqual(max(size.width, size.height), 400, "longest edge is clamped to 400")
        XCTAssertEqual(size.width, 400)
        XCTAssertEqual(size.height, 240)
    }

    func testThumbnailAppliesOrientationTransform() throws {
        // Orientation 6 = rotate 90° CW: a 1000×600 stored image displays as 600×1000 (portrait).
        // With the transform applied the thumbnail must come out portrait (height > width).
        let jpeg = makeJPEG(width: 1000, height: 600, orientation: 6)
        let thumb = try XCTUnwrap(Thumbnailer.imageThumbnailJPEG(from: jpeg))
        let size = try XCTUnwrap(pixelSize(of: thumb))
        XCTAssertGreaterThan(size.height, size.width, "EXIF orientation should be baked into the thumb")
        XCTAssertEqual(max(size.width, size.height), 400)
    }

    // MARK: - Ingest → files + R2 scheme

    func testIngestWritesFilesUnderR2SchemeAndBuildsPhoto() async throws {
        let root = tempMediaRoot()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let jpeg = makeJPEG(width: 800, height: 800, lat: 59.9139, lng: 10.7522,
                            dateOriginal: "2024:06:16 12:00:00")

        let photo = try await service.ingest(data: jpeg, type: .jpeg,
                                             journeyId: "J1", waypointId: nil, sortOrder: 7)

        // R2 relative key scheme (kept identical to the export/import so CloudKit can reuse it).
        XCTAssertEqual(photo.url, "journeys/J1/photos/\(photo.id).jpg")
        XCTAssertEqual(photo.thumbnailURL, "journeys/J1/photos/\(photo.id)_thumb.jpg")

        // Absolute paths resolved + bytes actually on disk.
        let original = try XCTUnwrap(photo.localOriginalPath)
        let thumb = try XCTUnwrap(photo.localThumbPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original))
        XCTAssertTrue(FileManager.default.fileExists(atPath: thumb))
        XCTAssertTrue(original.hasSuffix("journeys/J1/photos/\(photo.id).jpg"))

        // EXIF flowed through; provenance is "exif" because GPS was present.
        XCTAssertEqual(photo.coordinates?.count, 2)
        XCTAssertEqual(photo.locationSource, "exif")
        XCTAssertEqual(photo.mediaType, "image")
        XCTAssertEqual(photo.sortOrder, 7)
        XCTAssertFalse(photo.isHero)

        try? FileManager.default.removeItem(at: root)
    }

    func testIngestWithoutGPSMarksLocationManual() async throws {
        let root = tempMediaRoot()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let jpeg = makeJPEG(width: 200, height: 200)

        let photo = try await service.ingest(data: jpeg, type: .jpeg, journeyId: "J1")

        XCTAssertNil(photo.coordinates)
        XCTAssertEqual(photo.locationSource, "manual")
        try? FileManager.default.removeItem(at: root)
    }

    func testHEICKeepsHeicOriginalWithJPEGThumb() async throws {
        // We can't easily synth a HEIC, but the extension routing is deterministic: a photo
        // ingested as HEIC keeps a .heic original key while the thumb stays _thumb.jpg.
        let root = tempMediaRoot()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        // Encode the bytes as JPEG but *declare* HEIC so we exercise the extension mapping.
        let bytes = makeJPEG(width: 100, height: 100)
        let photo = try await service.ingest(data: bytes, type: .heic, journeyId: "J1")
        XCTAssertEqual(photo.url, "journeys/J1/photos/\(photo.id).heic")
        XCTAssertEqual(photo.thumbnailURL, "journeys/J1/photos/\(photo.id)_thumb.jpg")
        XCTAssertEqual(photo.mediaType, "image")
        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - Ingest → CDPhoto round-trip

    func testIngestRoundTripsIntoCoreData() async throws {
        let root = tempMediaRoot()
        let pc = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundleForTests)
        seedJourney(into: pc)

        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let jpeg = makeJPEG(width: 640, height: 480, lat: -3.07, lng: 37.35,
                            dateOriginal: "2024:06:02 09:00:00")
        var photo = try await service.ingest(data: jpeg, type: .jpeg, journeyId: "J1",
                                             sortOrder: pc.nextPhotoSortOrder(forJourneyID: "J1"))
        photo.waypointId = "W2"

        XCTAssertTrue(pc.insertPhoto(photo))

        let loaded = pc.loadPhotos(forJourneyID: "J1")
        XCTAssertEqual(loaded.count, 1)
        let stored = try XCTUnwrap(loaded.first)
        XCTAssertEqual(stored.id, photo.id)
        XCTAssertEqual(stored.waypointId, "W2")
        XCTAssertEqual(stored.url, "journeys/J1/photos/\(photo.id).jpg")
        XCTAssertEqual(stored.coordinates?.count, 2)
        XCTAssertEqual(stored.locationSource, "exif")
        XCTAssertNotNil(stored.localThumbPath)
        XCTAssertTrue(stored.hasLocalMedia)

        try? FileManager.default.removeItem(at: root)
    }

    func testSuggestedWaypointUsesDateMatch() async throws {
        let root = tempMediaRoot()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let journey = Self.sampleJourney()
        // Journey starts 2024-06-01; a photo taken on day 2 should suggest W2.
        let jpeg = makeJPEG(width: 100, height: 100, dateOriginal: "2024:06:02 10:00:00")
        let photo = try await service.ingest(data: jpeg, type: .jpeg, journeyId: journey.id)
        let suggestion = PhotoIngestService.suggestedWaypointId(for: photo, in: journey)
        XCTAssertEqual(suggestion, "W2")
        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - Cancel cleanup (C2: staged-then-cancelled photos leave no files behind)

    /// Mirrors what `NewJourneySheet.cancel()` does in the photos-first creation flow: ingest a
    /// batch keyed to the draft's (pre-create) journey id, then run every one of them through
    /// `PhotoEditService.deleteFiles` without ever creating the journey. No file under that
    /// journey id's media directory may survive — a cancelled pick must never leak bytes.
    func testCancellingAfterStagingLeavesNoFilesUnderTheDraftJourneyID() async throws {
        let root = tempMediaRoot()
        let draftJourneyId = UUID().uuidString.lowercased()
        let service = PhotoIngestService(media: MediaLibrary(root: root))

        var staged: [Photo] = []
        for i in 0..<3 {
            let jpeg = makeJPEG(width: 200, height: 150, lat: 59.9 + Double(i) * 0.01, lng: 10.7,
                                dateOriginal: "2024:06:1\(i) 09:00:00")
            let photo = try await service.ingest(data: jpeg, type: .jpeg,
                                                 journeyId: draftJourneyId, sortOrder: i)
            staged.append(photo)
        }

        // Sanity: the files really landed under the draft's journey id before we "cancel".
        let photoDir = root.appendingPathComponent("journeys/\(draftJourneyId)/photos", isDirectory: true)
        let beforeCancel = try FileManager.default.contentsOfDirectory(atPath: photoDir.path)
        XCTAssertEqual(beforeCancel.count, staged.count * 2, "original + thumbnail per staged photo")

        // Cancel: delete every staged file (`PhotoEditService.deleteFiles`), exactly as
        // `NewJourneySheet.cleanupStagedPhotos()` does — no journey is ever created.
        let editService = PhotoEditService(media: MediaLibrary(root: root))
        for photo in staged {
            let removed = editService.deleteFiles(for: photo)
            XCTAssertEqual(removed.count, 2, "original + thumbnail both removed")
        }

        // The directory itself may still exist (deleteFiles removes files, not folders), but it
        // must be empty — no file under the draft's journey id survives the cancel.
        let afterCancel = try FileManager.default.contentsOfDirectory(atPath: photoDir.path)
        XCTAssertTrue(afterCancel.isEmpty, "no files remain under the draft's journey id after cancel")
        for photo in staged {
            XCTAssertNotNil(photo.localOriginalPath)
            XCTAssertFalse(FileManager.default.fileExists(atPath: photo.localOriginalPath!))
            XCTAssertNotNil(photo.localThumbPath)
            XCTAssertFalse(FileManager.default.fileExists(atPath: photo.localThumbPath!))
        }

        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - ISO-6709 (video location)

    func testParseISO6709() throws {
        XCTAssertEqual(PhotoIngestService.parseISO6709("+27.5916+086.5640/"), [86.5640, 27.5916])
        // Negative + altitude field present.
        let parsed = try XCTUnwrap(PhotoIngestService.parseISO6709("-33.8688+151.2093+010.5/"))
        XCTAssertEqual(parsed[0], 151.2093, accuracy: 1e-4)
        XCTAssertEqual(parsed[1], -33.8688, accuracy: 1e-4)
        XCTAssertNil(PhotoIngestService.parseISO6709("garbage"))
    }

    // MARK: - Helpers

    private func seedJourney(into pc: PersistenceController) {
        CoreDataMapping.upsertJourney(Self.sampleJourney(), into: pc.viewContext)
        try? pc.viewContext.save()
    }

    static func sampleJourney() -> Journey {
        let camps = [
            Camp(id: "W1", name: "Basecamp", dayNumber: 1, elevation: 1000,
                 coordinates: [37.35, -3.07], notes: "", highlights: []),
            Camp(id: "W2", name: "High Camp", dayNumber: 2, elevation: 1500,
                 coordinates: [37.36, -3.08], notes: "", highlights: [])
        ]
        return Journey(
            id: "J1", slug: "j1", name: "Test Journey", country: "Tanzania",
            description: "d", heroImageURL: nil, dateStarted: "2024-06-01",
            dateEnded: "2024-06-03", isPublic: false, summitElevation: 2000,
            totalDistance: 10, totalDays: 3, centerCoordinates: nil,
            preferredBearing: nil, preferredPitch: nil,
            stats: TrekStats(duration: 3, totalDistance: 10, totalElevationGain: 500,
                             totalElevationLoss: nil,
                             highestPoint: HighestPoint(name: "Top", elevation: 2000, coordinates: nil)),
            route: .empty, camps: camps)
    }
}
