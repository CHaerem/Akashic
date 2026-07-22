import CoreData
import CloudKit

/// `SyncLocalStore` conformance: the bridge the `AkashicSyncEngine` uses to (a) materialize a
/// `CKRecord` for a pending upload and (b) apply fetched server records — all through the
/// existing Core Data view context and `RecordCoder`.
///
/// The apply-side upserts here are deliberately **per-record and server-authoritative** — they
/// overwrite a single row from its `CKRecord` and never cascade to siblings. This is distinct
/// from `CoreDataMapping.upsertJourney` (the importer's whole-journey upsert, which manages the
/// waypoint set and preserves local edits): sync applies one record at a time as it arrives.
extension PersistenceController: SyncLocalStore {

    // MARK: Attach the sync stack (called from init in .cloudKit mode)

    @MainActor
    func startSync() {
        // PRIMARY entitlement gate. Only an entitled `*-CloudKit` build may construct the
        // coordinator (which reaches a CKContainer). In the default Debug/Release build a
        // CKContainer would TRAP, so the `.cloudKit` store simply runs locally and the status
        // row explains why — even if the user selected `.cloudKit` in Settings.
        #if AKASHIC_CLOUDKIT_BUILD
        let accountProvider = CloudKitAccountStatusProvider(
            containerIdentifier: Config.cloudKitContainerIdentifier)
        let coordinator = AkashicSyncEngine(
            store: self,
            status: syncStatus,
            accountProvider: accountProvider,
            databaseScope: .private)
        // Second engine for journeys others shared with us (T2.8). A CKSyncEngine binds to one
        // database, so participation needs its own — with its own state file and change tokens.
        // It shares `syncStatus`: from the family's point of view there is one "is it syncing?"
        // question, and two rows would only invite the wrong answer to be read.
        let sharedCoordinator = AkashicSyncEngine(
            store: self,
            status: syncStatus,
            accountProvider: accountProvider,
            databaseScope: .shared)
        syncCoordinator = coordinator
        sharedSyncCoordinator = sharedCoordinator
        syncScheduler = SyncScheduler(
            context: viewContext,
            engines: [coordinator, sharedCoordinator],
            isApplyingRemoteChanges: { [weak self] in self?.syncIsApplyingRemoteChanges ?? false })
        Task {
            await coordinator.activate()
            await sharedCoordinator.activate()
        }
        #else
        syncStatus.set(.notEntitled)
        #endif
    }

    // MARK: Sharing (T2.8)

    /// Sharing service for the UI, wired to this store's ownership data so a journey shared
    /// *with* us is looked up in the shared database under its real owner.
    @MainActor
    var sharingService: JourneySharingService {
        CloudKitJourneySharing(zoneOwnerProvider: { [weak self] journeyID in
            self?.zoneOwnerName(forJourneyID: journeyID)
        })
    }

    /// Accept an invitation and pull the newly shared journey down.
    ///
    /// Acceptance only grants access — it does not deliver any data. Without the explicit fetch
    /// the journey would not appear until the next silent push, which the Simulator never gets
    /// at all (the same trap that hid the whole archive in T2.4).
    @MainActor
    func acceptShare(_ metadata: CKShare.Metadata) async {
        #if AKASHIC_CLOUDKIT_BUILD
        do {
            let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
            _ = try await container.accept(metadata)
            SyncLog.log("acceptShare: accepted \(metadata.share.recordID.recordName)")
            await sharedSyncCoordinator?.fetchOnActivation()
        } catch {
            SyncLog.error("acceptShare: FAILED \(error)")
            syncStatus.set(.error("Could not open the shared journey: \(error.localizedDescription)"))
        }
        #endif
    }

    // MARK: Upload side

    func allLocalJourneyIDs() -> [String] {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        return ((try? viewContext.fetch(request)) ?? []).compactMap { $0.id }
    }

    func zoneOwnerName(forJourneyID journeyID: String) -> String? {
        syncFetchJourney(journeyID)?.zoneOwnerName
    }

    func recordIdentities(forJourneyID journeyID: String) -> [LocalChange] {
        guard let journey = syncFetchJourney(journeyID) else { return [] }
        var out: [LocalChange] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                        recordName: journeyID, journeyID: journeyID)
        ]
        out += (journey.waypoints as? Set<CDWaypoint> ?? []).compactMap(\.id).map {
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.waypoint,
                        recordName: $0, journeyID: journeyID)
        }
        out += (journey.photos as? Set<CDPhoto> ?? []).compactMap(\.id).map {
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo,
                        recordName: $0, journeyID: journeyID)
        }
        out += (journey.dayComments as? Set<CDDayComment> ?? []).compactMap(\.id).map {
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.dayComment,
                        recordName: $0, journeyID: journeyID)
        }
        return out
    }

    /// Resolve a pending record id to its current domain value and encode it. Returns nil if
    /// the row is gone (the batch then skips the save).
    ///
    /// When the caller does not supply a rebased server record (the conflict path), the base is
    /// rehydrated from the persisted system fields (`CDSyncRecordMeta`, written on every
    /// remote-apply and successful send). This carries the last-known server change tag, so a
    /// first edit of an existing row is sent as an UPDATE and `CKSyncEngine` diffs it — instead
    /// of the old behavior, where every save built a fresh `CKRecord`, looked like an INSERT, and
    /// bounced off CloudKit's "record to insert already exists" (server error 14) before the
    /// `serverRecordChanged` retry rebased it (double round-trips + backoff, see
    /// `Docs/sync-verification.md`).
    func makeRecord(forRecordName recordName: String,
                    zoneID: CKRecordZone.ID,
                    existing: CKRecord?) -> CKRecord? {
        // Prefer the caller's rebased record (conflict path); otherwise rehydrate the last-known
        // server record's system fields so this save carries its change tag.
        let base = existing ?? systemFieldsRecord(forRecordName: recordName, zoneID: zoneID)
        if let cd = syncFetchJourney(recordName) {
            return RecordCoder.record(for: CoreDataMapping.journey(from: cd), in: zoneID, existing: base)
        }
        if let cd = syncFetchWaypoint(recordName), let cdJourney = cd.journey {
            let journey = CoreDataMapping.journey(from: cdJourney)
            guard let index = journey.camps.firstIndex(where: { $0.id == recordName }) else { return nil }
            return RecordCoder.record(forWaypoint: journey.camps[index], journeyID: journey.id,
                                      sortOrder: index, in: zoneID, existing: base)
        }
        if let cd = syncFetchPhoto(recordName) {
            return RecordCoder.record(for: CoreDataMapping.photo(from: cd), in: zoneID, existing: base)
        }
        if let cd = syncFetchComment(recordName) {
            return RecordCoder.record(for: CoreDataMapping.dayComment(from: cd, currentUserId: nil),
                                      in: zoneID, existing: base)
        }
        return nil
    }

    // MARK: Encoded system fields (server change tag persistence)

    /// Persist the system fields (identity + change tag) of records the server just accepted.
    ///
    /// This is the ONLY place the tag for a *locally originated* record is captured: the
    /// fetch-apply path only ever sees records the server produced, never the ones this device
    /// uploaded. Without it the second edit of a freshly created record would still take the
    /// code-14 rebase path. Runs its own commit under the remote-apply flag so the resulting
    /// Core Data save is not mistaken for a fresh local edit (though `CDSyncRecordMeta` maps to
    /// no `LocalChange` anyway).
    func recordsDidSave(_ records: [CKRecord]) {
        guard !records.isEmpty else { return }
        let wasApplying = syncIsApplyingRemoteChanges
        syncIsApplyingRemoteChanges = true
        for record in records { upsertSystemFields(for: record) }
        if viewContext.hasChanges {
            do {
                try viewContext.save()
                SyncLog.log("recordsDidSave: stored systemFields for \(records.count) saved record(s)")
            } catch {
                SyncLog.error("recordsDidSave: systemFields save FAILED for \(records.count): \(error)")
            }
        }
        syncIsApplyingRemoteChanges = wasApplying
    }

    /// Drop persisted system fields for records the server just deleted, so a row later
    /// re-created under the same name is not rehydrated onto a dead change tag.
    func recordsDidDelete(_ recordIDs: [CKRecord.ID]) {
        guard !recordIDs.isEmpty else { return }
        let wasApplying = syncIsApplyingRemoteChanges
        syncIsApplyingRemoteChanges = true
        removeSystemFields(forRecordNames: recordIDs.map { $0.recordName })
        if viewContext.hasChanges {
            do {
                try viewContext.save()
                SyncLog.log("recordsDidDelete: dropped systemFields for \(recordIDs.count) record(s)")
            } catch {
                SyncLog.error("recordsDidDelete: systemFields cleanup FAILED for \(recordIDs.count): \(error)")
            }
        }
        syncIsApplyingRemoteChanges = wasApplying
    }

    // MARK: Apply side (server-authoritative, per record)

    func beginRemoteApply() {
        syncIsApplyingRemoteChanges = true
    }

    func endRemoteApply() {
        if viewContext.hasChanges {
            let inserted = viewContext.insertedObjects.count
            let updated = viewContext.updatedObjects.count
            do {
                try viewContext.save()
                SyncLog.log("endRemoteApply: saved inserted=\(inserted) updated=\(updated)")
            } catch {
                // Previously `try?`: a validation failure silently discarded every fetched
                // record with no trace anywhere. Never swallow this again.
                SyncLog.error("endRemoteApply: SAVE FAILED inserted=\(inserted) updated=\(updated): \(error)")
            }
        }
        syncIsApplyingRemoteChanges = false
    }

    func applyFetchedRecord(_ record: CKRecord) {
        switch record.recordType {
        case RecordCoder.RecordType.journey:
            if let journey = RecordCoder.journey(from: record) {
                // route: nil means "present but unreadable" -> keep the local route.
                applyJourneyScalars(journey,
                                    route: RecordCoder.route(from: record),
                                    zoneOwnerName: record.recordID.zoneID.ownerName)
            }
        case RecordCoder.RecordType.waypoint:
            if let camp = RecordCoder.waypoint(from: record) {
                let journeyID = (record["journeyRef"] as? CKRecord.Reference)?.recordID.recordName
                    ?? RecordCoder.journeyID(fromZoneID: record.recordID.zoneID) ?? ""
                applyWaypoint(camp, journeyID: journeyID, sortOrder: record["sortOrder"] as? Int ?? 0)
            }
        case RecordCoder.RecordType.photo:
            if let photo = RecordCoder.photo(from: record) { applyPhoto(photo, from: record) }
        case RecordCoder.RecordType.dayComment:
            if let comment = RecordCoder.dayComment(from: record) { applyComment(comment) }
        default:
            SyncLog.log("applyFetchedRecord: UNKNOWN recordType \(record.recordType)")
            return   // unknown type wasn't applied to any row — don't persist its system fields
        }
        // Persist the server's system fields for the record we just applied, so a later local
        // edit of this row rehydrates its change tag in `makeRecord` (update, not insert).
        // Committed by `endRemoteApply` alongside the domain writes.
        upsertSystemFields(for: record)
    }

    func applyDeletedRecord(recordName: String, recordType: String) {
        // Gather the record names whose meta must go before the Core Data cascade removes the
        // rows: a journey delete cascades to its waypoints/photos/comments, but the meta side
        // table has no relationship to cascade through, so their tags would otherwise leak.
        var metaNamesToDrop = [recordName]
        let object: NSManagedObject?
        switch recordType {
        case RecordCoder.RecordType.journey:
            let journey = syncFetchJourney(recordName)
            if let journey { metaNamesToDrop += childRecordNames(of: journey) }
            object = journey
        case RecordCoder.RecordType.waypoint:   object = syncFetchWaypoint(recordName)
        case RecordCoder.RecordType.photo:      object = syncFetchPhoto(recordName)
        case RecordCoder.RecordType.dayComment: object = syncFetchComment(recordName)
        default:                                object = nil
        }
        if let object { viewContext.delete(object) }   // journey delete cascades to its children
        removeSystemFields(forRecordNames: metaNamesToDrop)
    }

    // MARK: Per-record upserts

    /// `route` is the decode result of `RecordCoder.route(from:)`: nil means the record carried
    /// a `routeJSON` asset we could not read, in which case the local route is left untouched.
    private func applyJourneyScalars(_ journey: Journey, route: Route?, zoneOwnerName: String? = nil) {
        let cd = syncFetchJourney(journey.id) ?? CDJourney(context: viewContext)
        cd.id = journey.id
        // Remember which database this journey came from, so later edits route back to the
        // right zone. A private-database record carries CKCurrentUserDefaultName, which we
        // store as nil ("mine") rather than as a literal owner name.
        if let zoneOwnerName {
            cd.zoneOwnerName = zoneOwnerName == CKCurrentUserDefaultName ? nil : zoneOwnerName
        }
        cd.slug = journey.slug
        cd.name = journey.name
        cd.country = journey.country
        cd.journeyDescription = journey.description
        // The record schema drops the hero R2 path (bytes live in the heroImage ASSET), so a
        // fetched journey always decodes heroImageURL == nil. Assigning that would erase the
        // path the local import stored — only ever overwrite with a real value.
        if let hero = journey.heroImageURL { cd.heroImageURL = hero }
        cd.dateStarted = DateOnly.date(from: journey.dateStarted)
        cd.dateEnded = DateOnly.date(from: journey.dateEnded)
        cd.isPublic = journey.isPublic
        cd.journeyType = "trek"
        cd.summitElevation = Int64(journey.summitElevation ?? 0)
        cd.totalDistance = journey.totalDistance ?? 0
        cd.totalDays = Int64(journey.totalDays ?? 0)
        cd.preferredBearing = journey.preferredBearing ?? 0
        cd.preferredPitch = journey.preferredPitch ?? 60
        cd.centerCoordinates = JSONCoding.encode(journey.centerCoordinates)
        if let route { cd.route = JSONCoding.encode(route) }
        cd.stats = JSONCoding.encode(journey.stats)
        if cd.createdAt == nil { cd.createdAt = Date() }
        cd.updatedAt = Date()
    }

    private func applyWaypoint(_ camp: Camp, journeyID: String, sortOrder: Int) {
        let cd = syncFetchWaypoint(camp.id) ?? CDWaypoint(context: viewContext)
        cd.id = camp.id
        cd.journeyId = journeyID
        cd.journey = syncFetchJourney(journeyID)
        cd.waypointType = "camp"
        cd.name = camp.name
        cd.dayNumber = Int64(camp.dayNumber)
        cd.elevation = Int64(camp.elevation)
        cd.coordinates = JSONCoding.encode(camp.coordinates)
        cd.waypointDescription = camp.notes
        cd.highlights = JSONCoding.encode(camp.highlights)
        cd.sortOrder = Int64(sortOrder)
        cd.routeDistanceKm = camp.routeDistanceKm ?? -1     // -1 sentinel: absent vs legit 0.0
        cd.routePointIndex = Int64(camp.routePointIndex ?? 0)
        cd.weather = JSONCoding.encode(camp.weather)
        cd.funFacts = JSONCoding.encode(camp.funFacts)
        cd.pointsOfInterest = JSONCoding.encode(camp.pointsOfInterest)
        cd.historicalSites = JSONCoding.encode(camp.historicalSites)
        if cd.createdAt == nil { cd.createdAt = Date() }
    }

    /// Apply a fetched Photo record.
    ///
    /// ## Media-pointer policy (data-safety critical — see `SyncMediaStaging`)
    /// The Photo schema deliberately drops the R2 keys (`url` / `thumbnailURL`) and carries the
    /// bytes in the `original` / `thumb` ASSETs, so a decoded `Photo` always has `url == ""`,
    /// `thumbnailURL == nil` and CloudKit *staging* paths in `localOriginalPath` /
    /// `localThumbPath`. Writing those four straight through would (a) blank the canonical
    /// object key `PhotoEditService` resolves bytes with and (b) point the row at a temporary
    /// file CloudKit may purge — after which the next local edit would upload a record with no
    /// assets and destroy the server copy. So: never overwrite a good key with an empty one,
    /// and never persist a staging path — copy the bytes into the media root and store that,
    /// keeping the existing local path whenever there is no asset or the copy fails.
    private func applyPhoto(_ photo: Photo, from record: CKRecord) {
        let cd = syncFetchPhoto(photo.id) ?? CDPhoto(context: viewContext)
        cd.id = photo.id
        cd.journeyId = photo.journeyId
        cd.journey = syncFetchJourney(photo.journeyId)
        cd.waypointId = photo.waypointId
        cd.waypoint = photo.waypointId.flatMap { syncFetchWaypoint($0) }
        if !photo.url.isEmpty { cd.url = photo.url }             // never clobber the R2 key
        if let thumbKey = photo.thumbnailURL { cd.thumbnailURL = thumbKey }
        cd.caption = photo.caption
        cd.coordinates = JSONCoding.encode(photo.coordinates)
        cd.takenAt = PhotoDayMatcher.parseDate(photo.takenAt)
        cd.isHero = photo.isHero
        cd.sortOrder = Int64(photo.sortOrder)
        cd.rotation = Int64(photo.rotation)
        cd.mediaType = photo.mediaType
        cd.duration = Int64(photo.duration ?? 0)
        cd.locationSource = photo.locationSource
        adoptPhotoAssets(from: record, into: cd, mediaType: photo.mediaType)
        if cd.createdAt == nil { cd.createdAt = Date() }
    }

    /// Copy the record's asset bytes out of CloudKit's staging area into the media root and
    /// point the row at the stable path. Existing local paths survive any failure.
    private func adoptPhotoAssets(from record: CKRecord, into cd: CDPhoto, mediaType: String) {
        let staging = RecordCoder.assetFileURLs(from: record)
        let journeyId = cd.journeyId ?? ""
        let photoId = cd.id ?? ""

        // If the row already has usable bytes in our own media root, keep them: a corrupt or
        // stale server asset must never be allowed to replace a good local original.
        if !hasStableLocalBytes(cd.localOriginalPath, relativeKey: cd.url),
           let adopted = SyncMediaStaging.adopt(assetAt: staging.original,
                                                kind: .original,
                                                journeyId: journeyId,
                                                photoId: photoId,
                                                relativeKey: cd.url,
                                                mediaType: mediaType) {
            cd.localOriginalPath = adopted.absolutePath
            if (cd.url ?? "").isEmpty { cd.url = adopted.relativeKey }
        }

        if !hasStableLocalBytes(cd.localThumbPath, relativeKey: cd.thumbnailURL),
           let adopted = SyncMediaStaging.adopt(assetAt: staging.thumb,
                                                kind: .thumbnail,
                                                journeyId: journeyId,
                                                photoId: photoId,
                                                relativeKey: cd.thumbnailURL,
                                                mediaType: mediaType) {
            cd.localThumbPath = adopted.absolutePath
            if (cd.thumbnailURL ?? "").isEmpty { cd.thumbnailURL = adopted.relativeKey }
        }
    }

    /// True when we already own the bytes inside our own media root — i.e. bytes that will still
    /// be there tomorrow (unlike a CloudKit staging path, which CloudKit may purge).
    ///
    /// `relativeKey` is consulted when the stored absolute path no longer resolves: the app's
    /// data container is re-created with a new UUID on reinstall/restore, which invalidates every
    /// stored absolute path while the files survive (see `Photo.resolveMedia`). Without this, a
    /// post-restore re-fetch would re-copy 1500 already-present originals out of CloudKit staging.
    private func hasStableLocalBytes(_ path: String?, relativeKey: String?) -> Bool {
        let root = MediaLibrary.shared.root.standardizedFileURL.path
        let prefix = root.hasSuffix("/") ? root : root + "/"

        if let path, !path.isEmpty {
            let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
            if standardized.hasPrefix(prefix), FileManager.default.fileExists(atPath: standardized) {
                return true
            }
        }
        guard let relativeKey, !relativeKey.isEmpty else { return false }
        let candidate = MediaLibrary.shared.absoluteURL(forRelative: relativeKey).standardizedFileURL.path
        return candidate.hasPrefix(prefix) && FileManager.default.fileExists(atPath: candidate)
    }

    private func applyComment(_ comment: DayComment) {
        let cd = syncFetchComment(comment.id) ?? CDDayComment(context: viewContext)
        cd.id = comment.id
        cd.journeyId = comment.journeyId
        cd.journey = syncFetchJourney(comment.journeyId)
        cd.waypointId = comment.waypointId
        cd.waypoint = syncFetchWaypoint(comment.waypointId)
        cd.content = comment.content
        cd.createdAt = comment.createdAt
        cd.updatedAt = comment.updatedAt
        cd.authorDisplayName = comment.authorName
        // userId (local-author identity) is not carried on the record; left as-is on remote apply.
    }

    // MARK: - System-fields meta side table (CDSyncRecordMeta)

    /// The last-known server record (system fields only) for a row, rehydrated from the meta side
    /// table — or nil when we have never seen a server copy, the bytes are unreadable, or the
    /// stored identity does not match the pending change. The identity guard matters: the returned
    /// record's `recordID` is the one `CKSyncEngine` saves under, so a base whose zone differs from
    /// the requested one would send the record to the wrong place. In production the two always
    /// agree (both derive from the journey's `zoneOwnerName`); the guard is defense in depth and,
    /// on a mismatch, falls back to the safe fresh-insert behavior.
    private func systemFieldsRecord(forRecordName recordName: String,
                                    zoneID: CKRecordZone.ID) -> CKRecord? {
        guard let meta = syncFetchMeta(recordName),
              let data = meta.systemFields,
              let record = RecordCoder.recordFromSystemFields(data),
              record.recordID.recordName == recordName,
              record.recordID.zoneID == zoneID
        else { return nil }
        return record
    }

    /// Insert-or-update the meta row for a record's encoded system fields. The uniqueness
    /// constraint on `recordName` is a backstop; this fetch-or-create keeps it from ever firing.
    private func upsertSystemFields(for record: CKRecord) {
        let name = record.recordID.recordName
        let meta = syncFetchMeta(name) ?? CDSyncRecordMeta(context: viewContext)
        meta.recordName = name
        meta.systemFields = RecordCoder.archivedSystemFields(of: record)
    }

    /// Delete the meta rows for the given record names (no-op for names with no row). Does NOT
    /// save — the caller commits alongside its other changes.
    private func removeSystemFields(forRecordNames names: [String]) {
        guard !names.isEmpty else { return }
        let request = NSFetchRequest<CDSyncRecordMeta>(entityName: "CDSyncRecordMeta")
        request.predicate = NSPredicate(format: "recordName IN %@", names)
        for meta in (try? viewContext.fetch(request)) ?? [] { viewContext.delete(meta) }
    }

    private func syncFetchMeta(_ recordName: String) -> CDSyncRecordMeta? {
        syncFetchOne("CDSyncRecordMeta", recordName, key: "recordName")
    }

    /// Every child record name of a journey (waypoints, photos, comments) — used to clean up the
    /// meta side table when a journey delete cascades in Core Data.
    private func childRecordNames(of journey: CDJourney) -> [String] {
        var names: [String] = []
        names += (journey.waypoints as? Set<CDWaypoint> ?? []).compactMap(\.id)
        names += (journey.photos as? Set<CDPhoto> ?? []).compactMap(\.id)
        names += (journey.dayComments as? Set<CDDayComment> ?? []).compactMap(\.id)
        return names
    }

    // MARK: Fetch-by-id helpers

    private func syncFetchJourney(_ id: String) -> CDJourney? { syncFetchOne("CDJourney", id) }
    private func syncFetchWaypoint(_ id: String) -> CDWaypoint? { syncFetchOne("CDWaypoint", id) }
    private func syncFetchPhoto(_ id: String) -> CDPhoto? { syncFetchOne("CDPhoto", id) }
    private func syncFetchComment(_ id: String) -> CDDayComment? { syncFetchOne("CDDayComment", id) }

    private func syncFetchOne<T: NSManagedObject>(_ entity: String, _ value: String,
                                                  key: String = "id") -> T? {
        let request = NSFetchRequest<T>(entityName: entity)
        request.predicate = NSPredicate(format: "%K == %@", key, value)
        request.fetchLimit = 1
        return (try? viewContext.fetch(request))?.first
    }
}
