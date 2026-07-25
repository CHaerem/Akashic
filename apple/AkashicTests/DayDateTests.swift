import XCTest
@testable import Akashic

/// `Formatters.dayDate` — shared by `DayDetailSheet` and `JourneyStoryView` (S1) so both name a
/// day's calendar date identically. Extracted from `DayDetailSheet`'s own (previously private,
/// duplicated-in-spirit) date arithmetic.
final class DayDateTests: XCTestCase {

    func testFirstDayMatchesStartDate() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2024-06-01", dayNumber: 1), "Jun 1, 2024")
    }

    func testLaterDayAddsOffset() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2024-06-01", dayNumber: 5), "Jun 5, 2024")
    }

    func testCrossesMonthAndYearBoundaries() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2023-12-30", dayNumber: 3), "Jan 1, 2024")
    }

    func testNilStartDateYieldsNil() {
        XCTAssertNil(Formatters.dayDate(dateStarted: nil, dayNumber: 1))
    }

    func testMalformedStartDateYieldsNil() {
        XCTAssertNil(Formatters.dayDate(dateStarted: "not-a-date", dayNumber: 1))
    }
}
