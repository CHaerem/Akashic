import CloudKit
import Foundation

/// Default backoff sleep for the importer (real `Task.sleep`). A file-scope function so it can
/// be a default argument without tripping the "covariant Self in default argument" rule.
func defaultImportSleep(_ seconds: TimeInterval) async {
    try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
}

// MARK: - CKDatabase seam
//
// The importer talks to CloudKit only through this protocol so unit tests inject a mock and
// the whole batching / retry / partial-failure machine is exercised WITHOUT a container or an
// iCloud account (none exists in any simulator yet — see the task's LIVE CONTEXT). The real
// `CKDatabase` conforms via the thin extension below; `NullDatabase` backs dry-runs (it throws
// if ever called, guaranteeing a dry-run performs zero network work).

/// The subset of `CKDatabase` the importer needs, in async form. Distinct method names
/// (`ck…`) avoid overload ambiguity with `CKDatabase`'s own members and keep the mock trivial.
protocol CKDatabaseProtocol {
    func ckModifyRecordZones(
        saving zonesToSave: [CKRecordZone],
        deleting zoneIDsToDelete: [CKRecordZone.ID]
    ) async throws -> (saveResults: [CKRecordZone.ID: Result<CKRecordZone, Error>],
                       deleteResults: [CKRecordZone.ID: Result<Void, Error>])

    func ckModifyRecords(
        saving recordsToSave: [CKRecord],
        deleting recordIDsToDelete: [CKRecord.ID],
        savePolicy: CKModifyRecordsOperation.RecordSavePolicy
    ) async throws -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>],
                       deleteResults: [CKRecord.ID: Result<Void, Error>])

    func ckRecord(for recordID: CKRecord.ID) async throws -> CKRecord
}

extension CKDatabase: CKDatabaseProtocol {
    func ckModifyRecordZones(
        saving zonesToSave: [CKRecordZone],
        deleting zoneIDsToDelete: [CKRecordZone.ID]
    ) async throws -> (saveResults: [CKRecordZone.ID: Result<CKRecordZone, Error>],
                       deleteResults: [CKRecordZone.ID: Result<Void, Error>]) {
        try await modifyRecordZones(saving: zonesToSave, deleting: zoneIDsToDelete)
    }

    func ckModifyRecords(
        saving recordsToSave: [CKRecord],
        deleting recordIDsToDelete: [CKRecord.ID],
        savePolicy: CKModifyRecordsOperation.RecordSavePolicy
    ) async throws -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>],
                       deleteResults: [CKRecord.ID: Result<Void, Error>]) {
        // `atomically: false` — a partial failure inside a batch must NOT roll back the records
        // that saved, so the run makes forward progress and a re-run (which starts from the top
        // and re-writes every record) only has to overwrite what already landed.
        try await modifyRecords(saving: recordsToSave, deleting: recordIDsToDelete,
                                savePolicy: savePolicy, atomically: false)
    }

    func ckRecord(for recordID: CKRecord.ID) async throws -> CKRecord {
        try await record(for: recordID)
    }
}

/// Dry-run database: every call is a programmer error (dry-run must not touch the network).
struct NullDatabase: CKDatabaseProtocol {
    struct Called: Error { let what: String }
    func ckModifyRecordZones(saving: [CKRecordZone], deleting: [CKRecordZone.ID]) async throws
        -> (saveResults: [CKRecordZone.ID: Result<CKRecordZone, Error>], deleteResults: [CKRecordZone.ID: Result<Void, Error>]) {
        throw Called(what: "modifyRecordZones")
    }
    func ckModifyRecords(saving: [CKRecord], deleting: [CKRecord.ID], savePolicy: CKModifyRecordsOperation.RecordSavePolicy) async throws
        -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>], deleteResults: [CKRecord.ID: Result<Void, Error>]) {
        throw Called(what: "modifyRecords")
    }
    func ckRecord(for recordID: CKRecord.ID) async throws -> CKRecord { throw Called(what: "record(for:)") }
}

// MARK: - Configuration

/// Tunables for batching and retry. Defaults follow the task's guidance: ≤200 records/op and
/// ≤50 MB of CKAsset bytes/op (well under CloudKit's 400-record / per-request ceilings).
struct CloudKitImportConfig: Equatable {
    var maxRecordsPerBatch = 200
    var maxBatchBytes: Int64 = 50 * 1_000_000     // 50 MB
    var maxRetries = 5
    var baseBackoff: TimeInterval = 0.5           // seconds; exponential, capped
    var maxBackoff: TimeInterval = 30

    static let `default` = CloudKitImportConfig()
}

// MARK: - Internal upload item

/// What flows through the executor. Precomputed identity + asset byte size (so the plan and
/// the chunker never read file *bytes*, only `stat` sizes), plus the source needed to build a
/// fresh `CKRecord` at upload time (via the shared `RecordCoder`).
private struct UploadItem {
    enum Source {
        case journey(Journey)
        case waypoint(Camp, journeyID: String, sortOrder: Int)
        case photo(Photo)
        case comment(DayComment)
    }
    var recordName: String
    var recordType: String
    var zoneID: CKRecordZone.ID
    var assetBytes: Int64
    var source: Source

    var zoneName: String { zoneID.zoneName }
}

// MARK: - CloudKitImportSink

/// `ImportSink` that pushes the rescued family data into the owner's **private** DB as custom
/// CKRecords in per-journey zones (`journey-<uuid>`, recordNames = original UUIDs — MAPPING §1).
///
/// It reuses the shared read/transform pipeline verbatim: feed it with
/// `LocalImporter(sink:).run(bundle:media:)`, which calls `upsert(journey:)` / `upsert(photo:)`
/// to **buffer** the mapped domain objects, then call `makePlan()` (pure, no network) or
/// `execute(dryRun:progress:)` to do the CloudKit work.
///
/// Record construction is delegated **entirely** to the sibling `RecordCoder` (Sync/) — the
/// single (de)serialization contract shared with the sync engine — so migrated records are
/// byte-for-byte what native edits later produce. The only asset this sink attaches itself is
/// `heroImage` (R2 bytes), which `RecordCoder` deliberately leaves to the importer.
///
/// Save policy: **`.allKeys` overwrite** with freshly-built records keyed by the original UUID.
/// Justification — this is the one-time migration where *imported-data-wins*, so overwriting is
/// correct; `.allKeys` lets a record be written without first fetching its `recordChangeTag`,
/// which avoids 1,500+ existence fetches, and makes the run **idempotent + safe to re-run from the
/// top**: re-running re-writes the same recordNames (no duplicates), but it is NOT resumable — no
/// progress is persisted across process death, so a re-run re-uploads every asset (>5 GB on the
/// real export) rather than picking up where it stopped. Making it truly resumable would mean
/// persisting the confirmed recordNames (append-after-batch file in Application Support) and
/// skipping them in `orderedItems()`; deliberately not done here — see the T2.5 notes.
final class CloudKitImportSink: ImportSink {

    private let database: CKDatabaseProtocol
    private let mediaResolver: MediaResolver
    private let config: CloudKitImportConfig
    let containerID: String
    let environment: CloudKitImportEnvironment

    /// Injected so tests run backoff with zero real delay.
    private let sleep: (TimeInterval) async -> Void

    /// Comments keyed by journey (mapped to domain `DayComment` with migrated `authorName`).
    private let commentsByJourney: [String: [DayComment]]

    // Buffered by the ImportSink methods.
    private var journeys: [Journey] = []
    private var journeyIDs: Set<String> = []
    private var photosByJourney: [String: [Photo]] = [:]
    /// Photos with NO local bytes at all — skipped, reported (never a hard failure).
    private var missingMedia: [MissingMediaPhoto] = []
    /// Serialized route JSON per journey, kept only to size the `routeJSON` asset in the plan.
    private var routeByteSize: [String: Int64] = [:]

    init(database: CKDatabaseProtocol,
         mediaResolver: MediaResolver,
         commentRows: [DayCommentRow] = [],
         profileNamesByID: [String: String] = [:],
         containerID: String = "iCloud.no.akashic",
         environment: CloudKitImportEnvironment = .development,
         config: CloudKitImportConfig = .default,
         sleep: @escaping (TimeInterval) async -> Void = defaultImportSleep) {
        self.database = database
        self.mediaResolver = mediaResolver
        self.commentsByJourney = Dictionary(grouping: commentRows.map { row -> DayComment in
            let created = Self.parseISO(row.createdAt) ?? Date()
            return DayComment(id: row.id, waypointId: row.waypointId, journeyId: row.journeyId,
                              authorName: profileNamesByID[row.userId] ?? "",
                              content: row.content, createdAt: created,
                              updatedAt: Self.parseISO(row.updatedAt) ?? created, isMine: false)
        }) { $0.journeyId }
        self.containerID = containerID
        self.environment = environment
        self.config = config
        self.sleep = sleep
    }

    /// Convenience: load an export from disk and buffer it through the shared pipeline, returning
    /// a sink ready for `makePlan()` / `execute()`. Reuses `ExportBundle` + `ExportMapper` +
    /// `LocalImporter.run` unchanged.
    static func fromExport(database: CKDatabaseProtocol,
                           exportRoot: URL,
                           mediaRoot: URL,
                           containerID: String = "iCloud.no.akashic",
                           environment: CloudKitImportEnvironment = .development,
                           config: CloudKitImportConfig = .default,
                           sleep: @escaping (TimeInterval) async -> Void = defaultImportSleep) throws -> CloudKitImportSink {
        let bundle = try ExportBundle.load(exportRoot: exportRoot)
        return fromBundle(database: database, bundle: bundle,
                          mediaResolver: MediaResolver(root: mediaRoot),
                          containerID: containerID, environment: environment,
                          config: config, sleep: sleep)
    }

    /// Build a fully-buffered sink from an already-loaded bundle (used by tests + the UI).
    static func fromBundle(database: CKDatabaseProtocol,
                           bundle: ExportBundle,
                           mediaResolver: MediaResolver,
                           containerID: String = "iCloud.no.akashic",
                           environment: CloudKitImportEnvironment = .development,
                           config: CloudKitImportConfig = .default,
                           sleep: @escaping (TimeInterval) async -> Void = defaultImportSleep) -> CloudKitImportSink {
        let sink = CloudKitImportSink(
            database: database, mediaResolver: mediaResolver,
            commentRows: bundle.comments, profileNamesByID: bundle.profileNamesByID,
            containerID: containerID, environment: environment, config: config, sleep: sleep)
        // Reuse the exact orchestration LocalImporter uses (read → map → buffer).
        _ = LocalImporter(sink: sink).run(bundle: bundle, media: mediaResolver)
        return sink
    }

    // MARK: ImportSink (buffering only; the CloudKit work happens in execute())

    func upsert(journey: Journey) throws -> UpsertResult {
        journeys.append(journey)
        journeyIDs.insert(journey.id)
        routeByteSize[journey.id] = Int64((try? JSONCoding.encoder.encode(journey.route))?.count ?? 0)
        return .created
    }

    func upsert(photo: Photo) throws -> UpsertResult {
        guard journeyIDs.contains(photo.journeyId) else { return .skipped }  // orphan (none in real data)
        guard photo.hasLocalMedia else {
            missingMedia.append(MissingMediaPhoto(photoID: photo.id, journeyID: photo.journeyId,
                                                  expectedOriginalPath: photo.url))
            return .skipped
        }
        photosByJourney[photo.journeyId, default: []].append(photo)
        return .created
    }

    func save() throws { /* no-op: execute() performs the upload */ }

    // MARK: Plan (pure — no CKDatabase, no bytes read)

    /// Build the ordered upload items (Journey → Waypoint → Photo → DayComment per zone; MAPPING §11).
    private func orderedItems() -> [UploadItem] {
        var items: [UploadItem] = []
        for journey in journeys {
            let zoneID = RecordCoder.zoneID(forJourneyID: journey.id)

            // Journey root: assets are routeJSON (+ heroImage if it resolves locally).
            let heroBytes = Self.fileSize(resolveHero(journey))
            items.append(UploadItem(recordName: journey.id, recordType: RecordCoder.RecordType.journey,
                                    zoneID: zoneID, assetBytes: (routeByteSize[journey.id] ?? 0) + heroBytes,
                                    source: .journey(journey)))

            // Waypoints from the journey's ordered camps (RecordCoder builds the record; sortOrder
            // = position in the already-ordered camp list — preserves the export's ordering).
            for (index, camp) in journey.camps.enumerated() {
                items.append(UploadItem(recordName: camp.id, recordType: RecordCoder.RecordType.waypoint,
                                        zoneID: zoneID, assetBytes: 0,
                                        source: .waypoint(camp, journeyID: journey.id, sortOrder: index)))
            }

            // Photos (already buffered, media resolved; missing-media excluded).
            for photo in (photosByJourney[journey.id] ?? []) {
                let bytes = Self.fileSize(photo.localOriginalPath) + Self.fileSize(photo.localThumbPath)
                items.append(UploadItem(recordName: photo.id, recordType: RecordCoder.RecordType.photo,
                                        zoneID: zoneID, assetBytes: bytes, source: .photo(photo)))
            }

            // Day comments (mapped to domain, with migrated authorDisplayName).
            for comment in (commentsByJourney[journey.id] ?? []) {
                items.append(UploadItem(recordName: comment.id, recordType: RecordCoder.RecordType.dayComment,
                                        zoneID: zoneID, assetBytes: 0, source: .comment(comment)))
            }
        }
        return items
    }

    /// Resolve the local bytes for a journey's hero image.
    ///
    /// The Supabase rows carry a Next.js `public/` static path (`/hero-images/<slug>-hero.png`),
    /// NOT an R2 object key — nothing exists under `<mediaRoot>/hero-images/`. The bytes ARE in
    /// the archive, one level down under `journeys/<slug>/hero.png`. Before this fallback all
    /// three family journeys silently lost their hero image (the path is dropped by RecordCoder
    /// too, so neither bytes nor path survived). The DB path is still tried first so a future
    /// export that *does* use real object keys keeps working.
    func resolveHero(_ journey: Journey) -> String? {
        mediaResolver.resolve(journey.heroImageURL)
            ?? mediaResolver.resolve("journeys/\(journey.slug)/hero.png")
    }

    /// Chunk items into batches bounded by record count AND cumulative asset bytes, never
    /// spanning zones (so per-journey progress is clean). A single record whose assets exceed
    /// the byte cap forms a batch on its own.
    private func chunk(_ items: [UploadItem]) -> [[UploadItem]] {
        var batches: [[UploadItem]] = []
        var current: [UploadItem] = []
        var bytes: Int64 = 0
        for item in items {
            let wouldOverflowBytes = !current.isEmpty && (bytes + item.assetBytes) > config.maxBatchBytes
            let wouldOverflowCount = current.count >= config.maxRecordsPerBatch
            let zoneChanged = current.first.map { $0.zoneName != item.zoneName } ?? false
            if !current.isEmpty && (wouldOverflowBytes || wouldOverflowCount || zoneChanged) {
                batches.append(current); current = []; bytes = 0
            }
            current.append(item); bytes += item.assetBytes
        }
        if !current.isEmpty { batches.append(current) }
        return batches
    }

    /// The dry-run plan: exactly what `execute` would do, as pure data.
    func makePlan() -> CloudKitImportPlan {
        let items = orderedItems()
        let batches = chunk(items)

        var plan = CloudKitImportPlan(environment: environment, containerID: containerID)
        plan.zoneNames = journeys.map { RecordCoder.zoneID(forJourneyID: $0.id).zoneName }
        plan.missingMedia = missingMedia

        for item in items {
            switch item.source {
            case .journey(let j):
                plan.journeyCount += 1
                if (routeByteSize[j.id] ?? 0) > 0 { plan.routeAssetCount += 1 }
                if resolveHero(j) != nil { plan.heroAssetCount += 1 } else { plan.heroMissing += 1 }
            case .waypoint:
                plan.waypointCount += 1
            case .photo(let p):
                plan.photoCount += 1
                if p.localOriginalPath != nil { plan.originalAssetCount += 1 }
                if p.localThumbPath != nil { plan.thumbAssetCount += 1 } else { plan.thumbsMissing += 1 }
            case .comment:
                plan.commentCount += 1
            }
            plan.totalAssetBytes += item.assetBytes
        }
        plan.batches = batches.map {
            PlannedBatch(zoneName: $0.first?.zoneName ?? "",
                         recordCount: $0.count,
                         assetBytes: $0.reduce(0) { $0 + $1.assetBytes })
        }
        return plan
    }

    // MARK: Execute

    /// Run the import. `dryRun == true` walks the plan and returns it WITHOUT any CKDatabase
    /// call. A real run creates the zones, then uploads every batch with retry/backoff and
    /// per-record failure collection, emitting `progress` after each op. Cooperative
    /// cancellation is honored between ops (cancel the enclosing `Task`).
    @discardableResult
    func execute(dryRun: Bool,
                 progress: ((CloudKitImportProgress) -> Void)? = nil) async -> CloudKitImportReport {
        let start = Date()
        let plan = makePlan()
        var report = CloudKitImportReport(dryRun: dryRun, environment: environment,
                                          containerID: containerID, plan: plan)
        report.thumbsMissing = plan.thumbsMissing
        report.heroMissing = plan.heroMissing
        report.photosSkippedMissingMedia = plan.missingMedia.count

        let items = orderedItems()
        let batches = chunk(items)

        var prog = CloudKitImportProgress(phase: .planning,
                                          zonesTotal: plan.zoneNames.count,
                                          recordsTotal: items.count,
                                          bytesTotal: plan.totalAssetBytes,
                                          journeysTotal: journeys.count)
        progress?(prog)

        if dryRun {
            report.elapsed = Date().timeIntervalSince(start)
            prog.phase = .finished
            progress?(prog)
            return report
        }

        // 1. Create all zones up front.
        prog.phase = .creatingZones
        progress?(prog)
        let zones = plan.zoneNames.map {
            CKRecordZone(zoneID: CKRecordZone.ID(zoneName: $0, ownerName: CKCurrentUserDefaultName))
        }
        var failedZoneNames: Set<String> = []
        if !zones.isEmpty {
            do {
                let (created, zoneFailures) = try await modifyZonesWithRetry(zones)
                report.zonesCreated = created
                prog.zonesDone = created
                for (zoneID, error) in zoneFailures {
                    failedZoneNames.insert(zoneID.zoneName)
                    report.failures.append(RecordFailure(recordName: zoneID.zoneName,
                                                         recordType: "CKRecordZone",
                                                         zoneName: zoneID.zoneName,
                                                         code: Self.code(of: error),
                                                         message: "zone creation failed: \(error)"))
                }
            } catch is CancellationError {
                return finish(&report, &prog, start, cancelled: true, progress: progress)
            } catch {
                // Zone creation failing wholesale is fatal — nothing can be written without zones.
                report.failures.append(RecordFailure(recordName: "(zones)", recordType: "CKRecordZone",
                                                      zoneName: "*", code: Self.code(of: error),
                                                      message: "\(error)"))
                prog.phase = .failed
                report.elapsed = Date().timeIntervalSince(start)
                purgeRouteAssetsIfNeeded(report)
                progress?(prog)
                return report
            }
        }

        // 2. Upload batches.
        prog.phase = .uploading
        progress?(prog)
        var journeysStarted: Set<String> = []
        for batch in batches {
            if Task.isCancelled { return finish(&report, &prog, start, cancelled: true, progress: progress) }

            // Zone never got created ⇒ every record in it would fail with a misleading
            // `.zoneNotFound`. Report the real cause per record and skip the round-trip.
            if let zoneName = batch.first?.zoneName, failedZoneNames.contains(zoneName) {
                for item in batch {
                    report.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                         zoneName: item.zoneName, code: CKError.zoneNotFound.rawValue,
                                                         message: "skipped — zone \(zoneName) could not be created"))
                }
                continue
            }

            // Per-journey progress: the first batch of a zone marks that journey started.
            if let zone = batch.first?.zoneID,
               let jid = RecordCoder.journeyID(fromZoneID: zone),
               journeysStarted.insert(jid).inserted {
                prog.journeysDone = journeysStarted.count
                prog.currentZoneName = zone.zoneName
            }

            do {
                let outcome = try await uploadBatchWithRetry(batch)
                for saved in outcome.saved {
                    report.recordsSaved += 1
                    report.bytesUploaded += saved.assetBytes
                    report.assetsUploaded += Self.assetCount(of: saved)
                    prog.recordsDone += 1
                    prog.bytesDone += saved.assetBytes
                }
                report.failures.append(contentsOf: outcome.failures)
            } catch is CancellationError {
                return finish(&report, &prog, start, cancelled: true, progress: progress)
            } catch {
                // Whole-batch non-retryable failure: record each item and keep going.
                for item in batch {
                    report.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                         zoneName: item.zoneName, code: Self.code(of: error),
                                                         message: "\(error)"))
                }
            }
            progress?(prog)
        }

        return finish(&report, &prog, start, cancelled: false, progress: progress)
    }

    /// Delete the temp route-asset files `RecordCoder` wrote for this run.
    ///
    /// Only ever called after every modify operation has completed (never with one in flight —
    /// the bytes would be pulled out from under the upload) and only for a REAL run: the temp
    /// directory is shared with the sync engine, and the run's sync interlock
    /// (`CloudKitImportViewModel.syncEngineIsLive`) is what guarantees no engine-owned asset is
    /// waiting in there. A dry-run never builds records, so it has nothing to clean up.
    private func purgeRouteAssetsIfNeeded(_ report: CloudKitImportReport) {
        guard !report.dryRun else { return }
        RecordCoder.purgeRouteAssetDirectory()
    }

    private func finish(_ report: inout CloudKitImportReport, _ prog: inout CloudKitImportProgress,
                        _ start: Date, cancelled: Bool,
                        progress: ((CloudKitImportProgress) -> Void)?) -> CloudKitImportReport {
        purgeRouteAssetsIfNeeded(report)
        report.wasCancelled = cancelled
        report.elapsed = Date().timeIntervalSince(start)
        prog.phase = cancelled ? .cancelled : .finished
        progress?(prog)
        return report
    }

    // MARK: Retry engines

    /// Create zones, backing off on transient errors (zoneBusy / serviceUnavailable / rateLimited /
    /// network blips). `modifyRecordZones` reports per-zone problems in `saveResults` rather than
    /// throwing, so the failures are returned alongside the success count — they must reach the
    /// report, otherwise a zone that never got created only shows up later as misleading
    /// `.zoneNotFound` errors on each of its records.
    private func modifyZonesWithRetry(_ zones: [CKRecordZone]) async throws -> (created: Int, failures: [(CKRecordZone.ID, Error)]) {
        var attempt = 0
        while true {
            if Task.isCancelled { throw CancellationError() }
            do {
                let (saveResults, _) = try await database.ckModifyRecordZones(saving: zones, deleting: [])
                var created = 0
                var failed: [(CKRecordZone.ID, Error)] = []
                for (zoneID, result) in saveResults {
                    switch result {
                    case .success: created += 1
                    case .failure(let error): failed.append((zoneID, error))
                    }
                }
                return (created, failed)
            } catch {
                guard attempt < config.maxRetries,
                      let delay = Self.transientRetryDelay(error, attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff) else {
                    throw error
                }
                attempt += 1
                await sleep(delay)
            }
        }
    }

    private struct BatchOutcome { var saved: [UploadItem] = []; var failures: [RecordFailure] = [] }

    /// Upload one batch. Handles:
    ///  * `.limitExceeded` (thrown, whole-op) → split the batch in half and recurse.
    ///  * `.zoneBusy` / `.serviceUnavailable` / `.requestRateLimited` (thrown) → backoff + retry.
    ///  * per-record `.failure` results and thrown `CKError.partialFailure` → collect; retry the
    ///    transient ones (bounded), record the permanent ones.
    private func uploadBatchWithRetry(_ batch: [UploadItem], attempt: Int = 0) async throws -> BatchOutcome {
        if Task.isCancelled { throw CancellationError() }

        let records = batch.map { buildRecord(for: $0) }
        let byName = Dictionary(uniqueKeysWithValues: batch.map { ($0.recordName, $0) })

        let saveResults: [CKRecord.ID: Result<CKRecord, Error>]
        do {
            (saveResults, _) = try await database.ckModifyRecords(saving: records, deleting: [], savePolicy: .allKeys)
        } catch let error where Self.isLimitExceeded(error) {
            // Halve and recurse. A single record that still trips the limit is recorded as a failure.
            guard batch.count > 1 else {
                var outcome = BatchOutcome()
                let item = batch[0]
                outcome.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                      zoneName: item.zoneName, code: Self.code(of: error),
                                                      message: "limitExceeded on a single record"))
                return outcome
            }
            let mid = batch.count / 2
            var merged = BatchOutcome()
            let a = try await uploadBatchWithRetry(Array(batch[..<mid]), attempt: attempt)
            let b = try await uploadBatchWithRetry(Array(batch[mid...]), attempt: attempt)
            merged.saved = a.saved + b.saved
            merged.failures = a.failures + b.failures
            return merged
        } catch let error where attempt < config.maxRetries &&
                    Self.transientRetryDelay(error, attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff) != nil {
            let delay = Self.transientRetryDelay(error, attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff)!
            await sleep(delay)
            return try await uploadBatchWithRetry(batch, attempt: attempt + 1)
        } catch let error as CKError where error.code == .partialFailure {
            // Old-style partial failure: reconstruct per-record results from partialErrorsByItemID.
            let partial = error.partialErrorsByItemID as? [CKRecord.ID: Error] ?? [:]
            return try await collect(fromPartial: partial, batch: batch, attempt: attempt)
        }

        // New-style: per-record results dictionary.
        var outcome = BatchOutcome()
        var transientRetries: [UploadItem] = []
        for record in records {
            guard let item = byName[record.recordID.recordName] else { continue }
            switch saveResults[record.recordID] {
            case .success:
                outcome.saved.append(item)
            case .failure(let err):
                if attempt < config.maxRetries,
                   Self.transientRetryDelay(err, attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff) != nil {
                    transientRetries.append(item)
                } else {
                    outcome.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                          zoneName: item.zoneName, code: Self.code(of: err), message: "\(err)"))
                }
            case .none:
                outcome.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                      zoneName: item.zoneName, code: -1, message: "no result returned"))
            }
        }
        if !transientRetries.isEmpty {
            await sleep(Self.backoff(attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff))
            let retried = try await uploadBatchWithRetry(transientRetries, attempt: attempt + 1)
            outcome.saved += retried.saved
            outcome.failures += retried.failures
        }
        return outcome
    }

    private func collect(fromPartial partial: [CKRecord.ID: Error], batch: [UploadItem], attempt: Int) async throws -> BatchOutcome {
        var outcome = BatchOutcome()
        var transientRetries: [UploadItem] = []
        for item in batch {
            let id = CKRecord.ID(recordName: item.recordName, zoneID: item.zoneID)
            if let err = partial[id] {
                if attempt < config.maxRetries,
                   Self.transientRetryDelay(err, attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff) != nil {
                    transientRetries.append(item)
                } else {
                    outcome.failures.append(RecordFailure(recordName: item.recordName, recordType: item.recordType,
                                                          zoneName: item.zoneName, code: Self.code(of: err), message: "\(err)"))
                }
            } else {
                outcome.saved.append(item)  // not in the error map ⇒ saved
            }
        }
        if !transientRetries.isEmpty {
            await sleep(Self.backoff(attempt: attempt, base: config.baseBackoff, cap: config.maxBackoff))
            let retried = try await uploadBatchWithRetry(transientRetries, attempt: attempt + 1)
            outcome.saved += retried.saved
            outcome.failures += retried.failures
        }
        return outcome
    }

    // MARK: Record building (delegates to the shared RecordCoder)

    /// Build a fresh `CKRecord` via the shared `RecordCoder` contract. For the initial migration
    /// `existing` is always nil and the save policy is `.allKeys` (imported-data-wins). The only
    /// asset attached here is `heroImage` (R2 bytes) — `RecordCoder` deliberately leaves it to the
    /// importer. The path comes from `resolveHero` (the DB path is a Next.js `public/` path; the
    /// bytes live at `journeys/<slug>/hero.png`), and any journey where it still does not resolve
    /// is counted in `plan.heroMissing` rather than dropped silently.
    private func buildRecord(for item: UploadItem) -> CKRecord {
        switch item.source {
        case .journey(let j):
            let zoneID = RecordCoder.zoneID(forJourneyID: j.id)
            let record = RecordCoder.record(for: j, in: zoneID)
            if let path = resolveHero(j) {
                record["heroImage"] = CKAsset(fileURL: URL(fileURLWithPath: path))
            }
            return record
        case .waypoint(let camp, let journeyID, let sortOrder):
            return RecordCoder.record(forWaypoint: camp, journeyID: journeyID, sortOrder: sortOrder,
                                      in: item.zoneID)
        case .photo(let p):
            return RecordCoder.record(for: p, in: item.zoneID)
        case .comment(let c):
            return RecordCoder.record(for: c, in: item.zoneID)
        }
    }

    // MARK: Helpers

    /// `stat` file size (no bytes read); 0 for nil / missing.
    static func fileSize(_ path: String?) -> Int64 {
        guard let path else { return 0 }
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        return (attrs?[.size] as? NSNumber)?.int64Value ?? 0
    }

    fileprivate static func assetCount(of item: UploadItem) -> Int {
        switch item.source {
        case .photo(let p): return (p.localOriginalPath != nil ? 1 : 0) + (p.localThumbPath != nil ? 1 : 0)
        case .journey: return item.assetBytes > 0 ? 1 : 0   // routeJSON (+ hero) collapsed for the counter
        default: return 0
        }
    }

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()
    static func parseISO(_ string: String?) -> Date? {
        guard let s = string, !s.isEmpty else { return nil }
        return isoWithFraction.date(from: s) ?? isoPlain.date(from: s) ?? DateOnly.date(from: s)
    }

    // MARK: Error classification

    static func code(of error: Error) -> Int { (error as? CKError)?.errorCode ?? (error as NSError).code }

    static func isLimitExceeded(_ error: Error) -> Bool { (error as? CKError)?.code == .limitExceeded }

    /// Transient (retryable) whole-op / per-record errors. Returns the delay to wait (honoring
    /// `CKErrorRetryAfterKey`), or nil if the error is permanent.
    ///
    /// Includes the **network** cases (`.networkUnavailable`, `.networkFailure`,
    /// `.serverResponseLost`, and bare/underlying `URLError`s): the real run is a multi-hour,
    /// >5 GB upload where a connectivity blip is near-certain, and treating one as permanent
    /// writes off a whole 200-record batch — and every batch after it, while the blip lasts.
    /// Retries stay bounded by `config.maxRetries` with the exponential `backoff` below.
    static func transientRetryDelay(_ error: Error, attempt: Int, base: TimeInterval, cap: TimeInterval) -> TimeInterval? {
        if let ck = error as? CKError {
            switch ck.code {
            case .zoneBusy, .serviceUnavailable, .requestRateLimited,
                 .networkUnavailable, .networkFailure, .serverResponseLost:
                if let retryAfter = ck.retryAfterSeconds, retryAfter > 0 { return min(retryAfter, cap) }
                return backoff(attempt: attempt, base: base, cap: cap)
            default:
                // CloudKit often wraps the real connectivity error rather than mapping it.
                if let underlying = ck.userInfo[NSUnderlyingErrorKey] as? Error, isTransientNetwork(underlying) {
                    return backoff(attempt: attempt, base: base, cap: cap)
                }
                return nil
            }
        }
        return isTransientNetwork(error) ? backoff(attempt: attempt, base: base, cap: cap) : nil
    }

    /// URLSession-level connectivity failures worth retrying (everything else — bad request,
    /// cancelled, unsupported URL — stays permanent).
    static func isTransientNetwork(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        switch urlError.code {
        case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed,
             .callIsActive, .secureConnectionFailed, .resourceUnavailable:
            return true
        default:
            return false
        }
    }

    static func backoff(attempt: Int, base: TimeInterval, cap: TimeInterval) -> TimeInterval {
        min(cap, base * pow(2.0, Double(attempt)))
    }
}
