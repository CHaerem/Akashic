import XCTest
@testable import Akashic

/// M3 — the paywall/entitlement layer (COMMERCIALIZATION-PLAN §4.4 + §5).
///
/// Covers the capability matrix (free vs complete × create/photos/export/publish), the shared-
/// content invariant, grandfathering, the partial photo-import math, entitlement refresh through
/// the StoreKit seam (fake transactions — never real StoreKit), and the developer/env override
/// precedence.
final class EntitlementTests: XCTestCase {

    // MARK: - Fake seam (no StoreKit)

    /// Records what the store asks and returns scripted answers, so the whole store is exercised
    /// without touching StoreKit.
    final class FakeStoreKitProvider: StoreKitProviding {
        var entitlement: Entitlement = .free
        var product: StoreProduct? = StoreProduct(
            id: EntitlementPolicy.completeProductID,
            displayName: "Akashic Complete",
            displayPrice: "kr 99,00",
            description: "Unlimited journeys and photos.")
        var loadError: Error?
        var purchaseError: Error?
        var restoreError: Error?
        var purchaseOutcome: PurchaseOutcome = .success
        /// If true, a successful `restore()` grants Complete (a matching prior purchase existed).
        var restoreGrantsComplete = true

        private(set) var observeRegistered = false
        var lastUpdateHandler: ((Entitlement) -> Void)?

        func loadProduct() async throws -> StoreProduct? {
            if let loadError { throw loadError }
            return product
        }
        func currentEntitlement() async -> Entitlement { entitlement }
        func purchase() async throws -> PurchaseOutcome {
            if let purchaseError { throw purchaseError }
            if purchaseOutcome == .success { entitlement = .complete }
            return purchaseOutcome
        }
        func restore() async throws {
            if let restoreError { throw restoreError }
            if restoreGrantsComplete { entitlement = .complete }
        }
        func observeTransactionUpdates(_ onChange: @escaping (Entitlement) -> Void) {
            observeRegistered = true
            lastUpdateHandler = onChange
        }
    }

    private func makeDefaults(_ suite: String = "akashic.entitlement.tests.\(UUID().uuidString)")
        -> UserDefaults {
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    @MainActor
    private func makeStore(provider: FakeStoreKitProvider = FakeStoreKitProvider(),
                           defaults: UserDefaults? = nil,
                           environment: [String: String] = [:]) -> EntitlementStore {
        EntitlementStore(provider: provider,
                         defaults: defaults ?? makeDefaults(),
                         environment: environment,
                         autostart: false)
    }

    // MARK: - Capability matrix (pure policy)

    func testFreeCapabilityMatrix() {
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertTrue(free.canCreateJourney(ownedCount: 0), "first owned journey is free")
        XCTAssertFalse(free.canCreateJourney(ownedCount: 1), "second owned journey needs Complete")
        XCTAssertFalse(free.canExport)
        XCTAssertFalse(free.canPublish)
        XCTAssertTrue(free.canAddPhotos(currentCount: 0, adding: 100), "100 fits")
        XCTAssertFalse(free.canAddPhotos(currentCount: 0, adding: 101), "101 does not")
    }

    func testCompleteCapabilityMatrix() {
        let complete = EntitlementPolicy(entitlement: .complete)
        XCTAssertTrue(complete.canCreateJourney(ownedCount: 0))
        XCTAssertTrue(complete.canCreateJourney(ownedCount: 50), "unlimited journeys")
        XCTAssertTrue(complete.canExport)
        XCTAssertTrue(complete.canPublish)
        XCTAssertTrue(complete.canAddPhotos(currentCount: 10_000, adding: 10_000), "unlimited photos")
        XCTAssertEqual(complete.photosAllowed(currentCount: 10_000, adding: 500), 500)
    }

    // MARK: - Shared content is never gated (owned counts only)

    func testPolicyOnlySeesOwnedCounts() {
        // The policy has no `isShared` parameter by design: shared-in journeys are filtered out by
        // the caller (JourneyStore.ownedJourneyCount / the per-journey ownership check) and never
        // reach it. This test pins that contract: the create gate is a pure function of the OWNED
        // count, so a family swimming in shared journeys is unaffected as long as callers pass the
        // owned count (0 here) — the free journey stays available.
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertTrue(free.canCreateJourney(ownedCount: 0),
                      "shared-in journeys don't count against the owned limit")
    }

    // MARK: - Grandfathering (owned count over the limit)

    func testGrandfatheringBlocksNewCreationButNothingElseRegresses() {
        // A free user who already owns MORE than the limit (beta family, reviewer restoring, edge
        // cases): no NEW journeys, but export/publish are unchanged and existing photos untouched.
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertFalse(free.canCreateJourney(ownedCount: 3), "no new journeys past the limit")
        XCTAssertFalse(free.canExport, "export capability does not depend on journey count")
        XCTAssertFalse(free.canPublish, "publish capability does not depend on journey count")

        // Completing the purchase lifts the create block for the same grandfathered count.
        let complete = EntitlementPolicy(entitlement: .complete)
        XCTAssertTrue(complete.canCreateJourney(ownedCount: 3))
    }

    func testGrandfatheredOverCapJourneyBlocksNewImportsButKeepsExisting() {
        // An owned journey already over the 100 cap: new imports are blocked (0 allowed), which is
        // "stop new import beyond the limit" — NOT hiding the 150 already there (that is a view
        // concern; the policy never removes anything).
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertEqual(free.photosAllowed(currentCount: 150, adding: 10), 0)
        XCTAssertFalse(free.canAddPhotos(currentCount: 150, adding: 10))
    }

    // MARK: - Partial photo-import math

    func testPartialImportMath() {
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertEqual(free.photosAllowed(currentCount: 95, adding: 10), 5, "import what fits")
        XCTAssertFalse(free.canAddPhotos(currentCount: 95, adding: 10), "not all 10 fit")
        XCTAssertEqual(free.photosAllowed(currentCount: 0, adding: 100), 100, "exactly the cap")
        XCTAssertEqual(free.photosAllowed(currentCount: 0, adding: 101), 100, "one over the cap")
        XCTAssertEqual(free.photosAllowed(currentCount: 100, adding: 1), 0, "already at cap")
        XCTAssertEqual(free.photosAllowed(currentCount: 90, adding: 0), 0, "nothing to add")
        XCTAssertEqual(free.photosAllowed(currentCount: 90, adding: -5), 0, "never negative")
    }

    func testPartialImportBoundaryAllowsFullFit() {
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertTrue(free.canAddPhotos(currentCount: 90, adding: 10), "90 + 10 == cap fits fully")
        XCTAssertEqual(free.photosAllowed(currentCount: 90, adding: 10), 10)
    }

    // MARK: - Store capability delegation

    @MainActor
    func testStoreDelegatesToPolicyForCurrentEntitlement() {
        let provider = FakeStoreKitProvider()
        let store = makeStore(provider: provider)

        // Free by default.
        XCTAssertFalse(store.isComplete)
        XCTAssertTrue(store.canCreateJourney(ownedCount: 0))
        XCTAssertFalse(store.canCreateJourney(ownedCount: 1))
        XCTAssertFalse(store.canExport)
        XCTAssertFalse(store.canPublish)
        XCTAssertEqual(store.photosAllowed(currentCount: 95, adding: 10), 5)
    }

    // MARK: - Entitlement refresh from the seam

    @MainActor
    func testRefreshEntitlementReadsFromSeam() async {
        let provider = FakeStoreKitProvider()
        provider.entitlement = .complete
        let store = makeStore(provider: provider)

        XCTAssertFalse(store.isComplete, "not yet refreshed")
        await store.refreshEntitlement()
        XCTAssertTrue(store.isComplete)
        XCTAssertTrue(store.canExport)
        XCTAssertTrue(store.canPublish)
        XCTAssertTrue(store.canCreateJourney(ownedCount: 99))
    }

    @MainActor
    func testStartWiresTransactionObserverAndLoadsProduct() async {
        let provider = FakeStoreKitProvider()
        let store = makeStore(provider: provider)
        await store.start()

        XCTAssertTrue(provider.observeRegistered, "start() registers the transaction observer")
        XCTAssertEqual(store.loadState, .loaded)
        XCTAssertEqual(store.product?.id, EntitlementPolicy.completeProductID)
    }

    @MainActor
    func testTransactionUpdateFlipsEntitlement() {
        let store = makeStore()
        XCTAssertFalse(store.isComplete)
        // Simulate the observer firing (as Transaction.updates would after a Family-Shared grant).
        store.receiveTransactionUpdate(.complete)
        XCTAssertTrue(store.isComplete)
    }

    // MARK: - Purchase / restore flows

    @MainActor
    func testPurchaseSuccessGrantsComplete() async {
        let provider = FakeStoreKitProvider()
        provider.purchaseOutcome = .success
        let store = makeStore(provider: provider)

        await store.purchase()
        XCTAssertEqual(store.purchasePhase, .purchased)
        XCTAssertTrue(store.isComplete)
    }

    @MainActor
    func testPurchaseCancelledLeavesEntitlementFree() async {
        let provider = FakeStoreKitProvider()
        provider.purchaseOutcome = .cancelled
        let store = makeStore(provider: provider)

        await store.purchase()
        XCTAssertEqual(store.purchasePhase, .cancelled)
        XCTAssertFalse(store.isComplete)
    }

    @MainActor
    func testPurchasePendingDoesNotGrantYet() async {
        let provider = FakeStoreKitProvider()
        provider.purchaseOutcome = .pending
        let store = makeStore(provider: provider)

        await store.purchase()
        XCTAssertEqual(store.purchasePhase, .pending)
        XCTAssertFalse(store.isComplete)
    }

    @MainActor
    func testRestoreGrantsCompleteWhenAPriorPurchaseExists() async {
        let provider = FakeStoreKitProvider()
        provider.restoreGrantsComplete = true
        let store = makeStore(provider: provider)

        await store.restore()
        XCTAssertTrue(store.isComplete)
        XCTAssertEqual(store.purchasePhase, .purchased)
    }

    @MainActor
    func testRestoreWithoutPriorPurchaseStaysFree() async {
        let provider = FakeStoreKitProvider()
        provider.restoreGrantsComplete = false
        let store = makeStore(provider: provider)

        await store.restore()
        XCTAssertFalse(store.isComplete)
        XCTAssertEqual(store.purchasePhase, .idle)
    }

    @MainActor
    func testProductLoadFailureIsGraceful() async {
        struct Offline: LocalizedError { var errorDescription: String? { "offline" } }
        let provider = FakeStoreKitProvider()
        provider.loadError = Offline()
        let store = makeStore(provider: provider)

        await store.loadProduct()
        XCTAssertNil(store.product)
        XCTAssertEqual(store.loadState, .failed("offline"))
    }

    // MARK: - Developer / env override + precedence

    func testResolvedOverrideDefaultsToNil() {
        let defaults = makeDefaults()
        XCTAssertNil(EntitlementOverride.resolvedOverride(defaults: defaults, environment: [:]))
    }

    func testDeveloperToggleForcesComplete() {
        let defaults = makeDefaults()
        EntitlementOverride.setSimulateComplete(true, defaults: defaults)
        XCTAssertEqual(EntitlementOverride.resolvedOverride(defaults: defaults, environment: [:]),
                       .complete)
        EntitlementOverride.setSimulateComplete(false, defaults: defaults)
        XCTAssertNil(EntitlementOverride.resolvedOverride(defaults: defaults, environment: [:]))
    }

    func testEnvForcesCompleteEvenWithoutToggle() {
        let defaults = makeDefaults()
        XCTAssertEqual(
            EntitlementOverride.resolvedOverride(defaults: defaults,
                                                 environment: ["AKASHIC_COMPLETE": "1"]),
            .complete)
    }

    @MainActor
    func testStoreHonorsDeveloperToggleOverRealEntitlement() {
        let provider = FakeStoreKitProvider()   // real entitlement stays .free
        let defaults = makeDefaults()
        let store = makeStore(provider: provider, defaults: defaults)

        XCTAssertFalse(store.isComplete)
        store.setSimulateComplete(true)
        XCTAssertTrue(store.isComplete, "developer toggle grants Complete without a purchase")
        XCTAssertTrue(store.canExport)

        store.setSimulateComplete(false)
        XCTAssertFalse(store.isComplete, "toggling off falls back to the real (free) entitlement")
    }

    @MainActor
    func testStoreHonorsEnvOverride() {
        let provider = FakeStoreKitProvider()   // real entitlement .free
        let store = makeStore(provider: provider, environment: ["AKASHIC_COMPLETE": "1"])
        XCTAssertTrue(store.isComplete, "AKASHIC_COMPLETE=1 forces Complete for screenshots")
    }

    @MainActor
    func testOverrideNeverDowngradesARealPurchase() async {
        let provider = FakeStoreKitProvider()
        provider.entitlement = .complete
        let store = makeStore(provider: provider)
        await store.refreshEntitlement()

        // No override set; real entitlement is Complete and must stand.
        XCTAssertTrue(store.isComplete)
        // The override can only GRANT — with the toggle off, a real purchaser stays Complete.
        store.setSimulateComplete(false)
        XCTAssertTrue(store.isComplete)
    }
}
