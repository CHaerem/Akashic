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

    func testBothModelVersionsShipInTheBundle() throws {
        XCTAssertNotNil(try model(named: "Akashic"), "version 1 must stay in the bundle to migrate from")
        XCTAssertNotNil(try model(named: "Akashic 2"), "version 2 is the current model")
    }

    func testVersionOneHasNoZoneOwnerAndVersionTwoDoes() throws {
        let v1 = try XCTUnwrap(try model(named: "Akashic"))
        let v2 = try XCTUnwrap(try model(named: "Akashic 2"))
        XCTAssertNil(attribute("zoneOwnerName", inJourneyOf: v1))
        XCTAssertNotNil(attribute("zoneOwnerName", inJourneyOf: v2))
        // Optional, or migrating existing rows would fail validation on save.
        XCTAssertTrue(attribute("zoneOwnerName", inJourneyOf: v2)?.isOptional == true)
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
