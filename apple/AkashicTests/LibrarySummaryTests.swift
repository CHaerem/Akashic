import XCTest
@testable import Akashic

/// The human storage one-liner on consumer Settings (§4.3): pluralization + thousands grouping.
final class LibrarySummaryTests: XCTestCase {

    func testPluralCounts() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 3, photos: 1538),
                       "3 journeys · 1,538 photos")
    }

    func testSingularCounts() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 1, photos: 1),
                       "1 journey · 1 photo")
    }

    func testZeroIsPlural() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 0, photos: 0),
                       "0 journeys · 0 photos")
    }
}
