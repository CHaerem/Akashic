import Foundation
import Combine

/// Observable source of journeys for the UI. Reads through the Core Data layer so the
/// SwiftUI views exercise the same mapping path CloudKit will use.
@MainActor
final class JourneyStore: ObservableObject {
    @Published private(set) var journeys: [Journey] = []
    @Published private(set) var loadError: String?

    /// Latest import outcome + progress, surfaced by the Settings import UI.
    @Published private(set) var importProgress: ImportProgress?
    @Published private(set) var lastImportReport: ImportReport?
    @Published private(set) var isImporting = false

    /// Journey id a Spotlight deep-link asked to open, awaiting the map to fly to it.
    /// Set by `AkashicApp`'s `onContinueUserActivity` handler; a view observes it and clears it.
    @Published var pendingJourneySelection: String?

    private let persistence: PersistenceController

    /// Shared on-demand originals fetcher for the v2 media split (MAPPING §13). nil outside the
    /// entitled CloudKit build / fixtures, where the UI falls back to whatever bytes are on disk.
    /// One instance so its single-in-flight-per-photo coalescing spans the whole session.
    lazy var mediaFetcher: MediaFetcher? = persistence.makeMediaFetcher()

    init(persistence: PersistenceController = .shared) {
        self.persistence = persistence
        reload()
        // Pulled server changes land straight in Core Data, which this store does NOT observe —
        // it publishes a snapshot taken by `reload()`. Without this hook a clean `.cloudKit`
        // install downloaded the whole archive and still showed "No journeys" until the next
        // relaunch. The coordinator fires it on the main actor after each applied batch.
        persistence.syncCoordinator?.onRemoteChangesApplied = { [weak self] in
            self?.reload()
        }
    }

    var mode: PersistenceMode { persistence.mode }

    func reload() {
        journeys = persistence.loadJourneys()
        loadError = journeys.isEmpty ? "No journeys found in the \(persistence.mode.label) store." : nil
        publishExtras()
    }

    func journey(withID id: String) -> Journey? {
        journeys.first { $0.id == id }
    }

    /// Record a Spotlight deep-link target (the map observes `pendingJourneySelection`).
    func requestJourneySelection(_ journeyID: String) {
        pendingJourneySelection = journeyID
    }

    // MARK: - Extras (Spotlight + widgets)

    /// Refresh the Spotlight index and the widget snapshot after any store load / import.
    /// Both calls are idempotent and internally no-op under XCTest / when unavailable, so this
    /// is safe to run on every `reload()`.
    private func publishExtras() {
        SpotlightIndexer.shared.reindex(journeys)
        WidgetPublisher.publish(journeys, thumbnailSources: heroThumbnailSources())
    }

    /// Map of journey id → absolute hero-thumbnail path, for widgets to copy into the shared
    /// container. Only computed when an App-Group container exists (otherwise the widget can't
    /// read the copies anyway), so it is free tonight on the unsigned build.
    private func heroThumbnailSources() -> [String: String] {
        guard AppGroup.isAvailable else { return [:] }
        var sources: [String: String] = [:]
        for journey in journeys {
            let photos = persistence.loadPhotos(forJourneyID: journey.id)
            if let hero = photos.first(where: { $0.isHero }) ?? photos.first,
               let path = hero.localThumbPath ?? hero.localOriginalPath {
                sources[journey.id] = path
            }
        }
        return sources
    }

    var photoCount: Int { persistence.photoCount() }

    // MARK: - Photos

    /// All photos for a journey (sorted by `sortOrder`).
    func photos(forJourneyID id: String) -> [Photo] {
        persistence.loadPhotos(forJourneyID: id)
    }

    /// Photos for a journey grouped by day using the 4-tier `PhotoDayMatcher`.
    /// Returns the per-day buckets plus everything that couldn't be matched.
    func photosByDay(forJourneyID id: String) -> (byDay: [Int: [Photo]], unassigned: [Photo]) {
        guard let journey = journey(withID: id) else { return ([:], []) }
        let matcher = PhotoDayMatcher(journey: journey)
        return matcher.groupByDay(persistence.loadPhotos(forJourneyID: id))
    }

    /// Photos for a single day of a journey (4-tier matched).
    func photos(forDay day: Int, journeyID id: String) -> [Photo] {
        guard let journey = journey(withID: id) else { return [] }
        let matcher = PhotoDayMatcher(journey: journey)
        return matcher.photos(forDay: day, from: persistence.loadPhotos(forJourneyID: id))
    }

    // MARK: - Import

    /// Run the local importer against an export bundle on disk, then reload the UI.
    ///
    /// Writes into this store's Core Data context. For persisted results (and photo display),
    /// the app should be in `.local` mode; in `.fixtures` mode the import is visible for the
    /// session but not saved to disk.
    @discardableResult
    func runLocalImport(bundlePath: String, mediaRoot: String,
                        reset: Bool = false) async -> ImportReport? {
        guard !isImporting else { return nil }
        isImporting = true
        importProgress = .reading
        defer { isImporting = false }

        if reset { persistence.resetJourneys() }

        let context = persistence.viewContext
        let exportRoot = URL(fileURLWithPath: bundlePath)
        let mediaURL = URL(fileURLWithPath: mediaRoot)

        do {
            let bundle = try ExportBundle.load(exportRoot: exportRoot)
            let media = MediaResolver(root: mediaURL)
            let importer = LocalImporter(context: context)
            let report = importer.run(bundle: bundle, media: media) { [weak self] progress in
                Task { @MainActor in self?.importProgress = progress }
            }
            lastImportReport = report
            importProgress = .finished(report)
            reload()
            return report
        } catch {
            importProgress = .failed(String(describing: error))
            return nil
        }
    }

    // MARK: - Comments
    //
    // Day-comments feature (web parity: `DayCommentsSection`). The service wraps THIS store's
    // Core Data stack so comments the UI writes land in the same context the views read, and it
    // owns validation + the local "Your name" author identity. Additive, comment-only.
    lazy var commentService = CommentService(persistence: persistence)

    // MARK: - Editing (native, contextual)
    //
    // Every edit flows store → PersistenceController → Core Data, then `reload()` re-publishes
    // `journeys` so SwiftUI refreshes synchronously (photo grids/strips re-derive from the store
    // on the same run loop). These are the same write methods the CloudKit path will drive in D4.

    private let photoEditService = PhotoEditService()

    // Photo edits ---------------------------------------------------------------------------

    /// Set/clear a photo caption. Returns the updated value (for callers holding a local copy,
    /// e.g. the lightbox) before `reload()` republishes the list.
    @discardableResult
    func setPhotoCaption(_ caption: String?, forPhoto id: String) -> Photo? {
        let updated = persistence.updatePhotoCaption(id: id, caption: caption)
        reload()
        return updated
    }

    /// Rotate a photo by a signed delta (e.g. +90 / −90); result is normalised to 0/90/180/270.
    @discardableResult
    func rotatePhoto(_ id: String, by delta: Int, from current: Int) -> Photo? {
        let updated = persistence.setPhotoRotation(id: id, rotation: current + delta)
        reload()
        return updated
    }

    @discardableResult
    func setPhotoRotation(_ rotation: Int, forPhoto id: String) -> Photo? {
        let updated = persistence.setPhotoRotation(id: id, rotation: rotation)
        reload()
        return updated
    }

    /// Toggle a photo as its journey's hero (clears any previous hero in the journey).
    @discardableResult
    func setPhotoHero(_ isHero: Bool, forPhoto id: String) -> Photo? {
        let updated = persistence.setPhotoHero(id: id, isHero: isHero)
        reload()
        return updated
    }

    /// (Re)assign a photo to a waypoint/day (`nil` unassigns → "Unassigned" bucket).
    @discardableResult
    func assignPhoto(_ id: String, toWaypoint waypointID: String?) -> Photo? {
        let updated = persistence.assignPhoto(id: id, toWaypointID: waypointID)
        reload()
        return updated
    }

    /// Manually set/clear a photo's coordinates. Records `location_source = "manual"` unless
    /// `source` is overridden.
    @discardableResult
    func setPhotoLocation(_ coordinates: [Double]?, source: String? = "manual", forPhoto id: String) -> Photo? {
        let updated = persistence.setPhotoLocation(id: id, coordinates: coordinates,
                                                   source: coordinates == nil ? nil : source)
        reload()
        return updated
    }

    /// Delete a photo: commit the record deletion first, then reclaim its on-disk bytes only
    /// if the commit succeeded (so a failed save never orphans the row from its files).
    /// Returns true on success.
    @discardableResult
    func deletePhoto(_ photo: Photo) -> Bool {
        let ok = persistence.deletePhoto(id: photo.id)
        if ok {
            photoEditService.deleteFiles(for: photo)
            // If the journey is published to the world-readable showcase, take the deleted photo's
            // thumbnail down from the public mirror too (best-effort). No-op outside CloudKit mode
            // / the entitled build, and for a non-public or shared-in journey. (finding #7.)
            persistence.removePublicMirrorPhotoIfPublished(photoID: photo.id, journeyID: photo.journeyId)
            // v2: remove the photo's PhotoMedia record (the original) from the media zone too. The
            // Photo record deletion rides the engine; the media record lives in the excluded media
            // zone and is deleted DIRECTLY. No-op outside the entitled CloudKit build. (MAPPING §13.)
            persistence.deletePhotoMedia(photoID: photo.id, journeyID: photo.journeyId)
        }
        reload()
        return ok
    }

    /// Insert freshly-ingested photos (files already written by `PhotoIngestService`), then reload.
    /// Returns the number that landed (a photo whose journey is absent is skipped).
    @discardableResult
    func addIngestedPhotos(_ photos: [Photo]) -> Int {
        var insertedIDs: [String] = []
        for photo in photos where persistence.insertPhoto(photo) { insertedIDs.append(photo.id) }
        reload()
        // v2: upload each new photo's original as a PhotoMedia record in the media zone (its Photo
        // record carries only the thumbnail, enqueued through the engine by the save observer).
        // User-initiated, so not Wi-Fi-gated. No-op outside the entitled CloudKit build. (MAPPING §13.)
        if !insertedIDs.isEmpty { persistence.uploadPhotoMedia(forIngestedPhotoIDs: insertedIDs) }
        return insertedIDs.count
    }

    /// Next free `sortOrder` for appending new photos to a journey.
    func nextPhotoSortOrder(forJourneyID id: String) -> Int {
        persistence.nextPhotoSortOrder(forJourneyID: id)
    }

    // Journey creation ----------------------------------------------------------------------

    /// Create a new journey from a draft (§4.1) and land it in the store. The slug is uniquified
    /// against the journeys already present. Returns the created journey (with its final slug) so
    /// the UI can navigate straight into it, or nil if the write failed.
    @discardableResult
    func createJourney(from draft: JourneyDraft) -> Journey? {
        let newJourney = draft.makeJourney(existingSlugs: journeys.map(\.slug))
        guard persistence.createJourney(newJourney) else { return nil }
        reload()
        return journey(withID: newJourney.id) ?? newJourney
    }

    // Waypoint / journey edits --------------------------------------------------------------

    @discardableResult
    func updateWaypoint(id: String, name: String, description: String,
                        highlights: [String], elevation: Int, dayNumber: Int) -> Bool {
        let ok = persistence.updateWaypoint(id: id, name: name, description: description,
                                            highlights: highlights, elevation: elevation,
                                            dayNumber: dayNumber)
        reload()
        return ok
    }

    /// Append grounded facts / historical notes drafted for a day onto its waypoint.
    @discardableResult
    func addDayContent(funFacts: [FunFact], historicalSites: [HistoricalSite], toWaypoint id: String) -> Bool {
        let ok = persistence.addDayContent(waypointID: id, funFacts: funFacts, historicalSites: historicalSites)
        reload()
        return ok
    }

    @discardableResult
    func updateJourney(id: String, name: String, description: String, country: String,
                       dateStarted: String?, dateEnded: String?,
                       totalDays: Int?, totalDistance: Double?, summitElevation: Int?) -> Bool {
        let ok = persistence.updateJourney(id: id, name: name, description: description,
                                           country: country, dateStarted: dateStarted,
                                           dateEnded: dateEnded, totalDays: totalDays,
                                           totalDistance: totalDistance, summitElevation: summitElevation)
        reload()
        return ok
    }

    // Day content edits ---------------------------------------------------------------------

    /// Authoritatively SET a day's content lists + weather (edit/delete/add of individual facts,
    /// POIs, historical sites, and weather all round-trip through this). Correcting data is free.
    @discardableResult
    func setDayContent(id: String, funFacts: [FunFact], pointsOfInterest: [PointOfInterest],
                       historicalSites: [HistoricalSite], weather: WeatherData?) -> Bool {
        let ok = persistence.setDayContent(waypointID: id, funFacts: funFacts,
                                           pointsOfInterest: pointsOfInterest,
                                           historicalSites: historicalSites, weather: weather)
        reload()
        return ok
    }

    // Route correction ----------------------------------------------------------------------

    /// Replace a journey's route and recompute its stats through the normal edit path (one engine
    /// save). Days are NEVER re-seeded here. `positions`, when supplied, is the opt-in "also update
    /// day positions" step — each is `(coordinate [lng,lat], elevation)` applied to days by order.
    @discardableResult
    func replaceRoute(journeyID: String, route: Route,
                      positions: [(coordinate: [Double], elevation: Int)]? = nil) -> Bool {
        guard let journey = journey(withID: journeyID) else { return false }
        let stats = RouteCorrection.recomputedStats(
            route: route, dayCount: journey.camps.count,
            dateStarted: journey.dateStarted, dateEnded: journey.dateEnded, name: journey.shortName)
        let ok = persistence.updateJourneyRoute(id: journeyID, route: route, stats: stats)
        if ok, let positions {
            persistence.updateWaypointPositions(journeyID: journeyID,
                                                coordinates: positions.map(\.coordinate),
                                                elevations: positions.map(\.elevation))
        }
        reload()
        return ok
    }

    /// Recompute stats from the journey's CURRENT route (fixes stale stats after any edit), through
    /// the same one-save path.
    @discardableResult
    func recomputeStats(journeyID: String) -> Bool {
        guard let journey = journey(withID: journeyID) else { return false }
        return replaceRoute(journeyID: journeyID, route: journey.route)
    }

    // Day management ------------------------------------------------------------------------

    /// Add a day (at the end, or after `afterDayNumber`); days renumber consistently. Returns the
    /// new day's id.
    @discardableResult
    func addDay(toJourney journeyID: String, name: String, afterDayNumber: Int? = nil) -> String? {
        let id = persistence.addWaypoint(journeyID: journeyID, name: name, afterDayNumber: afterDayNumber)
        reload()
        return id
    }

    /// Delete a day: its photos/comments become unassigned (never deleted); survivors renumber.
    @discardableResult
    func deleteDay(_ waypointID: String) -> Bool {
        let ok = persistence.deleteWaypoint(id: waypointID)
        reload()
        return ok
    }

    /// Reorder days to `orderedIDs` and renumber. Photo linkage (by waypointId) is preserved.
    @discardableResult
    func reorderDays(journeyID: String, orderedIDs: [String]) -> Bool {
        let ok = persistence.reorderWaypoints(journeyID: journeyID, orderedIDs: orderedIDs)
        reload()
        return ok
    }

    /// Mark a journey public/private (drives the public showcase mirror — T3.3 / MAPPING §8).
    @discardableResult
    func setJourneyPublic(_ isPublic: Bool, forJourney id: String) -> Bool {
        let ok = persistence.setJourneyPublic(id: id, isPublic: isPublic)
        reload()
        return ok
    }

    /// True when this journey lives in our OWN (private) database — i.e. we may manage its public
    /// showcase. A journey shared *into* this account has a non-nil `zoneOwnerName` and its mirror
    /// is the owner's to control (only `_creator` can write the public records, and consenting to
    /// world-readability on the owner's behalf is not ours to do). Fixtures / local-mode journeys
    /// have no owner recorded and are ours by definition. (review finding #6.)
    /// Why a journey cannot be deleted right now, or nil when deletion may proceed.
    enum DeleteBlocker {
        /// Shared-in journeys are the owner's to delete, not ours.
        case notOwner
        /// A published journey must leave the public showcase first — deleting around a live,
        /// world-readable mirror would strand it with no owner able to remove it.
        case stillPublished
    }

    func deleteBlocker(forJourneyID id: String) -> DeleteBlocker? {
        guard isOwnedByCurrentUser(journeyID: id) else { return .notOwner }
        if journey(withID: id)?.isPublic == true, persistence.mode == .cloudKit {
            return .stillPublished
        }
        return nil
    }

    /// Delete an owned, unpublished journey everywhere. Returns false when blocked — callers
    /// should have consulted `deleteBlocker` first and shown the reason.
    @discardableResult
    func deleteJourney(id: String) -> Bool {
        guard deleteBlocker(forJourneyID: id) == nil else { return false }
        persistence.deleteJourney(id: id)
        reload()
        return true
    }

    func isOwnedByCurrentUser(journeyID: String) -> Bool {
        persistence.zoneOwnerName(forJourneyID: journeyID) == nil
    }

    /// Number of journeys this user OWNS (`zoneOwnerName == nil`). Journeys shared *into* this
    /// account are excluded, because the free-tier limits (M3 / COMMERCIALIZATION-PLAN §5) apply
    /// only to what the user creates — never to shared content they view, comment on, or caption.
    var ownedJourneyCount: Int {
        journeys.filter { isOwnedByCurrentUser(journeyID: $0.id) }.count
    }

    /// The owned-journey count the create-journey paywall gate consults — owned journeys MINUS any
    /// seeded from the bundled demo fixtures. In `.cloudKit` mode nothing is seeded, so this equals
    /// `ownedJourneyCount`; in `.fixtures`/`.local` (dev/demo) modes the bundled demo journeys never
    /// eat the family's one free slot. (quality gate: fixture-seeded demo journeys consume the free
    /// tier.)
    var billableOwnedJourneyCount: Int {
        journeys.filter {
            isOwnedByCurrentUser(journeyID: $0.id) && !persistence.isSeededFixture(journeyID: $0.id)
        }.count
    }
}
