import Foundation
import CloudKit

/// Seam over the CloudKit share-accept round-trip so the auto-accept policy is unit-tested without
/// a container. The real implementation runs a `CKFetchShareMetadataOperation` then
/// `container.accept(_:)`; the test fake records calls and can be told to fail.
// QUA-08: `Sendable` because the auto-accepter hands `any MediaShareAccepting` into async work.
protocol MediaShareAccepting: AnyObject, Sendable {
    /// Fetch the share metadata for `shareURL` and accept it. Returns on success; throws on failure.
    func fetchAndAccept(shareURL: URL) async throws
}

/// Participant side of the v2 media share (MAPPING §13).
///
/// When a shared journey arrives carrying `mediaShareURL` (set by the owner) and the participant
/// has not yet accepted the media share, auto-accept it in the background — silent and
/// retry-tolerant. A failure NEVER surfaces as an error dialog: it degrades to thumbnails (the
/// journey still shows, originals just can't be streamed yet) and is retried on the next arrival.
///
/// "Already accepted" is remembered in `UserDefaults`, keyed by journey id, so a successful accept
/// is never re-attempted; a failure is not recorded, so it retries.
@MainActor
final class MediaShareAutoAccepter {

    static let acceptedKey = "akashic.media.acceptedMediaShares"

    private let accepter: MediaShareAccepting
    private let defaults: UserDefaults

    init(accepter: MediaShareAccepting, defaults: UserDefaults = .standard) {
        self.accepter = accepter
        self.defaults = defaults
    }

    /// Whether the media share for a journey has already been accepted on this device.
    func hasAccepted(journeyID: String) -> Bool {
        acceptedJourneyIDs().contains(journeyID)
    }

    /// Decide-and-do: auto-accept the journey's media share if there is a URL and it is not already
    /// accepted. Silent; degrades to thumbnails on any failure. Returns true iff an accept landed.
    @discardableResult
    func autoAcceptIfNeeded(journeyID: String, mediaShareURL: String?) async -> Bool {
        guard let raw = mediaShareURL, let url = URL(string: raw), !hasAccepted(journeyID: journeyID)
        else { return false }
        do {
            try await accepter.fetchAndAccept(shareURL: url)
            markAccepted(journeyID: journeyID)   // success is sticky — never re-attempt
            SyncLog.log("media auto-accept: accepted media share for \(journeyID)")
            return true
        } catch {
            // Degrade to thumbnails. Quiet log, no dialog, retried on the next arrival.
            SyncLog.log("media auto-accept: failed for \(journeyID) (\(error)) — staying on thumbnails")
            return false
        }
    }

    private func acceptedJourneyIDs() -> Set<String> {
        Set(defaults.stringArray(forKey: Self.acceptedKey) ?? [])
    }

    private func markAccepted(journeyID: String) {
        var set = acceptedJourneyIDs()
        set.insert(journeyID)
        defaults.set(Array(set), forKey: Self.acceptedKey)
    }
}

#if AKASHIC_CLOUDKIT_BUILD
/// Real accepter: fetch the share metadata for the URL, then accept it. Constructed only in the
/// entitled build (a `CKContainer` traps unentitled).
final class CKMediaShareAccepter: MediaShareAccepting {
    private let containerIdentifier: String

    init(containerIdentifier: String) { self.containerIdentifier = containerIdentifier }

    func fetchAndAccept(shareURL: URL) async throws {
        let container = CKContainer(identifier: containerIdentifier)
        let metadata = try await fetchMetadata(for: shareURL, container: container)
        _ = try await container.accept(metadata)
    }

    private func fetchMetadata(for url: URL, container: CKContainer) async throws -> CKShare.Metadata {
        try await withCheckedThrowingContinuation { continuation in
            let operation = CKFetchShareMetadataOperation(shareURLs: [url])
            operation.shouldFetchRootRecord = false
            var fetched: CKShare.Metadata?
            operation.perShareMetadataResultBlock = { _, result in
                if case .success(let metadata) = result { fetched = metadata }
            }
            operation.fetchShareMetadataResultBlock = { result in
                switch result {
                case .success:
                    if let fetched { continuation.resume(returning: fetched) }
                    else { continuation.resume(throwing: MediaFetchError.notFound) }
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
            container.add(operation)
        }
    }
}
#endif
