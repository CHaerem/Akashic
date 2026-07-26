import XCTest
@testable import Akashic

/// `Formatters.dayDate` — shared by `DayDetailSheet` and `JourneyStoryView` (S1) so both name a
/// day's calendar date identically. Extracted from `DayDetailSheet`'s own (previously private,
/// duplicated-in-spirit) date arithmetic.
///
/// QUA-06 pinned the locale in every case. The formatter used to be fixed to `en_US_POSIX` with a
/// literal "MMM d, yyyy" pattern — a *parsing* locale, deliberately frozen, used for text a
/// customer reads, which meant Norwegian got the American field order and punctuation. It now
/// builds the format from a template for the given locale, so the locale has to be stated for the
/// expectations to mean anything.
final class DayDateTests: XCTestCase {

    private let en = Locale(identifier: "en_US")
    private let nb = Locale(identifier: "nb_NO")

    func testFirstDayMatchesStartDate() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2024-06-01", dayNumber: 1, locale: en),
                       "Jun 1, 2024")
    }

    func testLaterDayAddsOffset() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2024-06-01", dayNumber: 5, locale: en),
                       "Jun 5, 2024")
    }

    func testCrossesMonthAndYearBoundaries() {
        XCTAssertEqual(Formatters.dayDate(dateStarted: "2023-12-30", dayNumber: 3, locale: en),
                       "Jan 1, 2024")
    }

    func testNilStartDateYieldsNil() {
        XCTAssertNil(Formatters.dayDate(dateStarted: nil, dayNumber: 1, locale: en))
    }

    func testMalformedStartDateYieldsNil() {
        XCTAssertNil(Formatters.dayDate(dateStarted: "not-a-date", dayNumber: 1, locale: en))
    }

    /// The day arithmetic is UTC (matching `DateOnly`'s day boundaries) and must stay UTC when the
    /// formatter reads it back, or a device west of Greenwich renders Day 1 as the previous date.
    /// Changing the locale must not disturb that.
    func testNorwegianUsesNorwegianWordingAndKeepsTheSameDay() {
        let value = Formatters.dayDate(dateStarted: "2024-06-01", dayNumber: 1, locale: nb)
        XCTAssertNotNil(value)
        // Norwegian writes the day first, with an ordinal period, and lowercases the month.
        XCTAssertTrue(value?.hasPrefix("1.") == true, "unexpected nb day date: \(value ?? "nil")")
        XCTAssertTrue(value?.contains("2024") == true, "unexpected nb day date: \(value ?? "nil")")
        XCTAssertFalse(value?.contains("Jun") == true, "month was not localised: \(value ?? "nil")")
    }

    /// A journey's date range on the list/detail header.
    func testDateRangeFollowsLocale() {
        XCTAssertEqual(Formatters.dateRange("2023-09-29", "2023-10-09", locale: en),
                       "Sep 29 – Oct 9, 2023")
        let nbValue = Formatters.dateRange("2023-09-29", "2023-10-09", locale: nb)
        XCTAssertTrue(nbValue?.hasPrefix("29.") == true, "unexpected nb range: \(nbValue ?? "nil")")
        XCTAssertFalse(nbValue?.contains("Sep") == true, "month was not localised: \(nbValue ?? "nil")")
    }
}
