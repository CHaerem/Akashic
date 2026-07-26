import XCTest

/// QUA-10 — the paywall's states, and the free-tier wall that leads to them.
///
/// `PaywallView` was at 1/594 covered lines. It is the one screen in a paid app that gets a single
/// shot at making its case, and the entitlement gates around it decide whether a customer who has
/// already paid can get back in.
///
/// ## What can and cannot be reached here
///
/// **Reached and asserted:** the `.settings` and `.journeyLimit` entry points, the offline/
/// unconfigured purchase surface with its retry, the restore control, the legal links, dismissal,
/// and — the one that matters most — that an entitled customer is never shown a live buy button.
///
/// **Not reached, and this is a real limitation rather than an omission:** the *priced* surface, the
/// branch that draws "Unlock Akashic Complete for kr 149,00". `apple/Akashic/Store/Akashic.storekit`
/// exists and `project.yml`'s scheme points the RUN action at it, but XcodeGen 2.45.4 writes
/// `StoreKitConfigurationFileReference` into the scheme's `LaunchAction` only — never into the
/// `TestAction` — so under `xcodebuild test` the app has no local store, `Product.products(for:)`
/// returns an empty array, and `EntitlementStore.product` stays nil. Verified by inspecting the
/// generated `.xcscheme` and again by reading the live tree (it renders `paywall.unavailable`).
/// `StoreKitProvider.purchase()` therefore remains uncovered by these tests, and completing a
/// purchase would additionally require driving StoreKit's own confirmation sheet, which is
/// out-of-process. Asserting the unpriced branch and saying so is the honest half of that.
final class PaywallUITests: AkashicUITestCase {

    // MARK: - The Settings entry point

    /// The `.settings` reason, and the contract that matters when the store is unreachable: the
    /// sheet must degrade, never brick. `PaywallView`'s own doc comment promises "graceful
    /// loading/offline states (offline must not brick — it shows a retry, never a dead sheet)", and
    /// that promise had never been executed.
    func testSettingsPaywallShowsItsReasonAndOffersAWayForward() {
        let app = launchApp(["AKASHIC_SCREEN": "settings"])

        let row = require(app.buttons[ID.settingsComplete], "the Settings 'Akashic Complete' row")
        XCTAssertTrue(row.isEnabled, "A free-tier customer must be able to open the paywall.")
        XCTAssertTrue(row.label.contains("Free"),
                      "The membership row should read Free before a purchase, not \"\(row.label)\".")
        row.tap()

        // The headline is the only thing on the sheet that says WHY it appeared, so it is what
        // proves the `.settings` reason was routed rather than one of the limit reasons.
        let headline = require(app.staticTexts[ID.paywallHeadline], "the paywall's headline")
        XCTAssertEqual(headline.label, "Unlock everything, once",
                       "The Settings route must show the `.settings` headline.")

        // Not a dead sheet: the store is unreachable under `xcodebuild test` (see the class comment),
        // and the sheet is required to say so AND offer a retry rather than sit on a spinner.
        require(app.staticTexts[ID.paywallUnavailable],
                "the 'isn't available here yet' explanation for an unreachable store")
        let retry = require(app.buttons[ID.paywallRetry], "the retry control beside that explanation")
        XCTAssertTrue(retry.isEnabled, "The only way out of the offline state must be tappable.")
        // QUA-29 measured this at 90 × 19.7 pt before the fix. Asserted here, not only in the audit,
        // so shrinking it back fails a test whose name says what broke.
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44,
                                    "The retry control must meet the 44 pt minimum hit target.")
        retry.tap()   // idempotent: it re-runs `loadProduct()`, which fails the same way
        require(app.staticTexts[ID.paywallUnavailable], "the same honest row after retrying")

        // No buy button while there is no price — a purchase button with no price attached would be
        // the wrong-state purchase surface in its other form.
        XCTAssertFalse(app.buttons[ID.paywallPurchase].exists,
                       "There must be no purchase button while no product has loaded.")

        // Restore is how an existing customer gets back in on a new device, and App Review looks for
        // it specifically. It must be present and usable even when the product did not load.
        let restore = require(app.buttons[ID.paywallRestore], "the 'Restore purchases' control")
        XCTAssertTrue(restore.isEnabled)
        XCTAssertGreaterThanOrEqual(restore.frame.height, 44,
                                    "Restore purchases must meet the 44 pt minimum hit target.")

        // Terms and Privacy, both required on a paid app's purchase surface.
        require(app.buttons["Terms"], "the Terms link")
        require(app.buttons["Privacy"], "the Privacy link")

        // Always dismissible: no dark patterns, per the view's own contract.
        require(app.buttons[ID.paywallClose], "the paywall's Close button").tap()
        requireGone(app.staticTexts[ID.paywallHeadline], "the paywall after Close")
        require(app.buttons[ID.settingsComplete], "Settings, back in view after dismissing")
    }

    // MARK: - The free-tier wall

    /// The wall itself: create the free tier's one journey through the UI, then try to create a
    /// second. This is the sequence a real customer performs, and it is only deterministic because
    /// the default Debug build runs the in-memory fixtures store and the bundled demo journeys are
    /// exempt from `billableOwnedJourneyCount` — so the journey created HERE is the first billable
    /// one, and the second attempt is the first that can hit the limit.
    func testSecondJourneyOnTheFreeTierHitsTheJourneyLimitPaywall() {
        let app = launchApp(["AKASHIC_EMPTY": "1"])

        // Journey one: allowed.
        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action").tap()
        require(app.buttons[ID.chooserNameOnly], "the chooser's name-only card").tap()
        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        name.tap()
        name.typeText("Besseggen")
        require(app.buttons[ID.editSheetSave], "Create").tap()
        require(app.staticTexts["Besseggen"], "the created journey on the globe")

        // Journey two: the wall. Reached from the journeys list, because the globe's own call to
        // action is only drawn while the store is empty.
        require(app.buttons["Journeys"], "the globe's Journeys button").tap()
        require(app.buttons[ID.journeyListCreate], "the journeys list's '+' button").tap()

        let headline = require(app.staticTexts[ID.paywallHeadline],
                               "the paywall, presented instead of a second creation sheet")
        XCTAssertEqual(headline.label, "The free tier includes one journey",
                       "Hitting the journey limit must show the `.journeyLimit` headline.")
        // The important half: the creation sheet must NOT also be up. A gate that presents the
        // paywall and the sheet together lets the user through the wall by dismissing one of them.
        XCTAssertFalse(app.textFields[ID.newJourneyName].exists,
                       "The creation sheet must not be presented once the free limit is reached.")
    }

    /// The other side of the same gate: Akashic Complete must actually remove the wall. This is what
    /// the customer paid for, and a regression here is indistinguishable from theft.
    func testCompleteRemovesTheJourneyLimit() {
        // `AKASHIC_COMPLETE=1` simulates the entitlement in DEBUG builds only — in Release the
        // override is compiled out entirely, which is why this cannot be used to bypass the paywall
        // in anything shipped (see `EntitlementOverride`).
        let app = launchApp(["AKASHIC_EMPTY": "1", "AKASHIC_COMPLETE": "1"])

        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action").tap()
        require(app.buttons[ID.chooserNameOnly], "the chooser's name-only card").tap()
        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        name.tap()
        name.typeText("Besseggen")
        require(app.buttons[ID.editSheetSave], "Create").tap()
        require(app.staticTexts["Besseggen"], "the first created journey")

        require(app.buttons["Journeys"], "the globe's Journeys button").tap()
        require(app.buttons[ID.journeyListCreate], "the journeys list's '+' button").tap()

        // The creation sheet, NOT the paywall — the same tap that walls a free user through.
        require(app.buttons[ID.chooserNameOnly],
                "the creation chooser for a second journey, which Complete must allow")
        XCTAssertFalse(app.staticTexts[ID.paywallHeadline].exists,
                       "An entitled customer must never be shown the journey-limit paywall.")
    }

    /// An entitled customer must never be offered a live purchase surface for something they own —
    /// a wrong-state purchase UI, and a reviewer red flag. The Settings row is the gate that
    /// enforces it, and it enforces it by refusing to present the sheet at all.
    func testEntitledCustomerIsNeverOfferedAPurchaseSurface() {
        let app = launchApp(["AKASHIC_SCREEN": "settings", "AKASHIC_COMPLETE": "1"])

        let row = require(app.buttons[ID.settingsComplete], "the Settings 'Akashic Complete' row")
        XCTAssertTrue(row.label.contains("Complete"),
                      "The membership row must state the entitlement, not \"\(row.label)\".")
        XCTAssertFalse(row.isEnabled,
                       "The row must be disabled for an owner — it is a status, not a way to buy again.")

        row.tap()   // a no-op by construction; asserted rather than assumed
        XCTAssertFalse(app.staticTexts[ID.paywallHeadline].waitForExistence(timeout: 3),
                       "Tapping the membership row as an owner must present nothing at all.")
        XCTAssertFalse(app.buttons[ID.paywallPurchase].exists,
                       "An owner must never see a purchase button.")
    }
}
