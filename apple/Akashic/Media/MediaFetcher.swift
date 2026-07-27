import Foundation
import CloudKit

enum MediaFetchError: LocalizedError, Equatable {
    case databaseUnavailable
    case notFound
    case noBytes

    /// Localised (QUA-26). Surfaced in the full-screen lightbox and during export, whenever an
    /// original cannot be resolved.
    var errorDescription: String? {
        switch self {
        case .databaseUnavailable:
            return String(localized: "Photo sync is not available in this build.",
                          comment: "Full-resolution photo failure: the running build has no iCloud entitlement. Only reachable in a misconfigured build.")
        case .notFound:
            return String(localized: "The full-resolution photo is not in iCloud yet.",
                          comment: "Full-resolution photo failure: the original has not finished uploading from the device that took it.")
        case .noBytes:
            return String(localized: "The full-resolution photo could not be downloaded.",
                          comment: "Full-resolution photo failure: the record was found but carried no usable bytes.")
        }
    }
}

/// On-demand originals for the v2 media split (MAPPING §13).
///
/// The journey zones the sync engine fetches carry only metadata + thumbnails; the full-resolution
/// original lives on a `PhotoMedia` record in the excluded media zone. `MediaFetcher` resolves an
/// original the moment the UI needs one (full-screen lightbox, export):
///
///   1. **local hit first** — if the bytes are already on disk (`Photo.originalFileURL`, the same
///      stale-path-tolerant resolution the rest of the app uses), return immediately;
///   2. otherwise **fetch** `media-<id>` from the correct database (owner → private, a journey
///      shared with us → shared, routed via the stored zone owner), copy the bytes into the media
///      root under the photo's canonical key (so `resolveMedia` finds them forever after), and
///      return the stable file URL.
///
/// Concurrency-safe: a single in-flight fetch per photo id (a second request for the same photo
/// awaits the first instead of starting a duplicate download). On-demand single originals (~4 MB,
/// the user just tapped a photo) are allowed on cellular by design — the Wi-Fi policy gates only
/// the multi-GB first sync and batch prefetch/export, not one deliberate tap.
@MainActor
final class MediaFetcher {

    /// Injected seams so the fetcher is unit-tested with no container: pick the media database for
    /// an owner (nil = we own it → private DB), resolve a journey's zone owner, and persist fetched
    /// bytes into the media store (returning the stable local URL).
    struct Dependencies {
        var database: (_ ownerName: String?) -> MediaDatabase?
        var zoneOwner: (_ journeyID: String) -> String?
        /// Copy the CloudKit staging bytes into the media root under the photo's canonical key and
        /// return the stable URL (nil on failure → the staging URL is used for this session only).
        var persist: (_ photo: Photo, _ stagingURL: URL) -> URL?
    }

    private let deps: Dependencies
    private var inFlight: [String: Task<URL, Error>] = [:]

    init(dependencies: Dependencies) {
        self.deps = dependencies
    }

    /// The file URL of a photo's full-resolution original, downloading it on demand if needed.
    func originalURL(for photo: Photo) async throws -> URL {
        // Local hit: already on disk (ingested here, already fetched, or restored). No network.
        if let local = photo.originalFileURL { return local }

        // Coalesce concurrent requests for the same photo onto one download.
        if let existing = inFlight[photo.id] {
            return try await existing.value
        }
        let task = Task<URL, Error> { [deps] in
            try await Self.fetch(photo: photo, deps: deps)
        }
        inFlight[photo.id] = task
        defer { inFlight[photo.id] = nil }
        return try await task.value
    }

    /// Whether a photo's original is already available locally (no download needed). Lets the UI
    /// show an instant image vs. a spinner without kicking off a fetch.
    func hasLocalOriginal(_ photo: Photo) -> Bool { photo.originalFileURL != nil }

    /// Best-effort batch prefetch of originals that are not yet local — used before packaging an
    /// export so the archive is as complete as possible. Sequential (gentle on the network), and
    /// failure-tolerant: a photo that cannot be fetched is simply left out and surfaces in the
    /// export's honest `missingPhotos` list. Returns the photo ids that are now available locally.
    @discardableResult
    func prefetchOriginals(for photos: [Photo]) async -> [String] {
        var available: [String] = []
        for photo in photos {
            if hasLocalOriginal(photo) { available.append(photo.id); continue }
            if (try? await originalURL(for: photo)) != nil { available.append(photo.id) }
        }
        return available
    }

    private static func fetch(photo: Photo, deps: Dependencies) async throws -> URL {
        let ownerName = deps.zoneOwner(photo.journeyId)
        guard let database = deps.database(ownerName) else { throw MediaFetchError.databaseUnavailable }

        let zoneID = RecordCoder.mediaZoneID(forJourneyID: photo.journeyId,
                                             ownerName: ownerName ?? CKCurrentUserDefaultName)
        let recordID = CKRecord.ID(recordName: RecordCoder.mediaRecordName(forPhotoID: photo.id),
                                   zoneID: zoneID)
        let records = try await database.fetchMediaRecords(for: [recordID], desiredKeys: nil)
        guard let record = records[recordID], let media = RecordCoder.photoMedia(from: record) else {
            throw MediaFetchError.notFound
        }
        guard let stagingURL = media.originalURL else { throw MediaFetchError.noBytes }

        // Store-through into the media root so the next open is a local hit forever after. On a
        // copy failure fall back to the staging URL (usable this session; CloudKit may purge it).
        if let stable = deps.persist(photo, stagingURL) { return stable }
        return stagingURL
    }
}
