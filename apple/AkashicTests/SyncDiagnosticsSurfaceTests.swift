import XCTest

/// DIFF-16: that the four fixes are actually WIRED — the toggle to `SyncLog`, the new states to the
/// journey list, the retry to a trigger, the progress flag to the fetch.
///
/// ## Why a source-text test, and why its own file
///
/// This is DIFF-15's `JourneyListWaitingSurfaceTests` reasoning applied to a bigger surface, and the
/// reason is measured rather than stylistic. `scripts/prove.mjs` requires the red side to be a FAILING
/// ASSERTION, never a build error — "a red for a build failure proves nothing about whether the
/// assertions can fail" — and a test file that names `EmptyListContent.couldNotCheck`,
/// `FirstSyncDownloadProgress` or `SyncLog.isEnabled(in:)` cannot compile against a tree where none of
/// them exists. So this file names **no symbol this task introduced**: only file paths, string
/// literals, and `Bundle`. Revert the five product files and it still builds, and fails on assertions.
///
/// The other half of the reason is QUA-45's, restated: `verifyPresence` shipped with 15 green tests
/// while the `.task` that called it could be deleted with all 841 native tests still green, because a
/// SwiftUI body is not reachable from a unit test. Three of DIFF-16's four fixes live in exactly such
/// unreachable places — a `Form` section, a `switch` arm, and a `NotificationCenter` subscription — so
/// without an assertion on the source text, "the decision is tested" would again be true and useless.
final class SyncDiagnosticsSurfaceTests: XCTestCase {

    private func source(_ relativePath: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()          // AkashicTests/
            .deletingLastPathComponent()          // apple/
            .appendingPathComponent(relativePath)
        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            throw XCTSkip("source not readable from the test bundle: \(relativePath)")
        }
        return text
    }

    /// The file with whole-line comments removed.
    ///
    /// Needed for the NEGATIVE assertions, and the reason is a real failure this file hit on its first
    /// run: both `SyncLog.swift` and `AkashicSyncEngine.swift` now document the mistake they used to
    /// contain — "`static let isEnabled` is evaluated once", "replaced a `hasEvaluatedFirstSyncPrompt`
    /// flag" — so `contains("static let isEnabled")` matched the explanation of the fix and reported the
    /// fix as absent. Writing down what went wrong is exactly what this repo asks for, so the assertion
    /// has to look at code.
    ///
    /// Only WHOLE-line comments are dropped. A trailing `//` on a code line is deliberately left alone:
    /// stripping it would also truncate any line holding a `"https://…"` literal, which would quietly
    /// remove real code from the text every other assertion here reads.
    private func codeOnly(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            .joined(separator: "\n")
    }

    private var syncLog: String { get throws { try source("Akashic/Sync/SyncLog.swift") } }
    private var settings: String { get throws { try source("Akashic/Views/SettingsView.swift") } }
    private var journeyList: String { get throws { try source("Akashic/Views/JourneyListView.swift") } }
    private var prompt: String { get throws { try source("Akashic/Sync/SyncDownloadPrompt.swift") } }
    private var engine: String { get throws { try source("Akashic/Sync/AkashicSyncEngine.swift") } }

    // MARK: - (1) The logger can be turned on without a relaunch, and without an environment

    /// The trap, asserted as text because it is a DECLARATION KIND and no runtime check can see it
    /// from outside: `static let isEnabled` is evaluated once, lazily, on first use. A toggle written
    /// in front of one changes nothing and looks entirely correct.
    func testSyncLogDoesNotCacheItsEnabledFlag() throws {
        let text = codeOnly(try syncLog)
        // A WORD BOUNDARY, not a prefix: `static let isEnabledByEnvironment` is correct and stays — a
        // process's own environment cannot change under it, so caching that half is the right call. A
        // plain `contains` called that declaration a regression, which is the assertion being wrong
        // about the code rather than the code being wrong.
        XCTAssertNil(text.range(of: #"static let isEnabled\b"#, options: .regularExpression),
                     "`static let` is evaluated ONCE — a persisted toggle in front of it is a no-op")
        XCTAssertTrue(text.contains("static var isEnabled"),
                      "the shipping flag has to be computed, so it re-reads the store every time")
    }

    func testSyncLogReadsAPersistedFlagAndStillHonoursTheEnvironment() throws {
        let text = try syncLog
        XCTAssertTrue(text.contains("UserDefaults"),
                      "a TestFlight install cannot be given an environment variable — a preference is "
                      + "the only switch it has")
        XCTAssertTrue(text.contains("AKASHIC_SYNC_LOG"),
                      "and the development switch must keep working: a simctl run should not have to "
                      + "write a preference first")
    }

    /// The Settings row is what makes the flag reachable at all. Without this assertion the toggle
    /// could be deleted from the form and every runtime test above would stay green.
    func testSettingsCarriesTheSyncLoggingToggle() throws {
        let text = try settings
        XCTAssertTrue(text.contains("SyncLog.setPersistentlyEnabled("),
                      "the toggle must WRITE the persisted flag, not merely hold view state")
        XCTAssertTrue(text.contains("Sync logging"),
                      "and there has to be a labelled control for the owner to find")
    }

    /// **The assertion that makes the whole task work on a TestFlight build.** The developer workshop
    /// is `#if DEBUG` on purpose (SHIP-09: a persistence-mode override has no business in a paid
    /// binary) — and the diagnostics section must NOT be, or the owner's device still cannot log.
    func testTheDiagnosticsSectionIsPresentInReleaseBuilds() throws {
        let text = try settings
        let section = try XCTUnwrap(text.range(of: "diagnosticsSection"),
                                    "no diagnostics section at all")
        let debugGate = try XCTUnwrap(text.range(of: "#if DEBUG"),
                                      "the developer workshop's DEBUG gate is expected to still exist")
        XCTAssertTrue(section.lowerBound < debugGate.lowerBound,
                      "the diagnostics section must be reached BEFORE the first `#if DEBUG` in the "
                      + "form — inside it, a Release build has no way to enable logging, which is the "
                      + "entire defect DIFF-16 exists to fix")
    }

    /// The seven-tap unlock used to be `#if DEBUG` too, on the correct reasoning that Release had
    /// nothing to unlock. It now has something to unlock, so the gesture has to exist there.
    func testTheSevenTapUnlockWorksInReleaseBuilds() throws {
        let text = try settings
        let start = try XCTUnwrap(text.range(of: "private var versionRow"))
        let end = try XCTUnwrap(text.range(of: "private func linkRow"))
        let versionRow = codeOnly(String(text[start.lowerBound..<end.lowerBound]))
        XCTAssertTrue(versionRow.contains("onTapGesture"),
                      "the version row is the only unlock gesture there is")
        XCTAssertFalse(versionRow.contains("#if DEBUG"),
                       "a DEBUG-only gesture leaves a signed build with no way to reveal diagnostics")
        XCTAssertTrue(versionRow.contains("DeveloperTools.tapsReachUnlock"),
                      "and it must use the existing tap arithmetic rather than a second copy of it")
    }

    // MARK: - (2) and (4) The list renders four states, not two

    func testTheListRendersCouldNotCheckAndDownloadingAndStillTheHero() throws {
        let text = try journeyList
        XCTAssertTrue(text.contains("FirstSyncDownloadDecision.emptyListContent("),
                      "the list must still ASK the decision — a tested decision nothing calls is QUA-45")
        XCTAssertTrue(text.contains("isDownloadRunning:"),
                      "and it must feed it the third input, or the downloading state is unreachable")
        XCTAssertTrue(text.contains("case .couldNotCheck"),
                      "the could-not-check arm has to be rendered, not merely decided")
        XCTAssertTrue(text.contains("JourneysCouldNotCheckSection("))
        XCTAssertTrue(text.contains("case .downloading"))
        XCTAssertTrue(text.contains("JourneysDownloadingSection("))
        XCTAssertTrue(text.contains("JourneyEmptyState"),
                      "and a genuinely new family must STILL get the create-your-first-journey hero")
        XCTAssertTrue(text.contains("JourneysAwaitingDownloadSection("),
                      "as must DIFF-15's named waiting rows")
    }

    /// The could-not-check surface has to offer a way forward. Both affordances are load-bearing: the
    /// retry re-runs the query that failed, and the one-occasion release downloads the real journeys
    /// WITHOUT depending on that query at all.
    func testTheCouldNotCheckSurfaceOffersARetryAndTheOneOccasionRelease() throws {
        let text = try journeyList
        XCTAssertTrue(text.contains("retryDeferredDownloadPreview()"),
                      "\"Check again\" must actually re-run the pre-fetch")
        XCTAssertTrue(text.contains("Check again"))
        XCTAssertTrue(text.contains("grantOneOccasionCellularDownload()"),
                      "and the release must stay the one-occasion pass NetworkPolicy already provides")
        XCTAssertFalse(text.contains("wifiOnlyDownloads ="),
                       "this surface must never write the persistent Wi-Fi-only preference")
    }

    /// `nil` and `[]` are now different answers, and the decision is where that difference lives.
    func testTheDecisionSeparatesCouldNotAnswerFromFoundNothing() throws {
        let text = try prompt
        XCTAssertTrue(text.contains("case couldNotCheck"),
                      "a failed pre-fetch used to fall through to the hero, which is a false statement "
                      + "to a family whose archive exists")
        XCTAssertTrue(text.contains("case downloading("))
        XCTAssertTrue(text.contains("isDownloadRunning"))
        XCTAssertTrue(text.contains("FirstSyncDownloadProgress"),
                      "and the running-download fact needs a published home the list can observe")
    }

    // MARK: - (3) The retry is wired to a trigger, not merely defined

    /// A retry method nobody calls is QUA-45 exactly. The foreground notification is the subscription
    /// that makes it a mechanism, and it lives in a `NotificationCenter` block no unit test reaches.
    func testTheRetryIsWiredToTheForegroundNotification() throws {
        let text = try engine
        XCTAssertTrue(text.contains("willEnterForegroundNotification"),
                      "without a subscription the retry is a method with no caller")
        XCTAssertTrue(text.contains("retryDeferredDownloadPreview"))
        XCTAssertTrue(text.contains("removeObserver"),
                      "and the token has to be released — QUA-08's deinit rule applies to this one too")
    }

    /// The once-per-lifetime guard is the whole of hypothesis (c). Its NAME going away is the cheapest
    /// possible check that it is gone rather than renamed around.
    func testTheOncePerLifetimeGuardIsGone() throws {
        let text = codeOnly(try engine)
        XCTAssertFalse(text.contains("hasEvaluatedFirstSyncPrompt"),
                       "a guard set on ENTRY made one transient failure permanent until relaunch")
        XCTAssertTrue(text.contains("maxDeferredPreviewAttempts"),
                      "and the retry has to be bounded, or a permanent failure re-queries forever")
    }

    /// The progress flag must be raised and lowered around the actual fetch — a flag that is only ever
    /// set, or only ever read, is not a mechanism.
    func testTheProgressFlagBracketsTheHeavyFetch() throws {
        let text = try engine
        XCTAssertTrue(text.contains("downloadProgress.begin()"))
        XCTAssertTrue(text.contains("downloadProgress.end()"))
        XCTAssertTrue(text.contains("firstDownloadHasKnownContent"),
                      "and it must be gated on evidence, or a brand-new family is told a download is "
                      + "coming for as long as their empty fetch takes")
    }

    // MARK: - Norwegian

    /// Every new user-facing string, read out of the BUILT bundle rather than the source catalogue —
    /// `StringCatalogTests` documents at length why the catalogue being right is not evidence that the
    /// binary is translated.
    ///
    /// These fail under `prove.mjs`'s reverted run as well, and correctly so: it checks out the whole
    /// tree at the earlier ref, so the catalogue there genuinely has no entry for any of these keys —
    /// the bundle echoes the key back, which is exactly what an untranslated string looks like.
    func testTheNewStringsAreTranslated() throws {
        let path = try XCTUnwrap(Bundle.main.path(forResource: "nb", ofType: "lproj"),
                                 "nb.lproj is missing from the built app — check `knownRegions`")
        let nb = try XCTUnwrap(Bundle(path: path))
        for key in [
            // The could-not-check surface.
            "Couldn't check iCloud",
            "Your journeys download when you're on Wi-Fi. We couldn't reach iCloud just now to see what's waiting — nothing has been lost, and nothing has been changed.",
            "Check again",
            // The downloading surface.
            "Downloading your journeys",
            "This can take a few minutes on a slow connection. Journeys appear as they arrive.",
            "Downloading…",
            // Settings › Diagnostics.
            "Diagnostics",
            "Sync logging",
            "Log subsystem",
            "Hide diagnostics",
            "Records what iCloud sync does — account status, fetch counts, zone names and failures — to the system log. Read it with Console.app while the device is connected, filtered on the subsystem above. Photos, captions and comments are never logged. Off by default.",
        ] {
            XCTAssertNotEqual(nb.localizedString(forKey: key, value: nil, table: "Localizable"), key,
                              "\(key.debugDescription) has no nb entry — the bundle echoed the key back")
        }
    }
}
