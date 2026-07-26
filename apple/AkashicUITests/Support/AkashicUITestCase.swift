import XCTest

/// Base class for every Akashic UI test (QUA-10 / QUA-29).
///
/// ## Why a base class rather than a helper function
///
/// A UI test target runs OUT of process: it does not link the app, so nothing in `Akashic/` is
/// visible here — not `A11yID`, not `EntitlementPolicy`, not `Journey`. Everything these tests know
/// about the app they learn by launching it with a documented `AKASHIC_*` launch environment (see
/// `apple/README.md`) and reading the accessibility tree back. That makes "how do I launch the app
/// in a known state" the single most important piece of shared code in the target, and getting it
/// wrong is how a suite ends up green while testing nothing.
///
/// ## What every launch here guarantees
///
/// * **Onboarding is suppressed** (`AKASHIC_SKIP_ONBOARDING=1`). Without it a full-screen cover
///   sits over every screen and every query below finds nothing.
/// * **English** (`-AppleLanguages "(en)"`). This must be a launch ARGUMENT, never an environment
///   variable — `UserDefaults` does not read the environment, so the environment form fails
///   silently and the app comes up in the host's language looking entirely fine (see CLAUDE.md).
/// * **A fresh store per launch.** The default Debug build resolves `.fixtures`, an IN-MEMORY
///   store, so nothing a test creates survives into the next one. That is what makes the
///   create-then-hit-the-paywall sequence below deterministic rather than order-dependent.
class AkashicUITestCase: XCTestCase {

    /// Long enough for a cold launch on a loaded CI runner, short enough that a genuinely missing
    /// element fails the test today rather than after a coffee. Every wait in this target goes
    /// through this constant.
    static let timeout: TimeInterval = 30

    override func setUp() {
        super.setUp()
        // A UI test that keeps going after its first failed assertion spends the rest of its run
        // querying a screen that is not the one it thinks it is on, and reports a cascade of
        // consequences instead of the cause.
        continueAfterFailure = false
    }

    /// Launch the app with the given `AKASHIC_*` seams applied on top of the guaranteed baseline.
    ///
    /// `environment` keys are the ones documented in `apple/README.md`; nothing here invents a new
    /// seam. Returns the launched application, already `.foreground`.
    @discardableResult
    func launchApp(_ environment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launchEnvironment["AKASHIC_SKIP_ONBOARDING"] = "1"
        for (key, value) in environment {
            app.launchEnvironment[key] = value
        }
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: Self.timeout),
                      "The app never reached the foreground — nothing below this line means anything.")
        return app
    }
}

// MARK: - Assertive waiting

extension XCTestCase {

    /// Wait for `element` to exist, and FAIL if it does not.
    ///
    /// This exists because `XCUIElement.waitForExistence(for:)` returns a `Bool` that is trivially
    /// ignored, and a UI test that quietly proceeds past a missing element is worse than no test:
    /// it taps nothing, asserts nothing, and passes. Every element this target touches is fetched
    /// through here or through an explicit `XCTAssertTrue(...exists)`, never bare.
    @discardableResult
    func require(_ element: XCUIElement,
                 _ message: @autoclosure () -> String,
                 timeout: TimeInterval = AkashicUITestCase.timeout,
                 file: StaticString = #filePath,
                 line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(element.waitForExistence(timeout: timeout),
                      "Never appeared: \(message())", file: file, line: line)
        return element
    }

    /// Wait for `element` to go away (a dismissed sheet, mostly), and FAIL if it stays.
    func requireGone(_ element: XCUIElement,
                     _ message: @autoclosure () -> String,
                     timeout: TimeInterval = AkashicUITestCase.timeout,
                     file: StaticString = #filePath,
                     line: UInt = #line) {
        let gone = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "exists == false"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: timeout), .completed,
                       "Never went away: \(message())", file: file, line: line)
    }
}

// MARK: - Identifiers (mirrored, deliberately)

/// The app-side `A11yID` values, restated here.
///
/// Not shared code and not a mistake: a `bundle.ui-testing` target cannot import the app, so the
/// only alternative is compiling `A11yID.swift` into both targets — which would make a UI-test-only
/// concern a member of the app's own module graph for no benefit. The duplication is two dozen
/// string literals with a compile-time-checkable failure mode: rename one side and the test fails
/// LOUDLY at `require(...)`, which is exactly what these tests are built to do.
enum ID {
    static let globeCreateFirstJourney = "globe.createFirstJourney"

    static let chooserPhotos = "newJourney.chooser.photos"
    static let chooserGPX = "newJourney.chooser.gpx"
    static let chooserNameOnly = "newJourney.chooser.nameOnly"
    static let newJourneyName = "newJourney.name"
    static let newJourneyAddDay = "newJourney.addDay"
    static let editSheetSave = "editSheet.save"
    static let editSheetCancel = "editSheet.cancel"

    static let journeyListCreate = "journeyList.create"

    static let paywallHeadline = "paywall.headline"
    static let paywallPurchase = "paywall.purchase"
    static let paywallRestore = "paywall.restore"
    static let paywallAlreadyComplete = "paywall.alreadyComplete"
    static let paywallUnavailable = "paywall.unavailable"
    static let paywallRetry = "paywall.retry"
    static let paywallClose = "paywall.close"

    static let settingsComplete = "settings.akashicComplete"
}
