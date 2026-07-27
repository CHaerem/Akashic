import XCTest
@testable import Akashic

/// QUA-15 — "free" and "not known yet" must not look the same.
///
/// `realEntitlement` starts `.free` because there is no third case to start it in, so on every cold
/// launch a purchaser looks free-tier until StoreKit answers — and indefinitely if it never does.
/// That is the worst first impression a paid app can give, and it was invisible because the wrong
/// state and the common state are the same value.
final class EntitlementResolutionTests: XCTestCase {

    /// Reuses `EntitlementTests.FakeStoreKitProvider` rather than defining a second fake — one
    /// definition of the seam means a protocol change cannot leave a stale duplicate compiling.
    private typealias Fake = EntitlementTests.FakeStoreKitProvider

    private func freshDefaults() -> UserDefaults {
        let name = "qua15-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    /// `autostart: false` so the initial, unresolved state is observable — which is the entire
    /// subject of these tests.
    @MainActor
    private func store(_ provider: Fake = Fake(),
                       environment: [String: String] = [:]) -> EntitlementStore {
        EntitlementStore(provider: provider, defaults: freshDefaults(),
                         environment: environment, autostart: false)
    }

    @MainActor
    func testEntitlementIsUndeterminedBeforeStoreKitAnswers() {
        let s = store()
        XCTAssertFalse(s.isEntitlementDetermined,
                       "nothing has been asked yet, so the UI must not claim a tier")
        XCTAssertFalse(s.isComplete, "and it must not claim entitlement either — strictness is kept")
    }

    @MainActor
    func testEntitlementBecomesDeterminedOnceStoreKitAnswersFree() async {
        let s = store()
        await s.refreshEntitlement()
        XCTAssertTrue(s.isEntitlementDetermined, "free is a real answer once it has been given")
        XCTAssertFalse(s.isComplete)
    }

    @MainActor
    func testEntitlementBecomesDeterminedOnceStoreKitAnswersComplete() async {
        let provider = Fake(); provider.entitlement = .complete
        let s = store(provider)
        await s.refreshEntitlement()
        XCTAssertTrue(s.isEntitlementDetermined)
        XCTAssertTrue(s.isComplete)
    }

    /// The flag must not flap back to undetermined on a later refresh, or the UI would blink
    /// "Checking…" over a customer who has already been told they own it.
    @MainActor
    func testRemainsDeterminedAcrossRepeatedRefreshes() async {
        let s = store()
        await s.refreshEntitlement()
        await s.refreshEntitlement()
        XCTAssertTrue(s.isEntitlementDetermined)
    }

    /// An override is deterministic by construction — that is the whole point of it — so a
    /// screenshot or UI-test run must never sit in "Checking…".
    @MainActor
    func testAnOverrideCountsAsDeterminedWithoutAskingStoreKit() {
        let s = store(environment: ["AKASHIC_COMPLETE": "1"])
        XCTAssertTrue(s.isEntitlementDetermined, "an override is deterministic; no round trip needed")
    }

    /// The strictness that must NOT have been traded away: treating unknown as entitled would let a
    /// genuinely free account create a second journey whenever StoreKit was slow.
    @MainActor
    func testUndeterminedDoesNotLoosenTheJourneyGate() {
        let s = store()
        XCTAssertFalse(s.canCreateJourney(ownedCount: 1),
                       "unknown must not be treated as entitled — only what is SHOWN changes")
    }
}
