import XCTest
@testable import Akashic

/// DIFF-15: that `JourneyListView` actually ASKS the waiting-rows question, and answers it with a
/// one-occasion pass rather than by disabling the user's protection.
///
/// ## Why a source-text test, and why its own file
///
/// `FirstSyncDownloadDecision.emptyListContent` is pure and fully covered by
/// `DeferredDownloadPreviewTests` — and that is EXACTLY the QUA-45 shape if nothing checks the call
/// site. `verifyPresence` shipped with 15 green unit tests while the `.task` that invoked it could be
/// deleted with all 841 native tests still green, because a SwiftUI body is not reachable from a unit
/// test and there is no UI test on this screen. A tested decision nobody calls is not a feature.
///
/// So this asserts on the source text of the view, the pattern `UniversalLinkTests` uses against the
/// entitlements plist and MAP-03 used against `index.css` — and that one fired correctly the moment
/// MAP-05 deleted the rule it guarded. Coarse, and it buys one specific thing: deleting the branch,
/// or swapping the one-occasion release for a flip of the persistent setting, cannot pass.
///
/// Its own file because it imports NO symbol this task introduced, only a file path. That is what
/// makes the view wiring provable in both directions: reverting `JourneyListView.swift` to before the
/// fix leaves this file compiling, so the red is four failing assertions rather than a build error.
final class JourneyListWaitingSurfaceTests: XCTestCase {

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

    private var journeyList: String { get throws { try source("Akashic/Views/JourneyListView.swift") } }

    func testTheListAsksTheDecisionAndCanRenderTheWaitingRows() throws {
        let view = try journeyList
        XCTAssertTrue(view.contains("FirstSyncDownloadDecision.emptyListContent("),
                      "the list must ASK the decision — a tested decision nothing calls is QUA-45 again")
        XCTAssertTrue(view.contains("JourneysAwaitingDownloadSection("),
                      "the waiting rows must be reachable from the list, not merely defined in it")
        XCTAssertTrue(view.contains("syncStatus.remoteJourneySummaries"),
                      "the decision has to be fed the summaries the engine published")
        XCTAssertTrue(view.contains(".waitingForWiFi"),
                      "and the fact that a download is actually being deferred right now")
    }

    /// The branch that must never regress, guarded at the call site as well as in the decision.
    func testTheFirstRunHeroIsStillRendered() throws {
        XCTAssertTrue(try journeyList.contains("JourneyEmptyState"),
                      "a genuinely new family must still get the create-your-first-journey hero")
    }

    /// A one-time yes, not a standing preference. Flipping `wifiOnlyDownloads` here would release this
    /// download and silently disable the protection for every future one.
    func testDownloadNowGrantsAOneOccasionPassAndNeverFlipsTheSetting() throws {
        let view = try journeyList
        XCTAssertTrue(view.contains("grantOneOccasionCellularDownload()"),
                      "the action must use the one-occasion release `NetworkPolicy` already provides")
        XCTAssertFalse(view.contains("wifiOnlyDownloads ="),
                       "this surface must never write the persistent Wi-Fi-only preference")
    }

    /// The size shown here has to be the corrected shared estimate, not a second hand-rolled number
    /// free to drift away from the one the first-sync prompt quotes.
    func testTheWaitingSurfaceSizesItselfFromTheSharedEstimate() throws {
        XCTAssertTrue(try journeyList.contains("SyncSizeEstimate.humanReadable("),
                      "one estimate, one place — a local calculation here would drift from the prompt's")
    }
}
