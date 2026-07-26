import AppIntents

// MARK: - App Intents mirroring the MCP tool surface
//
// Each intent maps 1:1 to an MCP tool. `perform()` returns BOTH:
//   * a machine-readable JSON `String` (`ReturnsValue<String>`) that is semantically equivalent
//     to the MCP tool payload — same keys, casing, and values, but compact with alphabetized
//     keys and nil optionals omitted (see `IntentModels.swift`) — for the future system-MCP
//     bridge; and
//   * a human-readable `IntentDialog` summary for Siri / Shortcuts.
// Tool failures throw `AkashicIntentError` carrying the MCP's plain-text message (the bridge
// maps a thrown error → `{ content: [{ text }], isError: true }`).

/// Carries the MCP plain-text error string (e.g. "Journey not found: x") to the intent surface.
enum AkashicIntentError: Error, CustomLocalizedStringResourceConvertible {
    case message(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .message(let text): return "\(text)"
        }
    }
}

// MARK: list_journeys

struct ListJourneysIntent: AppIntent {
    static var title: LocalizedStringResource = "List Journeys"
    static var description = IntentDescription(
        "List all journeys with metadata including name, country, duration, and distance.")

    @Parameter(title: "Limit", description: "Maximum number of journeys (default 20, max 100)", default: 20)
    var limit: Int

    @Parameter(title: "Offset", description: "Number of journeys to skip for pagination", default: 0)
    var offset: Int

    @Parameter(title: "Country", description: "Filter by country name (case-insensitive)")
    var country: String?

    static var parameterSummary: some ParameterSummary {
        Summary("List journeys") {
            \.$limit
            \.$offset
            \.$country
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let result = AkashicIntentData.refreshed()
            .listResult(limit: limit, offset: offset, country: country)
        return .result(value: IntentJSON.string(result), dialog: Self.dialog(for: result))
    }

    static func dialog(for result: JourneyListResult) -> IntentDialog {
        guard !result.journeys.isEmpty else { return IntentDialog("No journeys found.") }
        let names = result.journeys.prefix(3).map(\.name).joined(separator: ", ")
        let more = result.total > result.journeys.count ? " (of \(result.total))" : ""
        return IntentDialog("\(result.journeys.count) journeys\(more): \(names)")
    }
}

// MARK: search_journeys

struct SearchJourneysIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Journeys"
    static var description = IntentDescription(
        "Search journeys by name, country, or description.")

    @Parameter(title: "Query", description: "Text matched against name, country, or description")
    var query: String

    @Parameter(title: "Limit", description: "Maximum number of results (default 10, max 50)", default: 10)
    var limit: Int

    static var parameterSummary: some ParameterSummary {
        Summary("Search journeys for \(\.$query)") {
            \.$limit
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        switch AkashicIntentData.refreshed().searchOutcome(query: query, limit: limit) {
        case .success(let result):
            let dialog: IntentDialog
            if result.journeys.isEmpty {
                dialog = IntentDialog("No journeys match \"\(query)\".")
            } else {
                let names = result.journeys.prefix(3).map(\.name).joined(separator: ", ")
                dialog = IntentDialog("\(result.total) match: \(names)")
            }
            return .result(value: IntentJSON.string(result), dialog: dialog)
        case .failure(let message):
            throw AkashicIntentError.message(message)
        }
    }
}

// MARK: get_journey_details

struct GetJourneyDetailsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Journey Details"
    static var description = IntentDescription(
        "Get full details of a journey including camps/waypoints, route coordinates, and statistics.")

    @Parameter(title: "Journey", description: "Journey (UUID or slug)")
    var journey: JourneyEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Get details for \(\.$journey)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        switch AkashicIntentData.refreshed().detailsOutcome(idOrSlug: journey.id) {
        case .success(let result):
            let distance = result.stats.map { "\(Int($0.totalDistance)) km" } ?? "?"
            let dialog = IntentDialog("\(result.name): \(result.camps.count) camps, \(distance)")
            return .result(value: IntentJSON.string(result), dialog: dialog)
        case .failure(let message):
            throw AkashicIntentError.message(message)
        }
    }
}

// MARK: get_journey_stats

struct GetJourneyStatsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Journey Stats"
    static var description = IntentDescription(
        "Get computed statistics for a journey including difficulty rating, estimated hiking time, and elevation analysis.")

    @Parameter(title: "Journey", description: "Journey (UUID or slug)")
    var journey: JourneyEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Get stats for \(\.$journey)")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        switch AkashicIntentData.refreshed().statsOutcome(idOrSlug: journey.id) {
        case .success(let result):
            let ext = result.extendedStats
            // Siri speaks this line, so the difficulty has to be the translated wording rather
            // than the English token the model carries.
            let difficulty = String(localized: ExtendedStatsCalculator.localizedDifficulty(ext.difficulty))
            let dialog = IntentDialog(
                "\(result.journeyName): \(difficulty), ~\(ext.estimatedTotalTime), \(ext.avgDailyDistance) km/day")
            return .result(value: IntentJSON.string(result), dialog: dialog)
        case .failure(let message):
            throw AkashicIntentError.message(message)
        }
    }
}

// MARK: get_journey_photos

struct GetJourneyPhotosIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Journey Photos"
    static var description = IntentDescription(
        "Get photos for a journey with metadata including GPS coordinates and capture date.")

    @Parameter(title: "Journey", description: "Journey (UUID or slug)")
    var journey: JourneyEntity

    @Parameter(title: "Waypoint ID", description: "Filter photos by a specific waypoint/day")
    var waypointID: String?

    @Parameter(title: "Limit", description: "Maximum number of photos (default 50, max 200)", default: 50)
    var limit: Int

    static var parameterSummary: some ParameterSummary {
        Summary("Get photos for \(\.$journey)") {
            \.$waypointID
            \.$limit
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        switch AkashicIntentData.refreshed()
            .photosOutcome(idOrSlug: journey.id, waypointId: waypointID, limit: limit) {
        case .success(let result):
            let dialog = result.total == 0
                ? IntentDialog("No photos yet for \(journey.name).")
                : IntentDialog("\(result.total) photos for \(journey.name).")
            return .result(value: IntentJSON.string(result), dialog: dialog)
        case .failure(let message):
            throw AkashicIntentError.message(message)
        }
    }
}
