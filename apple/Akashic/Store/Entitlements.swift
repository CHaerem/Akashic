import Foundation
import StoreKit

/// M3 — the paywall/entitlement layer (COMMERCIALIZATION-PLAN §4.4 + §5).
///
/// This file is the **single source of truth** for what the free tier allows and how the paid
/// unlock ("Akashic Complete") is verified. The UI never hard-codes a limit or reads StoreKit
/// directly — it asks `EntitlementStore` the capability questions below, and every number lives
/// here as a constant in `EntitlementPolicy`.
///
/// ## The product model (plan §5, revised 2026-07-25)
///   * **Free**: 1 OWNED journey, full experience, sharing included, up to 100 photos per OWNED
///     journey — and that ONE journey is fully finishable: publishing to the showcase and
///     exporting it are both included, not gated. Withholding the finish is what the old model
///     got wrong (it strangled the showcase-as-funnel in §6: only people who had already paid
///     could market the app).
///   * **Akashic Complete**: a one-time non-consumable IAP (`no.akashic.app.complete`), Family
///     Sharing enabled — unlimited journeys/photos. Export and publishing are NOT part of what
///     Complete unlocks; they were never behind this wall to begin with.
///
/// ## The hard nuances baked into the policy
///   * **The family is the customer, and shared content is NEVER gated.** Every limit here is
///     expressed against journeys the user *owns* (`zoneOwnerName == nil`). A family member who
///     receives journeys via CKShare views/comments/captions them freely — callers pass OWNED
///     counts only (see `JourneyStore.ownedJourneyCount` and the per-journey ownership check the
///     photo gate performs). The policy has no concept of shared content precisely because shared
///     content must never reach it.
///   * **Grandfathering — we never hold memories hostage.** If a user already owns more than the
///     free limit (our own family during the beta; a reviewer restoring; edge cases), everything
///     stays VISIBLE and editable. The gate only stops *new* creation/import beyond the limit; it
///     never hides or removes what already exists. Concretely: `canCreateJourney` returns false
///     once over the limit, but no other capability regresses, and photo imports into an
///     over-cap journey are simply capped (existing photos are untouched).

// MARK: - Entitlement

/// What the current user (family) is entitled to.
enum Entitlement: String, Equatable {
    /// The free tier: one owned journey, 100 photos per owned journey — and that journey IS
    /// finishable: publishing to the showcase and exporting are both included (see the file header).
    case free
    /// Akashic Complete: unlimited owned journeys and photos. Export and publishing are not part of
    /// this — they are free-tier capabilities too.
    case complete
}

// MARK: - Policy (pure, testable — no StoreKit, no @MainActor)

/// The free-tier rulebook. Deliberately a plain value type with no StoreKit or actor dependency so
/// the entire capability matrix (free vs complete × create/photos/export/publish, the partial
/// photo-import math, and grandfathering) is unit-testable without touching StoreKit.
///
/// Every caller passes **owned** counts — shared-in journeys are filtered out before they ever get
/// here (see the file header). That is why there is no `isShared` parameter: the policy only ever
/// sees what the user created.
struct EntitlementPolicy: Equatable {

    // The only place these numbers live.

    /// App Store product identifier for the one-time unlock (non-consumable, Family Sharing on).
    static let completeProductID = "no.akashic.app.complete"

    /// Free tier allows this many OWNED journeys.
    static let freeOwnedJourneyLimit = 1

    /// Free tier allows this many photos per OWNED journey.
    static let freePhotosPerOwnedJourney = 100

    let entitlement: Entitlement

    var isComplete: Bool { entitlement == .complete }

    // MARK: Create

    /// Whether the user may create/import one more OWNED journey, given how many they already own.
    ///
    /// Complete: always. Free: only below the limit. A grandfathered free user with more owned
    /// journeys than the limit gets `false` here (no *new* journeys) while keeping full access to
    /// the ones they already have (that access is not this method's concern — nothing is hidden).
    func canCreateJourney(ownedCount: Int) -> Bool {
        if isComplete { return true }
        return ownedCount < Self.freeOwnedJourneyLimit
    }

    // MARK: Photos (with partial-import math)

    /// How many of `adding` new photos may land on an OWNED journey that currently holds
    /// `currentCount`.
    ///
    /// Complete: all of them. Free: up to the per-journey cap, and never negative — an over-cap
    /// (grandfathered) journey simply returns 0 (no *new* imports) while its existing photos stay
    /// put. Callers import what this returns and report the remainder; nothing is ever silently
    /// dropped.
    func photosAllowed(currentCount: Int, adding: Int) -> Int {
        guard adding > 0 else { return 0 }
        if isComplete { return adding }
        let remaining = max(0, Self.freePhotosPerOwnedJourney - currentCount)
        return min(adding, remaining)
    }

    /// Whether ALL of `adding` photos fit (i.e. no partial import is needed).
    func canAddPhotos(currentCount: Int, adding: Int) -> Bool {
        photosAllowed(currentCount: currentCount, adding: adding) >= adding
    }

    /// Ownership-aware photo gate — the crown-jewel invariant, now inside the policy (and tested)
    /// rather than living only in view code. A journey shared *into* this account is NEVER gated:
    /// a free family member may add all their photos to it. Only OWNED journeys hit the free cap.
    /// (quality gate: shared-content photo carve-out.)
    func photosAllowed(currentCount: Int, adding: Int, isOwned: Bool) -> Int {
        guard isOwned else { return max(0, adding) }   // shared-in content is never capped
        return photosAllowed(currentCount: currentCount, adding: adding)
    }

    // MARK: Export / publish

    /// Per-journey export (the "exit door") is available on EVERY tier, including free — plan §5:
    /// the one free journey is fully finishable. Independent of entitlement and of how many
    /// journeys exist, so it never regresses under grandfathering either.
    var canExport: Bool { true }

    /// Ownership-aware export gate. Export is never paywalled (see `canExport` above) for either
    /// an owned journey or one shared *into* this account — exporting your copy of shared content
    /// was always a viewing-tier action, and the free tier's own journey is no different now.
    /// Kept `isOwned`-shaped (rather than a bare `true`) for call-site symmetry with
    /// `canPublish(isOwned:)` and so a future re-gate has exactly one seam to change.
    /// (quality gate: shared-content export/showcase; §5: free-tier export/publish.)
    func canExport(isOwned: Bool) -> Bool { true }

    /// Publishing to the public showcase is available on EVERY tier (plan §5) — Akashic Complete
    /// no longer factors in here at all; the only remaining gate is ownership (see below) and,
    /// separately, the CloudKit build/account check `JourneyShowcaseSheet` performs.
    var canPublish: Bool { true }

    /// Ownership-aware publish gate. Entitlement no longer factors in (§5) — the only rule left is
    /// that you can never publish a journey shared *into* your account; only its owner controls
    /// world-readability.
    func canPublish(isOwned: Bool) -> Bool { isOwned }
}

// MARK: - Developer / screenshot override

/// Lets us and App Review flip entitlement states without a real purchase (plan §4.4).
///
/// **Compiled out of Release — defense in depth against a paywall bypass.** Both overrides only
/// exist in DEBUG builds. In a Release/TestFlight/App Store binary `resolvedOverride` always
/// returns `nil`, so NEITHER the persisted `simulateComplete` UserDefaults key NOR the
/// `AKASHIC_COMPLETE` environment variable can grant the paid tier — even if a key is hand-set on
/// device. Screenshots run against DEBUG builds, so `AKASHIC_COMPLETE=1` still works there.
///
/// Precedence within a DEBUG build, highest first:
///   1. `AKASHIC_COMPLETE=1` in the environment — for deterministic screenshots.
///   2. The developer-tools "Simulate Akashic Complete" toggle (persisted in `UserDefaults`).
///   3. Otherwise: the real StoreKit entitlement.
///
/// Both overrides can only *grant* Complete (they never take it away), so a real purchaser is
/// never downgraded by a stale toggle.
enum EntitlementOverride {

    /// Persisted developer toggle key.
    static let simulateCompleteKey = "akashic.developer.simulateComplete"

    /// Environment variable honored for screenshots.
    static let completeEnvKey = "AKASHIC_COMPLETE"

    /// Whether this binary was compiled with the DEBUG configuration. The real gate uses the
    /// compile-time flag; exposed as a value so `resolvedOverride(debugBuild:)` is unit-testable
    /// for BOTH configurations regardless of the config the tests run under.
    static let isDebugBuild: Bool = {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }()

    static func simulateComplete(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: simulateCompleteKey)
    }

    static func setSimulateComplete(_ on: Bool, defaults: UserDefaults = .standard) {
        if on {
            defaults.set(true, forKey: simulateCompleteKey)
        } else {
            defaults.removeObject(forKey: simulateCompleteKey)
        }
    }

    /// The override entitlement, or `nil` to fall through to the real StoreKit entitlement.
    /// `environment` is injectable so the env precedence is testable without mutating the process;
    /// `debugBuild` is injectable so a test can pin the Release compile-out directly.
    static func resolvedOverride(defaults: UserDefaults = .standard,
                                 environment: [String: String] = ProcessInfo.processInfo.environment,
                                 debugBuild: Bool = isDebugBuild)
        -> Entitlement? {
        // Release builds honor NEITHER the env var NOR the persisted toggle: the paywall can never
        // be bypassed by a UserDefaults key or an environment variable in a shipped binary.
        guard debugBuild else { return nil }
        if environment[completeEnvKey] == "1" { return .complete }
        if simulateComplete(defaults: defaults) { return .complete }
        return nil
    }
}

// MARK: - StoreKit seam

/// The subset of App Store surface the `EntitlementStore` drives, behind a protocol so unit tests
/// can inject fake entitlement states, products, and transaction updates without ever touching
/// StoreKit — mirroring the `SyncEngineProtocol` / `SyncLocalStore` seam pattern. The real
/// implementation is `StoreKitProvider`; tests inject a recording fake.
// QUA-08: `Sendable` because `Entitlements` sends its provider across isolation boundaries
// (four `sending 'self.provider'` sites). The shipping conformer is stateless over StoreKit 2's
// own Sendable API; the test fake is scripting state and takes `@unchecked`, as this target
// already does for `MockMediaDatabase` and `RecordingAccepter`.
protocol StoreKitProviding: Sendable {
    /// Load the Complete product (for its localized price/name), or `nil` if the store has no such
    /// product configured yet (offline, or App Store Connect not populated). Never bricks the UI.
    func loadProduct() async throws -> StoreProduct?

    /// The entitlement implied by the current verified transactions (`Transaction.currentEntitlements`).
    func currentEntitlement() async -> Entitlement

    /// Begin a purchase. Returns the outcome; throws only on an unrecoverable error (incl.
    /// verification failure).
    func purchase() async throws -> PurchaseOutcome

    /// Restore purchases (`AppStore.sync()`); the caller re-reads `currentEntitlement()` after.
    func restore() async throws

    /// Observe live transaction updates (`Transaction.updates`), calling back with the freshly
    /// resolved entitlement. Called once at launch.
    func observeTransactionUpdates(_ onChange: @escaping @Sendable (Entitlement) -> Void)
}

/// StoreKit-free description of the product, so the paywall and tests share one shape.
struct StoreProduct: Equatable {
    let id: String
    let displayName: String
    /// Localized, currency-formatted price string from the App Store, e.g. "kr 149,00".
    let displayPrice: String
    let description: String
}

/// The meaningful outcomes of a purchase attempt.
enum PurchaseOutcome: Equatable {
    /// Verified and finished — the entitlement is now granted.
    case success
    /// Deferred (Ask to Buy / SCA): nothing granted yet; a later transaction update will arrive.
    case pending
    /// The user dismissed the sheet.
    case cancelled
}

/// The real StoreKit 2 implementation. Constructing it is cheap and side-effect-free (it only
/// stores the product id); nothing touches StoreKit until a method is called, so it is safe to
/// build even where StoreKit is unavailable. Unit tests never construct it — they inject a fake.
struct StoreKitProvider: StoreKitProviding {

    let productID: String

    init(productID: String = EntitlementPolicy.completeProductID) {
        self.productID = productID
    }

    enum StoreKitProviderError: LocalizedError {
        case productUnavailable
        case unverified

        /// Localised (QUA-26). The paywall shows this verbatim when a purchase or restore fails.
        var errorDescription: String? {
            switch self {
            case .productUnavailable:
                return String(localized: "Akashic Complete is not available on the App Store right now.",
                              comment: "Purchase failure alert: StoreKit returned no product for the configured identifier. \"Akashic Complete\" is the product name and stays untranslated.")
            case .unverified:
                return String(localized: "The purchase could not be verified with the App Store.",
                              comment: "Purchase failure alert: StoreKit could not verify the transaction signature.")
            }
        }
    }

    func loadProduct() async throws -> StoreProduct? {
        let products = try await Product.products(for: [productID])
        guard let product = products.first else { return nil }
        return StoreProduct(id: product.id,
                            displayName: product.displayName,
                            displayPrice: product.displayPrice,
                            description: product.description)
    }

    func currentEntitlement() async -> Entitlement {
        await Self.entitlement(forProductID: productID)
    }

    func purchase() async throws -> PurchaseOutcome {
        let products = try await Product.products(for: [productID])
        guard let product = products.first else { throw StoreKitProviderError.productUnavailable }

        let result = try await product.purchase()
        switch result {
        case let .success(verification):
            switch verification {
            case let .verified(transaction):
                await transaction.finish()
                return .success
            case .unverified:
                throw StoreKitProviderError.unverified
            }
        case .pending:
            return .pending
        case .userCancelled:
            return .cancelled
        @unknown default:
            return .cancelled
        }
    }

    func restore() async throws {
        try await AppStore.sync()
    }

    // QUA-08: `@Sendable` — this is handed to `Task.detached` below, so the closure and everything
    // it captures genuinely cross an isolation boundary. Annotating the parameter checks the
    // callers' captures instead of trusting them.
    func observeTransactionUpdates(_ onChange: @escaping @Sendable (Entitlement) -> Void) {
        let productID = self.productID
        Task.detached {
            for await update in Transaction.updates {
                if case let .verified(transaction) = update {
                    await transaction.finish()
                }
                onChange(await Self.entitlement(forProductID: productID))
            }
        }
    }

    /// Resolve the entitlement from the current verified, non-revoked entitlements.
    private static func entitlement(forProductID productID: String) async -> Entitlement {
        for await result in Transaction.currentEntitlements {
            if case let .verified(transaction) = result,
               transaction.productID == productID,
               transaction.revocationDate == nil {
                return .complete
            }
        }
        return .free
    }
}

// MARK: - EntitlementStore

/// The app's observable entitlement state and the questions the UI asks. Owns the StoreKit
/// lifecycle (load product, purchase, restore, live updates, launch verification) behind the seam,
/// and layers the developer/screenshot override on top of the real entitlement.
@MainActor
final class EntitlementStore: ObservableObject {

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    enum PurchasePhase: Equatable {
        case idle
        case purchasing
        case restoring
        case purchased
        case pending
        case cancelled
        case failed(String)
    }

    /// The real StoreKit entitlement (before any override). Published so capability reads refresh.
    @Published private(set) var realEntitlement: Entitlement = .free

    /// Whether `realEntitlement` reflects an actual answer from StoreKit yet (QUA-15).
    ///
    /// It starts `.free` because there is no third case to start it in, which means on every cold
    /// launch a paying customer looks free-tier until `refreshEntitlement()` returns — and
    /// indefinitely if it never does. That is the worst possible first impression in a paid app, so
    /// the UI needs to be able to tell "free" from "not known yet" and say *checking* rather than
    /// putting up a wall the customer already paid to remove.
    ///
    /// Deliberately does NOT loosen any capability gate. Treating unknown as entitled would let a
    /// genuinely free account create a second journey whenever StoreKit was slow, which trades one
    /// wrong answer for another. The gates stay strict; only what is *shown* changes.
    @Published private(set) var hasResolvedEntitlement = false

    /// The loaded product (price/name for the paywall), or nil while loading / if unavailable.
    @Published private(set) var product: StoreProduct?

    /// Product-load state, so the paywall can show a spinner or an offline retry.
    @Published private(set) var loadState: LoadState = .idle

    /// The in-flight purchase/restore outcome, for the paywall's button states.
    @Published private(set) var purchasePhase: PurchasePhase = .idle

    private let provider: StoreKitProviding
    private let defaults: UserDefaults
    private let environment: [String: String]

    init(provider: StoreKitProviding = StoreKitProvider(),
         defaults: UserDefaults = .standard,
         environment: [String: String] = ProcessInfo.processInfo.environment,
         autostart: Bool = true) {
        self.provider = provider
        self.defaults = defaults
        self.environment = environment
        if autostart {
            Task { await start() }
        }
    }

    // MARK: Resolved entitlement + capability queries

    /// The effective entitlement the UI should honor: the developer/screenshot override if set,
    /// otherwise the real StoreKit entitlement.
    var current: Entitlement {
        EntitlementOverride.resolvedOverride(defaults: defaults, environment: environment)
            ?? realEntitlement
    }

    var isComplete: Bool { current == .complete }

    /// True once the entitlement is known — either StoreKit answered, or an override is in force
    /// (overrides are deterministic by construction, which is the point of them).
    var isEntitlementDetermined: Bool {
        hasResolvedEntitlement
            || EntitlementOverride.resolvedOverride(defaults: defaults, environment: environment) != nil
    }

    private var policy: EntitlementPolicy { EntitlementPolicy(entitlement: current) }

    /// Free tier caps OWNED journeys; callers pass `store.ownedJourneyCount` (shared-in journeys
    /// excluded). See the file header on why shared content never reaches this.
    func canCreateJourney(ownedCount: Int) -> Bool { policy.canCreateJourney(ownedCount: ownedCount) }

    /// Partial-import math for an OWNED journey. Callers pass owned per-journey counts only.
    func photosAllowed(currentCount: Int, adding: Int) -> Int {
        policy.photosAllowed(currentCount: currentCount, adding: adding)
    }

    func canAddPhotos(currentCount: Int, adding: Int) -> Bool {
        policy.canAddPhotos(currentCount: currentCount, adding: adding)
    }

    /// Ownership-aware photo gate; shared-in journeys are never capped. Callers pass whether the
    /// target journey is owned (`store.isOwnedByCurrentUser`).
    func photosAllowed(currentCount: Int, adding: Int, isOwned: Bool) -> Int {
        policy.photosAllowed(currentCount: currentCount, adding: adding, isOwned: isOwned)
    }

    var canExport: Bool { policy.canExport }
    var canPublish: Bool { policy.canPublish }

    /// Ownership-aware export/publish gates. Export of a shared-in journey is never paywalled;
    /// publishing always requires ownership. Views pass `store.isOwnedByCurrentUser`.
    func canExport(isOwned: Bool) -> Bool { policy.canExport(isOwned: isOwned) }
    func canPublish(isOwned: Bool) -> Bool { policy.canPublish(isOwned: isOwned) }

    // MARK: Lifecycle

    /// Verify the entitlement, load the product, and start observing live transaction updates.
    func start() async {
        await refreshEntitlement()
        await loadProduct()
        provider.observeTransactionUpdates { [weak self] entitlement in
            Task { @MainActor in self?.receiveTransactionUpdate(entitlement) }
        }
    }

    /// Re-read the verified entitlement (launch + after purchase/restore).
    func refreshEntitlement() async {
        realEntitlement = await provider.currentEntitlement()
        // Set after the assignment and never reset: once StoreKit has answered once, "free" is a
        // real answer rather than the initial placeholder (QUA-15).
        hasResolvedEntitlement = true
    }

    /// Load the product for its price/name, with graceful failure so an offline launch never
    /// bricks the paywall.
    func loadProduct() async {
        loadState = .loading
        do {
            product = try await provider.loadProduct()
            loadState = .loaded
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    /// Applied on the main actor from the `Transaction.updates` observer.
    func receiveTransactionUpdate(_ entitlement: Entitlement) {
        realEntitlement = entitlement
    }

    // MARK: Purchase / restore

    func purchase() async {
        guard purchasePhase != .purchasing else { return }
        purchasePhase = .purchasing
        do {
            switch try await provider.purchase() {
            case .success:
                await refreshEntitlement()
                purchasePhase = .purchased
            case .pending:
                purchasePhase = .pending
            case .cancelled:
                purchasePhase = .cancelled
            }
        } catch {
            purchasePhase = .failed(error.localizedDescription)
        }
    }

    func restore() async {
        guard purchasePhase != .restoring else { return }
        purchasePhase = .restoring
        do {
            try await provider.restore()
            await refreshEntitlement()
            purchasePhase = isComplete ? .purchased : .idle
        } catch {
            purchasePhase = .failed(error.localizedDescription)
        }
    }

    /// Reset the transient purchase phase (e.g. when the paywall reappears).
    func resetPurchasePhase() { purchasePhase = .idle }

    // MARK: Developer override

    var simulateComplete: Bool { EntitlementOverride.simulateComplete(defaults: defaults) }

    func setSimulateComplete(_ on: Bool) {
        EntitlementOverride.setSimulateComplete(on, defaults: defaults)
        // `current` is computed from the override (not a @Published), so nudge observers directly.
        objectWillChange.send()
    }
}

extension EntitlementStore {
    /// A non-autostarting store for SwiftUI previews (never touches StoreKit). Not `#if DEBUG`-
    /// gated because `#Preview` bodies are compiled in Release builds too.
    static var previewFree: EntitlementStore {
        EntitlementStore(provider: StoreKitProvider(), environment: [:], autostart: false)
    }
}
