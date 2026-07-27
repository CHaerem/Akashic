import XCTest
import CoreData
@testable import Akashic

/// Assisted creation §5 — manual photo placement. The write goes through the existing photo-edit
/// path and must land `coordinates` + `locationSource = "manual"`; the placement sheet's start
/// resolution prefers the photo's own coordinate, then a fallback; and drafted facts append onto a
/// day's waypoint without clobbering existing content.
@MainActor
final class PlacementTests: XCTestCase {

    private var bundleForTests: Bundle { Bundle(for: type(of: self)) }

    private func controller() -> PersistenceController {
        let pc = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundleForTests)
        CoreDataMapping.upsertJourney(Self.sampleJourney(), into: pc.viewContext)
        try? pc.viewContext.save()
        return pc
    }

    private func makePhoto(id: String) -> Photo {
        Photo(id: id, journeyId: "J1", waypointId: nil, url: "u", thumbnailURL: nil, caption: nil,
              coordinates: nil, takenAt: nil, locationSource: nil)
    }

    // MARK: Manual location write shape

    func testManualPlacementWritesCoordinatesAndManualSource() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))

        let updated = try XCTUnwrap(pc.setPhotoLocation(id: "P1", coordinates: [37.35, -3.07], source: "manual"))
        XCTAssertEqual(updated.coordinates ?? [], [37.35, -3.07])
        XCTAssertEqual(updated.locationSource, "manual")

        let reloaded = pc.loadPhotos(forJourneyID: "J1").first { $0.id == "P1" }
        XCTAssertEqual(reloaded?.coordinates ?? [], [37.35, -3.07])
        XCTAssertEqual(reloaded?.locationSource, "manual")
    }

    @MainActor
    func testStoreWrapperDefaultsToManualAndClearsSourceOnNil() throws {
        let pc = controller()
        pc.insertPhoto(makePhoto(id: "P1"))
        let store = JourneyStore(persistence: pc)

        let placed = try XCTUnwrap(store.setPhotoLocation([10, 60], forPhoto: "P1"))
        XCTAssertEqual(placed.locationSource, "manual", "the placement path stamps manual provenance")

        let cleared = try XCTUnwrap(store.setPhotoLocation(nil, forPhoto: "P1"))
        XCTAssertNil(cleared.coordinates)
        XCTAssertNil(cleared.locationSource)
    }

    // MARK: Start resolution

    func testPlacementStartPrefersPhotoThenFallback() {
        let fromPhoto = PhotoPlacementSheet.resolveStart([37.35, -3.07], [1, 1])
        XCTAssertEqual(fromPhoto.latitude, -3.07, accuracy: 1e-9)
        XCTAssertEqual(fromPhoto.longitude, 37.35, accuracy: 1e-9)

        let fromFallback = PhotoPlacementSheet.resolveStart(nil, [5, 6])
        XCTAssertEqual(fromFallback.latitude, 6, accuracy: 1e-9)
        XCTAssertEqual(fromFallback.longitude, 5, accuracy: 1e-9)

        let zero = PhotoPlacementSheet.resolveStart(nil, nil)
        XCTAssertEqual(zero.latitude, 0)
    }

    // MARK: Drafted facts append onto a day

    func testAddDayContentAppendsWithoutClobbering() {
        let pc = controller()
        let firstFact = FunFact(id: "f1", content: "Original", category: "general", source: nil,
                                learnMoreUrl: nil, icon: nil)
        XCTAssertTrue(pc.addDayContent(waypointID: "W1", funFacts: [firstFact], historicalSites: []))

        let drafted = FunFact(id: "f2", content: "Drafted", category: "general",
                              source: "Apple Intelligence", learnMoreUrl: nil, icon: nil)
        let site = HistoricalSite(id: "s1", name: "Barafu Camp", coordinates: nil, elevation: nil,
                                  routeDistanceKm: nil, summary: "A high camp.", description: nil,
                                  period: nil, significance: nil, imageUrls: nil, links: nil,
                                  tags: nil, dayNumber: 1)
        XCTAssertTrue(pc.addDayContent(waypointID: "W1", funFacts: [drafted], historicalSites: [site]))

        let camp = pc.loadJourneys().first { $0.id == "J1" }?.camps.first { $0.id == "W1" }
        XCTAssertEqual(camp?.funFacts?.map(\.content), ["Original", "Drafted"], "appends, keeps existing")
        XCTAssertEqual(camp?.historicalSites?.map(\.name), ["Barafu Camp"])
    }

    // MARK: Fixture

    private static func sampleJourney() -> Journey {
        let camp = Camp(id: "W1", name: "Day 1", dayNumber: 1, elevation: 1800,
                        coordinates: [37.30, -3.10], notes: "", highlights: [])
        return Journey(id: "J1", slug: "j1", name: "Kilimanjaro", country: "Tanzania",
                       description: "", heroImageURL: nil, dateStarted: nil, dateEnded: nil,
                       summitElevation: nil, totalDistance: nil, totalDays: nil,
                       centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
                       stats: TrekStats(duration: 1, totalDistance: 0, totalElevationGain: 0,
                                        totalElevationLoss: nil, highestPoint: nil),
                       route: .empty, camps: [camp])
    }
}
