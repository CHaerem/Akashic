import XCTest
@testable import Akashic

/// The human storage one-liner on consumer Settings (§4.3): pluralization + thousands grouping.
///
/// Every case pins an explicit `locale`. It used to rely on the host's, which passed only because
/// `Formatters.number` hardcoded a comma as the thousands separator — so the test agreed with the
/// bug rather than catching it. On a Simulator with a Norwegian region the *device* wanted
/// "1 538"; the app printed "1,538", which in Norwegian reads as one-point-five-three-eight.
///
/// Note what `locale:` does and does not do on `String(localized:)`: it formats the *interpolated
/// values*, but it does NOT choose which translation is loaded — that follows the bundle's
/// localizations. So these cases verify the numbers, and `StringCatalogTests` verifies the words.
final class LibrarySummaryTests: XCTestCase {

    private let en = Locale(identifier: "en_US")
    private let nb = Locale(identifier: "nb_NO")

    func testPluralCounts() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 3, photos: 1538, locale: en),
                       "3 journeys · 1,538 photos")
    }

    func testSingularCounts() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 1, photos: 1, locale: en),
                       "1 journey · 1 photo")
    }

    func testZeroIsPlural() {
        XCTAssertEqual(Formatters.librarySummary(journeys: 0, photos: 0, locale: en),
                       "0 journeys · 0 photos")
    }

    /// The counts keep their thousands grouping after the move to catalogue plurals, and take it
    /// from the locale rather than from a hardcoded comma.
    func testCountGroupingFollowsLocale() {
        let value = Formatters.librarySummary(journeys: 3, photos: 1538, locale: nb)
        XCTAssertFalse(value.contains("1,538"), "nb must not group with a comma: \(value)")
        XCTAssertTrue(value.contains("538"), "the count lost its grouping entirely: \(value)")
    }

    /// The locale-aware number formatter that feeds every elevation and distance. A hardcoded
    /// comma is not a cosmetic difference in Norwegian — `,` is the decimal separator there, so
    /// "5,895 m" reads as five point nine metres rather than as a 5 895 m summit.
    func testElevationGroupingFollowsLocale() {
        XCTAssertEqual(Formatters.meters(5895, locale: en), "5,895 m")

        let nbMeters = Formatters.meters(5895, locale: nb)
        XCTAssertFalse(nbMeters.contains(","), "nb grouped with a comma: \(nbMeters)")
        // nb groups with U+00A0, not an ordinary space, so compare on the digits instead of
        // guessing which whitespace codepoint Foundation picked.
        XCTAssertEqual(nbMeters.filter(\.isNumber), "5895")
        XCTAssertTrue(nbMeters.hasSuffix(" m"), "unexpected unit: \(nbMeters)")
    }

    /// The fractional distance was built with `String(format: "%.1f")`, which always emits a
    /// period regardless of locale — so Norwegian read "12.4 km" where the language writes "12,4".
    func testFractionalDistanceFollowsLocale() {
        XCTAssertEqual(Formatters.distanceKm(12.4, locale: en), "12.4 km")
        XCTAssertEqual(Formatters.distanceKm(12.4, locale: nb), "12,4 km")
        // A whole number still renders without a fraction in both.
        XCTAssertEqual(Formatters.distanceKm(12.0, locale: en), "12 km")
        XCTAssertEqual(Formatters.distanceKm(12.0, locale: nb), "12 km")
    }
}
