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

/// D9: the bundled demo journey (Kilimanjaro, seeded into a real `.local`/`.cloudKit` store on a
/// fresh install — a DIFFERENT thing from the `.fixtures`-mode dev seed exercised above, which
/// seeds all three dev fixtures into an in-memory store every launch and is unchanged by D9).
/// Covers the three things the design explicitly worried about:
///  - it must never eat the family's one free journey slot,
///  - deleting it must stay deleted across relaunches (never resurrect), and
///  - the decision to seed at all is made exactly once, independent of the store's current
///    contents (which is what makes "deleted" and "never seeded" indistinguishable states safe).
///
/// "Never syncs" is covered separately, at the `AkashicSyncEngine` seam, in `SyncEngineTests`
/// (`testHandlesExcludesSeededFixture` and friends) — this exercises
/// `PersistenceController.seedDemoJourneyIfFreshInstall` directly, which is exactly what
/// `.local`'s `init` calls synchronously and what `.cloudKit`'s `onFreshInstallDetermined` hook
/// calls once the fetch/no-account determination lands (see `PersistenceController+Sync`).
@MainActor
final class DemoJourneyTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    /// A throwaway on-disk store + a throwaway `UserDefaults` suite, so "relaunch" can be modeled
    /// honestly as a SECOND `PersistenceController` instance pointed at the same two things —
    /// exactly what persists (or doesn't) between real app launches.
    private func makeTempStoreURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("demo-journey-\(UUID().uuidString).sqlite")
    }

    private func makeTempDefaults() -> UserDefaults {
        UserDefaults(suiteName: "demo-journey-test-\(UUID().uuidString)")!
    }

    // MARK: - Seeds exactly once, into an empty store

    func testLocalModeSeedsTheDemoJourneyOnAFreshInstall() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()
        let controller = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)

        let journeys = controller.loadJourneys()
        XCTAssertEqual(journeys.map(\.id), ["kilimanjaro"], "the ONE demo journey lands, not all three dev fixtures")
        XCTAssertTrue(controller.isSeededFixture(journeyID: "kilimanjaro"))
    }

    // MARK: - Never eats the free tier's one journey

    func testDemoJourneyNeverCountsAgainstTheFreeTier() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()
        let controller = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)
        let store = JourneyStore(persistence: controller)

        XCTAssertEqual(store.ownedJourneyCount, 1, "the demo is an owned journey (present, local, unshared)")
        XCTAssertEqual(store.billableOwnedJourneyCount, 0, "but it must not count toward the free limit")

        let free = EntitlementPolicy(entitlement: .free)
        XCTAssertTrue(free.canCreateJourney(ownedCount: store.billableOwnedJourneyCount),
                     "a free user must still be able to create their OWN first journey")
    }

    // MARK: - Deleting it stays deleted across relaunches (the resurrection bug this guards against)

    func testDeletingTheDemoJourneyDoesNotReseedOnNextLaunch() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()

        // "Launch 1": fresh install, empty store -> the demo seeds.
        let firstLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)
        XCTAssertEqual(firstLaunch.loadJourneys().map(\.id), ["kilimanjaro"], "precondition: seeded")

        // The user deletes it, leaving the store looking EXACTLY like a fresh install would
        // (zero journeys) — the case a naive "seed when empty" check cannot tell apart.
        firstLaunch.deleteJourney(id: "kilimanjaro")
        XCTAssertTrue(firstLaunch.loadJourneys().isEmpty, "precondition: deleted")

        // "Launch 2": a NEW controller instance over the SAME on-disk store + the SAME persisted
        // decision — modeling an actual app relaunch, not just calling the method again in-process.
        let secondLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                 storeURL: storeURL, defaults: defaults)

        XCTAssertTrue(secondLaunch.loadJourneys().isEmpty,
                     "a sample that resurrects itself after being deleted is worse than not shipping it")
    }

    /// The persisted decision, not `seededJourneyIDs` (in-memory, reset every launch), is what
    /// `isSeededFixture` must keep consulting — otherwise the demo would still exist on disk after
    /// a relaunch but silently stop being recognised as a sample, and start counting against the
    /// free tier and (per `SyncEngineTests`) start being eligible for sync.
    func testSeededFixtureIsStillRecognisedAfterARelaunchWithoutReseeding() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()

        let firstLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)
        XCTAssertTrue(firstLaunch.isSeededFixture(journeyID: "kilimanjaro"))

        let secondLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                 storeURL: storeURL, defaults: defaults)
        // Nothing reseeded (still exactly the one demo journey)...
        XCTAssertEqual(secondLaunch.loadJourneys().map(\.id), ["kilimanjaro"])
        // ...but the row that survived from launch 1 is STILL recognised as the sample, even
        // though `secondLaunch.seededJourneyIDs` (in-memory) was never populated this launch.
        XCTAssertTrue(secondLaunch.isSeededFixture(journeyID: "kilimanjaro"),
                     "the persisted decision must survive a relaunch, not just the in-memory set")

        let store = JourneyStore(persistence: secondLaunch)
        XCTAssertEqual(store.billableOwnedJourneyCount, 0,
                      "still free-tier-exempt on the second launch, not just the first")
    }

    // MARK: - The decision is made once, independent of store contents

    /// If real content already exists by the time the seed decision runs (imported data, or a
    /// journey the user created before a deferred `.cloudKit` decision resolved), the demo must be
    /// skipped — not seeded alongside the family's own archive.
    func testSeedIsSkippedWhenTheStoreIsAlreadyNonEmpty() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()
        let controller = PersistenceController(mode: .local, seed: false, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)
        // Simulate real content already present (e.g. an import that beat the seed decision).
        let ownJourney = try FixtureLoader.load(named: "mountKenya", bundle: bundle)
        CoreDataMapping.upsertJourney(ownJourney, into: controller.viewContext)
        try controller.viewContext.save()

        controller.seedDemoJourneyIfFreshInstall(bundle: bundle)

        XCTAssertEqual(controller.loadJourneys().map(\.id), ["mount-kenya"],
                      "the demo must not be seeded next to already-present real content")
        XCTAssertFalse(controller.isSeededFixture(journeyID: "kilimanjaro"))
    }

    /// A second call within the same process (defensive — production only calls this once per
    /// mode, but the guard itself must hold) must not seed twice.
    func testSeedDoesNotRunTwiceInTheSameProcess() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()
        let controller = PersistenceController(mode: .local, seed: false, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)

        controller.seedDemoJourneyIfFreshInstall(bundle: bundle)
        controller.deleteJourney(id: "kilimanjaro")
        controller.seedDemoJourneyIfFreshInstall(bundle: bundle)

        XCTAssertTrue(controller.loadJourneys().isEmpty,
                     "the decision is made once ever, not once per call")
    }
}
