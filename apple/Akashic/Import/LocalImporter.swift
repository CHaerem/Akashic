import CoreData
import Foundation

// MARK: - Report & progress

/// Outcome of a single upsert.
enum UpsertResult { case created, updated, skipped }

/// Summary of one import run — the numbers the Settings screen and tests assert on.
struct ImportReport: Equatable {
    var journeysCreated = 0
    var journeysUpdated = 0
    var waypointsImported = 0
    var photosCreated = 0
    var photosUpdated = 0
    var photosSkipped = 0        // photo whose journey wasn't in the bundle (orphan)
    var originalsResolved = 0    // photos whose full-res bytes are on disk
    var thumbsResolved = 0       // photos whose thumbnail bytes are on disk
    var photosMissingMedia = 0   // photos with NO local bytes (neither thumb nor original)
    var elapsed: TimeInterval = 0

    var journeysTotal: Int { journeysCreated + journeysUpdated }
    var photosTotal: Int { photosCreated + photosUpdated }

    /// One-line human summary for logs / UI.
    var summary: String {
        """
        Journeys: \(journeysTotal) (\(journeysCreated) new, \(journeysUpdated) updated) · \
        Waypoints: \(waypointsImported) · \
        Photos: \(photosTotal) (\(photosCreated) new, \(photosUpdated) updated, \(photosSkipped) skipped) · \
        Media: \(thumbsResolved) thumbs, \(originalsResolved) originals on disk, \(photosMissingMedia) missing
        """
    }
}

/// Coarse progress for a run, surfaced to the UI.
enum ImportProgress: Equatable {
    case reading
    case importingJourneys(done: Int, total: Int)
    case importingPhotos(done: Int, total: Int)
    case saving
    case finished(ImportReport)
    case failed(String)
}

// MARK: - Sink seam (the part that varies between local and CloudKit)

/// The write target for an import. `ExportBundle` (read) and `ExportMapper` (transform) are
/// shared by every importer; only the sink changes:
///   * **tonight** — `CoreDataImportSink` writes the local `.local` Core Data store.
///   * **T2.5**    — a `CloudKitImportSink` will write CKRecords into per-journey zones,
///                   reusing this exact same `LocalImporter.run(bundle:media:)` orchestration
///                   and `ExportMapper` output. It only has to implement these three methods
///                   (upsert a Journey → zone root + Waypoint records, upsert a Photo →
///                   Photo record with CKAssets fetched from the resolved media paths).
protocol ImportSink {
    /// Upsert a journey and (re)build its waypoints. Idempotent, keyed by `journey.id`.
    func upsert(journey: Journey) throws -> UpsertResult
    /// Upsert a photo, linking it to its already-imported journey/waypoint. Returns
    /// `.skipped` when the journey isn't present.
    func upsert(photo: Photo) throws -> UpsertResult
    /// Flush pending writes.
    func save() throws
}

/// Core Data implementation of `ImportSink` for the `.local` store.
///
/// Caches the `CDJourney` / `CDWaypoint` objects it creates so photos resolve their
/// relationships from memory instead of a fetch-per-photo (1500+ photos).
final class CoreDataImportSink: ImportSink {
    let context: NSManagedObjectContext
    private var journeysByID: [String: CDJourney] = [:]
    private var waypointsByID: [String: CDWaypoint] = [:]

    init(context: NSManagedObjectContext) {
        self.context = context
    }

    func upsert(journey: Journey) throws -> UpsertResult {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "id == %@", journey.id)
        request.fetchLimit = 1
        let created = ((try? context.fetch(request))?.first) == nil

        let cd = CoreDataMapping.upsertJourney(journey, into: context)
        journeysByID[journey.id] = cd
        // upsertJourney rebuilds the waypoint set; cache the fresh objects for photo linking.
        for wp in (cd.waypoints as? Set<CDWaypoint> ?? []) {
            if let id = wp.id { waypointsByID[id] = wp }
        }
        return created ? .created : .updated
    }

    func upsert(photo: Photo) throws -> UpsertResult {
        guard let journey = journeysByID[photo.journeyId] else { return .skipped }
        let waypoint = photo.waypointId.flatMap { waypointsByID[$0] }
        let (_, created) = CoreDataMapping.upsertPhoto(photo, into: context,
                                                       journey: journey, waypoint: waypoint)
        return created ? .created : .updated
    }

    func save() throws {
        if context.hasChanges { try context.save() }
    }
}

// MARK: - LocalImporter (orchestrator)

/// Idempotent importer from a Supabase JSON export into a write sink.
///
/// Reads → maps → upserts → saves. All original UUIDs are preserved. Re-running against the
/// same store updates in place (no duplicates), and **preserves native edits**: a re-import
/// refreshes media paths/metadata and structural fields only, leaving user-editable fields
/// (photo caption/rotation/hero/assignment; waypoint name/description/highlights/elevation/
/// dayNumber) untouched. The default sink writes the local Core Data store; inject a different
/// `ImportSink` to reuse the same pipeline for CloudKit (see the `ImportSink` doc comment).
final class LocalImporter {
    private let sink: ImportSink

    init(sink: ImportSink) {
        self.sink = sink
    }

    /// Convenience: import straight into a Core Data context (the `.local` store).
    convenience init(context: NSManagedObjectContext) {
        self.init(sink: CoreDataImportSink(context: context))
    }

    /// Load an export from disk and import it. `exportRoot` may be the export root (containing
    /// `supabase/`) or the `supabase/` directory itself. `mediaRoot` is where R2 objects live
    /// (typically `<exportRoot>/r2/objects`).
    @discardableResult
    func run(exportRoot: URL, mediaRoot: URL,
             progress: ((ImportProgress) -> Void)? = nil) throws -> ImportReport {
        progress?(.reading)
        let bundle = try ExportBundle.load(exportRoot: exportRoot)
        let media = MediaResolver(root: mediaRoot)
        return run(bundle: bundle, media: media, progress: progress)
    }

    /// Import an already-loaded bundle. Pure orchestration over `ExportMapper` + the sink.
    @discardableResult
    func run(bundle: ExportBundle, media: MediaResolver,
             progress: ((ImportProgress) -> Void)? = nil) -> ImportReport {
        let start = Date()
        var report = ImportReport()

        // 1. Journeys (+ their waypoints) first, so photos can resolve relationships.
        let journeys = ExportMapper.journeys(from: bundle)
        for (i, journey) in journeys.enumerated() {
            progress?(.importingJourneys(done: i, total: journeys.count))
            switch (try? sink.upsert(journey: journey)) ?? .skipped {
            case .created: report.journeysCreated += 1
            case .updated: report.journeysUpdated += 1
            case .skipped: break
            }
            report.waypointsImported += journey.camps.count
        }

        // 2. Photos, resolving local media paths against the media root. Media stats count
        //    only photos actually imported (orphans whose journey is absent are skipped).
        let photos = ExportMapper.photos(from: bundle, media: media)
        for (i, photo) in photos.enumerated() {
            if i % 100 == 0 { progress?(.importingPhotos(done: i, total: photos.count)) }
            switch (try? sink.upsert(photo: photo)) ?? .skipped {
            case .created: report.photosCreated += 1
            case .updated: report.photosUpdated += 1
            case .skipped: report.photosSkipped += 1; continue
            }
            if photo.localOriginalPath != nil { report.originalsResolved += 1 }
            if photo.localThumbPath != nil { report.thumbsResolved += 1 }
            if !photo.hasLocalMedia { report.photosMissingMedia += 1 }
        }

        // 3. Flush.
        progress?(.saving)
        try? sink.save()

        report.elapsed = Date().timeIntervalSince(start)
        progress?(.finished(report))
        return report
    }
}
