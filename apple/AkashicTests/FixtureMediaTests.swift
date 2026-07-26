import CoreData
import XCTest
@testable import Akashic

/// DIFF-10 — photographs in the fixture pipeline.
///
/// Before this there was no photo path at all: `FixtureLoader` + `FixtureModels` contained zero
/// occurrences of "photo", so the once-ever demo journey a new paying customer sees had a route, days
/// and notes and **no photographs**, in a photo-memory app.
///
/// The pure mapping is tested from values; the byte staging is tested against a temporary media root
/// so nothing touches the real `MediaLibrary.shared`.
final class FixtureMediaTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }
    private var tempRoots: [URL] = []

    override func tearDown() {
        for root in tempRoots { try? FileManager.default.removeItem(at: root) }
        tempRoots = []
        super.tearDown()
    }

    /// A media library rooted in a fresh temp directory, cleaned up after the test.
    private func temporaryLibrary() -> MediaLibrary {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("fixture-media-\(UUID().uuidString)", isDirectory: true)
        tempRoots.append(root)
        return MediaLibrary(root: root)
    }

    private func kilimanjaro() throws -> Journey {
        try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
    }

    // MARK: - The manifest actually ships

    func testBundledManifestCarriesPhotographsForEveryBundledFixture() {
        let manifest = FixtureMedia.loadManifest(bundle: bundle)

        for slug in ["kilimanjaro", "mount-kenya", "inca-trail"] {
            let photos = manifest.photos(forSlug: slug)
            XCTAssertFalse(photos.isEmpty, "\(slug) must ship at least one photograph")
            for photo in photos {
                XCTAssertFalse(photo.id.isEmpty)
                XCTAssertFalse(photo.file.isEmpty)
                XCTAssertNotNil(FixtureMedia.bundledFileURL(named: photo.file, bundle: bundle),
                                "\(photo.file) is named in the manifest but not bundled")
            }
        }
    }

    func testAMissingManifestDegradesToEmptyRatherThanThrowing() {
        // `Bundle.main` under XCTest is the test runner, which carries no manifest.
        let manifest = FixtureMedia.loadManifest(bundle: Bundle(for: XCTestCase.self))
        XCTAssertTrue(manifest.journeys.isEmpty)
        XCTAssertTrue(manifest.photos(forSlug: "kilimanjaro").isEmpty)
    }

    func testManifestPhotosAreOrderedDeterministicallyBySortOrderThenID() {
        let manifest = FixturePhotoManifest(journeys: ["x": [
            FixturePhoto(id: "b", file: "b.jpg", dayNumber: nil, caption: nil, coordinates: nil,
                         takenAt: nil, isHero: nil, sortOrder: 2),
            FixturePhoto(id: "c", file: "c.jpg", dayNumber: nil, caption: nil, coordinates: nil,
                         takenAt: nil, isHero: nil, sortOrder: 1),
            FixturePhoto(id: "a", file: "a.jpg", dayNumber: nil, caption: nil, coordinates: nil,
                         takenAt: nil, isHero: nil, sortOrder: 1),
        ]])
        XCTAssertEqual(manifest.photos(forSlug: "x").map(\.id), ["a", "c", "b"])
        XCTAssertTrue(manifest.photos(forSlug: "absent").isEmpty)
    }

    // MARK: - Pure mapping

    func testPhotoMappingResolvesTheDayTheObjectKeyAndTheCoordinate() throws {
        let journey = try kilimanjaro()
        let library = temporaryLibrary()
        let fixture = FixturePhoto(id: "p1", file: "shot.jpg", dayNumber: 6,
                                   caption: "Summit", coordinates: [37.354, -3.0764],
                                   takenAt: "2023-10-06T06:12:00Z", isHero: true, sortOrder: 3)

        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: journey, library: library))

        XCTAssertEqual(photo.id, "p1")
        XCTAssertEqual(photo.journeyId, journey.id)
        let day6 = try XCTUnwrap(journey.camps.first { $0.dayNumber == 6 })
        XCTAssertEqual(photo.waypointId, day6.id, "attached to that day's waypoint")
        XCTAssertEqual(photo.url, "journeys/\(journey.id)/photos/p1.jpg",
                       "the same R2-style key an ingested or imported photo uses")
        XCTAssertNil(photo.thumbnailURL, "no separate thumbnail is bundled; the original stands in")
        XCTAssertEqual(photo.caption, "Summit")
        XCTAssertEqual(photo.coordinates, [37.354, -3.0764])
        XCTAssertEqual(photo.takenAt, "2023-10-06T06:12:00Z")
        XCTAssertTrue(photo.isHero)
        XCTAssertEqual(photo.sortOrder, 3)
        XCTAssertEqual(photo.mediaType, "image")
        XCTAssertEqual(photo.locationSource, "exif")
    }

    /// The demo seed re-mints ids; photos must follow, for the same record-identity reason journeys
    /// and waypoints do (`PersistenceController.remapToDemoIdentity`).
    func testIDPrefixFollowsTheDemoIdentityRemapIntoTheObjectKeyToo() throws {
        let demo = PersistenceController.remapToDemoIdentity(try kilimanjaro())
        let library = temporaryLibrary()
        let fixture = FixturePhoto(id: "p1", file: "shot.jpg", dayNumber: 6, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)

        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: demo,
                                                     idPrefix: "demo-", library: library))

        XCTAssertEqual(photo.id, "demo-p1")
        XCTAssertEqual(photo.journeyId, "demo-kilimanjaro")
        XCTAssertEqual(photo.url, "journeys/demo-kilimanjaro/photos/demo-p1.jpg")
        XCTAssertTrue(photo.waypointId?.hasPrefix("demo-") == true,
                      "the day reference points at the re-minted waypoint id")
    }

    func testAPhotoWithoutItsOwnCoordinateInheritsItsDaysAndIsMarkedEstimated() throws {
        let journey = try kilimanjaro()
        let day6 = try XCTUnwrap(journey.camps.first { $0.dayNumber == 6 })
        let fixture = FixturePhoto(id: "p1", file: "shot.jpg", dayNumber: 6, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)

        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: journey,
                                                     library: temporaryLibrary()))

        XCTAssertEqual(photo.coordinates, day6.coordinates)
        XCTAssertEqual(photo.locationSource, "estimated", "inherited, not read off the file")
    }

    func testAPhotoWithNoDayIsUnassignedRatherThanGuessed() throws {
        let fixture = FixturePhoto(id: "p1", file: "shot.jpg", dayNumber: nil, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)
        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: try kilimanjaro(),
                                                     library: temporaryLibrary()))
        XCTAssertNil(photo.waypointId)
        XCTAssertNil(photo.coordinates)
    }

    func testAPhotoNamingAnAbsentDayStaysUnassigned() throws {
        let fixture = FixturePhoto(id: "p1", file: "shot.jpg", dayNumber: 99, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)
        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: try kilimanjaro(),
                                                     library: temporaryLibrary()))
        XCTAssertNil(photo.waypointId, "day 99 does not exist; the photo is not silently reassigned")
    }

    func testMalformedManifestEntriesAreDroppedNotMapped() throws {
        let journey = try kilimanjaro()
        let library = temporaryLibrary()
        let blankID = FixturePhoto(id: "", file: "shot.jpg", dayNumber: nil, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)
        let blankFile = FixturePhoto(id: "p", file: "", dayNumber: nil, caption: nil,
                                     coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)
        XCTAssertNil(FixtureMedia.photo(from: blankID, journey: journey, library: library))
        XCTAssertNil(FixtureMedia.photo(from: blankFile, journey: journey, library: library))
        XCTAssertTrue(FixtureMedia.photos(from: [blankID, blankFile], journey: journey,
                                          library: library).isEmpty)
    }

    func testAnExtensionOtherThanJPEGIsPreservedInTheObjectKey() throws {
        let fixture = FixturePhoto(id: "p1", file: "shot.HEIC", dayNumber: nil, caption: nil,
                                   coordinates: nil, takenAt: nil, isHero: nil, sortOrder: nil)
        let photo = try XCTUnwrap(FixtureMedia.photo(from: fixture, journey: try kilimanjaro(),
                                                     library: temporaryLibrary()))
        XCTAssertTrue(photo.url.hasSuffix(".heic"), "lower-cased, but not forced to jpg: \(photo.url)")
    }

    // MARK: - Staging the bytes

    func testStagingCopiesBundledBytesIntoTheMediaLibraryWhereThePhotoCanFindThem() throws {
        let journey = try kilimanjaro()
        let library = temporaryLibrary()
        let fixtures = FixtureMedia.loadManifest(bundle: bundle).photos(forSlug: "kilimanjaro")
        XCTAssertFalse(fixtures.isEmpty)

        let staged = FixtureMedia.stagePhotos(fixtures, for: journey, bundle: bundle, library: library)

        XCTAssertEqual(staged.count, fixtures.count)
        for photo in staged {
            let path = try XCTUnwrap(photo.localOriginalPath)
            XCTAssertTrue(FileManager.default.fileExists(atPath: path), "bytes are on disk at \(path)")
            XCTAssertTrue(path.hasPrefix(library.root.path), "…under the media root, not the bundle")
            // The absolute path is what `Photo.resolveMedia` prefers, so display works immediately.
            XCTAssertEqual(photo.originalFileURL?.path, path)
            XCTAssertEqual(photo.thumbnailFileURL?.path, path, "thumb falls back to the original")
            XCTAssertTrue(photo.hasLocalMedia)
            let size = try FileManager.default.attributesOfItem(atPath: path)[.size] as? Int ?? 0
            XCTAssertGreaterThan(size, 1024, "a real image, not an empty file")
        }
    }

    func testStagingIsIdempotentAndDoesNotRewriteAnExistingFile() throws {
        let journey = try kilimanjaro()
        let library = temporaryLibrary()
        let fixtures = FixtureMedia.loadManifest(bundle: bundle).photos(forSlug: "kilimanjaro")

        let first = FixtureMedia.stagePhotos(fixtures, for: journey, bundle: bundle, library: library)
        let path = try XCTUnwrap(first.first?.localOriginalPath)
        let firstModified = try FileManager.default
            .attributesOfItem(atPath: path)[.modificationDate] as? Date

        let second = FixtureMedia.stagePhotos(fixtures, for: journey, bundle: bundle, library: library)
        let secondModified = try FileManager.default
            .attributesOfItem(atPath: path)[.modificationDate] as? Date

        XCTAssertEqual(first.map(\.id), second.map(\.id))
        XCTAssertEqual(firstModified, secondModified, "re-seeding costs a fileExists, not a rewrite")
    }

    func testAPhotoWhoseBundledFileIsMissingIsDroppedRatherThanGivenADeadPath() throws {
        let ghost = FixturePhoto(id: "ghost", file: "not-in-the-bundle.jpg", dayNumber: 1,
                                 caption: nil, coordinates: nil, takenAt: nil,
                                 isHero: nil, sortOrder: nil)
        let staged = FixtureMedia.stagePhotos([ghost], for: try kilimanjaro(),
                                              bundle: bundle, library: temporaryLibrary())
        XCTAssertTrue(staged.isEmpty, "a broken-image placeholder is worse than one fewer photo")
    }

    func testStagingNothingIsAValidNoOp() throws {
        XCTAssertTrue(FixtureMedia.stagePhotos([], for: try kilimanjaro(),
                                                bundle: bundle, library: temporaryLibrary()).isEmpty)
    }

    // MARK: - End to end through the store

    /// The customer-facing assertion: the `.fixtures` store, seeded as the app seeds it, hands back
    /// journeys whose photos have displayable bytes.
    func testSeededFixtureStoreYieldsJourneysWithPhotographsOnDisk() throws {
        let controller = PersistenceController(mode: .fixtures, seed: true, fixtureBundle: bundle,
                                               defaults: freshDefaults())

        let journeys = controller.loadJourneys()
        XCTAssertFalse(journeys.isEmpty)

        var totalPhotos = 0
        for journey in journeys {
            let photos = controller.loadPhotos(forJourneyID: journey.id)
            totalPhotos += photos.count
            for photo in photos {
                XCTAssertEqual(photo.journeyId, journey.id)
                XCTAssertTrue(photo.hasLocalMedia,
                              "\(journey.slug): photo \(photo.id) has no displayable bytes")
            }
        }
        XCTAssertEqual(totalPhotos, 3, "one bundled photograph per bundled fixture")
    }

    /// The DIFF-10 headline: the once-ever demo journey — the first thing a new paying customer sees —
    /// is no longer photo-free, and its photos carry the demo identity prefix.
    func testDemoJourneySeedIncludesItsPhotographs() throws {
        let defaults = freshDefaults()
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle,
                                               defaults: defaults)
        controller.seedDemoJourneyIfFreshInstall(bundle: bundle)

        let journeys = controller.loadJourneys()
        XCTAssertEqual(journeys.map(\.id), ["demo-kilimanjaro"])

        let photos = controller.loadPhotos(forJourneyID: "demo-kilimanjaro")
        XCTAssertFalse(photos.isEmpty, "the demo journey must show photographs")
        for photo in photos {
            XCTAssertTrue(photo.id.hasPrefix("demo-"),
                          "a photo id is a CloudKit recordName; it must not collide with real data")
            XCTAssertEqual(photo.journeyId, "demo-kilimanjaro")
            XCTAssertTrue(photo.hasLocalMedia)
            XCTAssertNotNil(photo.waypointId, "attached to a day, so it shows in the story chapter")
        }
        // The demo stays exempt from the free tier and from sync, photographs and all.
        XCTAssertTrue(controller.isSeededFixture(journeyID: "demo-kilimanjaro"))
    }

    private func freshDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: "fixture-media-tests-\(UUID().uuidString)")!
        defaults.removePersistentDomain(forName: defaults.description)
        return defaults
    }
}
