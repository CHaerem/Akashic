import CoreData

/// Owns the Core Data stack in one of three modes (see `PersistenceMode`).
///
/// - `.fixtures`  — in-memory store seeded from the recovered fixtures (app default today).
/// - `.local`     — on-disk store, seeded once if empty.
/// - `.cloudKit`  — the SAME on-disk local SQLite store as `.local`, with an
///                  `AkashicSyncEngine` (D4: `CKSyncEngine`, custom record types, one custom
///                  zone per journey — see `Sync/`) attached. The engine only starts when an
///                  iCloud account is available; with none (the simulator today) the app keeps
///                  working locally and `syncStatus` explains why. Compiles with no team;
///                  needs the `Debug-CloudKit`/`Release-CloudKit` entitlements to run for real.
final class PersistenceController {

    /// App-wide instance, mode chosen by `Config.resolvedPersistenceMode`.
    static let shared = PersistenceController(mode: Config.resolvedPersistenceMode)

    /// SwiftUI preview instance (in-memory, seeded).
    static let preview = PersistenceController(mode: .fixtures)

    let container: NSPersistentContainer
    let mode: PersistenceMode

    /// IDs of journeys seeded from the bundled demo fixtures THIS SESSION. Populated fresh on
    /// every launch by `.fixtures` mode's full in-memory reseed (all three dev fixtures), and
    /// also by a same-session seed of the ONE `.local`/`.cloudKit` demo journey (D9). These are
    /// never a customer's real content, so the free-tier create gate excludes them — a fresh
    /// install (or a dev/demo run) must never have its one free journey pre-consumed by the demo
    /// data. (quality gate: fixture-seeded demo journeys consume the free tier.)
    private(set) var seededJourneyIDs: Set<String> = []

    /// Bundle the demo journey is (re)loaded from on a later launch — stored (not `private`:
    /// `PersistenceController+Sync.swift`'s `startSync()` reads it when wiring the deferred
    /// `.cloudKit` seed) so that seed, fired from `onFreshInstallDetermined` long after `init`
    /// returned, reads the fixture from the same place `init` would have.
    let fixtureBundle: Bundle

    /// Where the once-ever demo-seed decision and the persisted demo journey ids are recorded.
    /// Injectable so tests can simulate "the next launch" against a throwaway suite instead of
    /// polluting `.standard` (see `SyncEngineTests.makeDefaults()` for the same pattern).
    private let defaults: UserDefaults

    /// Whether a journey was seeded from the bundled demo fixtures — checked against BOTH the
    /// in-memory `seededJourneyIDs` (this session's `.fixtures` reseed, or a same-session demo
    /// seed) AND `demoJourneyIDs` persisted in `UserDefaults` (D9: the ONE demo journey seeded
    /// into a real on-disk store is seeded at most once ever — see `seedDemoJourneyIfFreshInstall`
    /// — so nothing would ever repopulate an in-memory set for it again on a later launch; without
    /// the persisted half of this check, the demo journey would silently start counting against
    /// the free tier, and start syncing, from the SECOND launch onward).
    func isSeededFixture(journeyID: String) -> Bool {
        seededJourneyIDs.contains(journeyID) || Self.persistedDemoJourneyIDs(defaults).contains(journeyID)
    }

    // MARK: - CloudKit sync stack (populated only in `.cloudKit` mode; see `Sync/`)

    /// Observable sync status for the UI. Always present but `.disabled` outside `.cloudKit`.
    let syncStatus = SyncStatus()
    /// The sync coordinator for our own journeys (private database); nil unless `.cloudKit`.
    var syncCoordinator: AkashicSyncEngine?
    /// The coordinator for journeys shared with us (shared database, T2.8); nil unless `.cloudKit`.
    var sharedSyncCoordinator: AkashicSyncEngine?
    /// Observes local Core Data saves and feeds them to the engine; nil unless `.cloudKit`.
    var syncScheduler: SyncScheduler?
    /// The one-time v2 photo-storage repack (MAPPING §13). Held so a Wi-Fi path change can resume
    /// it. nil unless `.cloudKit` on the owner's device.
    var mediaRepackJob: MediaRepackJob?
    /// Set by the engine while applying fetched server records, so the scheduler ignores the
    /// echo save (see `SyncScheduler` / `PersistenceController+Sync`).
    var syncIsApplyingRemoteChanges = false

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

    /// - Parameter storeURL: overrides the on-disk file for `.local`/`.cloudKit` (nil keeps the
    ///   default Application Support location). Exists so a test that specifically needs
    ///   `mode == .cloudKit` (e.g. to exercise a mode-gated branch like `deleteBlocker`'s
    ///   still-published check) can point at a throwaway temp file instead of the app's real
    ///   store — every other test drives the engine/store seam directly and stays on `.fixtures`.
    init(mode: PersistenceMode, seed: Bool = true, fixtureBundle: Bundle = .main,
         storeURL: URL? = nil, defaults: UserDefaults = .standard) {
        self.mode = mode
        self.fixtureBundle = fixtureBundle
        self.defaults = defaults
        let model = PersistenceController.managedObjectModel

        switch mode {
        case .local, .cloudKit:
            // `.cloudKit` uses the same on-disk local store as `.local`; sync is layered on top
            // by `CKSyncEngine` (attached below), NOT by NSPersistentCloudKitContainer — that
            // placeholder is retired (it would have generated an incompatible `CD_`-prefixed
            // schema; see CloudKit/MAPPING.md §12 + the D4 decision).
            container = NSPersistentContainer(name: Config.coreDataModelName,
                                              managedObjectModel: model)
            if let storeURL {
                container.persistentStoreDescriptions.first?.url = storeURL
            }

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

        // Heal any child rows orphaned by a previous out-of-order sync (foreign-key string set,
        // relationship nil). Prevention lives in the sync-apply path; this is the retroactive
        // cure for a store that was already written wrong — e.g. an install that synced Mount
        // Kenya's days before its journey and has shown zero days ever since. Cheap: the fetches
        // are normally empty and it runs once at launch.
        repairOrphanedRelationships()

        // Attach the CloudKit sync engine (account-gated inside `startSync`/`activate`). Built
        // on the main actor: `.shared`/`.cloudKit` is created on launch from `@MainActor`
        // `JourneyStore`. Nearly every test drives the engine/store seam directly and stays on
        // `.fixtures`, so this main-actor assumption is mostly exercised on the app's own launch
        // path; the rare test that does build `.cloudKit` (via the `storeURL` override above,
        // to reach a mode-gated branch) runs on XCTest's main-thread test runner, so the
        // assumption still holds there.
        if mode == .cloudKit {
            MainActor.assumeIsolated { startSync() }
        }

        // `AKASHIC_EMPTY=1` keeps the store empty in every mode. Without it, the state a brand-new
        // customer actually sees — no journeys at all — could only be reached with a signed
        // CloudKit build and an empty iCloud account, which made the app's most important screen
        // the hardest one for its author to look at (and impossible to screenshot for the store).
        guard seed, !Config.startEmpty else { return }
        switch mode {
        case .fixtures:
            seedFixtures(bundle: fixtureBundle)
        case .local:
            // `.local` never syncs, so there is no "real data about to arrive" race to consider —
            // safe to decide synchronously, right here. `.cloudKit`'s equivalent is deliberately
            // NOT called from init (see `seedDemoJourneyIfFreshInstall`'s doc comment); it is wired
            // instead to `AkashicSyncEngine`'s `onFreshInstallDetermined` hook by `startSync()`.
            seedDemoJourneyIfFreshInstall(bundle: fixtureBundle)
        case .cloudKit:
            break
        }
    }

    // MARK: - Seeding

    /// `.fixtures` dev mode: seed ALL THREE bundled dev fixtures into the in-memory store, every
    /// launch. Deliberately unchanged by D9 — this is a development convenience (see every
    /// `PersistenceController(mode: .fixtures, ...)` test/preview call site), not the one
    /// customer-facing demo journey below, and it must keep working exactly as it did before.
    private func seedFixtures(bundle: Bundle) {
        let context = container.viewContext
        do {
            // DIFF-10: each dev fixture also gets its own bundled photographs, so `.fixtures` mode
            // (every preview, every screenshot run, the default simulator build) exercises the same
            // photo path the demo journey uses rather than a photo-free special case.
            let manifest = FixtureMedia.loadManifest(bundle: bundle)
            for name in FixtureLoader.fixtureNames {
                let trek = try FixtureLoader.trek(named: name, bundle: bundle)
                let journey = FixtureLoader.map(trek)
                let cd = CoreDataMapping.upsertJourney(journey, into: context)
                seededJourneyIDs.insert(journey.id)
                // No id prefix: `.fixtures` is an in-memory dev store that never syncs, and its
                // journeys deliberately keep their raw fixture ids (see this method's doc comment).
                seedPhotos(for: journey, slug: trek.slug, cdJourney: cd, manifest: manifest,
                           idPrefix: "", bundle: bundle, context: context)
            }
            if context.hasChanges { try context.save() }
        } catch {
            assertionFailure("Fixture seeding failed: \(error)")
        }
    }

    /// Stage a fixture journey's bundled photographs into the media library and persist their rows
    /// (DIFF-10). Never throws: a journey with no photographs is a lesser failure than no journey.
    ///
    /// Called before the enclosing `save()`, so the demo's `seededJourneyIDs` registration has already
    /// happened by the time `SyncScheduler` observes the save — which is what keeps these photo rows
    /// sync-excluded along with their journey (`AkashicSyncEngine.handles(journeyID:)` gates every
    /// upload path on the journey id a photo carries).
    private func seedPhotos(for journey: Journey, slug: String, cdJourney: CDJourney,
                            manifest: FixturePhotoManifest, idPrefix: String,
                            bundle: Bundle, context: NSManagedObjectContext) {
        let fixtures = manifest.photos(forSlug: slug)
        guard !fixtures.isEmpty else { return }
        let photos = FixtureMedia.stagePhotos(fixtures, for: journey,
                                              idPrefix: idPrefix, bundle: bundle)
        guard !photos.isEmpty else { return }

        var waypointsByID: [String: CDWaypoint] = [:]
        for waypoint in (cdJourney.waypoints as? Set<CDWaypoint> ?? []) {
            if let id = waypoint.id { waypointsByID[id] = waypoint }
        }
        for photo in photos {
            CoreDataMapping.upsertPhoto(photo, into: context, journey: cdJourney,
                                        waypoint: photo.waypointId.flatMap { waypointsByID[$0] })
        }
    }

    /// Persisted (survives every relaunch) key recording whether the once-ever bundled-demo-seed
    /// decision has already been made — seeded, or deliberately skipped. Checking "is the store
    /// empty" instead (as the pre-D9 `.local` seeding did) cannot distinguish "fresh install,
    /// never seeded" from "the customer deleted the sample" — both leave zero journeys in the
    /// store — so a store-emptiness check alone would resurrect a deleted sample on every
    /// relaunch. This flag is the difference. (quality gate: deleting the demo journey stays
    /// deleted across relaunches.)
    private static let demoSeedDecidedKey = "akashic.demo.seedDecided"

    /// Persisted ids of journeys seeded as the bundled demo. `seededJourneyIDs` above is
    /// in-memory and would NOT be repopulated on a later launch (the demo, unlike `.fixtures`
    /// mode's dev fixtures, is seeded at most once ever — there is nothing to reseed on launch
    /// two) — so `isSeededFixture` reads this persisted list too, which is what keeps the demo
    /// free-tier-exempt and sync-excluded for its whole lifetime, not just its first session.
    private static let demoJourneyIDsKey = "akashic.demo.journeyIDs"

    private static func persistedDemoJourneyIDs(_ defaults: UserDefaults) -> Set<String> {
        Set(defaults.stringArray(forKey: demoJourneyIDsKey) ?? [])
    }

    /// Seed the ONE bundled demo journey (Kilimanjaro — real route, real days, real notes, and since
    /// DIFF-10 its bundled photograph(s) too, so a photo-memory app's first-launch sample is not
    /// photo-free) into a real (`.local`/`.cloudKit`) store, **at most once ever**, and only into a
    /// store that is genuinely empty at the moment this runs.
    ///
    /// Two different callers reach this, deliberately at different times:
    ///  - `.local`, synchronously from `init` — `.local` never syncs, so there is no race: whatever
    ///    the store holds right now is all it will ever hold from outside this process.
    ///  - `.cloudKit`, from `AkashicSyncEngine.onFreshInstallDetermined` (wired in
    ///    `PersistenceController+Sync.startSync`) — fired only once the ONE fact that makes seeding
    ///    safe is known: either there is no iCloud account (sync can never deliver anything, ever),
    ///    or the FIRST fetch attempt just SUCCEEDED (the local store now reflects whatever the
    ///    account actually holds). It is deliberately NOT fired when that fetch is deferred
    ///    (Wi-Fi-only policy) or throws — in both cases whether real data is about to land is still
    ///    unknown, and seeding a sample into a family archive that is about to arrive by sync is
    ///    worse than not shipping the feature at all. If the account turns out to hold real
    ///    journeys (or the user created one locally before this resolved), the store is no longer
    ///    empty by the time this runs and the demo is skipped for good.
    func seedDemoJourneyIfFreshInstall(bundle: Bundle) {
        guard !defaults.bool(forKey: Self.demoSeedDecidedKey) else { return }

        // `AKASHIC_EMPTY=1` must mean empty, full stop — the screenshot/empty-state seam takes
        // precedence over the demo. Checked BEFORE the once-ever decision is marked below: a
        // screenshot run must never permanently burn the real decision it deliberately isn't
        // making, or the demo would silently never seed on that install again (quality gate:
        // `AKASHIC_EMPTY=1` does not consume the demo-seed decision).
        guard !Config.startEmpty else { return }

        // Decided either way, the moment this runs past the guards above — seeded or skipped, this
        // must never be reconsidered on a later launch (or a later call this same launch, e.g. a
        // sign-out/sign-in cycle re-running `activate()`).
        defer { defaults.set(true, forKey: Self.demoSeedDecidedKey) }

        let context = container.viewContext
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.fetchLimit = 1
        let existing = (try? context.count(for: request)) ?? 0
        guard existing == 0 else { return }   // not a fresh install, or real data already landed

        do {
            let trek = try FixtureLoader.trek(named: "kilimanjaro", bundle: bundle)
            // Re-mint every stable id the fixture carries — see `remapToDemoIdentity`'s doc
            // comment for why this is a ship-blocker, not a nicety.
            let journey = Self.remapToDemoIdentity(FixtureLoader.map(trek))
            let cd = CoreDataMapping.upsertJourney(journey, into: context)
            // Recorded BEFORE `save()`: the Core Data save notification `SyncScheduler` observes
            // fires synchronously, on this thread, from inside `save()` — so `isSeededFixture` must
            // already say true for this id by then, or the engine would enqueue the demo's own
            // insert for upload before this function returns.
            seededJourneyIDs.insert(journey.id)
            // DIFF-10: the demo journey's photographs. Ids carry the same `demo-` prefix as the
            // journey and its waypoints, for the same record-identity reason.
            seedPhotos(for: journey, slug: trek.slug, cdJourney: cd,
                       manifest: FixtureMedia.loadManifest(bundle: bundle),
                       idPrefix: "demo-", bundle: bundle, context: context)
            if context.hasChanges { try context.save() }
            var ids = Self.persistedDemoJourneyIDs(defaults)
            ids.insert(journey.id)
            defaults.set(Array(ids), forKey: Self.demoJourneyIDsKey)
        } catch {
            assertionFailure("Demo journey seeding failed: \(error)")
        }
    }

    /// Re-mint every stable identity the bundled demo fixture carries — the journey id AND every
    /// waypoint (`Camp`) id — before it ever touches a real store.
    ///
    /// `kilimanjaro.json` was recovered from the real family archive, so it carries the SAME
    /// `id`s the real records use — and MAPPING.md's contract is `Journey.recordName =
    /// journeys.id`, `Waypoint.recordName = waypoints.id`. Seeding the fixture verbatim means the
    /// demo and the real Kilimanjaro share a record identity: a later iCloud sign-in (or, over the
    /// SHARED database, a participant whose own device seeded the demo) upserts the real record
    /// into the row this device already branded "sample" — silently excluding the family's real
    /// journey from sync forever (`isSeededFixture`), lying in its delete confirmation ("never
    /// synced"), and cascading a real delete onto real local rows and the real media directory if
    /// the "sample" is ever removed. A demo id must be constructible in a way that can NEVER
    /// collide with anything that could arrive by sync or share, so every id is prefixed rather
    /// than kept verbatim. `journey.slug`, day content (funFacts/pointsOfInterest/historicalSites)
    /// and route geometry are untouched — they carry no record identity of their own (MAPPING.md
    /// §1) and reference camps only by array position, never by id, so remapping camp ids alone
    /// keeps day/camp references internally consistent.
    ///
    /// Applied ONLY on this path — never `.fixtures` mode's `seedFixtures`, which is an in-memory
    /// dev convenience that never touches a real (on-disk, syncable) store and must keep using the
    /// fixtures' raw ids exactly as before.
    static func remapToDemoIdentity(_ journey: Journey) -> Journey {
        var demo = journey
        demo.id = "demo-\(journey.id)"
        demo.camps = journey.camps.map { camp in
            var remapped = camp
            remapped.id = "demo-\(camp.id)"
            return remapped
        }
        return demo
    }

    // MARK: - Reads

    /// All journeys currently in the store, mapped to the domain model, sorted by name.
    /// Re-link child rows whose foreign-key string names a parent that exists locally but whose
    /// relationship is nil — the residue of out-of-order CloudKit delivery (a day/photo/comment
    /// applied before its journey, or a photo/comment before its waypoint). Idempotent; returns
    /// the number of rows repaired (used by tests).
    @discardableResult
    func repairOrphanedRelationships() -> Int {
        let context = container.viewContext
        var repaired = 0

        func relink<Child: NSManagedObject>(_ type: Child.Type, foreignKey: String,
                                             parentEntity: String, relation: String) {
            let request = NSFetchRequest<Child>(entityName: String(describing: type))
            request.predicate = NSPredicate(format: "%K != nil AND %K == nil", foreignKey, relation)
            guard let orphans = try? context.fetch(request), !orphans.isEmpty else { return }
            for child in orphans {
                guard let fkValue = child.value(forKey: foreignKey) as? String else { continue }
                let parentRequest = NSFetchRequest<NSManagedObject>(entityName: parentEntity)
                parentRequest.predicate = NSPredicate(format: "id == %@", fkValue)
                parentRequest.fetchLimit = 1
                if let parent = (try? context.fetch(parentRequest))?.first {
                    child.setValue(parent, forKey: relation)
                    repaired += 1
                }
            }
        }

        relink(CDWaypoint.self, foreignKey: "journeyId", parentEntity: "CDJourney", relation: "journey")
        relink(CDPhoto.self, foreignKey: "journeyId", parentEntity: "CDJourney", relation: "journey")
        relink(CDDayComment.self, foreignKey: "journeyId", parentEntity: "CDJourney", relation: "journey")
        relink(CDPhoto.self, foreignKey: "waypointId", parentEntity: "CDWaypoint", relation: "waypoint")
        relink(CDDayComment.self, foreignKey: "waypointId", parentEntity: "CDWaypoint", relation: "waypoint")

        if repaired > 0, context.hasChanges {
            try? context.save()
        }
        return repaired
    }

    func loadJourneys() -> [Journey] {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.sortDescriptors = [NSSortDescriptor(key: "name", ascending: true)]
        let rows = (try? container.viewContext.fetch(request)) ?? []
        return rows.map(CoreDataMapping.journey(from:))
    }

    /// All photos for a journey, mapped to the domain model, sorted by `sortOrder`.
    func loadPhotos(forJourneyID journeyID: String) -> [Photo] {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "journeyId == %@", journeyID)
        request.sortDescriptors = [NSSortDescriptor(key: "sortOrder", ascending: true)]
        let rows = (try? container.viewContext.fetch(request)) ?? []
        return rows.map(CoreDataMapping.photo(from:))
    }

    /// Total photo count in the store (for status display).
    /// Photo ids in a journey whose stored content hash matches `hash` (DIFF-14).
    ///
    /// Exact-match, so a hit is certainty rather than a heuristic — which is what makes it safe to
    /// skip an import without asking, where the Vision feature-print grouping only ever proposes.
    /// Returns empty for a nil or empty hash: absent means "unknown", never "unique", and treating
    /// unknown as a match would silently refuse every photo imported before this existed.
    func photoIDs(inJourney journeyID: String, matchingContentHash hash: String?) -> [String] {
        guard let hash, !hash.isEmpty else { return [] }
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "journeyId == %@ AND contentHash == %@",
                                       journeyID, hash)
        return ((try? viewContext.fetch(request)) ?? []).compactMap(\.id)
    }

    func photoCount() -> Int {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        return (try? container.viewContext.count(for: request)) ?? 0
    }

    /// Delete everything (journeys cascade to waypoints/photos/comments). Used to clear the
    /// fixture seed before a fresh import so the store shows only the imported data. Also clears
    /// the sync system-fields side table (`CDSyncRecordMeta`) — those change tags belong to the
    /// records being purged, and a stale tag rehydrated onto a re-imported record would send an
    /// update against a version the server no longer has.
    /// Delete a journey everywhere: its CloudKit zones (journey + media — the zone is the
    /// designed cascade boundary), its local rows (Core Data cascade takes the children), its
    /// system-fields meta (including the media- rows), and its local media files.
    ///
    /// The local cascade is bracketed in remote-apply suppression for the same reason as
    /// `resetJourneys`: without it the scheduler would forward a `deleteRecord` for every row
    /// toward a zone that is already gone, and the zoneNotFound send-recovery would then
    /// RECREATE the zone we just deleted. Two zone deletes are the entire remote story.
    ///
    /// Caller contract (enforced in `JourneyStore.deleteJourney`): owner-only, and never while
    /// the journey is still published to the public showcase.
    @MainActor
    func deleteJourney(id: String) {
        let context = container.viewContext

        // 1. Remote: the two zone deletes, enqueued while we still know the journey exists.
        syncCoordinator?.deleteZones(forJourneyID: id)

        // 2. Local rows, suppressed so the cascade never reaches the scheduler.
        let wasSuppressing = syncIsApplyingRemoteChanges
        syncIsApplyingRemoteChanges = true
        defer { syncIsApplyingRemoteChanges = wasSuppressing }

        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "id == %@", id)
        guard let journey = (try? context.fetch(request))?.first else { return }
        // Collect photo ids first — the meta purge and file cleanup need names the cascade
        // is about to erase (purgeSystemFields(forJourneyID:) walks the journey's children,
        // so it must run while the rows still exist).
        let photoIDs = (journey.photos as? Set<CDPhoto> ?? []).compactMap(\.id)
        purgeSystemFields(forJourneyID: id)
        purgeSystemFields(forRecordNames: photoIDs.map { "media-\($0)" })

        context.delete(journey)   // cascade: waypoints, photos, comments
        if context.hasChanges { try? context.save() }

        // 4. Local media files for this journey.
        let mediaDir = MediaLibrary.shared.root
            .appendingPathComponent("journeys", isDirectory: true)
            .appendingPathComponent(id, isDirectory: true)
        try? FileManager.default.removeItem(at: mediaDir)
    }

    func resetJourneys() {
        let context = container.viewContext
        // Suppress sync forwarding around the mass delete. Without this, a running sync engine
        // sees the reset's save as a `deleteRecord` for EVERY record in the store: if the ensuing
        // import throws (or simply omits natively-ingested photos / day comments), those deletes
        // are sent to CloudKit and fetched as cascading deletions on every other family device —
        // the exact distributed-wipe `handleZoneDeletions` was hardened against, reached through
        // the reset flag. The local store is authoritative; a local reset must never emit remote
        // deletes. (review finding #4.) Save/restore the flag so a nesting caller stays correct.
        let wasSuppressing = syncIsApplyingRemoteChanges
        syncIsApplyingRemoteChanges = true
        defer { syncIsApplyingRemoteChanges = wasSuppressing }
        for entity in ["CDPhoto", "CDDayComment", "CDWaypoint", "CDJourney", "CDSyncRecordMeta"] {
            let request = NSFetchRequest<NSManagedObject>(entityName: entity)
            for object in (try? context.fetch(request)) ?? [] {
                context.delete(object)
            }
        }
        if context.hasChanges { try? context.save() }
    }

    // MARK: - Comments
    //
    // Day-comment persistence (web parity: `commentAPI`). Additive, comment-only surface used by
    // `CommentService`, which owns validation + local author identity. Ordering matches the web
    // `getCommentsForWaypoint` (created_at ascending). Kept in its own section to sit apart from
    // the concurrent photo work in this file.

    /// Comments for a waypoint/day, oldest first (web parity: `created_at` ascending).
    /// `currentUserId` drives each comment's `isMine` flag.
    func loadComments(forWaypointID waypointID: String, currentUserId: String?) -> [DayComment] {
        let request = NSFetchRequest<CDDayComment>(entityName: "CDDayComment")
        request.predicate = NSPredicate(format: "waypointId == %@", waypointID)
        request.sortDescriptors = [NSSortDescriptor(key: "createdAt", ascending: true)]
        let rows = (try? viewContext.fetch(request)) ?? []
        return rows.map { CoreDataMapping.dayComment(from: $0, currentUserId: currentUserId) }
    }

    /// Total comment count in the store (for status display / tests).
    func commentCount() -> Int {
        let request = NSFetchRequest<CDDayComment>(entityName: "CDDayComment")
        return (try? viewContext.count(for: request)) ?? 0
    }

    /// Insert a comment and return the mapped domain value. Content is stored verbatim — the
    /// caller (`CommentService`) has already trimmed + validated it. Relationships are resolved
    /// by id so a cascade delete of the journey/waypoint also removes its comments.
    @discardableResult
    func createComment(id: String = UUID().uuidString,
                       waypointID: String,
                       journeyID: String,
                       userID: String,
                       authorName: String,
                       content: String,
                       now: Date = Date()) -> DayComment? {
        let context = viewContext
        let journey = fetchOne(CDJourney.self, matching: "id == %@", journeyID)
        let waypoint = fetchOne(CDWaypoint.self, matching: "id == %@", waypointID)
        let cd = CoreDataMapping.insertDayComment(
            id: id, waypointId: waypointID, journeyId: journeyID,
            userId: userID, authorName: authorName, content: content,
            createdAt: now, updatedAt: now,
            into: context, journey: journey, waypoint: waypoint)
        do {
            try context.save()
        } catch {
            context.delete(cd)
            return nil
        }
        return CoreDataMapping.dayComment(from: cd, currentUserId: userID)
    }

    /// Update a comment's content and bump `updatedAt` (drives the "(edited)" marker).
    /// Returns the refreshed domain value, or nil if the id is unknown.
    @discardableResult
    func updateComment(id: String, content: String, currentUserId: String?, now: Date = Date()) -> DayComment? {
        guard let cd = fetchOne(CDDayComment.self, matching: "id == %@", id) else { return nil }
        cd.content = content
        cd.updatedAt = now
        try? viewContext.save()
        return CoreDataMapping.dayComment(from: cd, currentUserId: currentUserId)
    }

    /// Delete a comment by id. Returns false if the id is unknown.
    @discardableResult
    func deleteComment(id: String) -> Bool {
        guard let cd = fetchOne(CDDayComment.self, matching: "id == %@", id) else { return false }
        viewContext.delete(cd)
        try? viewContext.save()
        return true
    }

    /// Fetch the first row of `entity` matching a single-argument predicate.
    private func fetchOne<T: NSManagedObject>(_ type: T.Type, matching format: String, _ arg: String) -> T? {
        let request = NSFetchRequest<T>(entityName: String(describing: type))
        request.predicate = NSPredicate(format: format, arg)
        request.fetchLimit = 1
        return (try? viewContext.fetch(request))?.first
    }

    // MARK: - Writes (native editing — Phase 3)
    //
    // The store-level mutations behind the editing UI. These are the ONE seam every edit flows
    // through (JourneyStore → here → Core Data). When the CloudKit write path lands (D4:
    // NSPersistentCloudKitContainer / CKSyncEngine) this stays the call site — the `.local`
    // store is swapped for the CloudKit-backed one and these signatures are unchanged. Each
    // returns enough for the UI to refresh synchronously. Kept apart from the comment section
    // above to sit clear of the concurrent comment work in this file.

    /// Fetch a photo, apply `mutate`, save, and return the re-mapped domain value (nil if absent).
    @discardableResult
    private func editPhoto(id: String, _ mutate: (CDPhoto) -> Void) -> Photo? {
        let context = viewContext
        guard let cd = fetchOne(CDPhoto.self, matching: "id == %@", id) else { return nil }
        mutate(cd)
        do {
            try context.save()
        } catch {
            context.rollback()
            return nil
        }
        return CoreDataMapping.photo(from: cd)
    }

    // MARK: Photo edits

    @discardableResult
    func updatePhotoCaption(id: String, caption: String?) -> Photo? {
        let trimmed = caption?.trimmingCharacters(in: .whitespacesAndNewlines)
        return editPhoto(id: id) { $0.caption = (trimmed?.isEmpty ?? true) ? nil : trimmed }
    }

    /// Apply new `sortOrder` values to several photos in one save (DIFF-13).
    ///
    /// Batched rather than looping `editPhoto`, because accepting a day's curation renumbers up to
    /// six photographs at once and six separate saves would publish six change notifications — the
    /// gallery would visibly reshuffle step by step instead of settling once.
    ///
    /// Returns the number of rows actually changed, so a caller can tell "nothing matched" from
    /// "nothing needed changing".
    @discardableResult
    func updatePhotoSortOrders(_ orders: [String: Int]) -> Int {
        guard !orders.isEmpty else { return 0 }
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "id IN %@", Array(orders.keys))
        let rows = (try? viewContext.fetch(request)) ?? []
        var changed = 0
        for row in rows {
            guard let id = row.id, let order = orders[id], row.sortOrder != Int64(order) else { continue }
            row.sortOrder = Int64(order)
            changed += 1
        }
        guard changed > 0 else { return 0 }
        do {
            try viewContext.save()
        } catch {
            viewContext.rollback()
            return 0
        }
        return changed
    }

    /// Store a 0/90/180/270 display rotation (normalised into range).
    @discardableResult
    func setPhotoRotation(id: String, rotation: Int) -> Photo? {
        let normalised = ((rotation % 360) + 360) % 360
        return editPhoto(id: id) { $0.rotation = Int64(normalised) }
    }

    /// Manually override a photo's location (`nil` clears it). `source` records provenance
    /// ("manual" from the location editor, "exif" for pipeline-extracted).
    @discardableResult
    func setPhotoLocation(id: String, coordinates: [Double]?, source: String?) -> Photo? {
        editPhoto(id: id) {
            $0.coordinates = JSONCoding.encode(coordinates)
            $0.locationSource = source
        }
    }

    /// (Re)assign a photo to a waypoint/day — or unassign it (`nil`). Keeps both the scalar
    /// `waypointId` and the Core Data relationship in sync.
    @discardableResult
    func assignPhoto(id: String, toWaypointID waypointID: String?) -> Photo? {
        let waypoint = waypointID.flatMap { fetchOne(CDWaypoint.self, matching: "id == %@", $0) }
        return editPhoto(id: id) {
            $0.waypointId = waypoint?.id
            $0.waypoint = waypoint
        }
    }

    /// Set/unset a photo as its journey's hero. Setting one clears any existing hero in the
    /// same journey (single-hero invariant, matching the web's is_hero semantics).
    @discardableResult
    func setPhotoHero(id: String, isHero: Bool) -> Photo? {
        let context = viewContext
        guard let cd = fetchOne(CDPhoto.self, matching: "id == %@", id) else { return nil }
        if isHero, let journeyID = cd.journeyId {
            let siblings = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
            siblings.predicate = NSPredicate(format: "journeyId == %@ AND isHero == YES", journeyID)
            for other in (try? context.fetch(siblings)) ?? [] where other.id != id {
                other.isHero = false
            }
        }
        cd.isHero = isHero
        do {
            try context.save()
        } catch {
            context.rollback()
            return nil
        }
        return CoreDataMapping.photo(from: cd)
    }

    /// Delete a photo record (file bytes are removed separately by `PhotoEditService`).
    /// Commits the deletion before returning so the caller only reclaims bytes on success.
    @discardableResult
    func deletePhoto(id: String) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDPhoto.self, matching: "id == %@", id) else { return false }
        context.delete(cd)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Insert a freshly-ingested photo, resolving its journey/waypoint relationships. Returns
    /// false if the target journey isn't in the store.
    @discardableResult
    func insertPhoto(_ photo: Photo) -> Bool {
        let context = viewContext
        guard let journey = fetchOne(CDJourney.self, matching: "id == %@", photo.journeyId) else { return false }
        let waypoint = photo.waypointId.flatMap { fetchOne(CDWaypoint.self, matching: "id == %@", $0) }
        CoreDataMapping.upsertPhoto(photo, into: context, journey: journey, waypoint: waypoint)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Next free `sortOrder` for a journey (appends new photos after the existing ones).
    func nextPhotoSortOrder(forJourneyID journeyID: String) -> Int {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "journeyId == %@", journeyID)
        request.sortDescriptors = [NSSortDescriptor(key: "sortOrder", ascending: false)]
        request.fetchLimit = 1
        let maxOrder = (try? viewContext.fetch(request))?.first.map { Int($0.sortOrder) } ?? -1
        return maxOrder + 1
    }

    // MARK: Waypoint / day edits

    /// Update a waypoint's editable fields (mirrors the web `WaypointEditModal`).
    @discardableResult
    func updateWaypoint(id: String, name: String, description: String,
                        highlights: [String], elevation: Int, dayNumber: Int) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDWaypoint.self, matching: "id == %@", id) else { return false }
        cd.name = name
        cd.waypointDescription = description
        cd.highlights = JSONCoding.encode(highlights)
        cd.elevation = Int64(elevation)
        cd.dayNumber = Int64(dayNumber)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Append drafted day content (fun facts + historical sites) to a waypoint, preserving any that
    /// are already there. Used by the grounded-fact drafter's "Add to day" accept action.
    @discardableResult
    func addDayContent(waypointID: String, funFacts: [FunFact], historicalSites: [HistoricalSite]) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDWaypoint.self, matching: "id == %@", waypointID) else { return false }
        var facts = JSONCoding.decode([FunFact].self, from: cd.funFacts) ?? []
        facts.append(contentsOf: funFacts)
        var sites = JSONCoding.decode([HistoricalSite].self, from: cd.historicalSites) ?? []
        sites.append(contentsOf: historicalSites)
        cd.funFacts = JSONCoding.encode(facts)
        cd.historicalSites = JSONCoding.encode(sites)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    // MARK: Journey creation

    /// Create a brand-new journey (with its camps as waypoints) from a draft-built domain value.
    ///
    /// Goes through the same `CoreDataMapping.upsertJourney` seam every import and edit uses, so
    /// the resulting Core Data save is observed by `SyncScheduler` in `.cloudKit` mode — and the
    /// new journey's CKRecord zone + records are enqueued for upload automatically (a journey-root
    /// `.save` becomes a `.saveZone`; see `AkashicSyncEngine.localStoreDidChange`). No new engine
    /// path is needed: a locally created journey is just another observed insert.
    @discardableResult
    func createJourney(_ journey: Journey) -> Bool {
        let context = viewContext
        CoreDataMapping.upsertJourney(journey, into: context)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    // MARK: Journey edits

    /// Update a journey's editable fields (mirrors the web `JourneyEditModal` / `JourneyUpdate`).
    /// Also mirrors the numeric fields into the embedded `stats` JSON so the read-side summary
    /// (which renders from `stats`, not the scalar columns) reflects the edit immediately.
    @discardableResult
    func updateJourney(id: String, name: String, description: String, country: String,
                       dateStarted: String?, dateEnded: String?,
                       totalDays: Int?, totalDistance: Double?, summitElevation: Int?) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", id) else { return false }
        cd.name = name
        cd.journeyDescription = description
        cd.country = country
        cd.dateStarted = DateOnly.date(from: dateStarted)
        cd.dateEnded = DateOnly.date(from: dateEnded)
        if let totalDays { cd.totalDays = Int64(totalDays) }
        if let totalDistance { cd.totalDistance = totalDistance }
        if let summitElevation { cd.summitElevation = Int64(summitElevation) }

        var stats = JSONCoding.decode(TrekStats.self, from: cd.stats)
            ?? TrekStats(duration: Int(cd.totalDays), totalDistance: cd.totalDistance,
                         totalElevationGain: 0, totalElevationLoss: nil, highestPoint: nil)
        if let totalDays { stats.duration = totalDays }
        if let totalDistance { stats.totalDistance = totalDistance }
        if let summitElevation {
            if stats.highestPoint != nil {
                stats.highestPoint?.elevation = summitElevation
            } else {
                stats.highestPoint = HighestPoint(name: name, elevation: summitElevation, coordinates: nil)
            }
        }
        cd.stats = JSONCoding.encode(stats)
        cd.updatedAt = Date()
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Replace ALL of a day's content lists + weather in one save (the WaypointEditSheet content
    /// editor and the enrich flow drive this). Unlike `addDayContent` (which appends the drafter's
    /// output), this is an authoritative SET: the passed arrays/weather become the day's content,
    /// so editing/deleting a single fact/POI/site round-trips. Correcting data is never blocked.
    @discardableResult
    func setDayContent(waypointID: String,
                       funFacts: [FunFact],
                       pointsOfInterest: [PointOfInterest],
                       historicalSites: [HistoricalSite],
                       weather: WeatherData?) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDWaypoint.self, matching: "id == %@", waypointID) else { return false }
        cd.funFacts = JSONCoding.encode(funFacts)
        cd.pointsOfInterest = JSONCoding.encode(pointsOfInterest)
        cd.historicalSites = JSONCoding.encode(historicalSites)
        cd.weather = JSONCoding.encode(weather)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    // MARK: Route correction (existing journeys)

    /// Replace a journey's route AND its recomputed stats in one save — the "everything is
    /// correctable" route-fix path (replace-from-GPX, draft-from-photos, or recompute-stats). Days
    /// are NEVER touched here (re-seeding is a separate opt-in), so a route correction never silently
    /// disturbs the day list. Mirrors the numeric stats into the scalar columns like `updateJourney`.
    @discardableResult
    func updateJourneyRoute(id: String, route: Route, stats: TrekStats) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", id) else { return false }
        cd.route = JSONCoding.encode(route)
        cd.stats = JSONCoding.encode(stats)
        cd.totalDistance = stats.totalDistance
        cd.totalDays = Int64(stats.duration)
        if let summit = stats.highestPoint?.elevation { cd.summitElevation = Int64(summit) }
        cd.updatedAt = Date()
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Opt-in "Also update day positions" after a route replace: overwrite each day's coordinate
    /// (and elevation, when > 0) from the new GPX waypoints, matched POSITIONALLY by day order. Days
    /// beyond the waypoint count are left untouched; content/name/dayNumber are never changed. This
    /// is the ONLY path that lets a route replace also move the days, and it is always the user's
    /// explicit choice.
    @discardableResult
    func updateWaypointPositions(journeyID: String, coordinates: [[Double]], elevations: [Int]) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", journeyID) else { return false }
        let ordered = (cd.waypoints as? Set<CDWaypoint> ?? []).sorted { $0.sortOrder < $1.sortOrder }
        for (index, wp) in ordered.enumerated() where index < coordinates.count {
            let coord = coordinates[index]
            if coord.count >= 2 { wp.coordinates = JSONCoding.encode([coord[0], coord[1]]) }
            if index < elevations.count, elevations[index] > 0 { wp.elevation = Int64(elevations[index]) }
        }
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    // MARK: Day management (add / delete / reorder)
    //
    // Structural day edits on an EXISTING journey. Every one renumbers the surviving days so
    // `dayNumber` and `sortOrder` stay 1…N / 0…N-1 in a single consistent order (see
    // `DayRenumbering`). Photos are keyed by the stable `waypointId`, so reordering never disturbs a
    // photo's day linkage; deleting a day UNASSIGNS its photos/comments (never deletes them).

    /// Renumber the journey's waypoints from an ordered id list: `sortOrder = index`,
    /// `dayNumber = index + 1`. Ids not present in the journey are ignored; any waypoint missing from
    /// `orderedIDs` is appended after, preserving its previous relative order (defensive).
    private func applyDayOrder(_ orderedIDs: [String], to cd: CDJourney) {
        let waypoints = (cd.waypoints as? Set<CDWaypoint> ?? [])
        var byID: [String: CDWaypoint] = [:]
        for wp in waypoints { if let id = wp.id { byID[id] = wp } }
        var finalOrder: [CDWaypoint] = orderedIDs.compactMap { byID[$0] }
        let placed = Set(finalOrder.compactMap { $0.id })
        let leftovers = waypoints.filter { !($0.id.map(placed.contains) ?? false) }
            .sorted { $0.sortOrder < $1.sortOrder }
        finalOrder.append(contentsOf: leftovers)
        for assignment in DayRenumbering.assignments(orderedIDs: finalOrder.compactMap { $0.id }) {
            guard let wp = byID[assignment.id] else { continue }
            wp.sortOrder = Int64(assignment.sortOrder)
            wp.dayNumber = Int64(assignment.dayNumber)
        }
    }

    /// Reorder a journey's days to `orderedIDs` and renumber. Photo assignments (by `waypointId`)
    /// are untouched, so a photo stays with its day across a reorder.
    @discardableResult
    func reorderWaypoints(journeyID: String, orderedIDs: [String]) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", journeyID) else { return false }
        applyDayOrder(orderedIDs, to: cd)
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Add a day to a journey. Inserted at the end, or immediately AFTER `afterDayNumber` when given;
    /// all days renumber consistently. Returns the created day's stable id (nil on failure).
    @discardableResult
    func addWaypoint(journeyID: String, name: String, afterDayNumber: Int?) -> String? {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", journeyID) else { return nil }
        let ordered = (cd.waypoints as? Set<CDWaypoint> ?? []).sorted { $0.sortOrder < $1.sortOrder }

        let newID = UUID().uuidString
        let wp = CDWaypoint(context: context)
        wp.id = newID
        wp.journeyId = journeyID
        wp.waypointType = "camp"
        wp.name = name
        wp.elevation = 0
        wp.coordinates = JSONCoding.encode([Double]())
        wp.highlights = JSONCoding.encode([String]())
        wp.waypointDescription = ""
        wp.routeDistanceKm = -1
        wp.createdAt = Date()
        wp.journey = cd

        // Compute the target order: existing ids, with the new id inserted after the requested day.
        var orderedIDs = ordered.compactMap { $0.id }
        if let afterDayNumber,
           let anchor = ordered.first(where: { Int($0.dayNumber) == afterDayNumber })?.id,
           let anchorIndex = orderedIDs.firstIndex(of: anchor) {
            orderedIDs.insert(newID, at: anchorIndex + 1)
        } else {
            orderedIDs.append(newID)
        }
        applyDayOrder(orderedIDs, to: cd)
        do {
            try context.save()
            return newID
        } catch {
            context.rollback()
            return nil
        }
    }

    /// Delete a day. Its photos and comments become UNASSIGNED (waypointId → nil) — never deleted —
    /// and the surviving days renumber consistently. This is the safe day-delete semantics: no
    /// media or memory is ever destroyed by removing a day.
    @discardableResult
    func deleteWaypoint(id: String) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDWaypoint.self, matching: "id == %@", id),
              let journey = cd.journey else { return false }

        // Unassign photos on this day (keep the bytes + records; they land in "Unassigned").
        let photoReq = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        photoReq.predicate = NSPredicate(format: "waypointId == %@", id)
        for photo in (try? context.fetch(photoReq)) ?? [] {
            photo.waypointId = nil
            photo.waypoint = nil
        }
        // Unassign comments on this day (never delete a family member's words).
        let commentReq = NSFetchRequest<CDDayComment>(entityName: "CDDayComment")
        commentReq.predicate = NSPredicate(format: "waypointId == %@", id)
        for comment in (try? context.fetch(commentReq)) ?? [] {
            comment.waypointId = nil
            comment.waypoint = nil
        }

        context.delete(cd)

        // Renumber the remaining days.
        let remaining = (journey.waypoints as? Set<CDWaypoint> ?? [])
            .filter { $0.id != id }
            .sorted { $0.sortOrder < $1.sortOrder }
        applyDayOrder(remaining.compactMap { $0.id }, to: journey)

        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }

    /// Set a journey's `isPublic` flag. Drives the public showcase mirror (MAPPING §8): flipping
    /// it true makes the journey's metadata + thumbnails eligible for the world-readable mirror.
    /// The mirror write itself is a separate step (`PublicMirrorPublisher`); this only records
    /// intent on the journey and lets the sync engine carry the flag to the private DB.
    @discardableResult
    func setJourneyPublic(id: String, isPublic: Bool) -> Bool {
        let context = viewContext
        guard let cd = fetchOne(CDJourney.self, matching: "id == %@", id) else { return false }
        cd.isPublic = isPublic
        cd.updatedAt = Date()
        do {
            try context.save()
            return true
        } catch {
            context.rollback()
            return false
        }
    }
}
