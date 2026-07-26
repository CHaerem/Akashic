import Foundation
import Combine
import CloudKit

/// Observable sync status the UI can surface (e.g. a Settings status row). Owned by the
/// Sync module; `PersistenceController` holds one and the coordinator drives it. It is inert
/// (`.disabled`) unless the store is in `.cloudKit` mode, so it is safe to construct always.
///
/// Not marked `@MainActor` so `PersistenceController` (non-isolated) can hold it as a stored
/// property; the only writer is the `@MainActor` `AkashicSyncEngine`, so mutations land on the
/// main actor in practice.
final class SyncStatus: ObservableObject {

    enum State: Equatable {
        case disabled            // store is not in .cloudKit mode
        case notEntitled         // built WITHOUT the CloudKit entitlement (default Debug/Release)
        case checkingAccount     // querying CKContainer.accountStatus
        case noAccount           // no iCloud account signed in -> app stays local
        case restricted          // iCloud restricted by profile/parental controls
        case unavailable         // couldNotDetermine / temporarilyUnavailable
        case active              // engine running
        case waitingForWiFi      // a heavy download is deferred by the Wi-Fi-only policy
        // The owner's iCloud is full, so the server is rejecting saves (CKError.quotaExceeded).
        // Its own state rather than `.error` because it is not a fault and it is not transient:
        // nothing retries its way out of a full account, the user has to free space or buy more,
        // and until they do the honest thing to say is "waiting", not "syncing". QUA-11.
        case storageFull
        case error(String)
    }

    @Published private(set) var state: State = .disabled
    @Published private(set) var lastSyncDate: Date?

    /// Set to a `.prompt` when a fresh install's heavy download is deferred and a size estimate is
    /// available, so the UI can present the one-time first-sync sheet. Nil the rest of the time
    /// (incremental syncs, no estimate, or after the user answers). Only ever holds a `.prompt`.
    @Published var firstSyncPrompt: FirstSyncDownloadDecision?

    /// Progress of the one-time v2 photo-storage repack (MAPPING §13), surfaced in consumer
    /// Settings as e.g. "Optimizing photo storage · 412/1538". Nil when no repack is running or
    /// pending (the common steady state, and on any non-owner / non-CloudKit device).
    @Published var repackProgress: MediaRepackProgress?

    /// One-line Settings string for an in-progress repack, or nil when there is nothing to show.
    var repackSummary: String? {
        guard let p = repackProgress, p.total > 0, p.done < p.total else { return nil }
        let base = "Optimizing photo storage · \(p.done)/\(p.total)"
        return p.isPaused ? base + " (waiting for Wi-Fi)" : base
    }

    /// Human-readable one-liner for a Settings row.
    var summary: String {
        switch state {
        case .disabled:        return "Off (local store)"
        // Only reachable in a build without the CloudKit entitlement, which no customer ever
        // installs — but it is a user-facing string in a Form row, so it should not read like a
        // build instruction if a configuration is ever mixed up (D5).
        case .notEntitled:     return "Syncing is unavailable in this build"
        case .checkingAccount: return "Checking iCloud account…"
        case .noAccount:       return "Sign in to iCloud to sync"
        case .restricted:      return "iCloud is restricted on this device"
        case .unavailable:     return "iCloud temporarily unavailable"
        case .active:
            if let date = lastSyncDate {
                return "Syncing · last update \(Self.relative.localizedString(for: date, relativeTo: Date()))"
            }
            return "Syncing with iCloud"
        case .storageFull:     return "Your iCloud is full — new photos are waiting to upload"
        case .waitingForWiFi:  return "Waiting for Wi-Fi to download"
        case .error(let message): return "Sync error: \(message)"
        }
    }

    /// Whether the engine is (or should be) running.
    var isActive: Bool { if case .active = state { return true } else { return false } }

    func set(_ newState: State) { state = newState }

    /// Record a successful sync round trip.
    ///
    /// `.storageFull` deliberately survives this (QUA-11). `markSynced` is called from four fetch
    /// paths as well as the save path, and **fetching keeps working perfectly when the account is
    /// full** — only saves are rejected. So without this guard the sequence "save rejected for
    /// quota, then any successful fetch" put the row straight back to "Syncing · last update just
    /// now", which is how a permanently-stuck upload managed to look healthy. The timestamp is
    /// still updated, because the fetch genuinely did happen; only the state is held.
    ///
    /// The state clears when a save actually succeeds — see `clearStorageFullOnSuccessfulSave`.
    func markSynced(_ date: Date = Date()) {
        lastSyncDate = date
        if state != .storageFull { state = .active }
    }

    /// Called when a save round trip succeeds, which is the only real evidence that space exists
    /// again. Kept separate from `markSynced` precisely because a fetch is not that evidence.
    func clearStorageFullOnSuccessfulSave() {
        if state == .storageFull { state = .active }
    }

    /// Map a raw `CKAccountStatus` to the corresponding non-active state. `.available`
    /// returns nil (the caller then transitions to `.active`).
    static func state(for accountStatus: CKAccountStatus) -> State? {
        switch accountStatus {
        case .available:              return nil
        case .noAccount:              return .noAccount
        case .restricted:             return .restricted
        case .couldNotDetermine:      return .unavailable
        case .temporarilyUnavailable: return .unavailable
        @unknown default:             return .unavailable
        }
    }

    private static let relative: RelativeDateTimeFormatter = {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .short
        return f
    }()
}

// MARK: - Account status seam

/// Seam over `CKContainer.accountStatus()` so the engine's account gating is unit-testable
/// without a live container (the simulator has no iCloud account tonight).
protocol AccountStatusProviding: Sendable {
    func accountStatus() async -> CKAccountStatus
}

/// Production provider — queries the real container. In a simulator with no account signed in
/// this returns `.noAccount`, which keeps the engine off (verified by test).
///
/// CRITICAL: `CKContainer(identifier:)` **traps** (SIGTRAP) in a binary without the
/// `com.apple.developer.icloud-services` entitlement — so the container is only ever
/// constructed inside `#if AKASHIC_CLOUDKIT_BUILD` (defined only by the signed `*-CloudKit`
/// configs). In every other build this provider returns a sentinel and no container is created.
struct CloudKitAccountStatusProvider: AccountStatusProviding {
    let containerIdentifier: String

    func accountStatus() async -> CKAccountStatus {
        #if AKASHIC_CLOUDKIT_BUILD
        let container = CKContainer(identifier: containerIdentifier)
        do {
            return try await container.accountStatus()
        } catch {
            return .couldNotDetermine
        }
        #else
        // No entitlement in this build — never touch CKContainer.
        return .couldNotDetermine
        #endif
    }
}
