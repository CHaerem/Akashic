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
        case .notEntitled:     return "Rebuild with the CloudKit configuration to sync"
        case .checkingAccount: return "Checking iCloud account…"
        case .noAccount:       return "Sign in to iCloud to sync"
        case .restricted:      return "iCloud is restricted on this device"
        case .unavailable:     return "iCloud temporarily unavailable"
        case .active:
            if let date = lastSyncDate {
                return "Syncing · last update \(Self.relative.localizedString(for: date, relativeTo: Date()))"
            }
            return "Syncing with iCloud"
        case .waitingForWiFi:  return "Waiting for Wi-Fi to download"
        case .error(let message): return "Sync error: \(message)"
        }
    }

    /// Whether the engine is (or should be) running.
    var isActive: Bool { if case .active = state { return true } else { return false } }

    func set(_ newState: State) { state = newState }

    func markSynced(_ date: Date = Date()) {
        lastSyncDate = date
        state = .active
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
