import XCTest
import CoreSpotlight
@testable import Akashic

/// Tests the pure, side-effect-free parts of `SpotlightIndexer`: item identifiers, the
/// searchable-item content built for journeys + days, and decoding a tapped Spotlight
/// activity back into a journey id. The actual `CSSearchableIndex` writes are skipped under
/// XCTest (see `SpotlightIndexer.indexingEnabled`) so nothing touches the system index here.
final class SpotlightIndexerTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func kilimanjaro() throws -> Journey {
        try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
    }

    // MARK: - Item identifiers

    func testItemIdentifierRoundTrip() {
        let journeyID = SpotlightIndexer.itemIdentifier(journeyID: "kilimanjaro")
        XCTAssertEqual(journeyID, "journey/kilimanjaro")
        XCTAssertEqual(SpotlightIndexer.journeyID(fromItemIdentifier: journeyID), "kilimanjaro")

        let dayID = SpotlightIndexer.itemIdentifier(journeyID: "abc-123", dayNumber: 4)
        XCTAssertEqual(dayID, "journey/abc-123/day/4")
        // The day identifier still resolves back to its parent journey.
        XCTAssertEqual(SpotlightIndexer.journeyID(fromItemIdentifier: dayID), "abc-123")
    }

    func testJourneyIDRejectsForeignIdentifiers() {
        XCTAssertNil(SpotlightIndexer.journeyID(fromItemIdentifier: "something/else"))
        XCTAssertNil(SpotlightIndexer.journeyID(fromItemIdentifier: "journey"))
        XCTAssertNil(SpotlightIndexer.journeyID(fromItemIdentifier: ""))
    }

    // MARK: - Searchable items

    func testSearchableItemsCoverJourneyPlusEachDay() throws {
        let journey = try kilimanjaro()
        let items = SpotlightIndexer.shared.searchableItems(for: [journey])

        // One journey item + one per camp.
        XCTAssertEqual(items.count, 1 + journey.camps.count)
        XCTAssertTrue(items.allSatisfy { $0.domainIdentifier == SpotlightIndexer.domainIdentifier })

        let journeyItem = items.first { $0.uniqueIdentifier == "journey/\(journey.id)" }
        XCTAssertNotNil(journeyItem)
        XCTAssertEqual(journeyItem?.attributeSet.title, "Kilimanjaro")
        // Country + summit surface in the description and keywords.
        XCTAssertEqual(journeyItem?.attributeSet.contentDescription?.contains("Tanzania"), true)
        XCTAssertEqual(journeyItem?.attributeSet.contentDescription?.contains("5,895 m"), true)
        let keywords = journeyItem?.attributeSet.keywords ?? []
        XCTAssertTrue(keywords.contains("Tanzania"))
        XCTAssertTrue(keywords.contains("Uhuru Peak"))
    }

    func testDayItemTitlesAndParentKeyword() throws {
        let journey = try kilimanjaro()
        let items = SpotlightIndexer.shared.searchableItems(for: [journey])
        guard let firstCamp = journey.camps.first else { return XCTFail("no camps") }

        let dayItem = items.first {
            $0.uniqueIdentifier == "journey/\(journey.id)/day/\(firstCamp.dayNumber)"
        }
        XCTAssertNotNil(dayItem)
        XCTAssertEqual(dayItem?.attributeSet.title, "Day \(firstCamp.dayNumber): \(firstCamp.name)")
        // Searching the journey name should surface its days too.
        XCTAssertEqual(dayItem?.attributeSet.keywords?.contains("Kilimanjaro"), true)
    }

    // MARK: - Deep-link decoding

    func testJourneySelectionFromSpotlightActivity() {
        let activity = NSUserActivity(activityType: CSSearchableItemActionType)
        activity.userInfo = [CSSearchableItemActivityIdentifier: "journey/inca-trail/day/2"]
        XCTAssertEqual(SpotlightIndexer.journeySelection(from: activity), "inca-trail")
    }

    func testJourneySelectionIgnoresUnrelatedActivity() {
        let wrongType = NSUserActivity(activityType: "com.example.other")
        wrongType.userInfo = [CSSearchableItemActivityIdentifier: "journey/x"]
        XCTAssertNil(SpotlightIndexer.journeySelection(from: wrongType))

        let noIdentifier = NSUserActivity(activityType: CSSearchableItemActionType)
        XCTAssertNil(SpotlightIndexer.journeySelection(from: noIdentifier))
    }
}
