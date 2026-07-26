import Foundation
import Network

/// The Wi-Fi-only download policy for the CloudKit sync engine.
///
/// The first sync pulls the whole photo archive — several gigabytes. On a cellular (or otherwise
/// metered) connection that is a real bill and the classic "this app ate my data plan" review.
/// So the DEFAULT is to protect the user: heavy transfers (the photo download) run over Wi-Fi
/// only, with an explicit opt-in for cellular and an honest status while waiting.
///
/// ## What is and isn't gated
/// * **Downloads / fetches** are gated. Both the engine's automatic (push-triggered / scheduled)
///   fetches AND our explicit activation pull consult this policy — the automatic ones natively
///   via `AkashicSyncEngine`'s `fetchChangesOptions` delegate hook (which sets
///   `allowsCellularAccess = false` on the fetch operation group so CloudKit defers on cellular
///   and retries on Wi-Fi), the explicit pull by checking `allowsHeavyTransfer` at the trigger.
/// * **Uploads / sends are NOT gated here.** They are the user's own edits going up (a photo the
///   user just picked, a caption they just typed) — user-initiated and expected. There is also no
///   send-side CKSyncEngine delegate hook equivalent to the fetch one, so automatic sends could
///   not be gated even if we wanted to. Public-mirror publishing (tens of MB) warns instead of
///   blocking, at its own call site.
///
/// `@MainActor` because it publishes to SwiftUI (the Settings toggle + status) and the engine
/// reads it on the main actor. A protocol seam (`NetworkPathSource`) sits over the path source so
/// tests can drive path changes deterministically without a real interface.
@MainActor
final class NetworkPolicy: ObservableObject, NetworkPolicyGate {

    /// Shared instance used by the app (Settings binds to it, `startSync` wires it into the
    /// engines). Tests construct their own with a fake `NetworkPathSource`.
    static let shared = NetworkPolicy()

    static let wifiOnlyKey = "akashic.sync.wifiOnlyDownloads"

    /// User setting: restrict heavy downloads to Wi-Fi. **DEFAULT TRUE** — the protective default.
    /// Persisted to `UserDefaults` on change. Flipping it OFF on an expensive path immediately
    /// releases any deferred fetch (see `onAllowsHeavyTransferBecameTrue`).
    @Published var wifiOnlyDownloads: Bool = true {
        didSet {
            guard wifiOnlyDownloads != oldValue else { return }
            defaults.set(wifiOnlyDownloads, forKey: Self.wifiOnlyKey)
            let before = Self.allows(wifiOnly: oldValue, expensive: isExpensivePath)
            fireIfBecameAllowed(before: before)
        }
    }

    /// Whether the current network path is "expensive" — cellular, a personal hotspot, or an
    /// otherwise metered link (`NWPath.isExpensive`). Updated by the path monitor.
    @Published private(set) var isExpensivePath: Bool = false

    /// A ONE-OCCASION cellular exemption for the pending heavy download, granted by the user from
    /// the first-sync prompt or the "Download now" status action. Deliberately **in-memory only**
    /// (never persisted): it is spent when the fetch completes (`heavyTransferDidComplete`) and
    /// gone on relaunch, so the next heavy fetch re-evaluates the policy fresh. It does NOT flip
    /// the global `wifiOnlyDownloads` setting — a one-time "yes", not a standing preference.
    @Published private(set) var oneOccasionExemption: Bool = false

    /// The one decision everything else reads: may a heavy transfer (the multi-GB photo download)
    /// run right now? Yes when downloads are not restricted to Wi-Fi, OR the path is not expensive,
    /// OR the user granted a one-occasion exemption for this download.
    var allowsHeavyTransfer: Bool { !wifiOnlyDownloads || !isExpensivePath || oneOccasionExemption }

    /// Fired (on the main actor) whenever `allowsHeavyTransfer` transitions **false → true** — the
    /// path became cheap, or the user turned the setting off. Wired by `startSync` to retry a
    /// deferred heavy fetch on both engines immediately, rather than waiting for the next launch.
    var onAllowsHeavyTransferBecameTrue: (() -> Void)?

    private let source: NetworkPathSource
    private let defaults: UserDefaults
    private var didStart = false

    init(source: NetworkPathSource = NWPathSource(), defaults: UserDefaults = .standard) {
        self.source = source
        self.defaults = defaults
        // DEFAULT TRUE: only an explicitly stored value overrides it; a fresh install reads true.
        if defaults.object(forKey: Self.wifiOnlyKey) == nil {
            self.wifiOnlyDownloads = true            // no didSet during init
        } else {
            self.wifiOnlyDownloads = defaults.bool(forKey: Self.wifiOnlyKey)
        }
        self.isExpensivePath = source.isExpensivePath
    }

    /// Begin monitoring the network path. Idempotent. The source delivers changes on the main
    /// thread, so the update is applied synchronously here.
    func start() {
        guard !didStart else { return }
        didStart = true
        source.start { [weak self] expensive in
            // The source contract delivers on the main thread (see `NWPathSource`), so this is a
            // safe main-actor hop with no async gap — which also keeps the tests deterministic.
            MainActor.assumeIsolated { self?.pathChanged(expensive: expensive) }
        }
    }

    /// Grant the pending heavy download a one-time pass over cellular, WITHOUT changing the global
    /// Wi-Fi-only setting. Releases any deferred fetch immediately (via the allowance callback).
    func grantOneOccasionCellularDownload() {
        guard !oneOccasionExemption else { return }
        let before = allowsHeavyTransfer
        oneOccasionExemption = true
        fireIfBecameAllowed(before: before)
    }

    /// Spend the one-occasion exemption once the heavy fetch it permitted has completed, so the
    /// next heavy fetch re-evaluates the policy from scratch. Called by the engine on fetch
    /// success; a no-op when no exemption was outstanding.
    func heavyTransferDidComplete() {
        oneOccasionExemption = false
    }

    private func pathChanged(expensive: Bool) {
        guard expensive != isExpensivePath else { return }
        let before = allowsHeavyTransfer
        isExpensivePath = expensive
        fireIfBecameAllowed(before: before)
    }

    private func fireIfBecameAllowed(before: Bool) {
        if !before && allowsHeavyTransfer { onAllowsHeavyTransferBecameTrue?() }
    }

    private static func allows(wifiOnly: Bool, expensive: Bool) -> Bool {
        !wifiOnly || !expensive
    }
}

// MARK: - Gate seam (what the engine depends on)

/// The minimal surface the sync engine reads. Kept tiny and `@MainActor` so the engine's default
/// argument can be a trivial always-allow stand-in, leaving the existing engine tests untouched.
@MainActor
protocol NetworkPolicyGate: AnyObject {
    var allowsHeavyTransfer: Bool { get }
    /// Called by the engine once a heavy fetch it was permitted to run has completed, so a
    /// one-occasion cellular exemption is spent (the next heavy fetch re-evaluates fresh).
    func heavyTransferDidComplete()
}

/// Permissive default for engines constructed without a policy (the existing unit tests, and any
/// non-download context). Never defers anything.
@MainActor
final class AlwaysAllowHeavyTransfer: NetworkPolicyGate {
    // `nonisolated` so it is usable as a default argument for the (main-actor) engine initializer,
    // whose default-argument expressions evaluate in a nonisolated context.
    nonisolated init() {}
    var allowsHeavyTransfer: Bool { true }
    func heavyTransferDidComplete() {}
}

// MARK: - Path source seam

/// Seam over the network path source so tests can drive path changes without a real interface.
/// `onChange` is invoked on the **main thread** with the new expensive-ness.
protocol NetworkPathSource: AnyObject {
    /// The current path's expensive-ness, readable before `start` (best-effort initial value).
    var isExpensivePath: Bool { get }
    /// Begin monitoring; `onChange` fires on the main thread whenever the path changes.
    /// QUA-08: `@Sendable` because `NWPathSource` carries this into `DispatchQueue.main.async`.
    /// The annotation is what makes that legal, and it checks that callers capture only
    /// Sendable state rather than trusting them to.
    func start(onChange: @escaping @Sendable (Bool) -> Void)
}

/// Production source backed by `NWPathMonitor`. The monitor delivers on a private queue; this
/// re-dispatches to the main thread so `NetworkPolicy` (main-actor) can apply the change directly.
final class NWPathSource: NetworkPathSource {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "no.akashic.networkpath")

    var isExpensivePath: Bool { monitor.currentPath.isExpensive }

    func start(onChange: @escaping @Sendable (Bool) -> Void) {
        monitor.pathUpdateHandler = { path in
            let expensive = path.isExpensive
            DispatchQueue.main.async { onChange(expensive) }
        }
        monitor.start(queue: queue)
    }
}
