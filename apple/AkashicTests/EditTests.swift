import XCTest
import CoreData
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
@testable import Akashic

/// Tests for the native editing writes (Phase 3): photo caption / rotation / hero / assignment,
/// delete-removes-files, and waypoint / journey edits — all through `PersistenceController`
/// (the same seam the CloudKit write path will use in D4) + `PhotoEditService` for file cleanup.
final class EditTests: XCTestCase {

    private var bundleForTests: Bundle { Bundle(for: type(of: self)) }

    private func controller() -> PersistenceController {
        let pc = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundleForTests)
        CoreDataMapping.upsertJourney(Self.sampleJourney(), into: pc.viewContext)
        try? pc.viewContext.save()
        return pc
    }

    // MARK: - Photo field edits

    func testCaptionPersistsAndTrimsAndClears() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))

        let updated = try XCTUnwrap(pc.updatePhotoCaption(id: "P1", caption: "  Summit push  "))
        XCTAssertEqual(updated.caption, "Summit push")
        XCTAssertEqual(pc.loadPhotos(forJourneyID: "J1").first?.caption, "Summit push")

        _ = pc.updatePhotoCaption(id: "P1", caption: "   ")
        XCTAssertNil(pc.loadPhotos(forJourneyID: "J1").first?.caption, "blank caption clears")
    }

    func testRotationNormalisesAndPersists() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))

        XCTAssertEqual(pc.setPhotoRotation(id: "P1", rotation: 450)?.rotation, 90)
        XCTAssertEqual(pc.loadPhotos(forJourneyID: "J1").first?.rotation, 90)
        XCTAssertEqual(pc.setPhotoRotation(id: "P1", rotation: -90)?.rotation, 270)
    }

    func testAssignmentPersistsAndUnassigns() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))

        let assigned = try XCTUnwrap(pc.assignPhoto(id: "P1", toWaypointID: "W2"))
        XCTAssertEqual(assigned.waypointId, "W2")
        XCTAssertEqual(pc.loadPhotos(forJourneyID: "J1").first?.waypointId, "W2")

        let unassigned = try XCTUnwrap(pc.assignPhoto(id: "P1", toWaypointID: nil))
        XCTAssertNil(unassigned.waypointId)
        XCTAssertNil(pc.loadPhotos(forJourneyID: "J1").first?.waypointId)
    }

    func testHeroIsSingletonPerJourney() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))
        pc.insertPhoto(makePhoto(id: "P2"))

        _ = pc.setPhotoHero(id: "P1", isHero: true)
        _ = pc.setPhotoHero(id: "P2", isHero: true)

        let photos = pc.loadPhotos(forJourneyID: "J1")
        XCTAssertEqual(photos.first { $0.id == "P1" }?.isHero, false, "setting a new hero clears the old one")
        XCTAssertEqual(photos.first { $0.id == "P2" }?.isHero, true)
    }

    func testSetLocationClears() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))

        let cleared = try XCTUnwrap(pc.setPhotoLocation(id: "P1", coordinates: nil, source: nil))
        XCTAssertNil(cleared.coordinates)
        XCTAssertNil(pc.loadPhotos(forJourneyID: "J1").first?.coordinates)
    }

    // MARK: - Delete removes files

    func testDeleteRemovesFilesAndRecord() async throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-del-\(UUID().uuidString)")
        let pc = controller()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let photo = try await service.ingest(data: makeJPEG(width: 100, height: 100),
                                             type: .jpeg, journeyId: "J1")
        pc.insertPhoto(photo)

        let original = try XCTUnwrap(photo.localOriginalPath)
        let thumb = try XCTUnwrap(photo.localThumbPath)
        XCTAssertTrue(FileManager.default.fileExists(atPath: original))
        XCTAssertTrue(FileManager.default.fileExists(atPath: thumb))

        // File cleanup (PhotoEditService) then record delete (PersistenceController) — the two
        // halves JourneyStore.deletePhoto stitches together.
        let removed = PhotoEditService(media: MediaLibrary(root: root)).deleteFiles(for: photo)
        XCTAssertEqual(Set(removed), Set([original, thumb]))
        XCTAssertFalse(FileManager.default.fileExists(atPath: original))
        XCTAssertFalse(FileManager.default.fileExists(atPath: thumb))

        XCTAssertTrue(pc.deletePhoto(id: photo.id))
        XCTAssertTrue(pc.loadPhotos(forJourneyID: "J1").isEmpty)

        try? FileManager.default.removeItem(at: root)
    }

    func testDeleteFilesNeverTouchesBytesOutsideMediaRoot() throws {
        // A photo whose local paths point outside our writable root (e.g. an import bundle)
        // must not be deleted by the editor.
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-root-\(UUID().uuidString)")
        let foreign = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-foreign-\(UUID().uuidString).jpg")
        try Data("bytes".utf8).write(to: foreign)

        var photo = makePhoto(id: "PX")
        photo.localOriginalPath = foreign.path
        let removed = PhotoEditService(media: MediaLibrary(root: root)).deleteFiles(for: photo)

        XCTAssertTrue(removed.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: foreign.path), "import-owned bytes untouched")
        try? FileManager.default.removeItem(at: foreign)
    }

    func testDeleteFilesLeavesSiblingRootBytesUntouched() throws {
        // A prefix match on the bare root path would wrongly treat "<root>-old/…" as inside
        // the root; the `rootPath + "/"` boundary must reject it.
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-sib-\(UUID().uuidString)")
        let siblingRoot = URL(fileURLWithPath: root.path + "-old")
        try FileManager.default.createDirectory(at: siblingRoot, withIntermediateDirectories: true)
        let siblingFile = siblingRoot.appendingPathComponent("P.jpg")
        try Data("bytes".utf8).write(to: siblingFile)

        var photo = makePhoto(id: "PS")
        photo.localOriginalPath = siblingFile.path
        let removed = PhotoEditService(media: MediaLibrary(root: root)).deleteFiles(for: photo)

        XCTAssertTrue(removed.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: siblingFile.path), "sibling-root bytes untouched")
        try? FileManager.default.removeItem(at: siblingRoot)
    }

    func testDeleteFilesRejectsTraversalEscapeFromRoot() throws {
        // A photo.url containing "../" resolves outside the media root; standardizing the
        // candidate before the boundary check must keep the escaped file safe.
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-esc-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let escapeName = "akashic-escape-\(UUID().uuidString).jpg"
        let escapeFile = root.deletingLastPathComponent().appendingPathComponent(escapeName)
        try Data("bytes".utf8).write(to: escapeFile)

        var photo = makePhoto(id: "PE")
        photo.localOriginalPath = nil          // force the R2-key fallback (media.absoluteURL(forRelative:))
        photo.localThumbPath = nil
        photo.url = "../\(escapeName)"         // resolves to <parent-of-root>/<escapeName>
        photo.thumbnailURL = nil
        let removed = PhotoEditService(media: MediaLibrary(root: root)).deleteFiles(for: photo)

        XCTAssertTrue(removed.isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: escapeFile.path), "traversal-escaped bytes untouched")
        try? FileManager.default.removeItem(at: escapeFile)
        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - Waypoint / journey edits

    func testWaypointEditPersists() throws {
        let pc = controller()
        XCTAssertTrue(pc.updateWaypoint(id: "W1", name: "Renamed Camp",
                                        description: "New notes", highlights: ["Sunrise", "Glacier"],
                                        elevation: 1750, dayNumber: 1))
        let journey = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" })
        let camp = try XCTUnwrap(journey.camps.first { $0.id == "W1" })
        XCTAssertEqual(camp.name, "Renamed Camp")
        XCTAssertEqual(camp.notes, "New notes")
        XCTAssertEqual(camp.highlights, ["Sunrise", "Glacier"])
        XCTAssertEqual(camp.elevation, 1750)
    }

    func testJourneyEditPersistsAndUpdatesStats() throws {
        let pc = controller()
        XCTAssertTrue(pc.updateJourney(id: "J1", name: "Renamed Journey",
                                       description: "Updated", country: "Kenya",
                                       dateStarted: "2024-07-01", dateEnded: "2024-07-10",
                                       totalDays: 5, totalDistance: 42.5, summitElevation: 3000))
        let journey = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" })
        XCTAssertEqual(journey.name, "Renamed Journey")
        XCTAssertEqual(journey.country, "Kenya")
        XCTAssertEqual(journey.dateStarted, "2024-07-01")
        XCTAssertEqual(journey.summitElevation, 3000)
        // The read-side summary renders from `stats`, so the edit must flow there too.
        XCTAssertEqual(journey.stats.totalDistance, 42.5, accuracy: 1e-6)
        XCTAssertEqual(journey.stats.duration, 5)
        XCTAssertEqual(journey.stats.highestPoint?.elevation, 3000)
    }

    // MARK: - Store-level (MainActor) smoke test

    @MainActor
    func testStoreDeleteRefreshesPublishedJourneys() async throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-store-\(UUID().uuidString)")
        let pc = controller()
        let service = PhotoIngestService(media: MediaLibrary(root: root))
        let photo = try await service.ingest(data: makeJPEG(width: 80, height: 80),
                                             type: .jpeg, journeyId: "J1")
        pc.insertPhoto(photo)

        let store = JourneyStore(persistence: pc)
        XCTAssertEqual(store.photos(forJourneyID: "J1").count, 1)
        XCTAssertTrue(store.deletePhoto(photo))
        XCTAssertEqual(store.photos(forJourneyID: "J1").count, 0)

        try? FileManager.default.removeItem(at: root)
    }

    // MARK: - Fixtures

    private func makePhoto(id: String, journeyId: String = "J1",
                           waypointId: String? = nil, isHero: Bool = false) -> Photo {
        Photo(id: id, journeyId: journeyId, waypointId: waypointId,
              url: "journeys/\(journeyId)/photos/\(id).jpg",
              thumbnailURL: "journeys/\(journeyId)/photos/\(id)_thumb.jpg",
              caption: nil, coordinates: [10, 60], takenAt: nil, isHero: isHero,
              sortOrder: 0, rotation: 0, mediaType: "image", duration: nil,
              locationSource: "exif", localOriginalPath: nil, localThumbPath: nil)
    }

    private func makeJPEG(width: Int, height: Int) -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(data: nil, width: width, height: height,
                                bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(CGColor(red: 0.3, green: 0.6, blue: 0.4, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let cgImage = context.makeImage()!
        let out = NSMutableData()
        let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(dest, cgImage, nil)
        _ = CGImageDestinationFinalize(dest)
        return out as Data
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
