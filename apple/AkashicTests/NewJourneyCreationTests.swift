import XCTest
import CoreData
@testable import Akashic

/// Creating a journey from a draft (§4.1) lands it in the store as a journey + its waypoints,
/// and the sync layer can enumerate those records — proving a locally created journey will
/// upload (zone + records) through the same seam imports and edits use.
final class NewJourneyCreationTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func controller() -> PersistenceController {
        PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
    }

    private func sampleDraft() -> JourneyDraft {
        var draft = JourneyDraft(name: "Besseggen Ridge", country: "Norway")
        draft.route = Route(type: "LineString", coordinates: [[8.8, 61.5, 1000], [8.9, 61.6, 1743]])
        draft.days = [
            DraftDay(name: "Gjendesheim", elevation: 995, coordinates: [8.8, 61.5], source: .manual),
            DraftDay(name: "Memurubu", elevation: 1008, coordinates: [8.9, 61.6], source: .manual)
        ]
        return draft
    }

    func testCreateJourneyPersistsJourneyAndWaypoints() throws {
        let pc = controller()
        let draft = sampleDraft()
        let journey = draft.makeJourney(existingSlugs: [])

        XCTAssertTrue(pc.createJourney(journey))

        let loaded = pc.loadJourneys()
        let stored = try XCTUnwrap(loaded.first { $0.id == journey.id })
        XCTAssertEqual(stored.name, "Besseggen Ridge")
        XCTAssertEqual(stored.country, "Norway")
        XCTAssertEqual(stored.camps.count, 2)
        XCTAssertEqual(stored.camps.map(\.name), ["Gjendesheim", "Memurubu"])
        XCTAssertEqual(stored.route.coordinates.count, 2)
    }

    func testSyncLayerSeesCreatedJourneyRecords() throws {
        let pc = controller()
        let journey = sampleDraft().makeJourney(existingSlugs: [])
        XCTAssertTrue(pc.createJourney(journey))

        // The initial-upload / zone-recreate paths enumerate a journey's records through this.
        let identities = pc.recordIdentities(forJourneyID: journey.id)
        XCTAssertEqual(identities.first?.recordType, RecordCoder.RecordType.journey, "journey root first")
        XCTAssertTrue(identities.first?.isJourneyRoot ?? false)
        XCTAssertEqual(identities.filter { $0.recordType == RecordCoder.RecordType.waypoint }.count, 2)
        XCTAssertEqual(identities.count, 3, "journey + two waypoints, no photos/comments yet")

        XCTAssertEqual(pc.allLocalJourneyIDs(), [journey.id])
    }

    func testCreatedSlugIsUniqueAgainstExisting() {
        let draft = JourneyDraft(name: "Kilimanjaro")
        let journey = draft.makeJourney(existingSlugs: ["kilimanjaro", "kilimanjaro-2"])
        XCTAssertEqual(journey.slug, "kilimanjaro-3")
    }
}
