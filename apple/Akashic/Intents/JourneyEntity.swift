import AppIntents

/// A journey exposed to Siri / Shortcuts so it can be picked and auto-completed by name or
/// slug. Its `id` is the journey id (UUID in CloudKit, slug in Fixtures) — the same value the
/// MCP tools accept as `journey_id`.
struct JourneyEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Journey")
    static var defaultQuery = JourneyEntityQuery()

    var id: String
    var name: String
    var slug: String
    var country: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: country.map { "\($0)" } ?? "")
    }

    init(id: String, name: String, slug: String, country: String?) {
        self.id = id
        self.name = name
        self.slug = slug
        self.country = country
    }

    init(_ journey: Journey) {
        self.init(id: journey.id, name: journey.name, slug: journey.slug,
                  country: journey.country.isEmpty ? nil : journey.country)
    }
}

/// Resolves and suggests `JourneyEntity` values. `EntityStringQuery` powers free-text
/// autocomplete (name / slug / country); `entities(for:)` resolves a picked or bridged id
/// using the same UUID-or-slug logic as the MCP tools.
struct JourneyEntityQuery: EntityQuery, EntityStringQuery {

    func entities(for identifiers: [String]) async throws -> [JourneyEntity] {
        let journeys = await MainActor.run { AkashicIntentData.refreshed().journeys }
        return identifiers.compactMap { identifier in
            JourneyResolver.resolve(identifier, in: journeys).map(JourneyEntity.init)
        }
    }

    func entities(matching string: String) async throws -> [JourneyEntity] {
        let journeys = await MainActor.run { AkashicIntentData.refreshed().journeys }
        return journeys
            .filter {
                $0.name.range(of: string, options: .caseInsensitive) != nil
                    || $0.slug.range(of: string, options: .caseInsensitive) != nil
                    || $0.country.range(of: string, options: .caseInsensitive) != nil
            }
            .map(JourneyEntity.init)
    }

    func suggestedEntities() async throws -> [JourneyEntity] {
        let journeys = await MainActor.run { AkashicIntentData.refreshed().journeys }
        return journeys.map(JourneyEntity.init)
    }
}
