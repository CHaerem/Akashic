import XCTest
@testable import Akashic

/// Assisted creation §4 — grounded fact drafting. The prompt is pure and must contain ONLY the
/// supplied names (nothing invented), the anti-invention contract must be present, and the domain
/// assembly must cap/clean the raw model output.
final class FactDrafterTests: XCTestCase {

    private func input() -> DayFactInput {
        DayFactInput(journeyName: "Kilimanjaro", country: "Tanzania", dayNumber: 5,
                     campName: "Barafu Camp", placeNames: ["Kibo", "Karanga Valley"],
                     poiNames: ["Uhuru Peak", "Reusch Crater"], dateLabel: "3 Oct 2023", elevation: 4600)
    }

    // MARK: Prompt purity

    func testPromptContainsAllSuppliedNamesAndNothingElse() {
        let prompt = FactDrafter.promptComponents(for: input())
        for name in ["Barafu Camp", "Kibo", "Karanga Valley", "Uhuru Peak", "Reusch Crater",
                     "Kilimanjaro", "Tanzania"] {
            XCTAssertTrue(prompt.contains(name), "prompt should mention supplied name: \(name)")
        }
        // The prompt must instruct grounding-only and never fabricate an unrelated place/number.
        XCTAssertTrue(prompt.lowercased().contains("only"))
        XCTAssertFalse(prompt.contains("Everest"), "no invented places")
    }

    func testInstructionsForbidInvention() {
        let i = FactDrafter.instructions.lowercased()
        XCTAssertTrue(i.contains("only"))
        XCTAssertTrue(i.contains("never invent"))
        XCTAssertTrue(i.contains("superlative"))
    }

    func testGroundingNamesAreDistinctAndNonEmpty() {
        let input = DayFactInput(journeyName: "J", country: "", dayNumber: 1, campName: "Barafu Camp",
                                 placeNames: ["Barafu Camp", "  ", "Kibo"], poiNames: ["Kibo", "Uhuru Peak"])
        XCTAssertEqual(input.groundingNames, ["Barafu Camp", "Kibo", "Uhuru Peak"])
        XCTAssertTrue(input.hasGrounding)
    }

    func testNoGroundingWhenOnlyAutoNameAndNoPlaces() {
        let input = DayFactInput(journeyName: "J", country: "", dayNumber: 2, campName: "   ")
        XCTAssertFalse(input.hasGrounding)
        // A prompt is still well-formed even with nothing to ground on.
        XCTAssertFalse(FactDrafter.promptComponents(for: input).isEmpty)
    }

    // MARK: Domain assembly

    func testFunFactsCleanedTrimmedAndCappedAtThree() {
        let facts = FactDrafter.funFacts(from: ["  A fact  ", "", "  ", "B", "C", "D"])
        XCTAssertEqual(facts.map(\.content), ["A fact", "B", "C"])
        XCTAssertTrue(facts.allSatisfy { $0.source == FactDrafter.source })
        XCTAssertTrue(facts.allSatisfy { $0.category == FactDrafter.funFactCategory })
        XCTAssertEqual(Set(facts.map(\.id)).count, 3, "each fact gets a distinct id")
    }

    func testHistoricalSitesRequireNameAndSummaryAndCarryDay() {
        let sites = FactDrafter.historicalSites(
            from: [("Barafu Camp", "A high camp."), ("", "orphan summary"), ("No summary", "  ")],
            dayNumber: 5)
        XCTAssertEqual(sites.count, 1)
        XCTAssertEqual(sites.first?.name, "Barafu Camp")
        XCTAssertEqual(sites.first?.summary, "A high camp.")
        XCTAssertEqual(sites.first?.dayNumber, 5)
    }
}
