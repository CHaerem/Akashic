import XCTest
import CoreData
@testable import Akashic

/// Guards the Core Data model version boundary.
///
/// T2.8 added `CDJourney.zoneOwnerName`. Editing the single model *in place* would have been
/// silently catastrophic: with no earlier version left in the bundle, Core Data cannot migrate
/// an existing store at all — it fails to open, and `PersistenceController` only asserts, so a
/// release build would come up with no archive and no explanation. Hence a real second model
/// version, and hence this test: it builds a store with the ORIGINAL model, then reopens it
/// with the current one, exactly as an upgrading install does.
final class StoreMigrationTests: XCTestCase {

    private var directory: URL!

    override func setUpWithError() throws {
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-migration-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testAllModelVersionsShipInTheBundle() throws {
        XCTAssertNotNil(try model(named: "Akashic"), "version 1 must stay in the bundle to migrate from")
        XCTAssertNotNil(try model(named: "Akashic 2"), "version 2 must stay in the bundle to migrate from")
        XCTAssertNotNil(try model(named: "Akashic 3"), "version 3 must stay in the bundle to migrate from")
        XCTAssertNotNil(try model(named: "Akashic 4"), "version 4 is the current model")
    }

    func testVersionOneHasNoZoneOwnerAndVersionTwoDoes() throws {
        let v1 = try XCTUnwrap(try model(named: "Akashic"))
        let v2 = try XCTUnwrap(try model(named: "Akashic 2"))
        XCTAssertNil(attribute("zoneOwnerName", inJourneyOf: v1))
        XCTAssertNotNil(attribute("zoneOwnerName", inJourneyOf: v2))
        // Optional, or migrating existing rows would fail validation on save.
        XCTAssertTrue(attribute("zoneOwnerName", inJourneyOf: v2)?.isOptional == true)
    }

    /// Version 3 adds ONLY the `CDSyncRecordMeta` side table (the system-fields store). A new,
    /// standalone entity is why the migration stays lightweight: there are no existing rows to
    /// transform, and none of the four domain entities changed. The uniqueness constraint on
    /// `recordName` is what lets the meta be upserted by record name.
    func testVersionThreeAddsOnlyTheSyncRecordMetaSideTable() throws {
        let v2 = try XCTUnwrap(try model(named: "Akashic 2"))
        let v3 = try XCTUnwrap(try model(named: "Akashic 3"))

        XCTAssertNil(v2.entitiesByName["CDSyncRecordMeta"], "the side table is new in v3")
        let meta = try XCTUnwrap(v3.entitiesByName["CDSyncRecordMeta"])
        XCTAssertNotNil(meta.attributesByName["recordName"])
        XCTAssertNotNil(meta.attributesByName["systemFields"])
        XCTAssertEqual(meta.attributesByName["systemFields"]?.attributeType, .binaryDataAttributeType)
        XCTAssertTrue(meta.uniquenessConstraints.contains { ($0 as? [String]) == ["recordName"] },
                      "recordName must be uniqueness-constrained so it can be upserted by name")

        // The four domain entities are byte-for-byte the same set as v2 (no churn -> lightweight).
        let domain = Set(v2.entitiesByName.keys)
        XCTAssertEqual(Set(v3.entitiesByName.keys), domain.union(["CDSyncRecordMeta"]),
                       "v3 adds the side table and changes nothing else")
    }

    /// The current model must open a store created by the IMMEDIATELY previous version (v2 ->
    /// v3), the exact upgrade a T2.8 install performs — inferred lightweight migration, the
    /// NSPersistentContainer defaults.
    func testVersionTwoStoreMigratesToCurrent() throws {
        let storeURL = directory.appendingPathComponent("AkashicV2.sqlite")
        let v2 = try XCTUnwrap(try model(named: "Akashic 2"))

        let old = NSPersistentStoreCoordinator(managedObjectModel: v2)
        try old.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL, options: nil)
        let oldContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        oldContext.persistentStoreCoordinator = old
        let journey = NSEntityDescription.insertNewObject(forEntityName: "CDJourney", into: oldContext)
        journey.setValue("kilimanjaro", forKey: "id")
        journey.setValue("Kilimanjaro", forKey: "name")
        journey.setValue("someone-else", forKey: "zoneOwnerName")   // a v2-only column, must survive
        try oldContext.save()
        for store in old.persistentStores { try old.remove(store) }

        let current = PersistenceController.managedObjectModel
        let new = NSPersistentStoreCoordinator(managedObjectModel: current)
        try new.addPersistentStore(
            ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL,
            options: [NSMigratePersistentStoresAutomaticallyOption: true,
                      NSInferMappingModelAutomaticallyOption: true])
        let newContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        newContext.persistentStoreCoordinator = new

        let migrated = try newContext.fetch(NSFetchRequest<NSManagedObject>(entityName: "CDJourney"))
        XCTAssertEqual(migrated.count, 1, "the journey must survive the v2 -> v3 upgrade")
        XCTAssertEqual(migrated.first?.value(forKey: "zoneOwnerName") as? String, "someone-else")
        // The new side table is present and empty on a freshly migrated store.
        XCTAssertEqual(try newContext.count(for: NSFetchRequest<NSManagedObject>(entityName: "CDSyncRecordMeta")), 0)
    }

    /// Version 4 adds ONLY `CDPhoto.contentHash`, optional (DIFF-14). Optional is what keeps the
    /// migration lightweight AND what keeps it honest: every photo imported before this existed has
    /// no hash, and a non-optional attribute would have to invent one for them.
    func testVersionFourAddsOnlyTheOptionalContentHash() throws {
        let v3 = try XCTUnwrap(try model(named: "Akashic 3"))
        let v4 = try XCTUnwrap(try model(named: "Akashic 4"))

        XCTAssertNil(v3.entitiesByName["CDPhoto"]?.attributesByName["contentHash"],
                     "contentHash is new in v4")
        let added = try XCTUnwrap(v4.entitiesByName["CDPhoto"]?.attributesByName["contentHash"])
        XCTAssertTrue(added.isOptional,
                      "a required attribute would fail validation for every pre-existing photo")
        XCTAssertEqual(added.attributeType, .stringAttributeType)

        // Nothing else moved: an additive change is the whole reason this stays inferrable.
        XCTAssertEqual(Set(v3.entitiesByName.keys), Set(v4.entitiesByName.keys))
        for (name, v3Entity) in v3.entitiesByName where name != "CDPhoto" {
            let v4Entity = try XCTUnwrap(v4.entitiesByName[name])
            XCTAssertEqual(Set(v3Entity.attributesByName.keys), Set(v4Entity.attributesByName.keys),
                           "\(name) must be untouched in v4")
        }
    }

    /// A v3 store holding a photograph, opened by the current model. The case that matters for
    /// anyone already running the app: their photos keep their identity and simply gain a nil hash.
    func testVersionThreeStoreWithAPhotoMigratesAndKeepsIt() throws {
        let storeURL = directory.appendingPathComponent("Akashic-v3.sqlite")
        let v3 = try XCTUnwrap(try model(named: "Akashic 3"))

        let old = NSPersistentStoreCoordinator(managedObjectModel: v3)
        try old.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil,
                                   at: storeURL, options: nil)
        let oldContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        oldContext.persistentStoreCoordinator = old
        let photo = NSEntityDescription.insertNewObject(forEntityName: "CDPhoto", into: oldContext)
        photo.setValue("P1", forKey: "id")
        photo.setValue("kilimanjaro", forKey: "journeyId")
        photo.setValue("Summit sign", forKey: "caption")
        try oldContext.save()
        for store in old.persistentStores { try old.remove(store) }

        let new = NSPersistentStoreCoordinator(managedObjectModel: PersistenceController.managedObjectModel)
        try new.addPersistentStore(
            ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL,
            options: [NSMigratePersistentStoresAutomaticallyOption: true,
                      NSInferMappingModelAutomaticallyOption: true])
        let newContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        newContext.persistentStoreCoordinator = new

        let migrated = try newContext.fetch(NSFetchRequest<NSManagedObject>(entityName: "CDPhoto"))
        XCTAssertEqual(migrated.count, 1, "the photograph must survive the upgrade")
        XCTAssertEqual(migrated.first?.value(forKey: "caption") as? String, "Summit sign")
        XCTAssertNil(migrated.first?.value(forKey: "contentHash"),
                     "an existing photo has no hash — absent must mean unknown, not unique")
    }

    /// The real thing: an existing v1 store with data in it, opened by the current app.
    func testExistingStoreMigratesAndKeepsItsData() throws {
        let storeURL = directory.appendingPathComponent("Akashic.sqlite")
        let v1 = try XCTUnwrap(try model(named: "Akashic"))

        // 1. An install from before T2.8.
        let old = NSPersistentStoreCoordinator(managedObjectModel: v1)
        try old.addPersistentStore(ofType: NSSQLiteStoreType, configurationName: nil,
                                   at: storeURL, options: nil)
        let oldContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        oldContext.persistentStoreCoordinator = old
        let journey = NSEntityDescription.insertNewObject(forEntityName: "CDJourney", into: oldContext)
        journey.setValue("kilimanjaro", forKey: "id")
        journey.setValue("Kilimanjaro", forKey: "name")
        try oldContext.save()
        for store in old.persistentStores { try old.remove(store) }

        // 2. The same store, opened by the current model with lightweight migration — the
        //    defaults `NSPersistentContainer` uses.
        let current = PersistenceController.managedObjectModel
        let new = NSPersistentStoreCoordinator(managedObjectModel: current)
        try new.addPersistentStore(
            ofType: NSSQLiteStoreType, configurationName: nil, at: storeURL,
            options: [NSMigratePersistentStoresAutomaticallyOption: true,
                      NSInferMappingModelAutomaticallyOption: true])

        let newContext = NSManagedObjectContext(concurrencyType: .mainQueueConcurrencyType)
        newContext.persistentStoreCoordinator = new
        let request = NSFetchRequest<NSManagedObject>(entityName: "CDJourney")
        let migrated = try newContext.fetch(request)

        XCTAssertEqual(migrated.count, 1, "the journey must survive the upgrade")
        XCTAssertEqual(migrated.first?.value(forKey: "name") as? String, "Kilimanjaro")
        XCTAssertNil(migrated.first?.value(forKey: "zoneOwnerName") as? String,
                     "an existing journey is ours, so it has no sharing owner")
    }

    // MARK: - Helpers

    private func model(named name: String) throws -> NSManagedObjectModel? {
        for bundle in [Bundle.main] + Bundle.allBundles {
            guard let momd = bundle.url(forResource: Config.coreDataModelName, withExtension: "momd")
            else { continue }
            let url = momd.appendingPathComponent("\(name).mom")
            if FileManager.default.fileExists(atPath: url.path) {
                return NSManagedObjectModel(contentsOf: url)
            }
        }
        return nil
    }

    private func attribute(_ name: String, inJourneyOf model: NSManagedObjectModel) -> NSAttributeDescription? {
        model.entitiesByName["CDJourney"]?.attributesByName[name]
    }
}
