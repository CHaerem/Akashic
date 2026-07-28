import XCTest
import CloudKit
import CoreData
@testable import Akashic

/// QUA-48 — the bundled SAMPLE journey seeded on top of a synced library.
///
/// MEASURED 2026-07-27 on a fresh install signed into the owner's real account: the library ended
/// up with FOUR journeys, two of them Kilimanjaro — one badged SAMPLE dated Sep 29 – Oct 9 2023 and
/// one unbadged dated Sep 30 – Oct 9 2023, identical distance (70 km), ascent (4 800 m) and summit
/// (Uhuru Peak, 5 895 m). A one-day-offset fake copy of the family's own trek.
///
/// This is a BETA-MEASUREMENT defect, not a cosmetic one: it fires on the SECOND device of every
/// household, so at SHIP-17's ~10 households it is the modal second-device experience, and the
/// household cannot see that the copy is ours rather than theirs.
///
/// Two halves, both covered here:
///  1. the once-ever seed decision must not be taken on an account status that means "we do not
///     know" (`AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed`), and
///  2. a sample that ends up beside the family's own journeys anyway is RETIRED
///     (`JourneyStore.retireSampleJourneyIfLibraryHasRealContent`) — the correction that does not
///     depend on predicting sync correctly.
///
/// The existing `DemoJourneyTests` in `ConfigModeTests.swift` covers the seed's other invariants
/// (seeds once, never resurrects, never eats the free tier, remapped ids).
@MainActor
final class SampleJourneyRetirementTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func makeTempStoreURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("sample-retire-\(UUID().uuidString).sqlite")
    }

    private func makeTempDefaults() -> UserDefaults {
        UserDefaults(suiteName: "sample-retire-\(UUID().uuidString)")!
    }

    /// A `.local` controller over a throwaway store + defaults, seeded with the ONE demo journey
    /// exactly as a fresh install does.
    private func makeSeededController() -> PersistenceController {
        PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                              storeURL: makeTempStoreURL(), defaults: makeTempDefaults())
    }

    /// Insert a journey straight into the store, the way the sync apply path does — bypassing
    /// `JourneyStore` so nothing observes it until the next `reload()`.
    private func insertJourney(named name: String, into controller: PersistenceController,
                               zoneOwnerName: String? = nil) throws -> String {
        let journey = try FixtureLoader.load(named: name, bundle: bundle)
        let cd = CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        cd.zoneOwnerName = zoneOwnerName
        try controller.viewContext.save()
        return journey.id
    }

    // MARK: - 1. The seed decision is not taken on a status that means "we do not know"

    /// `.couldNotDetermine` is what CloudKit reports when it cannot reach the account — the ordinary
    /// state of a cold launch before the network is up, i.e. exactly a fresh install opened the
    /// moment it finishes downloading. `.temporarilyUnavailable` says "retry" in its name. Firing
    /// the once-ever seed decision on either is how the sample got written into a store the family's
    /// real archive was seconds away from filling.
    ///
    /// Measured before the fix: all four of these fired the hook.
    func testInconclusiveAccountStatusDoesNotDecideTheSeedQuestion() async {
        for status: CKAccountStatus in [.couldNotDetermine, .temporarilyUnavailable] {
            let engine = AkashicSyncEngine(store: FakeLocalStore(), status: SyncStatus(),
                                           accountProvider: MockAccountProvider(status: status),
                                           defaults: makeTempDefaults(), engine: MockSyncEngine())
            var fired = 0
            engine.onFreshInstallDetermined = { fired += 1 }

            await engine.activate()

            XCTAssertEqual(fired, 0,
                           "\(status) means 'we do not know', which must not burn an irreversible decision")
        }
    }

    /// The other side of the same line: a status that genuinely says this device has no usable
    /// account still decides immediately, because no fetch is ever coming to decide it later. Losing
    /// this would mean a customer with no iCloud never sees a sample at all.
    func testConclusiveAccountStatusStillDecidesImmediately() async {
        for status: CKAccountStatus in [.noAccount, .restricted] {
            let engine = AkashicSyncEngine(store: FakeLocalStore(), status: SyncStatus(),
                                           accountProvider: MockAccountProvider(status: status),
                                           defaults: makeTempDefaults(), engine: MockSyncEngine())
            var fired = 0
            engine.onFreshInstallDetermined = { fired += 1 }

            await engine.activate()

            XCTAssertEqual(fired, 1, "\(status) is a decided state of the device — decide now")
        }
    }

    /// The classifier itself, so the intent is readable without driving `activate()`.
    func testAccountStatusConclusivenessClassification() {
        XCTAssertTrue(AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed(.noAccount))
        XCTAssertTrue(AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed(.restricted))
        XCTAssertFalse(AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed(.couldNotDetermine))
        XCTAssertFalse(AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed(.temporarilyUnavailable))
        // An available account defers to the first successful fetch, which is a better answer than
        // any account status can give.
        XCTAssertFalse(AkashicSyncEngine.accountStatusIsConclusiveForDemoSeed(.available))
    }

    // MARK: - 2. A sample beside the family's own archive is retired

    /// The measured defect, reproduced end to end: the demo seeds into an empty store, then the
    /// family's real Kilimanjaro arrives by sync. Constructing the store models the NEXT LAUNCH of
    /// an install that is already in that state — which is where the owner's device is now, and
    /// where every second device in the beta would be.
    func testSampleIsRetiredWhenTheFamilysOwnArchiveIsPresent() throws {
        let controller = makeSeededController()
        XCTAssertEqual(controller.loadJourneys().map(\.id), ["demo-kilimanjaro"], "precondition: seeded")

        // The real trek arrives from CloudKit under its own (raw-archive) id.
        let realID = try insertJourney(named: "kilimanjaro", into: controller)
        XCTAssertEqual(Set(controller.loadJourneys().map(\.id)), ["demo-kilimanjaro", realID],
                       "precondition: the duplicate pair the household actually saw")

        let store = JourneyStore(persistence: controller)

        XCTAssertEqual(store.journeys.map(\.id), [realID],
                       "the sample copy of the family's own trek must not survive alongside it")
        XCTAssertFalse(controller.loadJourneys().map(\.id).contains("demo-kilimanjaro"),
                       "and it is gone from the store, not merely hidden from this snapshot")
    }

    /// The same correction driven by the hook the sync path actually fires — a second device where
    /// the sample is already on screen when the archive lands mid-session.
    func testSampleIsRetiredWhenRealJourneysArriveMidSession() throws {
        let controller = makeSeededController()
        let store = JourneyStore(persistence: controller)
        XCTAssertEqual(store.journeys.map(\.id), ["demo-kilimanjaro"],
                       "precondition: a fresh install showing the sample")

        let realID = try insertJourney(named: "kilimanjaro", into: controller)
        // What `onRemoteChangesApplied` does (wired in `JourneyStore.init`; unreachable here because
        // `.local` has no coordinator).
        store.reload()
        let retired = store.retireSampleJourneyIfLibraryHasRealContent()

        XCTAssertEqual(retired, ["demo-kilimanjaro"])
        XCTAssertEqual(store.journeys.map(\.id), [realID])
    }

    /// The case the fix must NOT break: a brand-new customer with nothing of their own keeps the
    /// sample. `JourneyStore.swift`'s comments explain why the demo exists at all.
    func testSampleSurvivesOnAGenuinelyEmptyAccount() {
        let controller = makeSeededController()
        let store = JourneyStore(persistence: controller)

        XCTAssertEqual(store.journeys.map(\.id), ["demo-kilimanjaro"],
                       "a customer with no journeys of their own still gets something to look at")
        XCTAssertEqual(store.retireSampleJourneyIfLibraryHasRealContent(), [],
                       "and repeating the sweep does not change its mind")
    }

    /// A journey someone shared INTO this account is not evidence that the customer has made
    /// anything, so it must not retire the sample. Same line `billableOwnedJourneyCount` already
    /// draws for the free tier — shared content is never the customer's own content.
    func testSharedInJourneyDoesNotRetireTheSample() throws {
        let controller = makeSeededController()
        _ = try insertJourney(named: "mountKenya", into: controller, zoneOwnerName: "_someoneElse")
        let store = JourneyStore(persistence: controller)

        XCTAssertTrue(store.journeys.map(\.id).contains("demo-kilimanjaro"),
                      "a shared-in journey means someone ELSE made one — the sample keeps its job")
    }

    /// `.fixtures` is the in-memory dev/preview/screenshot store where every journey is a seeded
    /// fixture and seeding is the whole point. A sweep there would empty the app the moment a
    /// developer created a journey.
    func testFixturesModeIsNeverSwept() throws {
        let controller = PersistenceController(mode: .fixtures, seed: true, fixtureBundle: bundle)
        let store = JourneyStore(persistence: controller)
        let seeded = store.journeys.count
        XCTAssertGreaterThan(seeded, 1, "precondition: all three dev fixtures")

        // A journey the developer creates in fixtures mode is billable, so the guard that keeps this
        // store exempt has to be the MODE, not the counts.
        let draft = JourneyDraft(name: "Scratch")
        XCTAssertNotNil(store.createJourney(from: draft))
        XCTAssertGreaterThan(store.billableOwnedJourneyCount, 0, "precondition: real content present")

        XCTAssertEqual(store.retireSampleJourneyIfLibraryHasRealContent(), [],
                       "the dev fixture seed is not the customer-facing sample and is never retired")
        XCTAssertEqual(store.journeys.count, seeded + 1)
    }

    /// Retiring must be final. The once-ever seed decision is already persisted by the time the
    /// sweep runs, so the next launch must not put the duplicate straight back.
    func testRetiringTheSampleDoesNotReseedItOnTheNextLaunch() throws {
        let storeURL = makeTempStoreURL()
        let defaults = makeTempDefaults()

        let firstLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                storeURL: storeURL, defaults: defaults)
        let realID = try insertJourney(named: "kilimanjaro", into: firstLaunch)
        _ = JourneyStore(persistence: firstLaunch)
        XCTAssertEqual(firstLaunch.loadJourneys().map(\.id), [realID], "precondition: retired")

        // A real relaunch: a NEW controller over the SAME store and the SAME persisted decision.
        let secondLaunch = PersistenceController(mode: .local, seed: true, fixtureBundle: bundle,
                                                 storeURL: storeURL, defaults: defaults)
        let store = JourneyStore(persistence: secondLaunch)

        XCTAssertEqual(store.journeys.map(\.id), [realID],
                       "a sample that comes back after being retired is the same defect again")
    }

    /// A published sample has a live world-readable mirror in the public database, and taking that
    /// down is the owner's action (`deleteBlocker.stillPublished`), not a sweep's. The sweep must
    /// defer to that rather than delete around it.
    func testAPublishedSampleIsLeftForTheOwnerToHandle() throws {
        let controller = PersistenceController(mode: .cloudKit, seed: true, fixtureBundle: bundle,
                                               storeURL: makeTempStoreURL(),
                                               defaults: makeTempDefaults())
        // `.cloudKit`'s seed is deferred to the sync engine, so drive it the way the hook does.
        controller.seedDemoJourneyIfFreshInstall(bundle: bundle)
        XCTAssertTrue(controller.setJourneyPublic(id: "demo-kilimanjaro", isPublic: true),
                      "precondition: the sample is published")
        _ = try insertJourney(named: "kilimanjaro", into: controller)

        let store = JourneyStore(persistence: controller)

        XCTAssertTrue(store.journeys.map(\.id).contains("demo-kilimanjaro"),
                      "a published journey must leave the showcase before anything deletes it")
    }
}
