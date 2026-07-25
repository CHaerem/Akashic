import XCTest
@testable import Akashic

/// Persistence-mode resolution per build flag + the free-tier carve-out for fixture-seeded demo
/// journeys. (quality gate: fresh installs run fixtures / fixture-seeded demo journeys consume the
/// free tier.)
final class ConfigModeTests: XCTestCase {

    // MARK: - Pure mode resolver, per build flag

    func testResolvePersistenceModePrecedence() {
        // An explicit Settings override always wins, over both the env seam and the build flag.
        XCTAssertEqual(Config.resolvePersistenceMode(override: .local, envCloudKit: true, cloudKitBuild: true),
                       .local, "the Settings override wins")

        // The launch-time AKASHIC_CLOUDKIT env seam selects CloudKit for one run.
        XCTAssertEqual(Config.resolvePersistenceMode(override: nil, envCloudKit: true, cloudKitBuild: false),
                       .cloudKit, "env seam selects CloudKit")

        // A CloudKit-entitled build DEFAULTS to CloudKit — no env var needed. This is the fresh-install
        // fix: a customer's TestFlight install no longer lands in fixtures/demo mode.
        XCTAssertEqual(Config.resolvePersistenceMode(override: nil, envCloudKit: false, cloudKitBuild: true),
                       .cloudKit, "the entitled build defaults to sync, not demo")

        // The default Debug/Release build (no entitlement) still defaults to fixtures.
        XCTAssertEqual(Config.resolvePersistenceMode(override: nil, envCloudKit: false, cloudKitBuild: false),
                       .fixtures, "the un-entitled build defaults to fixtures")
    }

    /// `cloudKitEnabled` is derived from the compile-time flag; in the (non-CloudKit) test build it
    /// is false, so the live resolver defaults to fixtures — matching the pure resolver above.
    func testLiveResolverMatchesBuildFlag() {
        #if AKASHIC_CLOUDKIT_BUILD
        XCTAssertTrue(FeatureFlags.cloudKitEnabled)
        #else
        XCTAssertFalse(FeatureFlags.cloudKitEnabled)
        #endif
    }

    // MARK: - Fixture-seeded demo journeys never eat the family's one free journey

    @MainActor
    func testFixtureSeededJourneysDoNotConsumeTheFreeTier() {
        let bundle = Bundle(for: type(of: self))
        let controller = PersistenceController(mode: .fixtures, seed: true, fixtureBundle: bundle)
        let store = JourneyStore(persistence: controller)

        XCTAssertGreaterThan(store.ownedJourneyCount, 0, "fixtures seed owned demo journeys")
        XCTAssertEqual(store.billableOwnedJourneyCount, 0,
                       "but seeded demo journeys never count against the free create limit")

        // So a brand-new free user can still create their one free journey (rather than landing on a
        // paywall that says 'You've filled your free journey' having created nothing).
        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertTrue(free.canCreateJourney(ownedCount: store.billableOwnedJourneyCount),
                      "a fresh free install can create its first journey")
    }
}
