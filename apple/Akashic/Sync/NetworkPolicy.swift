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
    /// releases any deferred fetch (see `onAllowsHeavyTransferBecameTrue`); flipping it ON while on
    /// one immediately defers a first download that has not delivered yet (DIFF-16, see
    /// `heavyTransferDisallowedObservers`).
    @Published var wifiOnlyDownloads: Bool = true {
        didSet {
            guard wifiOnlyDownloads != oldValue else { return }
            defaults.set(wifiOnlyDownloads, forKey: Self.wifiOnlyKey)
            // `oneOccasionExemption` is part of `allowsHeavyTransfer`, so the "before" value must
            // include it — otherwise turning the setting ON while an exemption is outstanding looks
            // like a true → false transition when the exemption still permits the download, and
            // (since DIFF-16) that would defer a fetch the user explicitly allowed.
            let before = Self.allows(wifiOnly: oldValue, expensive: isExpensivePath,
                                     exemption: oneOccasionExemption)
            fireTransition(from: before)
        }
    }

    /// Whether the current network path is "expensive" — cellular, a personal hotspot, or an
    /// otherwise metered link (`NWPath.isExpensive`). Updated by the path monitor.
    ///
    /// **This starts out LYING on a cellular launch, and that is DIFF-16's root cause.** `init`
    /// seeds it from `NWPathMonitor.currentPath`, which before the monitor's first update always
    /// reports not-expensive — so activation's gate passes, the multi-GB pull starts, and
    /// milliseconds later the real path arrives. Nothing can be done about the seed (there is no
    /// synchronous way to ask, and waiting for the first update would add launch latency to every
    /// launch); what matters is that the correction, when it lands, is *acted on* — which is why the
    /// true → false transition below exists as well as the false → true one.
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

    /// DIFF-16: observers of the OTHER direction, **true → false**.
    ///
    /// This half did not exist, and its absence was the whole defect: on a cellular launch the seed
    /// above says not-expensive, the heavy pull starts, the real path arrives a moment later, and the
    /// per-operation hook (`nextFetchChangesOptions`) then hands CloudKit `allowsCellularAccess =
    /// false` for every subsequent request. CloudKit defers them SILENTLY while the status still says
    /// "Syncing", so the user sat at 0 journeys / 0 photos forever — measured on the owner's phone on
    /// builds 101 and 102. With a one-directional transition the engine could never honestly enter
    /// the deferred state after launch, no matter what the path did.
    ///
    /// A LIST, and self-registered by each engine (`AkashicSyncEngine.init` via
    /// `observeHeavyTransferDisallowed`), where the true direction is a single closure that
    /// `startSync` fans out to both engines by hand. That asymmetry is deliberate, for the reason
    /// `AkashicSyncEngine.observeForeground` gives for subscribing in `init`: a subscription that
    /// depends on a call site remembering to make it is a subscription that can ship missing. Both
    /// engines share one policy, so a single closure would have let whichever registered last silently
    /// replace the other.
    ///
    /// Observers must capture weakly (`[weak self]`), exactly as `startSync`'s closure does: this list
    /// is never pruned, because in production it holds exactly two entries for the life of the process.
    private var heavyTransferDisallowedObservers: [() -> Void] = []

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
        fireTransition(from: before)
    }

    /// DIFF-16: register a callback for the **true → false** transition. Append-only; see
    /// `heavyTransferDisallowedObservers` for why this is a list and why observers must capture weakly.
    func observeHeavyTransferDisallowed(_ onDisallowed: @escaping () -> Void) {
        heavyTransferDisallowedObservers.append(onDisallowed)
    }

    /// Spend the one-occasion exemption once the heavy fetch it permitted has completed, so the
    /// next heavy fetch re-evaluates the policy from scratch. Called by the engine on fetch
    /// success; a no-op when no exemption was outstanding.
    func heavyTransferDidComplete() {
        // Deliberately does NOT fire the disallowed transition, even though spending the exemption can
        // flip `allowsHeavyTransfer` true → false. This is called from INSIDE `fetchOnActivation`,
        // immediately after a successful heavy fetch, and that method owns the status for the rest of
        // its body — re-entering the deferred state from underneath it would have the engine contradict
        // the round trip it just completed. The path-change and setting-change sites below are the
        // honest triggers: something outside the fetch actually changed.
        oneOccasionExemption = false
    }

    private func pathChanged(expensive: Bool) {
        guard expensive != isExpensivePath else { return }
        let before = allowsHeavyTransfer
        isExpensivePath = expensive
        fireTransition(from: before)
    }

    /// Fire whichever direction `allowsHeavyTransfer` just moved in, or nothing if it did not move.
    ///
    /// One method for both directions so a new mutation site cannot pick up half the contract — which is
    /// exactly what happened when only the false → true half existed.
    private func fireTransition(from before: Bool) {
        let now = allowsHeavyTransfer
        guard now != before else { return }
        if now {
            onAllowsHeavyTransferBecameTrue?()
        } else {
            for observer in heavyTransferDisallowedObservers { observer() }
        }
    }

    /// `allowsHeavyTransfer` evaluated against explicit inputs, for computing the "before" value in
    /// `wifiOnlyDownloads.didSet` — where the stored property already holds the new value.
    private static func allows(wifiOnly: Bool, expensive: Bool, exemption: Bool) -> Bool {
        !wifiOnly || !expensive || exemption
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
    /// DIFF-16: register a callback fired when `allowsHeavyTransfer` goes **true → false**, so the
    /// engine can enter the honest deferred state instead of letting CloudKit defer its operations
    /// silently behind a status that still says "Syncing".
    ///
    /// A requirement rather than a defaulted protocol extension on purpose: a gate that can say no and
    /// forgets to implement this reproduces the exact defect, and a no-op default makes that
    /// omission invisible. Gates that never disallow implement it as an explicit no-op and say so.
    func observeHeavyTransferDisallowed(_ onDisallowed: @escaping () -> Void)
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
    /// Never fires: `allowsHeavyTransfer` is a constant `true` here, so there is no transition to
    /// observe. Dropping the callback is correct rather than lossy — the alternative (storing it) would
    /// only hold a closure that nothing could ever call.
    func observeHeavyTransferDisallowed(_ onDisallowed: @escaping () -> Void) {}
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

    /// **Always `false` until the monitor has delivered its first path update** — `currentPath` on an
    /// unstarted monitor is an empty path, and an empty path is not expensive. So this is not merely
    /// "best effort": on a cellular launch it is reliably WRONG, which is why `NetworkPolicy` treats the
    /// first real update as a correction it must act on rather than as a refinement (DIFF-16).
    var isExpensivePath: Bool { monitor.currentPath.isExpensive }

    func start(onChange: @escaping @Sendable (Bool) -> Void) {
        monitor.pathUpdateHandler = { path in
            let expensive = path.isExpensive
            DispatchQueue.main.async { onChange(expensive) }
        }
        monitor.start(queue: queue)
    }
}
