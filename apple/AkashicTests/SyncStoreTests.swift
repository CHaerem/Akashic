import XCTest
import CoreData
import CloudKit
@testable import Akashic

/// `PersistenceController` as a `SyncLocalStore`: materializing CKRecords from stored rows and
/// applying fetched server records into Core Data. Uses an in-memory `.fixtures` controller;
/// the sync-apply methods operate on the view context regardless of mode.
final class SyncStoreTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func seededController() throws -> (PersistenceController, Journey) {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        try controller.viewContext.save()
        return (controller, journey)
    }

    // MARK: - Upload side

    func testAllLocalJourneyIDs() throws {
        let (controller, journey) = try seededController()
        XCTAssertEqual(controller.allLocalJourneyIDs(), [journey.id])
    }

    func testRecordIdentitiesInDependencyOrder() throws {
        let (controller, journey) = try seededController()
        let identities = controller.recordIdentities(forJourneyID: journey.id)

        XCTAssertEqual(identities.first?.recordType, RecordCoder.RecordType.journey,
                       "journey root first")
        XCTAssertEqual(identities.filter { $0.recordType == RecordCoder.RecordType.waypoint }.count,
                       journey.camps.count)
        // Fixtures carry no photos/comments.
        XCTAssertEqual(identities.count, 1 + journey.camps.count)
    }

    func testMakeRecordForJourney() throws {
        let (controller, journey) = try seededController()
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let record = try XCTUnwrap(controller.makeRecord(forRecordName: journey.id, zoneID: zone, existing: nil))

        XCTAssertEqual(record.recordType, RecordCoder.RecordType.journey)
        XCTAssertEqual(record.recordID.recordName, journey.id)
        XCTAssertEqual(record["slug"] as? String, journey.slug)
        XCTAssertEqual(record["name"] as? String, journey.name)
    }

    func testMakeRecordForWaypointCarriesJourneyRef() throws {
        let (controller, journey) = try seededController()
        let camp = journey.camps[0]
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let record = try XCTUnwrap(controller.makeRecord(forRecordName: camp.id, zoneID: zone, existing: nil))

        XCTAssertEqual(record.recordType, RecordCoder.RecordType.waypoint)
        XCTAssertEqual((record["journeyRef"] as? CKRecord.Reference)?.recordID.recordName, journey.id)
        XCTAssertEqual((record["journeyRef"] as? CKRecord.Reference)?.action, CKRecord.ReferenceAction.none)
    }

    func testMakeRecordForUnknownIDReturnsNil() throws {
        let (controller, journey) = try seededController()
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        XCTAssertNil(controller.makeRecord(forRecordName: "does-not-exist", zoneID: zone, existing: nil))
    }

    // MARK: - Apply side (server-authoritative, per record)

    func testApplyFetchedJourneyUpdatesScalarsWithoutDeletingChildren() throws {
        let (controller, journey) = try seededController()
        let campCountBefore = journey.camps.count
        XCTAssertGreaterThan(campCountBefore, 0)

        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let record = try XCTUnwrap(controller.makeRecord(forRecordName: journey.id, zoneID: zone, existing: nil))
        record["name"] = "Renamed From Server"

        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let reloaded = try XCTUnwrap(controller.loadJourneys().first)
        XCTAssertEqual(reloaded.name, "Renamed From Server")
        XCTAssertEqual(reloaded.camps.count, campCountBefore,
                       "a single-record journey apply must NOT delete the journey's waypoints")
    }

    func testApplyFetchedWaypointUpdatesExistingRow() throws {
        let (controller, journey) = try seededController()
        let camp = journey.camps[0]
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let record = try XCTUnwrap(controller.makeRecord(forRecordName: camp.id, zoneID: zone, existing: nil))
        record["name"] = "Server Camp Name"

        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let reloaded = try XCTUnwrap(controller.loadJourneys().first)
        let updated = try XCTUnwrap(reloaded.camps.first { $0.id == camp.id })
        XCTAssertEqual(updated.name, "Server Camp Name")
        XCTAssertEqual(reloaded.camps.count, journey.camps.count, "no duplicate rows on upsert")
    }

    func testApplyFetchedNewJourneyInserts() throws {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let zone = RecordCoder.zoneID(forJourneyID: "new-journey")
        let record = CKRecord(recordType: RecordCoder.RecordType.journey,
                              recordID: CKRecord.ID(recordName: "new-journey", zoneID: zone))
        record["name"] = "Brand New"
        record["slug"] = "brand-new"
        record["country"] = "Norway"

        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let journeys = controller.loadJourneys()
        XCTAssertEqual(journeys.count, 1)
        XCTAssertEqual(journeys.first?.name, "Brand New")
    }

    // MARK: - Media pointers (CRITICAL: a fetched photo must never destroy media pointers)

    /// Insert a CDPhoto row that looks like an imported archive photo.
    @discardableResult
    private func insertPhoto(into controller: PersistenceController,
                             journeyId: String,
                             id: String,
                             url: String,
                             localOriginalPath: String?,
                             localThumbPath: String? = nil) throws -> CDPhoto {
        let cd = CDPhoto(context: controller.viewContext)
        cd.id = id
        cd.journeyId = journeyId
        cd.url = url
        cd.thumbnailURL = "journeys/\(journeyId)/photos/\(id)_thumb.jpg"
        cd.localOriginalPath = localOriginalPath
        cd.localThumbPath = localThumbPath
        cd.mediaType = "image"
        cd.createdAt = Date()
        try controller.viewContext.save()
        return cd
    }

    private func fetchPhoto(_ controller: PersistenceController, _ id: String) throws -> CDPhoto {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "id == %@", id)
        return try XCTUnwrap(controller.viewContext.fetch(request).first)
    }

    private func photoRecord(journeyId: String, photoId: String, assetURL: URL?) -> CKRecord {
        let zone = RecordCoder.zoneID(forJourneyID: journeyId)
        let record = CKRecord(recordType: RecordCoder.RecordType.photo,
                              recordID: CKRecord.ID(recordName: photoId, zoneID: zone))
        record["journeyRef"] = CKRecord.Reference(
            recordID: CKRecord.ID(recordName: journeyId, zoneID: zone), action: .deleteSelf)
        record["caption"] = "From the server"
        record["mediaType"] = "image"
        if let assetURL { record["original"] = CKAsset(fileURL: assetURL) }
        return record
    }

    /// The Photo schema carries no R2 keys and hands back a CloudKit *staging* path, so the old
    /// unconditional write blanked `url` and pointed the row at a file CloudKit may purge —
    /// after which the next local edit uploaded an asset-less record and destroyed the only
    /// remaining copy of the photo.
    func testApplyFetchedPhotoKeepsR2KeyAndStoresBytesUnderMediaRoot() throws {
        let (controller, journey) = try seededController()
        let photoId = "photo-\(UUID().uuidString.lowercased())"
        let r2Key = "journeys/\(journey.id)/photos/\(photoId).jpg"
        // A stale CloudKit staging path, exactly the state the bug used to leave behind.
        try insertPhoto(into: controller, journeyId: journey.id, id: photoId, url: r2Key,
                        localOriginalPath: "/private/var/tmp/ckasset-cache/\(UUID().uuidString)")

        // A CKAsset whose file lives in CloudKit's temp area.
        let staging = FileManager.default.temporaryDirectory
            .appendingPathComponent("ck-staging-\(UUID().uuidString)")
        try Data("original-bytes".utf8).write(to: staging)
        defer { try? FileManager.default.removeItem(at: staging) }

        let record = photoRecord(journeyId: journey.id, photoId: photoId, assetURL: staging)
        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let cd = try fetchPhoto(controller, photoId)
        XCTAssertEqual(cd.url, r2Key, "the R2 object key must survive a sync apply")
        XCTAssertEqual(cd.caption, "From the server", "scalar fields still apply")

        let stored = try XCTUnwrap(cd.localOriginalPath)
        let root = MediaLibrary.shared.root.standardizedFileURL.path
        XCTAssertTrue(stored.hasPrefix(root),
                      "bytes must be copied into the media root, not left at \(stored)")
        XCTAssertNotEqual(stored, staging.path, "the CloudKit staging path must never be persisted")
        XCTAssertTrue(FileManager.default.fileExists(atPath: stored))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: stored)), Data("original-bytes".utf8))
        XCTAssertEqual(URL(fileURLWithPath: stored).standardizedFileURL.path,
                       MediaLibrary.shared.absoluteURL(forRelative: r2Key).standardizedFileURL.path,
                       "stored under the row's own R2 key scheme")
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: stored))
    }

    /// No asset on the record (CloudKit has not materialized it, or it was never uploaded) must
    /// leave the row's existing media pointers completely alone.
    func testApplyFetchedPhotoWithoutAssetKeepsExistingMediaPointers() throws {
        let (controller, journey) = try seededController()
        let photoId = "photo-\(UUID().uuidString.lowercased())"
        let r2Key = "journeys/\(journey.id)/photos/\(photoId).jpg"
        let localPath = MediaLibrary.shared.absoluteURL(forRelative: r2Key)
        try FileManager.default.createDirectory(at: localPath.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try Data("local-bytes".utf8).write(to: localPath)
        defer { try? FileManager.default.removeItem(at: localPath) }

        try insertPhoto(into: controller, journeyId: journey.id, id: photoId, url: r2Key,
                        localOriginalPath: localPath.path, localThumbPath: localPath.path)

        let record = photoRecord(journeyId: journey.id, photoId: photoId, assetURL: nil)
        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let cd = try fetchPhoto(controller, photoId)
        XCTAssertEqual(cd.url, r2Key)
        XCTAssertEqual(cd.localOriginalPath, localPath.path, "no asset -> keep the local original")
        XCTAssertEqual(cd.localThumbPath, localPath.path, "no asset -> keep the local thumb")
        XCTAssertEqual(try Data(contentsOf: localPath), Data("local-bytes".utf8),
                       "good local bytes are never replaced")
    }

    /// A photo that only exists server-side still gets a stable path + a canonical R2 key.
    func testApplyFetchedNewPhotoDerivesR2KeyForAdoptedBytes() throws {
        let (controller, journey) = try seededController()
        let photoId = "photo-\(UUID().uuidString.lowercased())"
        let staging = FileManager.default.temporaryDirectory
            .appendingPathComponent("ck-staging-\(UUID().uuidString)")
        try Data("new-bytes".utf8).write(to: staging)
        defer { try? FileManager.default.removeItem(at: staging) }

        let record = photoRecord(journeyId: journey.id, photoId: photoId, assetURL: staging)
        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let cd = try fetchPhoto(controller, photoId)
        XCTAssertEqual(cd.url, "journeys/\(journey.id)/photos/\(photoId).jpg",
                       "a synced-in photo gets the standard R2 key")
        let stored = try XCTUnwrap(cd.localOriginalPath)
        XCTAssertTrue(stored.hasPrefix(MediaLibrary.shared.root.standardizedFileURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: stored))
        try? FileManager.default.removeItem(at: URL(fileURLWithPath: stored))
    }

    // MARK: - Route / hero (apply must not blank fields the record cannot carry)

    /// A `routeJSON` asset the client cannot read decoded to `.empty` and was written straight
    /// over a perfectly good local route — which the next native edit then uploaded.
    func testApplyFetchedJourneyWithUnreadableRouteKeepsLocalRoute() throws {
        let (controller, journey) = try seededController()
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let record = try XCTUnwrap(controller.makeRecord(forRecordName: journey.id, zoneID: zone, existing: nil))
        let routeBefore = try XCTUnwrap(controller.loadJourneys().first).route
        XCTAssertFalse(routeBefore.coordinates.isEmpty, "fixture precondition: a real route")

        // Point routeJSON at a file that does not exist (unmaterialized / purged asset).
        record["routeJSON"] = CKAsset(fileURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-\(UUID().uuidString).json"))
        record["name"] = "Renamed From Server"

        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        let reloaded = try XCTUnwrap(controller.loadJourneys().first)
        XCTAssertEqual(reloaded.name, "Renamed From Server", "other fields still apply")
        XCTAssertEqual(reloaded.route.coordinates.count, routeBefore.coordinates.count,
                       "an unreadable route asset must leave the local route untouched")
    }

    func testApplyFetchedJourneyDoesNotEraseLocalHeroImageURL() throws {
        let (controller, journey) = try seededController()
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let cd = try XCTUnwrap(controller.viewContext.registeredObjects
            .compactMap { $0 as? CDJourney }.first { $0.id == journey.id })
        cd.heroImageURL = "journeys/\(journey.slug)/hero.png"
        try controller.viewContext.save()

        let record = try XCTUnwrap(controller.makeRecord(forRecordName: journey.id, zoneID: zone, existing: nil))
        controller.beginRemoteApply()
        controller.applyFetchedRecord(record)
        controller.endRemoteApply()

        XCTAssertEqual(cd.heroImageURL, "journeys/\(journey.slug)/hero.png",
                       "the record cannot carry the hero path, so applying it must not null it")
    }

    func testApplyDeletedJourneyCascades() throws {
        let (controller, journey) = try seededController()

        controller.beginRemoteApply()
        controller.applyDeletedRecord(recordName: journey.id, recordType: RecordCoder.RecordType.journey)
        controller.endRemoteApply()

        XCTAssertEqual(controller.loadJourneys().count, 0)
        let waypointRequest = NSFetchRequest<CDWaypoint>(entityName: "CDWaypoint")
        XCTAssertEqual(try controller.viewContext.count(for: waypointRequest), 0,
                       "deleting the journey cascades to its waypoints")
    }

    // MARK: - Media paths survive a new data container (T2.4 live-test regression)
    //
    // An iOS app's data container is re-created with a fresh UUID on reinstall, restore and
    // migration, which invalidates every absolute path stored in Core Data while the files
    // themselves are carried across. That is precisely the "restore the archive onto a new
    // phone" case CloudKit sync exists for — and it showed up the first time a synced install
    // was reinstalled: 1538 photos on disk, every single thumbnail a broken-image placeholder.

    private func makeMediaFile(relativeKey: String) throws -> URL {
        let url = MediaLibrary.shared.absoluteURL(forRelative: relativeKey)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        try Data([0x1]).write(to: url)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    func testStaleAbsolutePathFallsBackToTheRelativeKey() throws {
        let key = "journeys/j-media/photos/p-media_thumb.jpg"
        let real = try makeMediaFile(relativeKey: key)
        var photo = Photo(id: "p-media", journeyId: "j-media", url: "", thumbnailURL: key)
        photo.localThumbPath = "/var/mobile/Containers/Data/Application/DEAD-BEEF/Library/"
            + "Application Support/media/" + key

        XCTAssertEqual(photo.thumbnailFileURL?.standardizedFileURL,
                       real.standardizedFileURL,
                       "a dead container path must be re-resolved against the current media root")
        XCTAssertTrue(photo.hasLocalMedia)
    }

    func testValidAbsolutePathOutsideTheMediaRootStillWins() throws {
        // The local importer legitimately points at bytes inside the export bundle, where the
        // R2 key does not resolve — so the absolute path must be tried first, not second.
        let outside = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-outside-\(UUID().uuidString).jpg")
        try Data([0x1]).write(to: outside)
        addTeardownBlock { try? FileManager.default.removeItem(at: outside) }

        var photo = Photo(id: "p-outside", journeyId: "j-outside", url: "",
                          thumbnailURL: "journeys/j-outside/photos/nothing_thumb.jpg")
        photo.localThumbPath = outside.path

        XCTAssertEqual(photo.thumbnailFileURL?.standardizedFileURL, outside.standardizedFileURL)
    }

    func testMissingBytesResolveToNil() {
        var photo = Photo(id: "p-gone", journeyId: "j-gone", url: "journeys/j-gone/photos/p-gone.jpg",
                          thumbnailURL: "journeys/j-gone/photos/p-gone_thumb.jpg")
        photo.localOriginalPath = "/nope/original.jpg"
        photo.localThumbPath = "/nope/thumb.jpg"

        XCTAssertNil(photo.thumbnailFileURL)
        XCTAssertNil(photo.originalFileURL)
        XCTAssertFalse(photo.hasLocalMedia, "nothing on disk must not report local media")
    }

    /// The thumbnail falls back to the original so a photo whose thumb never downloaded still
    /// renders — via the same stale-path-tolerant resolution.
    func testThumbnailFallsBackToOriginalThroughTheRelativeKey() throws {
        let key = "journeys/j-fallback/photos/p-fallback.jpg"
        let real = try makeMediaFile(relativeKey: key)
        var photo = Photo(id: "p-fallback", journeyId: "j-fallback", url: key, thumbnailURL: nil)
        photo.localOriginalPath = "/gone/p-fallback.jpg"

        XCTAssertEqual(photo.thumbnailFileURL?.standardizedFileURL, real.standardizedFileURL)
    }
}
