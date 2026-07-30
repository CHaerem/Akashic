import XCTest

/// QUA-90: a camp badge under a photo stack must still take the tap.
///
/// ## Why this test exists at all
///
/// QUA-83 fixed the defect by DECLARATION ORDER inside a `@MapContentBuilder` — photo stacks are
/// declared before camp badges, so camps draw last and win the hit test. No unit test can observe
/// that, and `npm run prove` refused QUA-83's 15 new `MapMathTests` outright and correctly: every
/// symbol they name is new, so the reverted tree fails to BUILD and no assertion ever runs. Which
/// left the headline half of the fix guarded by nothing. This is the guard.
///
/// ## Why it needs no fixture data of its own
///
/// The bundled demo journey already contains the exact condition. `apple/Fixtures/demo-media/
/// demo-photos.json` geotags Kilimanjaro's one photograph at `[37.354, -3.0764]`, which is
/// **0 m** from the day-6 camp "Uhuru Peak (Summit)" in `Fixtures/recovered/kilimanjaro.json` —
/// measured, not assumed. A photo taken at camp is the most common geotag there is, which is why
/// the sample has one and why the defect shipped.
///
/// So nothing here edits fixture data. Changing what a new customer sees on first launch to make a
/// test pass would be the wrong trade in both directions.
///
/// ## Why it picks its target by geometry instead of naming one
///
/// The defect is *which marker covers which*, so the test asserts on that rather than on a chosen
/// camp: it finds a photo stack, then finds the camp badge whose centre falls inside that stack's
/// frame, and taps THAT. Naming a camp would also not have worked — Kilimanjaro has two camps
/// numbered day 6 (Uhuru Peak and Mweka Camp, 9 km apart), so a day number is not unique.
final class MapTapPrecedenceUITests: AkashicUITestCase {

    func testTappingACampBadgeUnderAPhotoStackSelectsTheDay() throws {
        // `day7` and not `overview`, for two measured reasons. (1) The overview frames the whole
        // route and the accessibility tree then holds only camps 1, 2 and 7 — the summit cluster is
        // decluttered away, so the markers this test needs are not addressable there. (2) `day7`
        // selects camp INDEX 6 (Mweka Camp) and frames the Uhuru→Mweka leg, which puts the summit
        // camp in shot while leaving it UNSELECTED — so a selection appearing on it can only have
        // come from this tap. Kilimanjaro numbers both of those camps day 6, which is also why the
        // selected day's photo filter shows the summit photograph here.
        let app = launchApp(["AKASHIC_OPEN": "kilimanjaro", "AKASHIC_SCENE": "day7"])

        let stacks = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", ID.mapPhotoStackPrefix))
        let badges = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", ID.mapCampBadgePrefix))

        // Both families must be on screen before the overlap means anything. A test that silently
        // finds zero markers would pass every assertion below it.
        //
        // The diagnostic matters as much as the assertion: "no photo stack appeared" on a map is
        // indistinguishable between "the markers are gone", "the demo journey did not seed" and
        // "the annotations are not in the accessibility tree", and the identifiers actually present
        // separate those three in one line instead of one build cycle each.
        //
        // A SKIP and not a failure, because the precondition depends on the demo journey having
        // seeded with its photograph — true on a fresh install and on CI, not guaranteed on a
        // simulator with history. A skip that always fires is a test that never runs, so if this
        // starts skipping, `xcrun simctl uninstall no.akashic.app` is the first thing to try.
        //
        // A correction worth keeping, because it nearly became a documented lie. This comment first
        // said two byte-identical runs disagreed about whether `AKASHIC_SCENE` reached the app, and
        // called it launch-seam non-determinism. It was not: `xcodebuild test` was running a STALE
        // `.xctest` after an earlier manual `simctl uninstall`, so the "flaky" run was executing a
        // previous version of this file — the failure message quoted text that had already been
        // deleted from it, which is what gave it away. Uninstalling BOTH `no.akashic.app` and
        // `no.akashic.app.uitests` made it deterministic and green. The app bundle alone is not
        // enough; the runner bundle caches too.
        try XCTSkipUnless(
            stacks.firstMatch.waitForExistence(timeout: Self.timeout),
            "PRECONDITION UNMET, NOT A PASS: no photo stack is on screen, so nothing below ran. "
            + "Map identifiers present: " + presentMapIdentifiers(app).joined(separator: ", "))
        require(badges.firstMatch, "a camp badge alongside the photo stack")

        // ── Assertion 1: on screen, no photo stack may sit on a camp badge's tap point.
        //
        // This is the defect, measured where it happens. The demo photo is geotagged 0 m from the
        // day-6 camp, so before QUA-83 its marker sat exactly on that badge's centre and took every
        // tap aimed at it. The clearance now pushes the stack 30 pt clear (`markerClearancePoints`),
        // which is more than the 44 pt frame's half-width, so no stack centre can land on a badge.
        //
        // Discovered while writing this test, and worth stating because it inverted the design: the
        // fix means an overlap NO LONGER EXISTS to tap through, so a test that first hunts for an
        // overlapping pair and then taps it can only ever pass on the broken code. Asserting the
        // absence is both the honest shape and the one that goes red against the old order.
        if let (badge, stack) = overlappingPair(badges: badges, stacks: stacks) {
            XCTFail("""
                A photo stack (\(stack.identifier)) covers the tap point of camp badge \
                (\(badge.identifier)), so a tap meant for the camp opens the lightbox instead. \
                That is QUA-83 regressing. Two things reach this: `trekOverlays()` must declare \
                photo stacks BEFORE camp badges (later map content draws above earlier and wins the \
                hit test), and `MapGeoMath.clustersCleared` must be applied with a live \
                `metersPerPoint` so coincident markers are pushed apart.
                """)
        }

        // ── Assertion 2: the camp badge nearest a photo stack is genuinely tappable.
        //
        // Clearance alone is not the whole fix. `metersPerPoint` is 0 until the map reports a
        // camera, and the nudge is deliberately skipped in that state — the declaration order is
        // what keeps camps reachable regardless. So the badge closest to a stack must still select
        // its day, which is the property a customer actually experiences.
        let target = try XCTUnwrap(badgeNearestAStack(badges: badges, stacks: stacks),
                                  "A photo stack exists but no camp badge does, which the require "
                                  + "above should already have caught.")

        XCTAssertFalse(target.isSelected,
                       "The badge under test must start unselected, or the assertion below is vacuous.")

        target.tap()

        XCTAssertTrue(waitForSelection(of: target),
                      "Tapping the camp badge nearest a photo stack must select its day. It did not "
                      + "— the stack took the tap.")
    }

    /// QUA-91: every day of the journey must be reachable from the overview's camp badges.
    ///
    /// Measured before the fix: the overview's accessibility tree held `map.campBadge.day1`, `day2`
    /// and `day7` and nothing else — 3 of 8 camps, the summit four absent entirely. Absent is worse
    /// than hidden: a culled annotation cannot be tapped and VoiceOver cannot reach it, so half the
    /// journey's days were simply unavailable on the screen that exists to select them.
    ///
    /// The assertion is on the UNION OF DAYS the badges advertise, not on how many badges there are,
    /// because the badge count depends on the live projection and no test can predict it. Merging is
    /// a legitimate answer here and culling is not — one badge offering days 3–6 keeps all four
    /// reachable, and that is the distinction this test encodes.
    func testEveryDayIsReachableFromTheOverviewsCampBadges() throws {
        let app = launchApp(["AKASHIC_OPEN": "kilimanjaro"])

        let badges = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", ID.mapCampBadgePrefix))
        require(badges.firstMatch, "at least one camp badge on the journey overview")

        // KNOWN-FAILING, DELIBERATELY RECORDED. The defect is live: `XCTExpectFailure` keeps the gate
        // honest in both directions — the suite stays green while QUA-91 is open, and the moment the
        // defect is actually fixed this test fails as an unexpected PASS, which is what makes it
        // impossible to fix quietly and forget the assertion. A skip would not do that; a plain
        // failure would leave `apple-ci` red, and a red gate that stays red trains everyone to ignore
        // CI. Delete this line as part of closing QUA-91 — that is the whole point of it.
        XCTExpectFailure("QUA-91: MapKit culls camp badges 3-6 on the Kilimanjaro overview. "
                         + "The merge that would prevent it does not execute — measured, the "
                         + "separation threshold changes nothing, so metersPerPoint is 0 here.")

        let identifiers = badges.allElementsBoundByIndex.map(\.identifier)
        let days = Set(identifiers.flatMap(Self.daysAdvertised(by:)))

        // 8 camps over 7 day numbers: Kilimanjaro's fixture numbers both Uhuru Peak and Mweka Camp
        // day 6 (`apple/Fixtures/recovered/kilimanjaro.json`). Day NUMBERS are what a customer picks
        // from, so that is what must be covered.
        XCTAssertEqual(days, Set(1...7), """
            Not every day is reachable from the overview. Present badges: \
            \(identifiers.sorted().joined(separator: ", ")).
            Missing days: \(Set(1...7).subtracting(days).sorted().map(String.init).joined(separator: ", ")).
            A missing day here is not a cosmetic gap — MapKit culled the annotation, so it is absent \
            from the accessibility tree and cannot be tapped or reached by VoiceOver. The fix is to \
            stop handing the map overlapping annotations: `campGroups(for:)` must merge badges closer \
            than `MapGeoMath.campBadgeSeparationPoints`, which needs a live `metersPerPoint`.
            """)
    }

    /// QUA-91: the live projection must actually be established on the overview.
    ///
    /// This exists because five attempts to fix the culling defect were reasoned from symptoms — badge
    /// identifiers that did not change between a 44 pt and a 96 pt threshold — and every one of them
    /// was a guess about a number nobody had read. `metersPerPoint` gates both QUA-83's photo
    /// clearance and QUA-91's badge merging, and when it is 0 BOTH degrade to doing nothing while the
    /// map still looks entirely plausible. So it is worth an assertion of its own: this is the
    /// difference between "the fix is wrong" and "the fix never ran".
    func testTheLiveProjectionIsEstablishedOnTheOverview() throws {
        let app = launchApp(["AKASHIC_OPEN": "kilimanjaro", "AKASHIC_MAP_PROBE": "1"])

        let probe = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", ID.mapProjectionProbePrefix))
            .firstMatch
        require(probe, "the projection probe (needs AKASHIC_MAP_PROBE=1)")

        let metersPerPoint = try XCTUnwrap(Self.probeValue(probe.identifier, key: "mppMilli"),
                                          "could not parse mppMilli from \(probe.identifier)") / 1000

        XCTAssertGreaterThan(metersPerPoint, 0, """
            The live map projection is never established on the overview (metersPerPoint = \
            \(metersPerPoint), probe: \(probe.identifier)). Everything that depends on it silently \
            does nothing: QUA-83's photo clearance never nudges a stack off a camp, and QUA-91's \
            badge merging never merges. Neither failure is visible on screen, which is why this is \
            asserted directly rather than inferred from marker positions.
            """)
    }

    // MARK: - Helpers

    /// The number following `key` in the probe's `-`-separated identifier.
    ///
    /// `map.projectionProbe.mppMilli-50000-distM-1200` → `probeValue(_, key: "mppMilli") == 50000`.
    static func probeValue(_ identifier: String, key: String) -> Double? {
        // `hasSuffix`, not `==`: the first token carries the whole dotted prefix
        // (`map.projectionProbe.mppMilli`), which an equality match silently misses — measured, it
        // cost a run and reported "could not parse" about an identifier that was perfectly well formed.
        let tokens = identifier.split(separator: "-").map(String.init)
        guard let at = tokens.firstIndex(where: { $0.hasSuffix(key) }),
              tokens.indices.contains(at + 1) else { return nil }
        return Double(tokens[at + 1])
    }

    /// The day numbers a camp-badge identifier advertises — `map.campBadge.days3-4-5-6.i2` → 3,4,5,6.
    ///
    /// Parsing an identifier is deliberate. The alternative is reading the accessibility LABEL, and
    /// that is a localised catalogue string: it would break on any copy edit and on every non-English
    /// run, which is the whole reason this suite addresses elements by identifier.
    static func daysAdvertised(by identifier: String) -> [Int] {
        guard let tail = identifier.split(separator: ".").first(where: { $0.hasPrefix("days") })
        else { return [] }
        return tail.dropFirst(4).split(separator: "-").compactMap { Int($0) }
    }

    /// Every non-empty identifier currently in the tree, for a failure message that names the cause.
    private func presentMapIdentifiers(_ app: XCUIApplication) -> [String] {
        let all = app.descendants(matching: .any).allElementsBoundByIndex
            .map(\.identifier)
            .filter { !$0.isEmpty }
        return all.isEmpty ? ["(none at all — the tree is empty or the app is not on the map)"]
                           : Array(Set(all)).sorted()
    }

    /// The first (badge, stack) pair where the badge's centre lies inside the stack's frame.
    ///
    /// Centre-in-frame rather than frame-intersection on purpose: a tap lands at the element's
    /// centre, so that is the point whose ownership decides the defect. Two frames can clip corners
    /// without either stealing the other's tap.
    private func overlappingPair(badges: XCUIElementQuery,
                                 stacks: XCUIElementQuery) -> (XCUIElement, XCUIElement)? {
        let stackFrames = stacks.allElementsBoundByIndex.map { ($0, $0.frame) }
        for badge in badges.allElementsBoundByIndex {
            let centre = CGPoint(x: badge.frame.midX, y: badge.frame.midY)
            if let hit = stackFrames.first(where: { $0.1.contains(centre) }) {
                return (badge, hit.0)
            }
        }
        return nil
    }

    /// The camp badge whose centre is closest to any photo stack's centre — the one a customer is
    /// most likely to miss if precedence regresses.
    private func badgeNearestAStack(badges: XCUIElementQuery,
                                    stacks: XCUIElementQuery) -> XCUIElement? {
        let stackCentres = stacks.allElementsBoundByIndex.map {
            CGPoint(x: $0.frame.midX, y: $0.frame.midY)
        }
        guard !stackCentres.isEmpty else { return nil }
        return badges.allElementsBoundByIndex
            .map { badge -> (XCUIElement, CGFloat) in
                let c = CGPoint(x: badge.frame.midX, y: badge.frame.midY)
                let nearest = stackCentres
                    .map { hypot($0.x - c.x, $0.y - c.y) }
                    .min() ?? .greatestFiniteMagnitude
                return (badge, nearest)
            }
            .min { $0.1 < $1.1 }?.0
    }

    /// Selecting a day starts a camera fly-in and presents the day sheet, so the trait lands a
    /// beat after the tap. Polled rather than slept: a fixed sleep either flakes or wastes the
    /// difference on every run.
    private func waitForSelection(of element: XCUIElement,
                                  timeout: TimeInterval = AkashicUITestCase.timeout) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists && element.isSelected { return true }
            _ = XCUIApplication().wait(for: .runningForeground, timeout: 0.2)
        }
        return false
    }
}
