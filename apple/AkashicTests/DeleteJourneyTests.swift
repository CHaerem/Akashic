import XCTest
import CoreData
import CloudKit
@testable import Akashic

/// The delete-journey feature: `PersistenceController.deleteJourney` (local cascade + meta purge,
/// suppressed so the scheduler never forwards it), `AkashicSyncEngine.deleteZones` (the two-zone
/// remote delete), and `JourneyStore.deleteBlocker`/`deleteJourney` (the ownership + still-published
/// gates the UI consults before offering the destructive action).
@MainActor
final class DeleteJourneyTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func seededController() throws -> (PersistenceController, Journey) {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        try controller.viewContext.save()
        return (controller, journey)
    }

    private func fetchMeta(_ controller: PersistenceController, _ recordName: String) throws -> CDSyncRecordMeta? {
        let request = NSFetchRequest<CDSyncRecordMeta>(entityName: "CDSyncRecordMeta")
        request.predicate = NSPredicate(format: "recordName == %@", recordName)
        return try controller.viewContext.fetch(request).first
    }

    @discardableResult
    private func insertPhoto(into controller: PersistenceController, journeyId: String, id: String) throws -> CDPhoto {
        let cd = CDPhoto(context: controller.viewContext)
        cd.id = id
        cd.journeyId = journeyId
        cd.url = "journeys/\(journeyId)/photos/\(id).jpg"
        cd.thumbnailURL = "journeys/\(journeyId)/photos/\(id)_thumb.jpg"
        cd.mediaType = "image"
        cd.createdAt = Date()
        try controller.viewContext.save()
        return cd
    }

    // MARK: - Local cascade + meta purge (PersistenceController.deleteJourney)

    /// Deleting a journey removes its row, its cascaded children (waypoints, photos), AND every
    /// system-fields meta row that belongs to it — including the `media-<photoId>` row for its
    /// v2 media-zone PhotoMedia record, which lives in the meta side table under its own key and
    /// is purged explicitly (`purgeSystemFields(forRecordNames:)`), not by the Core Data cascade.
    func testDeleteJourneyRemovesRowsAndAllSystemFieldsMeta() throws {
        let (controller, journey) = try seededController()
        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        let camp = journey.camps[0]
        let photoID = "photo-\(UUID().uuidString)"
        try insertPhoto(into: controller, journeyId: journey.id, id: photoID)

        // Seed meta for the journey and one waypoint via the apply path (as
        // testDeletingRecordsRemovesTheirSystemFields does in SyncStoreTests).
        controller.beginRemoteApply()
        controller.applyFetchedRecord(try XCTUnwrap(controller.makeRecord(forRecordName: journey.id, zoneID: zone, existing: nil)))
        controller.applyFetchedRecord(try XCTUnwrap(controller.makeRecord(forRecordName: camp.id, zoneID: zone, existing: nil)))
        controller.endRemoteApply()
        // The photo's PhotoMedia meta row: applyFetchedRecord doesn't know the PhotoMedia type (it
        // lives in the excluded media zone), so seed it the way a real send confirmation would —
        // via recordsDidSave, which persists system fields for any record type.
        let mediaZone = RecordCoder.mediaZoneID(forJourneyID: journey.id)
        controller.recordsDidSave([
            RecordCoder.recordForPhotoMedia(photoID: photoID, journeyID: journey.id, in: mediaZone, originalPath: nil),
        ])

        XCTAssertNotNil(try fetchMeta(controller, journey.id), "precondition: journey meta seeded")
        XCTAssertNotNil(try fetchMeta(controller, camp.id), "precondition: waypoint meta seeded")
        XCTAssertNotNil(try fetchMeta(controller, RecordCoder.mediaRecordName(forPhotoID: photoID)),
                        "precondition: media-<photoId> meta seeded")

        controller.deleteJourney(id: journey.id)

        XCTAssertEqual(controller.loadJourneys().count, 0, "journey row removed")
        let waypointRequest = NSFetchRequest<CDWaypoint>(entityName: "CDWaypoint")
        XCTAssertEqual(try controller.viewContext.count(for: waypointRequest), 0, "cascade removes waypoints")
        let photoRequest = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        XCTAssertEqual(try controller.viewContext.count(for: photoRequest), 0, "cascade removes photos")

        XCTAssertNil(try fetchMeta(controller, journey.id), "journey meta purged")
        XCTAssertNil(try fetchMeta(controller, camp.id), "waypoint meta purged")
        XCTAssertNil(try fetchMeta(controller, RecordCoder.mediaRecordName(forPhotoID: photoID)),
                    "media-<photoId> meta purged")
    }

    /// The local cascade must never reach a running scheduler as `deleteRecord` changes — the two
    /// zone deletes (enqueued separately, up front) are the entire remote story; a forwarded
    /// per-row cascade would race the zone delete and could resurrect the zone via send-failure
    /// recovery. Mirrors `testResetJourneysDoesNotForwardDeletesToRunningEngine`.
    func testDeleteJourneySuppressesCascadeFromRunningScheduler() async throws {
        let (controller, journey) = try seededController()
        try insertPhoto(into: controller, journeyId: journey.id, id: "photo-suppressed")

        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(store: controller, status: SyncStatus(),
                                       accountProvider: MockAccountProvider(status: .available),
                                       defaults: UserDefaults(suiteName: "delete-journey-\(UUID().uuidString)")!,
                                       engine: mock)
        await engine.activate()
        let scheduler = SyncScheduler(context: controller.viewContext, engines: [engine],
                                      isApplyingRemoteChanges: { controller.syncIsApplyingRemoteChanges })
        withExtendedLifetime(scheduler) {
            mock.reset()   // clear the initial-upload enqueue

            controller.deleteJourney(id: journey.id)

            XCTAssertTrue(mock.deletedRecordNames.isEmpty,
                          "deleteJourney's local cascade must NEVER forward deleteRecord changes to the sync engine")
            XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty,
                          "no pending record changes at all reach the engine during the delete")
        }
        XCTAssertFalse(controller.syncIsApplyingRemoteChanges, "the suppression flag is restored afterward")
    }

    // MARK: - Remote zone deletes (AkashicSyncEngine.deleteZones)

    /// Deleting a journey's zones enqueues exactly the journey zone and its `-media` sibling —
    /// the two-zone cascade boundary that removes every record and asset without enumerating them.
    func testDeleteZonesEnqueuesJourneyAndMediaZoneOnPrivateScope() async {
        let store = FakeLocalStore()
        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(store: store, status: SyncStatus(),
                                       accountProvider: MockAccountProvider(status: .available),
                                       defaults: UserDefaults(suiteName: "delete-zones-\(UUID().uuidString)")!,
                                       engine: mock)
        await engine.activate()
        mock.reset()

        engine.deleteZones(forJourneyID: "j7")

        let deletedZoneNames = mock.pendingDatabaseChanges.compactMap {
            if case .deleteZone(let id) = $0 { return id.zoneName } else { return nil }
        }
        XCTAssertEqual(Set(deletedZoneNames),
                       Set([RecordCoder.zoneID(forJourneyID: "j7").zoneName,
                            RecordCoder.mediaZoneID(forJourneyID: "j7").zoneName]))
        XCTAssertEqual(deletedZoneNames.count, 2, "exactly the journey zone and its media sibling — no more")
    }

    /// Zone deletion is owner-only by construction: a journey shared *into* this account lives in
    /// the shared database, where deleting the owner's zone is not ours to do.
    func testDeleteZonesIsNoOpInSharedScope() async {
        let store = FakeLocalStore()
        let mock = MockSyncEngine()
        let engine = AkashicSyncEngine(store: store, status: SyncStatus(),
                                       accountProvider: MockAccountProvider(status: .available),
                                       containerIdentifier: Config.cloudKitContainerIdentifier,
                                       databaseScope: .shared,
                                       defaults: UserDefaults(suiteName: "delete-zones-shared-\(UUID().uuidString)")!,
                                       engine: mock)
        await engine.activate()
        mock.reset()

        engine.deleteZones(forJourneyID: "shared1")

        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty, "shared scope must never enqueue a zone delete")
    }

    // MARK: - deleteBlocker (JourneyStore)

    /// A journey shared *into* this account (`zoneOwnerName` set) is the owner's to delete, not
    /// ours — surfaced regardless of its publish state.
    func testDeleteBlockerSharedInJourneyIsNotOwner() throws {
        let (controller, journey) = try seededController()
        let cd = try XCTUnwrap(controller.viewContext.registeredObjects
            .compactMap { $0 as? CDJourney }.first { $0.id == journey.id })
        cd.zoneOwnerName = "someone-else"
        try controller.viewContext.save()

        let store = JourneyStore(persistence: controller)
        XCTAssertEqual(store.deleteBlocker(forJourneyID: journey.id), .notOwner)
    }

    /// A published journey blocks deletion ONLY where the public showcase mirror actually exists
    /// (`.cloudKit` mode) — in `.fixtures` (and `.local`) there is no mirror to strand, so `isPublic`
    /// alone must not block. Exercises the real mode gate in `deleteBlocker`, so the `.cloudKit`
    /// controller here is pointed at a throwaway temp file (`storeURL`) rather than the app's real
    /// on-disk store.
    func testDeleteBlockerStillPublishedOnlyGatesInCloudKitMode() throws {
        // .fixtures: published, but no mirror exists outside .cloudKit mode -> not blocked.
        let (fixturesController, fixturesJourney) = try seededController()
        fixturesController.setJourneyPublic(id: fixturesJourney.id, isPublic: true)
        let fixturesStore = JourneyStore(persistence: fixturesController)
        XCTAssertNil(fixturesStore.deleteBlocker(forJourneyID: fixturesJourney.id),
                    ".fixtures mode has no public mirror, so a published journey is not blocked")

        // .cloudKit: published -> blocked (the mirror would be stranded with no owner to remove it).
        // Uses a uniquely-named throwaway temp file (never the app's real store) and deliberately
        // leaves it for the OS to reclaim: in the CloudKit-entitled build, `.cloudKit` mode starts
        // a real background sync Task that can still touch the store briefly after this test
        // returns, so deleting the file in a teardown block races that task (harmless but noisy).
        let storeURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("delete-journey-cloudkit-\(UUID().uuidString).sqlite")
        let cloudKitController = PersistenceController(mode: .cloudKit, seed: false,
                                                        fixtureBundle: bundle, storeURL: storeURL)
        let cloudKitJourney = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(cloudKitJourney, into: cloudKitController.viewContext)
        try cloudKitController.viewContext.save()
        cloudKitController.setJourneyPublic(id: cloudKitJourney.id, isPublic: true)

        let cloudKitStore = JourneyStore(persistence: cloudKitController)
        XCTAssertEqual(cloudKitStore.deleteBlocker(forJourneyID: cloudKitJourney.id), .stillPublished)
    }

    /// An owned, unpublished journey may be deleted: `deleteBlocker` is nil, and `deleteJourney`
    /// both reports success and actually removes the row.
    func testDeleteBlockerOwnedPrivateJourneyAllowsDeletion() throws {
        let (controller, journey) = try seededController()
        let store = JourneyStore(persistence: controller)

        XCTAssertNil(store.deleteBlocker(forJourneyID: journey.id))
        XCTAssertTrue(store.deleteJourney(id: journey.id))
        XCTAssertNil(store.journey(withID: journey.id), "the journey is gone from the store's published snapshot")
    }
}
