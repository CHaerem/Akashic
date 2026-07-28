import XCTest

/// QUA-29 — `XCUIApplication.performAccessibilityAudit()` over the app's main screens.
///
/// ## Why this test exists at all
///
/// The accessibility pass (QUA-07 / QUA-24) added labels across seven directories, took
/// `accessibilityValue` from 0 to 18, and built a real `AXChartDescriptor` — and could verify none
/// of it **by navigation**. Accessibility Inspector is a macOS GUI app with no scriptable
/// interface, and driving the simulator interactively needed a permission nobody was present to
/// grant. That agent asserted labels existed in the built bundle and refused to claim any screen
/// was navigable, which was the right call and a permanent gap rather than bad luck: every
/// autonomous run hits it identically.
///
/// `performAccessibilityAudit()` is the programmatic form of exactly that audit, and it needed a
/// `bundle.ui-testing` target to live in. This file is the finish line.
///
/// ## What the audit actually checks
///
/// `.all` is contrast, element detection, hit region (the 44×44 pt minimum), sufficient element
/// description, dynamic type, clipped text, and trait correctness — evaluated against the LIVE
/// accessibility tree of a running app, which is the thing no static check can see.
///
/// ## How findings are handled
///
/// Every screen is audited with `.all` — no audit type is switched off, because switching one off
/// removes the check for every future screen too. Findings land in one of three buckets, and which
/// bucket is the whole of the triage:
///
///   1. **Fixed in the view.** Seven sub-44 pt hit targets: four on the paywall (including "Restore
///      purchases" at 131 × 18 pt), two on the create-journey review screen (including
///      "Remove day 1" at 17 × 17 pt, which deletes a day), and one — QUA-55 — on `DraftMapCard`'s
///      "Route options" menu at 104.5 × 14.5 pt, the only way to replace or remove a route. After
///      those fixes, `hitRegion` reports nothing app-owned on any of these screens.
///   2. **Excused by `deliberate(_:)`**, which names the element and the reason. Two entries, both
///      MapKit's own drawing rather than anything in the app's view tree.
///   3. **Reported but not enforced** — see `audit(_:screen:)`, which explains exactly which three
///      audit types those are, how many findings each produced, the measured contrast ratios behind
///      them, and the condition for moving each one into `enforced`.
///
/// The distinction matters more than the count: this suite is green on the four audit types that ask
/// structural questions, and it prints the rest in full on every run rather than pretending they are
/// not there.
final class AccessibilityAuditTests: AkashicUITestCase {

    // MARK: - The screens

    /// The landing screen with the family's journeys on it — the first thing anyone sees.
    func testGlobeWithJourneysClearsTheEnforcedAudit() throws {
        let app = launchApp()
        require(app.staticTexts["Akashic"], "the globe's wordmark, i.e. the globe actually rendered")
        try audit(app, screen: "globe (journeys present)")
    }

    /// The same screen for a brand-new customer. A separate case because it is a different view
    /// hierarchy — the journey strip is replaced by the empty state's call to action — and because
    /// "the first screen of a fresh install" is the one that has to be right.
    func testEmptyGlobeClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_EMPTY": "1"])
        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action")
        try audit(app, screen: "globe (empty, first launch)")
    }

    /// A day view: the day sheet over the trek map, reached through the documented scene seam
    /// rather than by tapping a pin (a map pin's hit target moves with the camera animation, which
    /// would make this test's SETUP the flakiest thing about it).
    func testDayViewClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_OPEN": "kilimanjaro", "AKASHIC_SCENE": "day3"])
        // The day sheet carries the day's own heading; waiting on the wordmark would pass while the
        // sheet was still animating up and audit the map underneath it instead.
        require(app.staticTexts["Kilimanjaro"], "the trek map's journey title")
        try audit(app, screen: "day view (Kilimanjaro, day 3)")
    }

    /// The paywall — the one screen in a paid app that has a single shot at making its case.
    func testPaywallClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_SCREEN": "settings"])
        requireByScrolling(app.buttons[ID.settingsComplete], in: app,
                           "the Settings 'Akashic Complete' row").tap()
        require(app.staticTexts[ID.paywallHeadline], "the paywall's headline")
        try audit(app, screen: "paywall")
    }

    /// The create-journey flow, both phases. One test rather than two because phase 2 is only
    /// reachable through phase 1, so splitting them would double the launch cost to audit the same
    /// two hierarchies.
    ///
    /// **QUA-55: this test's result depends on the DESTINATION, and that is how a real defect hid.**
    /// `DraftMapCard`'s "Route options" menu was 14.5 pt tall and this test passed anyway from the day
    /// the audit landed, because every run had happened to pick an iPhone. Measured on one commit,
    /// both directions: on iPad (A16) phase 2 reports 24 findings and the menu's button sits at
    /// y = 143; on iPhone 17 Pro it reports 13 and the same button sits at **y = −113** — tapping
    /// "Add day" scrolls the ROUTE field off the top, so the control was not merely passing there, it
    /// was never examined. The topmost element iPhone reports is COUNTRY, the field *below* ROUTE,
    /// which is the tell.
    ///
    /// This is QUA-56's lesson a second time and it is worth stating as a rule: **the audit's coverage
    /// is exactly as deep as the tests scroll, and exactly as wide as the destinations they run on.**
    /// QUA-56 found the same shape vertically — the bottom of Settings had never been audited, and
    /// scrolling to it immediately found a real `.sufficientElementDescription` defect. So a green run
    /// on one simulator is not evidence about any other, and the reported-only totals in
    /// `audit(_:screen:)` are per-destination rather than absolute. Note that CI's `ids[-1]` picks an
    /// iPhone SE, which is the shortest screen and therefore audits *less* of this form than either
    /// device above: run a tall destination too before believing this suite is clean.
    func testCreateJourneyFlowClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_EMPTY": "1"])
        require(app.buttons[ID.globeCreateFirstJourney], "the empty globe's call to action").tap()

        require(app.buttons[ID.chooserNameOnly], "the chooser's name-only card")
        try audit(app, screen: "new journey — chooser (phase 1)")

        app.buttons[ID.chooserNameOnly].tap()
        let name = require(app.textFields[ID.newJourneyName], "the review screen's Name field")
        // Audit the review screen with CONTENT in it: an empty draft hides the day rows, the
        // suggestion rows and the nudges, which is most of what QUA-24 labelled.
        name.tap()
        name.typeText("Besseggen")
        require(app.buttons[ID.newJourneyAddDay], "the 'Add day' button").tap()
        require(app.textFields["Name of day 1"], "the first day row")
        try audit(app, screen: "new journey — review (phase 2, one day)")
    }

    /// Settings: the screen that carries the sync one-liner, the appearance picker and the
    /// membership row, and the one a localisation change most needs to be right on.
    func testSettingsClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_SCREEN": "settings"])
        // On small screens this scrolls, so the audit below sees the BOTTOM of Settings there and
        // the top elsewhere. That is inherent to auditing a live tree on differently-sized screens,
        // and honest: performAccessibilityAudit only ever audits what is currently instantiated.
        requireByScrolling(app.buttons[ID.settingsComplete], in: app,
                           "the Settings 'Akashic Complete' row")
        try audit(app, screen: "settings")
    }

    /// Stats — the screen QUA-07 built the `AXChartDescriptor` for, which is precisely the kind of
    /// claim that could only ever be checked by an audit against a live tree.
    func testStatsClearsTheEnforcedAudit() throws {
        let app = launchApp(["AKASHIC_TAB": "1"])
        require(app.navigationBars.firstMatch, "the Stats tab's navigation bar")
        try audit(app, screen: "stats")
    }

    // MARK: - Triage

    /// The audit types this suite FAILS on. All four ask structural questions about the
    /// accessibility tree rather than measuring rendered pixels, which is both why they are the
    /// classes QUA-07/QUA-24 worked in and why they are stable across OS versions:
    ///
    ///   * `.sufficientElementDescription` — an element with no usable label. This is the exact
    ///     defect class QUA-24 fixed by hand and could not verify by navigation. It reports **zero**
    ///     findings on all eight screens below, which is that pass finally checked rather than
    ///     asserted.
    ///   * `.trait` — a control that does not announce as one. Also zero, which is `PhotosPicker`'s
    ///     hand-added `.isButton` trait actually holding at runtime.
    ///   * `.hitRegion` — a target under 44 × 44 pt. Found **seven** real defects across three
    ///     files, not one: "Restore purchases" at 131 × 18 pt and the store-unreachable retry at
    ///     90 × 19.7 pt in `PaywallView`; "Edit dates" at 23 × 14 pt plus **"Remove day 1" at
    ///     17 × 17 pt — a control that deletes a day** in `NewJourneySheet`; and **"Route options" at
    ///     104.5 × 14.5 pt — a menu that replaces or removes the route** in `DraftMapCard` (QUA-55).
    ///     All seven are fixed with `.frame(minWidth/minHeight: 44)` and a `contentShape`, because
    ///     growing the frame without the shape leaves the extra area untappable and the audit still
    ///     passing.
    ///   * `.elementDetection` — pixels that look like text with no element behind them.
    static let enforced: XCUIAccessibilityAuditType = [
        .sufficientElementDescription, .trait, .hitRegion, .elementDetection,
    ]

    /// Run the audit, fail on `enforced` findings, and print everything else in full.
    ///
    /// ## Why three of the seven audit types are reported rather than enforced
    ///
    /// `.contrast`, `.dynamicType` and `.textClipped` produce **124 findings across these eight
    /// audited hierarchies** — 62 / 43 / 19, stable across repeated runs on iOS 26.5. They are not
    /// 124 bugs; they are three systemic design decisions, each traceable to one seam:
    ///
    /// Treat those totals as a measurement with a date on it, not a fact. They are prose, so unlike
    /// an assertion they cannot go red — they go stale silently, and the next reader believes them.
    /// This very list said 123 and "61 contrast" until the merge that brought QUA-10 and QUA-31 into
    /// one tree measured 62; the likeliest cause is that the count predates the last of the six
    /// `.hitRegion` fixes above, since padding a frame out to 44 pt can bring a label that was too
    /// small to evaluate into contrast range. Re-measure rather than trusting the number:
    ///
    /// ```
    /// xcodebuild ... -only-testing:AkashicUITests/AccessibilityAuditTests test 2>&1 \
    ///   | grep -oE '^• \[[a-zA-Z]+\]' | sort | uniq -c
    /// ```
    ///
    ///   * **contrast (62: outright plus large-text-only)** is `Theme.textSecondary` and
    ///     `Theme.textTertiary`, which are Apple's own `.secondaryLabel` (3.45:1 over
    ///     `systemBackground` in Light Mode) and `.tertiaryLabel` (1.74:1), plus `Theme.accent` used
    ///     as text (2.45:1). `Theme` already answers Increase Contrast by stepping every tier up a
    ///     level, and the audit does not simulate that setting — so it measures the app in its
    ///     lowest-contrast configuration only. `StatsView`'s own palette note also records that its
    ///     coloured values were checked against the 3:1 floor for `.title3`, which WCAG allows for
    ///     large text and this audit does not. Fixing the rest properly means re-tuning three
    ///     semantic tiers and the brand accent across ~200 call sites in both appearances: a design
    ///     change with an owner-visible result, not a mechanical edit, and emphatically not something
    ///     to land quietly inside a test commit.
    ///   * **dynamicType (43)** is mostly the immersive map chrome, which deliberately caps at
    ///     `.dynamicTypeSize(...xxLarge)` (see `GlobeExperienceView.overlays`) because past that the
    ///     chrome drowns the map that is the point of the screen — plus `GlassField`'s fixed
    ///     `.system(size: 11)` field headings and the navigation-bar buttons iOS does not scale.
    ///   * **textClipped (19)** is `.lineLimit(1)` with `.minimumScaleFactor(...)`, which `StatChip`
    ///     and `StatChipRow` document at length as the deliberate answer to a Norwegian caption that
    ///     would otherwise change a chip's height and flip a `ViewThatFits` decision.
    ///
    /// Excusing them through `deliberate` would be dishonest — they are real, they are just not this
    /// task's — and pinning them to a per-screen count would go red the first time a different
    /// simulator measured a pixel differently (this runs against iOS 26.5 locally and Xcode 16.4's
    /// iOS 18 on the CI runner). So they are printed in full on every run, each with the element and
    /// frame that identify it, and the log is the backlog.
    ///
    /// **Removal condition:** when a seam above is re-tuned, move that audit type into `enforced` in
    /// the same commit. Nothing else in this file needs to change.
    private func audit(_ app: XCUIApplication, screen: String,
                       file: StaticString = #filePath, line: UInt = #line) throws {
        var failures: [String] = []
        var reported: [String] = []

        try app.performAccessibilityAudit { issue in
            let entry = "• [\(Self.name(issue.auditType))] \(issue.compactDescription)  "
                + Self.describe(issue.element)
            if let reason = Self.deliberate(issue) {
                // Printed, not silent: an exclusion that stops being needed should be visible in the
                // log so it can be deleted, rather than quietly outliving its reason.
                reported.append(entry + "\n    excused: \(reason)")
            } else if Self.enforced.contains(issue.auditType) {
                failures.append(entry + "\n    " + issue.detailedDescription)
            } else {
                reported.append(entry)
            }
            // Always "handled": every issue lands in one of the three buckets above, and returning
            // false would additionally raise it as an unlabelled framework failure on top of the
            // grouped report below. Collecting rather than failing per-issue matters because
            // `continueAfterFailure = false` would otherwise hide every finding after the first.
            return true
        }

        if !reported.isEmpty {
            print("[a11y audit] \(screen): \(reported.count) reported-only finding(s)\n"
                  + reported.joined(separator: "\n"))
        }
        XCTAssertTrue(failures.isEmpty,
                      "Accessibility audit: \(failures.count) enforced failure(s) on \(screen):\n"
                      + failures.joined(separator: "\n"),
                      file: file, line: line)
    }

    /// The exclusion list: an issue the audit is right to notice and the app is right to have.
    /// Returns the reason when the issue is deliberate, `nil` when it is a real finding.
    ///
    /// Deliberately matched narrowly — on the audit type AND on the element — so an exclusion cannot
    /// grow to cover a genuine regression elsewhere on the same screen.
    private static func deliberate(_ issue: XCUIAccessibilityAuditIssue) -> String? {
        // MapKit's own legal attribution, measured at 28.6 × 10.7 pt on every map screen. It is
        // drawn by `MKMapView` underneath SwiftUI's `Map`, its size is not settable from there, and
        // the MapKit terms require it to stay visible — neither ours to resize nor ours to remove.
        if issue.auditType == .hitRegion, issue.element?.label == "Legal" {
            return "MKMapView's own attribution label — not app-owned, and required to stay visible"
        }
        // Both globe screens report one of these with NO element attached: it is the satellite
        // imagery's own rendered place names, pixels inside `MKMapView` with no accessibility
        // element behind them. Nothing in the app's view tree can carry a label for them.
        if issue.auditType == .elementDetection, issue.element == nil {
            return "place names rendered into MKMapView's satellite imagery — no app element exists"
        }
        return nil
    }

    /// `XCUIAccessibilityAuditType` has no `description`, so it prints as
    /// "XCUIAccessibilityAuditType(rawValue: 65536)". Named here so the log is readable, and so a
    /// type Apple adds later surfaces as an explicit unknown rather than as noise.
    static func name(_ type: XCUIAccessibilityAuditType) -> String {
        switch type {
        case .contrast: return "contrast"
        case .elementDetection: return "elementDetection"
        case .hitRegion: return "hitRegion"
        case .sufficientElementDescription: return "sufficientElementDescription"
        case .dynamicType: return "dynamicType"
        case .textClipped: return "textClipped"
        case .trait: return "trait"
        default: return "unknown(\(type.rawValue))"
        }
    }

    /// The audit's own `compactDescription` names the offending element as
    /// "SwiftUI.AccessibilityNode" — the class, not the thing on screen — which is unactionable on
    /// its own. This adds the label and frame, which is what turns a finding into a file and a line.
    static func describe(_ element: XCUIElement?) -> String {
        guard let element else { return "(no element)" }
        let label = element.label.isEmpty ? "«no label»" : "\"\(element.label)\""
        return "\(label) id=\(element.identifier) frame=\(element.frame)"
    }
}
