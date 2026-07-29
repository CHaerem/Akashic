import Foundation

/// Resolves a journey by UUID **or** slug, mirroring the MCP Worker's `resolveJourneyId`.
enum JourneyResolver {
    /// Matches the MCP's UUID regex (case-insensitive).
    static let uuidPattern = "^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"

    static func isUUID(_ value: String) -> Bool {
        value.range(of: uuidPattern, options: .regularExpression) != nil
    }

    /// UUID-shaped input matches on `id`; anything else matches on `slug`
    /// (the MCP branches on the same regex, then looks the slug up in the DB).
    static func resolve(_ idOrSlug: String, in journeys: [Journey]) -> Journey? {
        if isUUID(idOrSlug) {
            return journeys.first { $0.id.caseInsensitiveCompare(idOrSlug) == .orderedSame }
        }
        return journeys.first { $0.slug == idOrSlug }
    }
}

/// Pure, testable implementation of the 5 MCP tools over an in-memory `[Journey]` snapshot.
///
/// Defaults, clamps and error messages were ported 1:1 from the Cloudflare Worker's MCP tools
/// (`workers/media-proxy/src/mcp/tools/index.ts`). **That file no longer exists** — the Worker was
/// deleted in LEG-01 and its source in LEG-12, so THIS is now the only definition of those values.
/// Reach for `git log -- workers/media-proxy/src/mcp/tools/index.ts` if you ever need to see what
/// they were ported from. There is no membership/access layer locally — every journey in the store is
/// accessible (CloudKit's private DB is the equivalent scope later), so the MCP's
/// "Access denied" branch collapses into "Journey not found" when an id/slug does not resolve.
enum JourneyQuery {

    /// Success carries a decoded result; failure carries the MCP's plain-text error message
    /// (what the MCP put in `content[0].text` with `isError: true`).
    enum Outcome<T: Equatable>: Equatable {
        case success(T)
        case failure(String)
    }

    /// `Math.min(value || def, max)` — a falsy/absent/zero value falls back to `def`.
    static func clampedLimit(_ limit: Int?, default def: Int, max maximum: Int) -> Int {
        let base = (limit ?? 0) == 0 ? def : (limit ?? def)
        return Swift.max(0, Swift.min(base, maximum))
    }

    // MARK: list_journeys

    static func list(_ journeys: [Journey], limit: Int?, offset: Int?, country: String?) -> JourneyListResult {
        let clamped = clampedLimit(limit, default: 20, max: 100)
        let off = Swift.max(0, offset ?? 0)

        // MCP orders `&order=name`.
        var filtered = journeys.sorted { $0.name < $1.name }
        if let country, !country.isEmpty {
            filtered = filtered.filter { $0.country.range(of: country, options: .caseInsensitive) != nil }
        }

        // QUA-70: `total`/`hasMore` count the FILTERED set. They used to count ALL journeys "to
        // mirror the MCP Worker, whose count query ignores the country filter" — but that Worker
        // was deleted (LEG-01/LEG-12), this file became the only definition, and the preserved
        // quirk was just wrong pagination metadata: filter by country and `hasMore` could be true
        // with nothing more to fetch. Deliberate divergence from the dead Worker, per the
        // tombstone convention.
        let total = filtered.count

        let page = Array(filtered.dropFirst(off).prefix(clamped))
        let items = page.map(listItem(from:))
        let hasMore = off + items.count < total
        return JourneyListResult(journeys: items, total: total, hasMore: hasMore)
    }

    // MARK: search_journeys

    static func search(_ journeys: [Journey], query: String, limit: Int?) -> Outcome<JourneySearchResult> {
        guard !query.isEmpty else { return .failure("query is required") }
        let clamped = clampedLimit(limit, default: 10, max: 50)

        let matched = journeys.filter { j in
            j.name.range(of: query, options: .caseInsensitive) != nil
                || j.country.range(of: query, options: .caseInsensitive) != nil
                || j.description.range(of: query, options: .caseInsensitive) != nil
        }
        let items = Array(matched.prefix(clamped)).map(listItem(from:))
        return .success(JourneySearchResult(journeys: items, total: items.count))
    }

    // MARK: get_journey_details

    static func details(_ journeys: [Journey], idOrSlug: String) -> Outcome<JourneyDetailsResult> {
        guard !idOrSlug.isEmpty else { return .failure("journey_id is required") }
        guard let journey = JourneyResolver.resolve(idOrSlug, in: journeys) else {
            return .failure("Journey not found: \(idOrSlug)")
        }

        let result = JourneyDetailsResult(
            id: journey.id,
            slug: journey.slug,
            name: journey.name,
            country: journey.country,
            description: journey.description,
            dateStarted: journey.dateStarted,
            stats: journey.stats,
            camps: journey.camps.map(mcpCamp(from:)),
            route: journey.route
        )
        return .success(result)
    }

    // MARK: get_journey_stats

    static func stats(_ journeys: [Journey], idOrSlug: String) -> Outcome<JourneyStatsResult> {
        guard !idOrSlug.isEmpty else { return .failure("journey_id is required") }
        guard let journey = JourneyResolver.resolve(idOrSlug, in: journeys) else {
            return .failure("Journey not found: \(idOrSlug)")
        }
        // MCP: `if (!journey.route || !journey.stats)` → error. Locally the domain always
        // carries a `TrekStats`, so an empty route is the only "no data" condition.
        guard !journey.route.coordinates.isEmpty else {
            return .failure("Journey has no route or stats data")
        }

        let extended = ExtendedStatsCalculator.calculate(
            route: journey.route, stats: journey.stats, camps: journey.camps)
        return .success(JourneyStatsResult(
            journeyName: journey.name,
            basicStats: journey.stats,
            extendedStats: extended))
    }

    // MARK: get_journey_photos

    /// QUA-70: this was a fixtures-era stub that ALWAYS answered `photos: [], total: 0` — with
    /// `waypointId` and `limit` parsed and discarded — long after import and sync landed. The
    /// intent is exposed to Siri/Shortcuts with phrases, so a customer with a 939-photo journey
    /// was confidently told "no photos", and Shortcuts automations silently got empty JSON.
    /// Photos arrive through a provider closure so the function stays pure and fixture-testable.
    static func photos(_ journeys: [Journey],
                       photosForJourney: (String) -> [Photo],
                       idOrSlug: String, waypointId: String?, limit: Int?) -> Outcome<JourneyPhotosResult> {
        guard !idOrSlug.isEmpty else { return .failure("journey_id is required") }
        guard let journey = JourneyResolver.resolve(idOrSlug, in: journeys) else {
            return .failure("Journey not found: \(idOrSlug)")
        }
        let clamped = clampedLimit(limit, default: 50, max: 200)
        var photos = photosForJourney(journey.id).sorted { $0.sortOrder < $1.sortOrder }
        if let waypointId, !waypointId.isEmpty {
            photos = photos.filter { $0.waypointId == waypointId }
        }
        // `total` counts the FILTERED set — the metadata must describe the list it ships with
        // (see `list()`'s corrected pagination note).
        let total = photos.count
        let page = Array(photos.prefix(clamped)).map(mcpPhoto(from:))
        return .success(JourneyPhotosResult(photos: page, total: total))
    }

    static func mcpPhoto(from photo: Photo) -> MCPPhoto {
        MCPPhoto(id: photo.id,
                 journeyId: photo.journeyId,
                 waypointId: photo.waypointId,
                 url: photo.url,
                 thumbnailURL: photo.thumbnailURL,
                 caption: photo.caption,
                 coordinates: photo.coordinates,
                 takenAt: photo.takenAt,
                 isHero: photo.isHero,
                 sortOrder: photo.sortOrder)
    }

    // MARK: - Mapping helpers

    static func listItem(from journey: Journey) -> JourneyListItem {
        JourneyListItem(
            id: journey.id,
            slug: journey.slug,
            name: journey.name,
            country: journey.country,
            totalDays: journey.totalDays,
            totalDistance: journey.totalDistance,
            summitElevation: journey.summitElevation,
            dateStarted: journey.dateStarted)
    }

    static func mcpCamp(from camp: Camp) -> MCPCamp {
        MCPCamp(
            id: camp.id,
            name: camp.name,
            dayNumber: camp.dayNumber,
            elevation: camp.elevation,
            coordinates: camp.coordinates,
            notes: camp.notes,
            highlights: camp.highlights.isEmpty ? nil : camp.highlights,
            routeDistanceKm: camp.routeDistanceKm,
            routePointIndex: camp.routePointIndex)
    }
}
