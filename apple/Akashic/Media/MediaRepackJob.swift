import Foundation
import CloudKit

/// Progress of the one-time photo-storage repack.
struct MediaRepackProgress: Equatable {
    var done: Int
    var total: Int
    var isPaused: Bool
    var isFinished: Bool { total == 0 || done >= total }
}

/// The local-store seam the repack drives. Kept tiny so the whole job is unit tested against a
/// fake (no container, no iCloud account). `@MainActor` because the clear step reaches the
/// (main-actor) sync engine, and the store reads the main-queue Core Data context.
@MainActor
protocol MediaRepackStore: AnyObject {
    /// Photos still needing repack: an OWNER journey's photo whose original bytes are on disk AND
    /// whose PhotoMedia is not yet confirmed (`media-<id>` meta absent). A photo with no local
    /// bytes is intentionally NOT returned — the owner's complete device repacks; other devices
    /// just let Photo.original go nil and fetch on demand.
    func mediaRepackPending() -> [MediaUploadItem]

    /// Count of photos whose PhotoMedia is already confirmed (the repack's "done" tally, so a
    /// resumed run reports the true total rather than only what is left).
    func mediaRepackConfirmedCount() -> Int

    /// Persist `media-<id>` completion for the records the server accepted (this is the resumable
    /// checkpoint: a re-run skips these).
    func markMediaUploaded(_ records: [CKRecord])

    /// Clear each photo's server-side `Photo.original` via the engine (a normal local edit → sync),
    /// now that the bytes are safe on a PhotoMedia record.
    func enqueuePhotoOriginalClear(photoIDs: [String])
}

/// THE AUTOMATIC ONE-TIME REPACK (MAPPING §13, Christopher's condition).
///
/// On launch in `.cloudKit` mode, on the owner's device, migrated photos still carry their original
/// asset on the Photo record (the journey zone the sync engine fetches → the ~5.4 GB first sync).
/// This job moves each such original onto its own `PhotoMedia` record in the media zone (uploaded
/// from LOCAL bytes — never downloaded), then clears `Photo.original` so the journey zone shrinks
/// to metadata + thumbnails.
///
/// Properties:
///   * **Resumable** — progress is the `media-<id>` completion meta, persisted per record; a kill
///     mid-run resumes exactly where it left off (`mediaRepackPending` re-derives the remainder).
///   * **Idempotent** — a second run finds nothing pending and does no work.
///   * **Skip-when-bytes-missing** — a photo with no local original is never pending, so a partial
///     store (participant device) neither loops nor errors.
///   * **Wi-Fi-gated** — pauses on cellular (`.waitingForWiFi`-style status) and resumes when the
///     path becomes cheap; a re-invocation picks up the remainder.
///   * **Throttled** — a small yield between batches so it never starves interactive use.
@MainActor
final class MediaRepackJob {

    private let store: MediaRepackStore
    private let service: PhotoMediaService
    private let networkPolicy: NetworkPolicyGate
    private let batchSize: Int
    private let sleep: (Duration) async -> Void

    /// Fired after every batch (and on pause/finish) with the current tally. Wired to `SyncStatus`
    /// in production; tests read it directly.
    var onProgress: ((MediaRepackProgress) -> Void)?

    /// Guards against two overlapping runs (launch + a path-change resume racing).
    private var isRunning = false

    init(store: MediaRepackStore,
         service: PhotoMediaService,
         networkPolicy: NetworkPolicyGate = AlwaysAllowHeavyTransfer(),
         batchSize: Int = 50,
         sleep: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }) {
        self.store = store
        self.service = service
        self.networkPolicy = networkPolicy
        self.batchSize = max(1, batchSize)
        self.sleep = sleep
    }

    /// Run (or resume) the repack. Returns the final progress. Safe to call repeatedly: idempotent
    /// once everything is confirmed, and re-entrancy-guarded so a launch call and a path-change
    /// resume never double-process.
    @discardableResult
    func run() async -> MediaRepackProgress {
        guard !isRunning else {
            return MediaRepackProgress(done: store.mediaRepackConfirmedCount(),
                                       total: store.mediaRepackConfirmedCount(), isPaused: false)
        }
        isRunning = true
        defer { isRunning = false }

        let confirmedAtStart = store.mediaRepackConfirmedCount()
        var pending = store.mediaRepackPending()
        let total = confirmedAtStart + pending.count
        var done = confirmedAtStart

        // Nothing to do — idempotent no-op.
        guard !pending.isEmpty else {
            let progress = MediaRepackProgress(done: done, total: total, isPaused: false)
            onProgress?(progress)
            return progress
        }

        while !pending.isEmpty {
            // Wi-Fi gate: a metered path pauses the batch upload (the bulk transfer). It resumes
            // when the path becomes cheap and this run is invoked again (see the wiring in
            // PersistenceController). Interactive ingest is unaffected — it never comes through here.
            guard networkPolicy.allowsHeavyTransfer else {
                let progress = MediaRepackProgress(done: done, total: total, isPaused: true)
                onProgress?(progress)
                return progress
            }

            let batch = Array(pending.prefix(batchSize))
            pending.removeFirst(batch.count)

            let result = await service.upload(batch)
            if !result.savedRecords.isEmpty {
                store.markMediaUploaded(result.savedRecords)
                // Only clear Photo.original for photos whose bytes are now confirmed on PhotoMedia.
                store.enqueuePhotoOriginalClear(photoIDs: result.savedPhotoIDs)
                done += result.savedRecords.count
            }
            onProgress?(MediaRepackProgress(done: done, total: total, isPaused: false))

            // Throttle: yield between batches so the repack never starves interactive use.
            if !pending.isEmpty { await sleep(.milliseconds(50)) }
        }

        let progress = MediaRepackProgress(done: done, total: total, isPaused: false)
        onProgress?(progress)
        return progress
    }
}
