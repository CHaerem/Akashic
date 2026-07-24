import CoreData
import CloudKit

/// Photo architecture v2 (MAPPING §13): the media-zone side of the store.
///
/// Splits into two layers:
///   * `MediaRepackStore` conformance and the ingest/delete hooks — pure Core Data, compiled in
///     every configuration and unit-tested against a real in-memory controller;
///   * the CloudKit factories (media database, media fetcher, repack launch) — reached only in the
///     entitled `*-CloudKit` build, exactly like the rest of the sync stack.
extension PersistenceController: MediaRepackStore {

    // MARK: - MediaRepackStore (pure Core Data)

    /// Photos still needing repack: an OWNER journey's photo whose original bytes are on disk and
    /// whose PhotoMedia is not yet confirmed. A photo with no local original is skipped (the owner's
    /// complete device does the work); a shared-in journey is skipped (only the owner repacks).
    func mediaRepackPending() -> [MediaUploadItem] {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        let photos = (try? viewContext.fetch(request)) ?? []
        var items: [MediaUploadItem] = []
        for cd in photos {
            guard let id = cd.id, let journeyId = cd.journeyId else { continue }
            guard cd.journey?.zoneOwnerName == nil else { continue }   // owner journeys only
            guard let original = Photo.resolveMedia(absolutePath: cd.localOriginalPath, relativeKey: cd.url)
            else { continue }                                          // no local bytes → skip
            guard !hasUploadedRecord(forRecordName: RecordCoder.mediaRecordName(forPhotoID: id))
            else { continue }                                          // already confirmed
            items.append(MediaUploadItem(photoID: id, journeyID: journeyId,
                                         originalPath: original.path))
        }
        return items
    }

    func mediaRepackConfirmedCount() -> Int {
        let request = NSFetchRequest<CDSyncRecordMeta>(entityName: "CDSyncRecordMeta")
        request.predicate = NSPredicate(format: "recordName BEGINSWITH %@", RecordCoder.mediaRecordPrefix)
        return (try? viewContext.count(for: request)) ?? 0
    }

    /// Reuses the existing system-fields side table, keyed by the `media-<id>` record name: writing
    /// a PhotoMedia record's meta both persists its change tag AND marks the repack step done, so no
    /// Core Data migration was needed for repack progress (MAPPING §13).
    func markMediaUploaded(_ records: [CKRecord]) {
        recordsDidSave(records)
    }

    /// Enqueue a normal Photo save through the private engine for each repacked photo; `makeRecord`
    /// then clears `original` because the `media-<id>` meta now exists (see PersistenceController+Sync).
    func enqueuePhotoOriginalClear(photoIDs: [String]) {
        guard let engine = syncCoordinator else { return }
        var changes: [LocalChange] = []
        for id in photoIDs {
            guard let cd = photoRow(id), let journeyId = cd.journeyId else { continue }
            changes.append(LocalChange(kind: .save, recordType: RecordCoder.RecordType.photo,
                                       recordName: id, journeyID: journeyId))
        }
        if !changes.isEmpty { engine.localStoreDidChange(changes) }
    }

    private func photoRow(_ id: String) -> CDPhoto? {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "id == %@", id)
        request.fetchLimit = 1
        return (try? viewContext.fetch(request))?.first
    }

    /// Build the media-upload items for a set of freshly-ingested photos (their original bytes are
    /// already on disk). Routed to the journey's owner so a participant's edit lands in the shared DB.
    func mediaUploadItems(forPhotoIDs ids: [String]) -> [MediaUploadItem] {
        ids.compactMap { id in
            guard let cd = photoRow(id), let journeyId = cd.journeyId,
                  let original = Photo.resolveMedia(absolutePath: cd.localOriginalPath, relativeKey: cd.url)
            else { return nil }
            return MediaUploadItem(photoID: id, journeyID: journeyId, originalPath: original.path,
                                   ownerName: zoneOwnerName(forJourneyID: journeyId) ?? CKCurrentUserDefaultName)
        }
    }

    // MARK: - Public entry points (always compiled; CloudKit work gated inside)
    //
    // These are called from views (lightbox / export) and `JourneyStore`, which compile in every
    // configuration — so the entry points are always present and no-op outside the entitled build.

    /// A `MediaFetcher` wired to this store, or nil outside the entitled CloudKit build. Routes to
    /// the right database per journey owner and stores fetched bytes back into the media root.
    @MainActor
    func makeMediaFetcher() -> MediaFetcher? {
        #if AKASHIC_CLOUDKIT_BUILD
        return MediaFetcher(dependencies: .init(
            database: { [weak self] owner in self?.makeMediaDatabase(ownerName: owner) },
            zoneOwner: { [weak self] journeyID in self?.zoneOwnerName(forJourneyID: journeyID) },
            persist: { [weak self] photo, staging in self?.storeFetchedOriginal(photo, stagingURL: staging) }))
        #else
        return nil
        #endif
    }

    /// Ingest hook: upload PhotoMedia records for freshly-ingested photos (user-initiated, so not
    /// Wi-Fi-gated). Fire-and-forget; the Photo record's thumbnail rides the engine separately.
    @MainActor
    func uploadPhotoMedia(forIngestedPhotoIDs ids: [String]) {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, syncCoordinator?.isRunning == true else { return }
        let items = mediaUploadItems(forPhotoIDs: ids)
        guard !items.isEmpty else { return }
        // One service per owner database (owner items dominate; a shared-in edit is rare).
        let grouped = Dictionary(grouping: items) { $0.ownerName }
        for (owner, ownerItems) in grouped {
            guard let db = makeMediaDatabase(ownerName: owner == CKCurrentUserDefaultName ? nil : owner)
            else { continue }
            let service = PhotoMediaService(database: db)
            let store = self
            Task { [weak store] in
                let result = await service.upload(ownerItems)
                await MainActor.run { store?.markMediaUploaded(result.savedRecords) }
            }
        }
        #endif
    }

    /// Delete hook: remove a deleted photo's PhotoMedia record from its journey's media zone.
    @MainActor
    func deletePhotoMedia(photoID: String, journeyID: String) {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, syncCoordinator?.isRunning == true else { return }
        let owner = zoneOwnerName(forJourneyID: journeyID)
        guard let db = makeMediaDatabase(ownerName: owner) else { return }
        let service = PhotoMediaService(database: db)
        Task {
            await service.delete(photoIDs: [photoID], journeyID: journeyID,
                                 ownerName: owner ?? CKCurrentUserDefaultName)
        }
        #endif
    }

    /// Start (or resume) the one-time repack on the owner's device. Surfaces progress on
    /// `syncStatus`. Detached from the caller; safe to call on launch and on a Wi-Fi path change.
    @MainActor
    func startMediaRepackIfNeeded() {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, syncCoordinator?.isRunning == true else { return }
        guard let db = makeMediaDatabase(ownerName: nil) else { return }   // owner → private DB
        let service = PhotoMediaService(database: db)
        let job = MediaRepackJob(store: self, service: service, networkPolicy: NetworkPolicy.shared)
        let status = syncStatus
        job.onProgress = { progress in
            status.repackProgress = progress.isFinished ? nil : progress
        }
        mediaRepackJob = job
        Task { await job.run() }
        #endif
    }

    /// Owner side of the media share (MAPPING §13): ensure the journey's media zone exists and has
    /// a `CKShare`, then publish its URL onto the Journey record (`mediaShareURL`) so participants
    /// can auto-accept. Called when the journey's data share is created. No-op outside the entitled
    /// build / for a journey we do not own.
    @MainActor
    func ensureMediaShare(forJourneyID journeyID: String, title: String) async {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, zoneOwnerName(forJourneyID: journeyID) == nil else { return }
        let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
        let database = container.privateCloudDatabase
        let mediaZoneID = RecordCoder.mediaZoneID(forJourneyID: journeyID)
        do {
            _ = try await database.modifyRecordZones(saving: [CKRecordZone(zoneID: mediaZoneID)], deleting: [])
            let shareRecordID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: mediaZoneID)
            let share: CKShare
            if let existing = try? await database.record(for: shareRecordID) as? CKShare {
                share = existing
            } else {
                let fresh = CKShare(recordZoneID: mediaZoneID)
                fresh[CKShare.SystemFieldKey.title] = title as CKRecordValue
                fresh.publicPermission = .none
                let (results, _) = try await database.modifyRecords(saving: [fresh], deleting: [])
                guard let saved = try results[fresh.recordID]?.get() as? CKShare else { return }
                share = saved
            }
            if let url = share.url { setMediaShareURL(url.absoluteString, forJourneyID: journeyID) }
        } catch {
            SyncLog.error("ensureMediaShare: failed for \(journeyID): \(error)")
        }
        #endif
    }

    /// Owner side of unshare: stop the media zone's share too, and clear the published URL.
    @MainActor
    func stopMediaShare(forJourneyID journeyID: String) async {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, zoneOwnerName(forJourneyID: journeyID) == nil else { return }
        let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
        let database = container.privateCloudDatabase
        let mediaZoneID = RecordCoder.mediaZoneID(forJourneyID: journeyID)
        let shareRecordID = CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: mediaZoneID)
        _ = try? await database.modifyRecords(saving: [], deleting: [shareRecordID])
        setMediaShareURL(nil, forJourneyID: journeyID)
        #endif
    }

    /// Participant side: auto-accept the media share of any shared-in journey that carries a
    /// `mediaShareURL` we have not accepted yet. Silent, retry-tolerant, degrades to thumbnails.
    @MainActor
    func autoAcceptMediaSharesIfNeeded() {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit else { return }
        let accepter = MediaShareAutoAccepter(
            accepter: CKMediaShareAccepter(containerIdentifier: Config.cloudKitContainerIdentifier))
        for (journeyID, url) in sharedJourneysWithMediaShareURL() where !accepter.hasAccepted(journeyID: journeyID) {
            Task { await accepter.autoAcceptIfNeeded(journeyID: journeyID, mediaShareURL: url) }
        }
        #endif
    }

    /// Shared-in journeys (zone owner set) that carry a media share URL.
    private func sharedJourneysWithMediaShareURL() -> [(journeyID: String, url: String)] {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "zoneOwnerName != nil AND mediaShareURL != nil")
        return ((try? viewContext.fetch(request)) ?? []).compactMap { cd in
            guard let id = cd.id, let url = cd.mediaShareURL else { return nil }
            return (id, url)
        }
    }

    /// Set (or clear) a journey's media share URL locally. On the owner this is a normal edit that
    /// the scheduler forwards to the engine, so the URL rides the Journey record to participants.
    @MainActor
    func setMediaShareURL(_ url: String?, forJourneyID journeyID: String) {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "id == %@", journeyID)
        request.fetchLimit = 1
        guard let cd = (try? viewContext.fetch(request))?.first else { return }
        cd.mediaShareURL = url
        cd.updatedAt = Date()
        try? viewContext.save()
    }

    /// Re-upload a journey's PhotoMedia from local bytes after its media zone was lost server-side
    /// (wired to `AkashicSyncEngine.onMediaZoneLost`). Reuses the repack machinery, one journey.
    @MainActor
    func healMediaZone(journeyID: String) {
        #if AKASHIC_CLOUDKIT_BUILD
        guard mode == .cloudKit, let db = makeMediaDatabase(ownerName: nil) else { return }
        let items = mediaRepackPending().filter { $0.journeyID == journeyID }
        guard !items.isEmpty else { return }
        let service = PhotoMediaService(database: db)
        let store = self
        Task { [weak store] in
            let result = await service.upload(items)
            await MainActor.run {
                store?.markMediaUploaded(result.savedRecords)
                store?.enqueuePhotoOriginalClear(photoIDs: result.savedPhotoIDs)
            }
        }
        #endif
    }

    // MARK: - CloudKit-only helpers (entitled build)

    #if AKASHIC_CLOUDKIT_BUILD
    /// The media database for an owner (nil = we own it → private DB; a sharing owner → shared DB).
    func makeMediaDatabase(ownerName: String?) -> MediaDatabase? {
        let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
        let database = ownerName == nil ? container.privateCloudDatabase : container.sharedCloudDatabase
        return CKMediaDatabase(database: database)
    }

    /// Copy the CloudKit staging bytes of a fetched original into the media root under the photo's
    /// canonical key and update the row, so the next open is a local hit. Returns the stable URL.
    @MainActor
    private func storeFetchedOriginal(_ photo: Photo, stagingURL: URL) -> URL? {
        guard let adopted = SyncMediaStaging.adopt(assetAt: stagingURL, kind: .original,
                                                   journeyId: photo.journeyId, photoId: photo.id,
                                                   relativeKey: photo.url, mediaType: photo.mediaType)
        else { return nil }
        if let cd = photoRow(photo.id) {
            let wasApplying = syncIsApplyingRemoteChanges
            syncIsApplyingRemoteChanges = true          // storing fetched bytes is not a user edit
            cd.localOriginalPath = adopted.absolutePath
            if (cd.url ?? "").isEmpty { cd.url = adopted.relativeKey }
            try? viewContext.save()
            syncIsApplyingRemoteChanges = wasApplying
        }
        return URL(fileURLWithPath: adopted.absolutePath)
    }
    #endif
}
