import XCTest
import CloudKit
import CoreData
@testable import Akashic

/// v2 media-zone behaviour on the sync engine and the store (MAPPING §13): fetch-scope exclusion,
/// media-zone-loss routing, the makeRecord "clear original once confirmed" step, and the repack
/// pending/confirmed computation. Reuses the seam mocks defined in `SyncEngineTests`.
@MainActor
final class MediaSyncEngineTests: XCTestCase {

    private func makeDefaults() -> UserDefaults { UserDefaults(suiteName: "media-eng-\(UUID())")! }

    private func engine(store: FakeLocalStore, scope: CKDatabase.Scope = .private,
                        mock: MockSyncEngine = MockSyncEngine()) -> AkashicSyncEngine {
        AkashicSyncEngine(store: store, status: SyncStatus(),
                          accountProvider: MockAccountProvider(status: .available),
                          databaseScope: scope, defaults: makeDefaults(), engine: mock)
    }

    // MARK: - Fetch-scope exclusion

    func testMediaZonesExcludedForOwnedJourneys() {
        let store = FakeLocalStore()
        store.journeyIDs = ["j1", "j2"]
        let sut = engine(store: store)
        let excluded = Set(sut.mediaZoneIDsToExclude().map { $0.zoneName })
        XCTAssertEqual(excluded, ["journey-j1-media", "journey-j2-media"],
                       "every owned journey's media zone is excluded from fetch")
    }

    func testMediaExclusionIsDynamicAndOwnerRouted() {
        // A journey shared with us routes its media zone to the sharing owner (shared DB).
        let store = FakeLocalStore()
        store.journeyIDs = ["mine", "shared1"]
        store.zoneOwners["shared1"] = "owner-record-name"

        let priv = engine(store: store, scope: .private)
        XCTAssertEqual(Set(priv.mediaZoneIDsToExclude().map { $0.zoneName }), ["journey-mine-media"],
                       "the private engine excludes only the journeys it handles")

        let shared = engine(store: store, scope: .shared)
        let sharedZones = shared.mediaZoneIDsToExclude()
        XCTAssertEqual(sharedZones.map { $0.zoneName }, ["journey-shared1-media"])
        XCTAssertEqual(sharedZones.first?.ownerName, "owner-record-name",
                       "the shared engine's media zone carries the sharing owner")
    }

    func testDiscoveredMediaZonesExcludedEvenWithoutLocalJourney() {
        // Fresh restore: the local store is empty, but the server database-change event reveals a
        // media zone. It must be excluded from the fetch scope so the restore stays small.
        let store = FakeLocalStore()   // no local journeys
        let defaults = makeDefaults()
        let sut = AkashicSyncEngine(store: store, status: SyncStatus(),
                                    accountProvider: MockAccountProvider(status: .available),
                                    defaults: defaults, engine: MockSyncEngine())
        XCTAssertTrue(sut.mediaZoneIDsToExclude().isEmpty, "nothing known yet")

        let mediaZone = RecordCoder.mediaZoneID(forJourneyID: "restored")
        let dataZone = RecordCoder.zoneID(forJourneyID: "restored")
        sut.recordDiscoveredMediaZones([dataZone, mediaZone])   // a data zone must NOT be recorded

        XCTAssertEqual(sut.mediaZoneIDsToExclude().map { $0.zoneName }, ["journey-restored-media"])

        // Persisted: a fresh engine over the same defaults still excludes it (survives relaunch).
        let relaunched = AkashicSyncEngine(store: store, status: SyncStatus(),
                                           accountProvider: MockAccountProvider(status: .available),
                                           defaults: defaults, engine: MockSyncEngine())
        XCTAssertEqual(relaunched.mediaZoneIDsToExclude().map { $0.zoneName }, ["journey-restored-media"],
                       "discovered media zones survive relaunch")
    }

    // MARK: - Media-zone-loss routing

    func testMediaZoneLossTriggersHealNotJourneyReupload() async {
        let store = FakeLocalStore()
        store.journeyIDs = ["j7"]
        store.identities["j7"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey, recordName: "j7", journeyID: "j7"),
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo, recordName: "p7", journeyID: "j7"),
        ]
        let mock = MockSyncEngine()
        let sut = engine(store: store, mock: mock)
        await sut.activate()
        mock.reset()
        var healed: [String] = []
        sut.onMediaZoneLost = { healed.append($0) }

        sut.handleZoneDeletions([RecordCoder.mediaZoneID(forJourneyID: "j7")], reason: .deleted)

        XCTAssertEqual(healed, ["j7"], "a lost media zone heals that journey's PhotoMedia")
        XCTAssertTrue(mock.savedZoneNames.isEmpty, "a media-zone loss must NOT re-create the data zone")
        XCTAssertTrue(mock.savedRecordNames.isEmpty, "a media-zone loss must NOT re-enqueue journey records")
        XCTAssertTrue(store.purgedJourneyIDs.isEmpty, "no tag purge for a media zone")
    }

    func testMediaZoneLossInSharedScopeDoesNotHeal() async {
        let store = FakeLocalStore()
        store.zoneOwners["shared1"] = "owner"
        let sut = engine(store: store, scope: .shared)
        await sut.activate()
        var healed: [String] = []
        sut.onMediaZoneLost = { healed.append($0) }

        sut.handleZoneDeletions([RecordCoder.mediaZoneID(forJourneyID: "shared1", ownerName: "owner")],
                                reason: .deleted)

        XCTAssertTrue(healed.isEmpty, "a participant holds no originals — nothing to re-upload")
    }

    // MARK: - makeRecord clears original once media is confirmed

    func testMakeRecordClearsPhotoOriginalOnlyAfterMediaConfirmed() throws {
        let bundle = Bundle(for: type(of: self))
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        // Insert a photo row under the journey.
        let cdJourney = try XCTUnwrap(fetchJourney(controller, journey.id))
        let photo = Photo(id: "p-clear", journeyId: journey.id, waypointId: nil, url: "", thumbnailURL: nil,
                          caption: nil, coordinates: nil, takenAt: nil, isHero: false, sortOrder: 0,
                          rotation: 0, mediaType: "image", duration: nil, locationSource: nil,
                          localOriginalPath: nil, localThumbPath: nil)
        CoreDataMapping.upsertPhoto(photo, into: controller.viewContext, journey: cdJourney, waypoint: nil)
        try controller.viewContext.save()

        let zone = RecordCoder.zoneID(forJourneyID: journey.id)
        // A base record that already carries a server-side original asset.
        let base = CKRecord(recordType: "Photo", recordID: .init(recordName: "p-clear", zoneID: zone))
        let asset = try tempFile(contents: "server-original")
        defer { try? FileManager.default.removeItem(at: asset) }
        base["original"] = CKAsset(fileURL: asset)

        // Before the media is confirmed, makeRecord leaves the base's original intact.
        let before = try XCTUnwrap(controller.makeRecord(forRecordName: "p-clear", zoneID: zone, existing: base))
        XCTAssertNotNil(before["original"] as? CKAsset, "original stays until PhotoMedia is confirmed")

        // Confirm the media (persist the `media-p-clear` meta), then makeRecord clears the original.
        let mediaRecord = CKRecord(recordType: "PhotoMedia",
                                   recordID: .init(recordName: "media-p-clear",
                                                   zoneID: RecordCoder.mediaZoneID(forJourneyID: journey.id)))
        controller.recordsDidSave([mediaRecord])

        let base2 = CKRecord(recordType: "Photo", recordID: .init(recordName: "p-clear", zoneID: zone))
        base2["original"] = CKAsset(fileURL: asset)
        let after = try XCTUnwrap(controller.makeRecord(forRecordName: "p-clear", zoneID: zone, existing: base2))
        XCTAssertNil(after["original"], "once PhotoMedia is confirmed, the Photo record's original is cleared")
    }

    // MARK: - Repack pending / confirmed computation (real store)

    func testMediaRepackPendingAndConfirmedComputation() throws {
        let bundle = Bundle(for: type(of: self))
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        let cdJourney = try XCTUnwrap(fetchJourney(controller, journey.id))

        // p-bytes: owner journey + local original present -> pending.
        let bytes = try tempFile(contents: "orig")
        defer { try? FileManager.default.removeItem(at: bytes) }
        insertPhoto(controller, id: "p-bytes", journey: cdJourney, localOriginalPath: bytes.path)
        // p-nobytes: no local bytes -> skipped (never pending).
        insertPhoto(controller, id: "p-nobytes", journey: cdJourney, localOriginalPath: nil)
        try controller.viewContext.save()

        var pending = controller.mediaRepackPending().map(\.photoID)
        XCTAssertEqual(pending, ["p-bytes"], "only owner photos with local bytes are pending")
        XCTAssertEqual(controller.mediaRepackConfirmedCount(), 0)

        // Confirm p-bytes -> no longer pending, confirmed count rises.
        let mediaRecord = CKRecord(recordType: "PhotoMedia",
                                   recordID: .init(recordName: "media-p-bytes",
                                                   zoneID: RecordCoder.mediaZoneID(forJourneyID: journey.id)))
        controller.recordsDidSave([mediaRecord])
        pending = controller.mediaRepackPending().map(\.photoID)
        XCTAssertTrue(pending.isEmpty, "a confirmed photo is no longer pending (resumable/idempotent)")
        XCTAssertEqual(controller.mediaRepackConfirmedCount(), 1)
    }

    func testMediaRepackSkipsSharedInJourneys() throws {
        let bundle = Bundle(for: type(of: self))
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "mountKenya", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        let cdJourney = try XCTUnwrap(fetchJourney(controller, journey.id))
        cdJourney.zoneOwnerName = "someone-else"          // shared WITH us -> only the owner repacks
        let bytes = try tempFile(contents: "orig")
        defer { try? FileManager.default.removeItem(at: bytes) }
        insertPhoto(controller, id: "p1", journey: cdJourney, localOriginalPath: bytes.path)
        try controller.viewContext.save()

        XCTAssertTrue(controller.mediaRepackPending().isEmpty,
                      "a journey shared with us is never repacked locally")
    }

    // MARK: - Helpers

    private func tempFile(contents: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("mse-\(UUID()).bin")
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func fetchJourney(_ controller: PersistenceController, _ id: String) -> CDJourney? {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "id == %@", id)
        request.fetchLimit = 1
        return (try? controller.viewContext.fetch(request))?.first
    }

    private func insertPhoto(_ controller: PersistenceController, id: String,
                             journey: CDJourney, localOriginalPath: String?) {
        let cd = CDPhoto(context: controller.viewContext)
        cd.id = id
        cd.journeyId = journey.id
        cd.journey = journey
        cd.url = ""
        cd.mediaType = "image"
        cd.localOriginalPath = localOriginalPath
    }
}
