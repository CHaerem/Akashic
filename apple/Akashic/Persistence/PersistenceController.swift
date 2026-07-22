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

    // MARK: - CloudKit sync stack (populated only in `.cloudKit` mode; see `Sync/`)

    /// Observable sync status for the UI. Always present but `.disabled` outside `.cloudKit`.
    let syncStatus = SyncStatus()
    /// The sync coordinator for our own journeys (private database); nil unless `.cloudKit`.
    var syncCoordinator: AkashicSyncEngine?
    /// The coordinator for journeys shared with us (shared database, T2.8); nil unless `.cloudKit`.
    var sharedSyncCoordinator: AkashicSyncEngine?
    /// Observes local Core Data saves and feeds them to the engine; nil unless `.cloudKit`.
    var syncScheduler: SyncScheduler?
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

    init(mode: PersistenceMode, seed: Bool = true, fixtureBundle: Bundle = .main) {
        self.mode = mode
        let model = PersistenceController.managedObjectModel

        switch mode {
        case .local, .cloudKit:
            // `.cloudKit` uses the same on-disk local store as `.local`; sync is layered on top
            // by `CKSyncEngine` (attached below), NOT by NSPersistentCloudKitContainer — that
            // placeholder is retired (it would have generated an incompatible `CD_`-prefixed
            // schema; see CloudKit/MAPPING.md §12 + the D4 decision).
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

        // Attach the CloudKit sync engine (account-gated inside `startSync`/`activate`). Built
        // on the main actor: `.shared`/`.cloudKit` is created on launch from `@MainActor`
        // `JourneyStore`. Tests never build a `.cloudKit` controller (they drive the engine and
        // store seam directly), so this main-actor assumption is not exercised off-main.
        if mode == .cloudKit {
            MainActor.assumeIsolated { startSync() }
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

    /// All photos for a journey, mapped to the domain model, sorted by `sortOrder`.
    func loadPhotos(forJourneyID journeyID: String) -> [Photo] {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "journeyId == %@", journeyID)
        request.sortDescriptors = [NSSortDescriptor(key: "sortOrder", ascending: true)]
        let rows = (try? container.viewContext.fetch(request)) ?? []
        return rows.map(CoreDataMapping.photo(from:))
    }

    /// Total photo count in the store (for status display).
    func photoCount() -> Int {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        return (try? container.viewContext.count(for: request)) ?? 0
    }

    /// Delete everything (journeys cascade to waypoints/photos/comments). Used to clear the
    /// fixture seed before a fresh import so the store shows only the imported data. Also clears
    /// the sync system-fields side table (`CDSyncRecordMeta`) — those change tags belong to the
    /// records being purged, and a stale tag rehydrated onto a re-imported record would send an
    /// update against a version the server no longer has.
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
