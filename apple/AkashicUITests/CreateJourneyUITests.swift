import XCTest

/// QUA-10 — the create-journey flow, end to end.
///
/// `NewJourneySheet` is 1,188 lines and had zero direct coverage, and it is where every new
/// customer spends their first five minutes. This drives the whole shape of it: the empty globe's
/// call to action, phase 1's "what do you have?" chooser, phase 2's review screen, the Create
/// button's validity gate, and the journey actually landing on the globe afterwards.
///
/// ## What is deliberately NOT here, and why
///
/// Two of the chooser's three cards open **out-of-process system UI**: `PhotosPicker` is the
/// system photo library and `.fileImporter` is the Files browser. Both run in a separate process
/// with their own permission prompts, and a test that drives them is testing iOS, not Akashic —
/// so this suite asserts those cards EXIST and are hittable, and stops there. The photo-staging
/// and GPX-parsing logic behind them is covered by the unit suite (`JourneyDraft`, `GPXParser`,
/// `PhotoIngestService`), which is the right place for it. Saying so plainly is the point: a UI
/// test that appeared to cover the photo path but silently never opened the picker would be worse
/// than this comment.
final class CreateJourneyUITests: AkashicUITestCase {

    /// The whole name-only path, which is the one path through the sheet that needs no system UI:
    /// empty globe → chooser → review → type a name → Create → the journey exists.
    func testCreateJourneyFromNameOnlyLandsOnTheGlobe() {
        let app = launchApp(["AKASHIC_EMPTY": "1"])

        // The empty-globe front door. If this is missing, `AKASHIC_EMPTY` stopped working and
        // every "empty state" screenshot in the repo is also wrong.
        let start = require(app.buttons[ID.globeCreateFirstJourney],
                            "the empty globe's 'Start your first journey' call to action")
        start.tap()

        // Phase 1: all three ways in are offered. Asserted together because the design decision
        // under test is that photos are FIRST and promoted — a chooser that silently lost a card
        // would still pass a test that only looked for the one it needs.
        require(app.buttons[ID.chooserPhotos], "the chooser's 'Start from your photos' card")
        require(app.buttons[ID.chooserGPX], "the chooser's 'Import a GPX route' card")
        let nameOnly = require(app.buttons[ID.chooserNameOnly],
                               "the chooser's 'Start with just a name' card")
        XCTAssertTrue(app.buttons[ID.chooserPhotos].isHittable,
                      "The photos card is the promoted, least-friction way in and must be tappable.")
        nameOnly.tap()

        // Phase 2: the review screen. `Create` must be DISABLED before a name exists — the sheet's
        // own `saveDisabled: !draft.isValid` contract, and the difference between a friendly form
        // and one that fails after the tap.
        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        let create = require(app.buttons[ID.editSheetSave], "the review screen's Create button")
        XCTAssertFalse(create.isEnabled,
                       "Create must stay disabled until the journey has a name (draft.isValid).")

        name.tap()
        name.typeText("Besseggen")
        XCTAssertTrue(create.isEnabled, "Create must enable the moment the name is non-empty.")

        create.tap()

        // The sheet dismisses and the globe flies to the new journey. Assert on the sheet being
        // GONE and the journey being PRESENT — either alone would pass for the wrong reason (a
        // save that silently failed still dismisses nothing; a stuck sheet still holds a name).
        requireGone(app.textFields[ID.newJourneyName], "the review screen after a successful Create")
        require(app.staticTexts["Besseggen"],
                "the created journey's card in the globe's journey strip")
    }

    /// Cancelling must leave the store exactly as it was — the empty globe, not a half-made journey.
    func testCancellingTheReviewScreenCreatesNothing() {
        let app = launchApp(["AKASHIC_EMPTY": "1"])

        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action").tap()
        require(app.buttons[ID.chooserNameOnly], "the chooser's name-only card").tap()

        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        name.tap()
        name.typeText("Abandoned draft")

        require(app.buttons[ID.editSheetCancel], "the review screen's Cancel button").tap()
        // QUA-64: a non-empty draft now confirms before discarding — one accidental swipe or
        // mistap used to delete every staged photo file with no confirmation and no recovery.
        // The deliberate second tap IS the contract this test exists to protect.
        require(app.buttons["Discard journey"], "the discard confirmation").tap()

        requireGone(app.textFields[ID.newJourneyName], "the review screen after Cancel")
        XCTAssertFalse(app.staticTexts["Abandoned draft"].exists,
                       "A cancelled draft must not appear anywhere — the globe should be empty again.")
        // Back to the empty state, which is the proof the store is untouched rather than merely
        // that the sheet closed.
        require(app.buttons[ID.globeCreateFirstJourney],
                "the empty globe's call to action, still there after Cancel")
    }

    /// The review screen must be usable by hand as well as from a proposal: adding a day is the one
    /// structural edit available on a name-only draft, and it is 20 lines of `NewJourneySheet` that
    /// nothing had ever run.
    func testAddingDaysByHandOnANameOnlyDraft() {
        let app = launchApp(["AKASHIC_EMPTY": "1"])

        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action").tap()
        require(app.buttons[ID.chooserNameOnly], "the chooser's name-only card").tap()

        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        name.tap()
        name.typeText("Jotunheimen")

        scrollToAndTap(app.buttons[ID.newJourneyAddDay], in: app, "the 'Add day' button")
        // QUA-24 gave each day row's name field the label "Name of day <n>", which is what makes
        // this assertable at all — before that pass every day row was three anonymous buttons and
        // an unlabelled field. QUA-56's lesson applies to the rows themselves: a SwiftUI row below
        // the fold does not EXIST in the accessibility hierarchy, and QUA-64's free-tier budget
        // line made this form one line taller — so scroll like a customer instead of assuming a
        // viewport.
        requireByScrolling(app.textFields["Name of day 1"], in: app, "the first hand-added day's name field")
        scrollToAndTap(app.buttons[ID.newJourneyAddDay], in: app, "the 'Add day' button again")
        requireByScrolling(app.textFields["Name of day 2"], in: app, "the second hand-added day's name field")

        scrollToAndTap(app.buttons[ID.editSheetSave], in: app, "Create")
        requireGone(app.textFields[ID.newJourneyName], "the review screen after Create")
        require(app.staticTexts["Jotunheimen"], "the created journey on the globe")
    }
}
