import XCTest
@testable import Akashic

/// QUA-06: the Norwegian localisation is present in the *built bundle*, not merely in the source
/// catalogue.
///
/// This is the regression these tests exist for. `Localizable.xcstrings` can be perfect and the
/// app still ship English-only in any of several silent ways: `knownRegions` losing `nb` in
/// `project.yml` (XcodeGen infers regions from `.lproj` folders, and a String Catalog has none, so
/// the list is declared by hand); the catalogue being classified into the wrong build phase by the
/// `path: Akashic` source sweep; or `AppShortcuts.xcstrings` being renamed — App Intents phrase
/// localisation looks for that exact filename and silently finds nothing otherwise. Every one of
/// those produces a binary that builds, runs, passes every other test, and is not translated.
///
/// So these assertions read the compiled artifacts out of `Bundle.main` (the test host app) rather
/// than the source files.
final class StringCatalogTests: XCTestCase {

    private var nbBundle: Bundle {
        get throws {
            let path = try XCTUnwrap(Bundle.main.path(forResource: "nb", ofType: "lproj"),
                                     "nb.lproj is missing from the built app — check `knownRegions` in project.yml")
            return try XCTUnwrap(Bundle(path: path), "nb.lproj is not a loadable bundle")
        }
    }

    func testNorwegianIsAShippedLocalization() {
        XCTAssertTrue(Bundle.main.localizations.contains("nb"),
                      "built app claims only: \(Bundle.main.localizations)")
    }

    /// A spread across the screens the store listing sells: the tab bar, a stat caption, the
    /// paywall, and a weather label built in a helper rather than at a `Text`.
    func testCoreScreensAreTranslated() throws {
        let nb = try nbBundle
        let expected = [
            "Explore": "Utforsk",
            "Journeys": "Turer",
            "Settings": "Innstillinger",
            "Summit": "Topp",
            "Unlock everything, once": "Lås opp alt, én gang",
            "Heavy snow": "Kraftig snø",
            // Difficulty follows DNT's own trail grades, which is the point of translating it
            // rather than transliterating it.
            "Hard": "Krevende",
        ]
        for (key, value) in expected {
            XCTAssertEqual(nb.localizedString(forKey: key, value: nil, table: "Localizable"), value,
                           "key \(key.debugDescription) is not translated in the built bundle")
        }
    }

    /// The plural forms compile to a `.stringsdict` beside the `.strings`, and Norwegian inflects
/// the noun ("bilde" → "bilder"), so a `count == 1 ? "" : "s"` at the call site could never have
    /// produced it.
    func testPluralsCompiledAndInflect() throws {
        let nb = try nbBundle
        let format = nb.localizedString(forKey: "%lld photos", value: nil, table: "Localizable")
        let one = String.localizedStringWithFormat(format, 1)
        let many = String.localizedStringWithFormat(format, 4)
        XCTAssertTrue(one.contains("bilde"), "singular not Norwegian: \(one)")
        XCTAssertFalse(one.contains("bilder"), "singular used the plural form: \(one)")
        XCTAssertTrue(many.contains("bilder"), "plural not Norwegian: \(many)")
    }

    /// The Siri phrases live in their own table because App Intents will not look anywhere else.
    /// Two of them used to be hand-written Norwegian sitting in the English source array — "List
    /// mine reiser i Akashic" (an English verb on a Norwegian object) and "Søk i reiser i Akashic"
    /// ("i … i …" twice in five words). Both are gone from the source; the translations are here.
    func testSiriPhrasesAreTranslatedInTheirOwnTable() throws {
        let nb = try nbBundle
        let key = "List my journeys in ${applicationName}"
        let value = nb.localizedString(forKey: key, value: nil, table: "AppShortcuts")
        XCTAssertEqual(value, "Vis turene mine i ${applicationName}",
                       "AppShortcuts.strings is missing or untranslated in nb.lproj")
        XCTAssertTrue(value.contains("${applicationName}"),
                      "the application-name token must survive translation: \(value)")
    }

    /// Nothing in the app should still be reaching for the two grammatically broken Norwegian
    /// phrases that used to be compiled into the English phrase list.
    func testBrokenNorwegianPhrasesAreGone() throws {
        let nb = try nbBundle
        for broken in ["List mine reiser i ${applicationName}", "Søk i reiser i ${applicationName}"] {
            // `localizedString(forKey:)` echoes the key back when there is no entry, which is
            // exactly what "this phrase no longer exists" looks like.
            XCTAssertEqual(nb.localizedString(forKey: broken, value: nil, table: "AppShortcuts"),
                           broken,
                           "the broken phrase is still carried in the catalogue")
        }
    }

    /// The difficulty token stays English on purpose — it is persisted in the export JSON, it is
    /// what `StatsView.difficultyColor` switches on, and it is what a saved Shortcut compares
    /// against. Translating it at the source would have turned every Norwegian journey's badge
    /// green (the `default:` case) and broken saved automations.
    func testDifficultyTokenIsNotTranslatedAtTheSource() {
        // score 0: 5 km/day, 300 m max gain, 1 000 m total.
        XCTAssertEqual(
            ExtendedStatsCalculator.calculateDifficultyRating(35, 500, 500, 5, 300),
            "Easy")
        // score 4: 16 km/day (+2) and 1 200 m max daily gain (+2).
        XCTAssertEqual(
            ExtendedStatsCalculator.calculateDifficultyRating(112, 2000, 2000, 16, 1200),
            "Hard")
    }

    /// …and it becomes prose at the display seam instead, which is where the catalogue can reach
    /// it. This is the pair of behaviours that has to hold together: an English token in the data,
    /// Norwegian on screen.
    func testDifficultyIsTranslatedAtTheDisplaySeam() throws {
        let nb = try nbBundle
        XCTAssertEqual(nb.localizedString(forKey: "Hard", value: nil, table: "Localizable"),
                       "Krevende")
        XCTAssertEqual(nb.localizedString(forKey: "Easy", value: nil, table: "Localizable"),
                       "Enkel")
    }
}
