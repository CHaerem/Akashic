import CoreData

/// Owns the Core Data stack in one of three modes (see `PersistenceMode`).
///
/// - `.fixtures`  — in-memory store seeded from the recovered fixtures (app default today).
/// - `.local`     — on-disk store, seeded once if empty.
/// - `.cloudKit`  — `NSPersistentCloudKitContainer` mirroring to `iCloud.no.akashic`.
///                  Fully compiled but only functional once CloudKit entitlements exist;
///                  loading this store without them fails at runtime, never at build time.
final class PersistenceController {

    /// App-wide instance, mode chosen by `Config.resolvedPersistenceMode`.
    static let shared = PersistenceController(mode: Config.resolvedPersistenceMode)

    /// SwiftUI preview instance (in-memory, seeded).
    static let preview = PersistenceController(mode: .fixtures)

    let container: NSPersistentContainer
    let mode: PersistenceMode

    /// A single shared model instance avoids "multiple NSEntityDescriptions claim…" warnings
    /// when several controllers are created (notably in tests).
    static let managedObjectModel: NSManagedObjectModel = {
        for bundle in [Bundle.main] + Bundle.allBundles {
            if let url = bundle.url(forResource: Config.coreDataModelName, withExtension: "momd"),
               let model = NSManagedObjectModel(contentsOf: url) {
                return model
            }
        }
        return NSManagedObjectModel.mergedModel(from: nil) ?? NSManagedObjectModel()
    }()

    var viewContext: NSManagedObjectContext { container.viewContext }

    init(mode: PersistenceMode, seed: Bool = true, fixtureBundle: Bundle = .main) {
        self.mode = mode
        let model = PersistenceController.managedObjectModel

        switch mode {
        case .cloudKit:
            let ckContainer = NSPersistentCloudKitContainer(name: Config.coreDataModelName,
                                                            managedObjectModel: model)
            if let description = ckContainer.persistentStoreDescriptions.first {
                description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
                description.setOption(true as NSNumber,
                                      forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)
                description.cloudKitContainerOptions = NSPersistentCloudKitContainerOptions(
                    containerIdentifier: Config.cloudKitContainerIdentifier)
            }
            container = ckContainer

        case .local:
            container = NSPersistentContainer(name: Config.coreDataModelName,
                                              managedObjectModel: model)

        case .fixtures:
            container = NSPersistentContainer(name: Config.coreDataModelName,
                                              managedObjectModel: model)
            // /dev/null makes SQLite behave as an ephemeral in-memory store.
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }

        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy

        var loadError: Error?
        container.loadPersistentStores { _, error in loadError = error }
        if let loadError {
            // .fixtures/.local cannot function without a store; make the failure loud in debug.
            assertionFailure("Core Data store load failed (\(mode)): \(loadError)")
        }

        guard seed else { return }
        switch mode {
        case .fixtures:
            seedFixtures(bundle: fixtureBundle)
        case .local:
            seedFixturesIfEmpty(bundle: fixtureBundle)
        case .cloudKit:
            break
        }
    }

    // MARK: - Seeding

    private func seedFixtures(bundle: Bundle) {
        let context = container.viewContext
        do {
            let journeys = try FixtureLoader.loadAll(bundle: bundle)
            for journey in journeys {
                CoreDataMapping.upsertJourney(journey, into: context)
            }
            if context.hasChanges { try context.save() }
        } catch {
            assertionFailure("Fixture seeding failed: \(error)")
        }
    }

    private func seedFixturesIfEmpty(bundle: Bundle) {
        let context = container.viewContext
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.fetchLimit = 1
        let existing = (try? context.count(for: request)) ?? 0
        if existing == 0 { seedFixtures(bundle: bundle) }
    }

    // MARK: - Reads

    /// All journeys currently in the store, mapped to the domain model, sorted by name.
    func loadJourneys() -> [Journey] {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        let rows = (try? container.viewContext.fetch(request)) ?? []
        return rows.map(CoreDataMapping.journey(from:))
    }
}
