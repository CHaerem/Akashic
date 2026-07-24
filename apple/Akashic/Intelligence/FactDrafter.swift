import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// Assisted journey creation — draft a day's **fun facts** and **historical notes** on-device,
/// GROUNDED strictly in the place names the enrichment step already discovered (locality, area,
/// nearby POIs). This is the M6 pattern (`DayNamer` / `DayNoteDrafter`) extended to day content:
///
///   * pure, deterministic `promptComponents(for:)` — no FoundationModels dependency, unit-tested;
///   * a hard **anti-invention** contract in the instructions — the model may only speak about the
///     supplied names and must not invent other places, dates, numbers, or superlatives;
///   * `@Generable` output, iOS 26+ gated, behind the same `Intelligence.isAvailable` gate
///     (Apple Intelligence + Complete entitlement + `AKASHIC_DISABLE_AI` kill switch);
///   * every generated item is a **suggestion** the user accepts — nothing is written silently.
///
/// Entry points: a "Draft facts" accept-row per enriched day in the creation flow, and beside the
/// existing note drafter in day editing.

// MARK: - Input (pure value type)

/// The names a day's facts may be grounded in. Deliberately names only — no coordinates, no photo
/// bytes — so the prompt is deterministic and the model has nothing to invent from.
struct DayFactInput: Equatable {
    var journeyName: String
    var country: String
    var dayNumber: Int
    var campName: String
    /// Place names discovered by reverse-geocoding (locality, area of interest, region).
    var placeNames: [String]
    /// Nearby POI names discovered by local search (summits, lakes, viewpoints, huts).
    var poiNames: [String]
    var dateLabel: String?
    var elevation: Int

    init(journeyName: String, country: String, dayNumber: Int, campName: String,
         placeNames: [String] = [], poiNames: [String] = [], dateLabel: String? = nil, elevation: Int = 0) {
        self.journeyName = journeyName
        self.country = country
        self.dayNumber = dayNumber
        self.campName = campName
        self.placeNames = placeNames
        self.poiNames = poiNames
        self.dateLabel = dateLabel
        self.elevation = elevation
    }

    /// Every distinct, non-empty name the model is allowed to talk about (camp + places + POIs).
    var groundingNames: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for name in ([campName] + placeNames + poiNames) {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = trimmed.lowercased()
            guard !trimmed.isEmpty, !seen.contains(key) else { continue }
            seen.insert(key)
            out.append(trimmed)
        }
        return out
    }

    /// There is nothing to ground facts in without at least one real place name.
    var hasGrounding: Bool { !groundingNames.isEmpty }
}

// MARK: - Drafting logic (pure)

enum FactDrafter {

    /// System instructions — the anti-invention contract, stricter than the note drafter because
    /// facts are asserted as true. The model may ONLY use the supplied names; it must refuse to add
    /// places, dates, numbers, or superlatives that aren't in the input.
    static let instructions = """
    You draft short factual notes for a travel journaling app, grounded STRICTLY in the place names \
    you are given. Absolute rules: use ONLY the names provided; never invent other places, dates, \
    numbers, statistics, records, or superlatives; never claim something is the highest, oldest, \
    largest, or "most" anything unless that exact claim is in the input. If you are not confident a \
    statement is true from the given names alone, do not make it — return fewer items instead. Keep \
    each item to one plain sentence. No marketing tone.
    """

    /// The deterministic prompt for one day. Lists the grounding names explicitly and asks for facts
    /// about THOSE names only. Contains no coordinates, no photo data.
    static func promptComponents(for input: DayFactInput) -> String {
        var lines: [String] = []
        lines.append("Draft facts for one day of a trek, using ONLY the names listed.")
        lines.append("Journey: \(input.journeyName)" + (input.country.isEmpty ? "" : ", \(input.country)"))
        lines.append("Day \(input.dayNumber): \(input.campName)")
        if let dateLabel = input.dateLabel, !dateLabel.isEmpty {
            lines.append("Date: \(dateLabel)")
        }
        if input.elevation > 0 {
            lines.append("Elevation: \(input.elevation) m")
        }
        if !input.placeNames.isEmpty {
            lines.append("Places: \(input.placeNames.joined(separator: ", "))")
        }
        if !input.poiNames.isEmpty {
            lines.append("Nearby points of interest: \(input.poiNames.joined(separator: ", "))")
        }
        lines.append("Return up to 3 fun facts and up to 3 short historical or cultural notes, each grounded only in the names above. Omit anything you are unsure is true.")
        return lines.joined(separator: "\n")
    }

    // MARK: Domain assembly (pure)

    /// Category stamped on drafted fun facts (raw string, styled by the fun-fact UI).
    static let funFactCategory = "general"
    /// Provenance recorded on every drafted item, so the UI can badge machine-drafted content.
    static let source = "Apple Intelligence"

    /// Build domain `FunFact`s from raw sentences, dropping blanks and capping at 3.
    static func funFacts(from raw: [String]) -> [FunFact] {
        raw.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(3)
            .map { FunFact(id: UUID().uuidString, content: $0, category: funFactCategory,
                           source: source, learnMoreUrl: nil, icon: nil) }
    }

    /// Build domain `HistoricalSite`s from raw (name, summary) pairs, dropping blanks and capping at 3.
    static func historicalSites(from raw: [(name: String, summary: String)], dayNumber: Int) -> [HistoricalSite] {
        raw.map { (name: $0.name.trimmingCharacters(in: .whitespacesAndNewlines),
                   summary: $0.summary.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .filter { !$0.name.isEmpty && !$0.summary.isEmpty }
            .prefix(3)
            .map { HistoricalSite(id: UUID().uuidString, name: $0.name, coordinates: nil, elevation: nil,
                                  routeDistanceKm: nil, summary: $0.summary, description: nil, period: nil,
                                  significance: nil, imageUrls: nil, links: nil, tags: nil, dayNumber: dayNumber) }
    }
}

/// The assembled draft the caller offers as accept-rows.
struct DraftedFacts: Equatable {
    var funFacts: [FunFact]
    var historicalSites: [HistoricalSite]

    var isEmpty: Bool { funFacts.isEmpty && historicalSites.isEmpty }
}

// MARK: - Live generation (gated)

#if canImport(FoundationModels)

/// One grounded historical note: a name taken from the input and a one-sentence summary. iOS 26+.
@available(iOS 26.0, *)
@Generable
struct GeneratedHistoricalNote {
    @Guide(description: "A place name taken verbatim from the list of names given — never a new place.")
    var name: String
    @Guide(description: "A one-sentence factual summary grounded only in the given names. No invented dates or numbers.")
    var summary: String
}

/// The `@Generable` output: up to 3 fun facts and up to 3 historical notes, all grounded. iOS 26+.
@available(iOS 26.0, *)
@Generable
struct DayFactsSuggestion {
    @Guide(description: "Up to 3 short factual trivia sentences about the given places only. No invented places, dates, numbers, or superlatives.")
    var funFacts: [String]
    @Guide(description: "Up to 3 short historical or cultural notes, each about a place named in the input.")
    var historicalSites: [GeneratedHistoricalNote]
}

@available(iOS 26.0, *)
extension FactDrafter {
    /// Draft grounded facts on-device. Thin driver: builds the pure prompt, runs one guided
    /// generation, maps the raw output into domain value types. Callers must have confirmed
    /// `Intelligence.isAvailable` and that `input.hasGrounding` first.
    static func generate(for input: DayFactInput) async throws -> DraftedFacts {
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(
            to: promptComponents(for: input),
            generating: DayFactsSuggestion.self)
        let content = response.content
        return DraftedFacts(
            funFacts: funFacts(from: content.funFacts),
            historicalSites: historicalSites(
                from: content.historicalSites.map { (name: $0.name, summary: $0.summary) },
                dayNumber: input.dayNumber))
    }
}

#endif
