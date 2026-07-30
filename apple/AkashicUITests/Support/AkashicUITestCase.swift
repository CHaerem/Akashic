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
///
/// ## Why the whole class is `@MainActor` (QUA-08)
///
/// `XCUIApplication`, `XCUIElement` and its subscripts are all main-actor isolated in the current
/// SDK, while `XCTestCase`'s test methods are nonisolated. Under
/// `SWIFT_STRICT_CONCURRENCY=complete` that mismatch produced **218 diagnostics** across this
/// target — every `app.buttons[...]`, every `.exists`, every `.tap()`. They were 218 reports of one
/// fact, not 218 problems: a UI test drives an out-of-process app through a main-actor-isolated
/// proxy API and belongs on the main actor. Annotating the base class fixes the target, because
/// isolation is inherited by subclasses — so `CreateJourneyUITests`, `PaywallUITests` and
/// `AccessibilityAuditTests` need nothing of their own.
@MainActor
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

// `@MainActor` for the same reason as the base class: both helpers take an `XCUIElement`, and
// `waitForExistence` and `NSPredicate(format: "exists == false")` both reach main-actor-isolated
// state. Declared on the extension so the isolation covers every member without repeating it.
@MainActor
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

    /// Scroll `element` into reach and tap it.
    ///
    /// `require(_:).tap()` is not enough for a control near the bottom of a long form: `require`
    /// waits for EXISTENCE, and an element covered by the keyboard exists — the synthesized tap
    /// then lands on the keyboard, and the NEXT assertion fails as "never appeared" pointing at a
    /// screen that is perfectly fine. Measured 2026-07-29 (QUA-64): adding the free-tier budget
    /// line to the creation form pushed "Add day" one line lower, under the keyboard raised by
    /// typing the name, and three UI tests failed that way — the app was correct in every one of
    /// them. Swiping first is what a customer does; `isHittable` then holds.
    @discardableResult
    func scrollToAndTap(_ element: XCUIElement,
                        in app: XCUIApplication,
                        _ message: @autoclosure () -> String,
                        maxSwipes: Int = 4,
                        file: StaticString = #filePath,
                        line: UInt = #line) -> XCUIElement {
        let found = requireByScrolling(element, in: app, message(), file: file, line: line)
        for _ in 0..<maxSwipes where !found.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(found.isHittable, "Never became tappable: \(message())", file: file, line: line)
        found.tap()
        return found
    }

    /// Wait for `element`, scrolling to find it if the screen is too small to show it at launch —
    /// and FAIL if it never appears.
    ///
    /// This exists because `require(_:)` alone carried a hidden assumption that held on every
    /// device anyone happened to test on and broke on the first one nobody did. A SwiftUI `List`
    /// creates rows LAZILY, so a row below the fold does not exist in the accessibility hierarchy
    /// at all — `exists` is false, not merely "not hittable". Measured 2026-07-28 (QUA-56): the
    /// Settings "Akashic Complete" row exists at launch on iPhone 17 Pro and iPad, and on the
    /// iPhone SE (3rd generation) that apple-ci's device-picking happened to select, it does not —
    /// which made all four paywall/settings tests fail on CI with "Never appeared" for three days
    /// while passing on every device anyone ran locally. The app was never wrong: a customer
    /// scrolls. The tests assumed a screen size instead of doing what the customer does.
    ///
    /// The swipe count is bounded so a genuinely missing element still fails fast, and the initial
    /// wait is shorter than `AkashicUITestCase.timeout` on purpose: the generous timeout is for
    /// cold launches on a loaded CI runner, but 30 s spent waiting for a row that is merely below
    /// the fold would double every test that scrolls. 10 s is enough for the launch case measured
    /// on CI (~4 s) with headroom, and the swipes retry existence anyway.
    @discardableResult
    func requireByScrolling(_ element: XCUIElement,
                            in app: XCUIApplication,
                            _ message: @autoclosure () -> String,
                            maxSwipes: Int = 6,
                            file: StaticString = #filePath,
                            line: UInt = #line) -> XCUIElement {
        if element.waitForExistence(timeout: 10) { return element }
        for _ in 0..<maxSwipes {
            app.swipeUp()
            if element.waitForExistence(timeout: 1) { return element }
        }
        XCTFail("Never appeared, even after scrolling \(maxSwipes) screens: \(message())",
                file: file, line: line)
        return element
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

    /// QUA-90: map marker identifier PREFIXES, matched with `BEGINSWITH` rather than by equality.
    /// The guarded defect is geometric — which marker covers which — so the test enumerates markers
    /// and picks by frame overlap instead of naming one.
    static let mapCampBadgePrefix = "map.campBadge."
    static let mapPhotoStackPrefix = "map.photoStack."
}
