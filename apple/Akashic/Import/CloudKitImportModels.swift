import CloudKit
import Foundation
import Combine

// MARK: - CloudKit import: plan / progress / report value types
//
// These are the sink-agnostic value types the CloudKit importer (`CloudKitImportSink`) and
// the Settings UI assert on. They carry NO CloudKit types so they can be built and asserted
// from unit tests without a container/account, and so the dry-run plan is a pure computation.
//
// See CloudKit/MAPPING.md for the field mapping and §11 import order these describe, and
// `CloudKitImportSink.swift` for the sink that produces them.

/// Which CloudKit environment the run targets. **Development is implied by the build**
/// (the `Release-CloudKit` config + Development container); Production is never written by
/// this importer. Surfaced purely as a label so the confirmation dialog can state the target.
enum CloudKitImportEnvironment: String, Equatable {
    case development = "Development"
    case production = "Production"
}

/// A photo that cannot be uploaded because it has NO local bytes on disk (neither the
/// original nor the thumbnail resolved under the media root). These are **skipped** — never
/// a hard failure (MAPPING §4; import requirement "SKIP missing-media photos with a report
/// entry, never fail the run").
struct MissingMediaPhoto: Equatable, Identifiable {
    var photoID: String
    var journeyID: String
    /// The R2 object path the original *should* have been at (for the report line).
    var expectedOriginalPath: String
    var id: String { photoID }
}

/// One planned `CKModifyRecordsOperation` (a single `ckModifyRecords` call). The chunker
/// bounds each batch by record count AND cumulative CKAsset bytes (a single record whose
/// assets exceed the byte cap forms a batch on its own — a record can't be split).
struct PlannedBatch: Equatable {
    var zoneName: String
    var recordCount: Int
    var assetBytes: Int64
}

/// The full dry-run plan: everything the importer *would* do, computed WITHOUT any CKDatabase
/// call. `CloudKitImportSink.makePlan()` returns this; the Settings screen renders it; the real
/// run executes it.
struct CloudKitImportPlan: Equatable {
    var environment: CloudKitImportEnvironment = .development
    var containerID: String = "iCloud.no.akashic"

    /// `journey-<uuid>` zone names, one per journey, in import order.
    var zoneNames: [String] = []

    // Record counts (records that WILL be written — missing-media photos already excluded).
    var journeyCount = 0
    var waypointCount = 0
    var photoCount = 0
    var commentCount = 0
    var recordCount: Int { journeyCount + waypointCount + photoCount + commentCount }

    // Asset counts.
    var originalAssetCount = 0
    var thumbAssetCount = 0
    var routeAssetCount = 0
    var heroAssetCount = 0
    var assetCount: Int { originalAssetCount + thumbAssetCount + routeAssetCount + heroAssetCount }

    /// Photos that upload with an original but whose thumbnail bytes were absent (original-only).
    var thumbsMissing = 0
    /// Journeys whose hero-image bytes could not be resolved anywhere under the media root
    /// (neither the DB path nor `journeys/<slug>/hero.png`). Surfaced so an unresolved hero can
    /// never again pass silently — see `CloudKitImportSink.resolveHero`.
    var heroMissing = 0
    /// Photos skipped entirely (no bytes at all).
    var missingMedia: [MissingMediaPhoto] = []

    /// Sum of all CKAsset file sizes across every record.
    var totalAssetBytes: Int64 = 0

    /// The batch breakdown the executor will run (after the initial zone-creation op).
    var batches: [PlannedBatch] = []
    var batchCount: Int { batches.count }
    var zoneCount: Int { zoneNames.count }

    /// Human-readable multi-line summary for the Settings screen / logs.
    var summary: String {
        """
        Target: \(containerID) · \(environment.rawValue)
        Zones: \(zoneCount)  Records: \(recordCount) (\(journeyCount)J / \(waypointCount)W / \(photoCount)P / \(commentCount)C)
        Assets: \(assetCount) (\(originalAssetCount) orig, \(thumbAssetCount) thumb, \(routeAssetCount) route, \(heroAssetCount) hero) = \(ByteCount.string(totalAssetBytes))
        Upload ops: \(batchCount) batches (after 1 zone-create op)
        Thumbs missing: \(thumbsMissing) · Heroes missing: \(heroMissing) · Photos skipped (no media): \(missingMedia.count)
        """
    }
}

/// A single record that failed to save (collected from per-record results and unpacked
/// `CKError.partialFailure`). The run continues; failures are surfaced, not thrown.
struct RecordFailure: Equatable, Identifiable {
    var recordName: String
    var recordType: String
    var zoneName: String
    var code: Int
    var message: String
    var id: String { recordName }
}

/// Outcome of a run (dry-run or real). Idempotent re-runs produce the same numbers.
struct CloudKitImportReport: Equatable {
    var dryRun: Bool = false
    var environment: CloudKitImportEnvironment = .development
    var containerID: String = "iCloud.no.akashic"

    var zonesCreated = 0
    var recordsSaved = 0
    var assetsUploaded = 0
    var bytesUploaded: Int64 = 0
    var photosSkippedMissingMedia = 0
    var thumbsMissing = 0
    /// Journeys uploaded without hero-image bytes (see `CloudKitImportPlan.heroMissing`).
    var heroMissing = 0

    var failures: [RecordFailure] = []
    var wasCancelled = false
    var elapsed: TimeInterval = 0

    /// The plan this run executed (or, for a dry-run, *is*).
    var plan = CloudKitImportPlan()

    /// True when every planned record saved and the run wasn't cancelled.
    var succeeded: Bool { failures.isEmpty && !wasCancelled }

    var summary: String {
        let head = dryRun ? "DRY-RUN plan" : (wasCancelled ? "CANCELLED" : (succeeded ? "OK" : "COMPLETED WITH FAILURES"))
        return """
        \(head) — \(containerID) · \(environment.rawValue)
        Zones: \(zonesCreated)  Records saved: \(recordsSaved)/\(plan.recordCount)  \
        Assets: \(assetsUploaded) = \(ByteCount.string(bytesUploaded))
        Skipped (no media): \(photosSkippedMissingMedia)  Thumbs missing: \(thumbsMissing)  Heroes missing: \(heroMissing)  Failures: \(failures.count)
        Elapsed: \(String(format: "%.1fs", elapsed))
        """
    }
}

/// Coarse phase of a run, for the progress UI.
enum CloudKitImportPhase: Equatable {
    case idle
    case planning
    case creatingZones
    case uploading
    case finished
    case cancelled
    case failed
}

/// Live progress, emitted after every operation. Bytes/records are cumulative; the UI drives
/// three progress bars (records, assets-bytes) plus a per-journey line.
struct CloudKitImportProgress: Equatable {
    var phase: CloudKitImportPhase = .idle

    var zonesDone = 0
    var zonesTotal = 0

    var recordsDone = 0
    var recordsTotal = 0

    var bytesDone: Int64 = 0
    var bytesTotal: Int64 = 0

    var journeysDone = 0
    var journeysTotal = 0

    var currentZoneName: String?
    var message: String?

    var recordFraction: Double { recordsTotal == 0 ? 0 : Double(recordsDone) / Double(recordsTotal) }
    var byteFraction: Double { bytesTotal == 0 ? 0 : Double(bytesDone) / Double(bytesTotal) }
}

// MARK: - Settings view model

/// Drives the "Import to CloudKit" Settings section. The **dry-run** path (compute + show the
/// plan) is runnable tonight against the real export with no account. The **real** run is
/// hard-gated behind the `Release-CloudKit` build (entitlements) AND an available iCloud account
/// AND an explicit confirmation dialog — and only ever targets Development (implied by the build).
/// Production is never written.
@MainActor
final class CloudKitImportViewModel: ObservableObject {
    @Published var plan: CloudKitImportPlan?
    @Published var report: CloudKitImportReport?
    @Published var progress: CloudKitImportProgress?
    @Published var isRunning = false
    @Published var statusMessage: String?

    let containerID = Config.cloudKitContainerIdentifier
    /// Development is implied by the build config (the `Release-CloudKit` target uses the
    /// Development container + `aps-environment: development`). Surfaced as a label only.
    let environment: CloudKitImportEnvironment = .development

    private var task: Task<Void, Never>?

    /// UserDefaults key owned by `AkashicSyncEngine` (`akashic.sync.didInitialUpload`). The
    /// importer sets it after a successful run so a later engine activation does not enqueue a
    /// second full upload of the archive the importer just wrote. Mirrored (not imported) to keep
    /// the dependency one-way: the importer never mutates the sync engine.
    static let didInitialUploadDefaultsKey = "akashic.sync.didInitialUpload"

    /// Read-only probe of the live sync engine. **The importer and `CKSyncEngine` must never
    /// write the same private database concurrently** — the importer saves with `.allKeys` and
    /// ignores change tags, while the engine rebases `serverRecordChanged` conflicts by copying
    /// every client key onto the server record, so neither side wins deterministically and asset
    /// fields can be clobbered in both directions. Injected so tests can drive both states.
    var syncEngineIsLive: @MainActor () -> Bool = { CloudKitImportViewModel.liveSyncEngineDetected() }

    /// Default probe: true only when an entitled build has an activated, running engine.
    static func liveSyncEngineDetected() -> Bool {
        #if AKASHIC_CLOUDKIT_BUILD
        return PersistenceController.shared.syncCoordinator?.isRunning == true
        #else
        // No entitlement in this build ⇒ `startSync()` never built a coordinator.
        return false
        #endif
    }

    /// The real run is only available in a CloudKit-entitled build.
    ///
    /// CRITICAL: this is a **compile-time** gate, not a runtime flag. `CKContainer(identifier:)`
    /// TRAPS (SIGTRAP) in a binary without the `com.apple.developer.icloud-services` entitlement,
    /// so — exactly like `PersistenceController.startSync()`, `CloudKitAccountStatusProvider` and
    /// `AkashicSyncEngine.buildRealEngine()` — the entitlement is the first line of defense and
    /// the runtime `accountStatus()` check can only ever be the second. Gating on
    /// `FeatureFlags.cloudKitEnabled` (a plain constant, identical in every configuration) was
    /// the defect: flipping it armed the real-import button in the unentitled Debug/Release
    /// builds too, where tapping it crashed the app.
    var realRunAvailable: Bool {
        #if AKASHIC_CLOUDKIT_BUILD
        return true
        #else
        return false
        #endif
    }

    /// True when a live sync engine currently blocks the import (see `syncEngineIsLive`).
    var blockedByLiveSync: Bool { syncEngineIsLive() }

    /// The real-import button's enablement: entitled build, nothing running, sync quiesced.
    var canStartRealImport: Bool { realRunAvailable && !isRunning && !blockedByLiveSync }

    /// Why the real run is unavailable, or nil when it can start.
    var realRunBlockedReason: String? {
        if !realRunAvailable { return "Requires the Debug-CloudKit / Release-CloudKit build (entitlements + signing)." }
        if blockedByLiveSync { return "CloudKit sync is running — quiesce it before importing (see below)." }
        return nil
    }

    /// Dry-run: load the export, compute the plan, show it. Zero network. Cancellable.
    func computePlan(bundlePath: String, mediaRoot: String) {
        guard !isRunning else { return }
        isRunning = true
        statusMessage = "Computing plan…"
        report = nil
        task = Task { [containerID, environment] in
            do {
                let sink = try CloudKitImportSink.fromExport(
                    database: NullDatabase(),
                    exportRoot: URL(fileURLWithPath: bundlePath),
                    mediaRoot: URL(fileURLWithPath: mediaRoot),
                    containerID: containerID, environment: environment)
                let result = await sink.execute(dryRun: true) { [weak self] prog in
                    Task { @MainActor in self?.progress = prog }
                }
                self.plan = result.plan
                self.report = result
                self.statusMessage = "Dry-run plan ready"
            } catch {
                self.statusMessage = "Plan failed: \(error)"
            }
            self.isRunning = false
        }
    }

    /// Real run — GATED. Precondition-checks the build (compile-time entitlement gate), the sync
    /// interlock, and the account, then uploads to the owner's private DB. The caller is
    /// responsible for the confirmation dialog before invoking this.
    func runRealImport(bundlePath: String, mediaRoot: String) {
        guard !isRunning else { return }
        guard realRunAvailable else {
            statusMessage = "Real import requires the Debug-CloudKit / Release-CloudKit build (entitlements + signing)."
            return
        }
        // Sync interlock (never start a second writer on the same private DB).
        guard !syncEngineIsLive() else {
            statusMessage = """
            Refused: CloudKit sync is running. The importer writes the private database directly \
            (savePolicy .allKeys, bypassing CKSyncEngine) — running both would double-write the \
            archive and clobber records non-deterministically. Switch the store to Local in \
            Settings → Override, relaunch, then run the import.
            """
            return
        }
        isRunning = true
        statusMessage = "Checking iCloud account…"
        report = nil
        task = Task { [containerID, environment] in
            // Second entitlement gate, structural: no CKContainer may be *constructed* in a
            // binary without the icloud-services entitlement — it traps (SIGTRAP), so the
            // accountStatus() check below can never be the first line of defense.
            #if AKASHIC_CLOUDKIT_BUILD
            let container = CKContainer(identifier: containerID)
            let status = (try? await container.accountStatus()) ?? .couldNotDetermine
            guard status == .available else {
                self.statusMessage = "No iCloud account available. Sign in (Settings → iCloud) and retry."
                self.isRunning = false
                return
            }
            self.statusMessage = "Uploading to \(containerID) · \(environment.rawValue)…"
            do {
                let sink = try CloudKitImportSink.fromExport(
                    database: container.privateCloudDatabase,
                    exportRoot: URL(fileURLWithPath: bundlePath),
                    mediaRoot: URL(fileURLWithPath: mediaRoot),
                    containerID: containerID, environment: environment)
                let result = await sink.execute(dryRun: false) { [weak self] prog in
                    Task { @MainActor in self?.progress = prog }
                }
                self.plan = result.plan
                self.report = result
                self.statusMessage = result.wasCancelled ? "Cancelled" : result.summary
                // The archive is now in CloudKit: stop a later engine activation from enqueueing
                // the very same 1559 records / >5 GB as an "initial upload".
                if result.succeeded {
                    UserDefaults.standard.set(true, forKey: Self.didInitialUploadDefaultsKey)
                }
            } catch {
                self.statusMessage = "Import failed: \(error)"
            }
            self.isRunning = false
            #else
            self.statusMessage = "Real import requires the Debug-CloudKit / Release-CloudKit build (entitlements + signing)."
            self.isRunning = false
            #endif
        }
    }

    func cancel() {
        task?.cancel()
        statusMessage = "Cancelling…"
    }
}

// MARK: - Byte formatting

/// Small, dependency-free byte formatter (avoids `ByteCountFormatter`'s main-actor quirks in
/// tests and gives stable GB/MB strings for the plan summary).
enum ByteCount {
    static func string(_ bytes: Int64) -> String {
        let b = Double(bytes)
        let gb = 1_000_000_000.0, mb = 1_000_000.0, kb = 1_000.0
        if b >= gb { return String(format: "%.2f GB", b / gb) }
        if b >= mb { return String(format: "%.1f MB", b / mb) }
        if b >= kb { return String(format: "%.0f KB", b / kb) }
        return "\(bytes) B"
    }
}
