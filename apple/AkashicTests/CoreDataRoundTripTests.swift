import XCTest
import CoreData
@testable import Akashic

@MainActor
final class CoreDataRoundTripTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    /// Full domain -> Core Data -> domain round-trip through an in-memory store, for ALL three
    /// fixtures. Mount Kenya's Saruni Basecamp carries a legitimate `routeDistanceKm == 0.0`,
    /// so this guards the sentinel: a `== 0 -> nil` write/read would drop that value and the
    /// round-trip would no longer be equal.
    func testJourneyRoundTripThroughCoreData() throws {
        for name in ["kilimanjaro", "mountKenya", "incaTrail"] {
            let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
            let context = controller.container.viewContext

            let original = try FixtureLoader.load(named: name, bundle: bundle)
            CoreDataMapping.upsertJourney(original, into: context)
            try context.save()

            let loaded = controller.loadJourneys()
            XCTAssertEqual(loaded.count, 1, "\(name): exactly one journey after upsert")
            let round = try XCTUnwrap(loaded.first)

            XCTAssertEqual(round, original, "\(name) did not survive the Core Data round-trip unchanged")
        }
    }

    /// A camp with `routeDistanceKm == 0.0` must survive the round-trip as `0.0`, not `nil`
    /// (the -1 sentinel distinguishes "absent" from a legitimate zero).
    func testZeroRouteDistanceSurvivesRoundTrip() throws {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let context = controller.container.viewContext

        let original = try FixtureLoader.load(named: "mountKenya", bundle: bundle)
        // Mount Kenya's safari camp stores distanceFromStart == 0.
        XCTAssertTrue(original.camps.contains { $0.routeDistanceKm == 0 },
                      "fixture precondition: a camp with routeDistanceKm == 0")
        CoreDataMapping.upsertJourney(original, into: context)
        try context.save()

        let round = try XCTUnwrap(controller.loadJourneys().first)
        let zeroCamps = round.camps.filter { $0.routeDistanceKm == 0 }
        XCTAssertEqual(zeroCamps.count, original.camps.filter { $0.routeDistanceKm == 0 }.count,
                       "zero-distance camp must not collapse to nil")
    }

    /// Upsert must be idempotent (re-seeding replaces, never duplicates, children).
    func testUpsertIsIdempotent() throws {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let context = controller.container.viewContext
        let journey = try FixtureLoader.load(named: "incaTrail", bundle: bundle)

        CoreDataMapping.upsertJourney(journey, into: context)
        try context.save()
        CoreDataMapping.upsertJourney(journey, into: context)
        try context.save()

        let journeysReq = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        let waypointsReq = NSFetchRequest<CDWaypoint>(entityName: "CDWaypoint")
        XCTAssertEqual(try context.count(for: journeysReq), 1)
        XCTAssertEqual(try context.count(for: waypointsReq), journey.camps.count)
    }

    /// S2: `journeyType` must survive a Core Data save/load unchanged — both the ordinary
    /// default and a non-default value. Before the fix, `upsertJourney` stamped every row
    /// "trek" regardless of what the domain `Journey` carried, so a "diary" input would have
    /// silently come back "trek"; that is exactly what this test would have caught.
    func testJourneyTypeSurvivesCoreDataRoundTrip() throws {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let context = controller.container.viewContext

        var trek = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        XCTAssertEqual(trek.journeyType, "trek", "fixture precondition: default journeyType")
        CoreDataMapping.upsertJourney(trek, into: context)
        try context.save()
        let loadedTrek = try XCTUnwrap(controller.loadJourneys().first { $0.id == trek.id })
        XCTAssertEqual(loadedTrek.journeyType, "trek")

        trek.journeyType = "diary"
        CoreDataMapping.upsertJourney(trek, into: context)
        try context.save()
        let loadedDiary = try XCTUnwrap(controller.loadJourneys().first { $0.id == trek.id })
        XCTAssertEqual(loadedDiary.journeyType, "diary",
                       "a non-default value must not be overwritten by a hardcoded \"trek\"")
    }

    /// The seeding path loads all three fixtures into the store.
    func testSeededStoreLoadsAllJourneys() throws {
        let controller = PersistenceController(mode: .fixtures, seed: true, fixtureBundle: bundle)
        let journeys = controller.loadJourneys()
        XCTAssertEqual(journeys.count, 3)
        XCTAssertEqual(journeys.reduce(0) { $0 + $1.camps.count }, 8 + 6 + 4)
    }
}
