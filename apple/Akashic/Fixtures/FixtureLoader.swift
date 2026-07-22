import Foundation

/// Loads the recovered pre-Supabase trek JSON and maps it into the domain model.
///
/// The fixtures use the old camp shape (`FixtureCamp`); this is the single place that
/// translates it into `Journey`/`Camp`, and it recomputes per-day route stats via
/// `DayStats` rather than trusting the fixture's stored per-camp numbers.
enum FixtureLoader {

    /// Slugs of the bundled fixtures, in display order.
    static let fixtureNames = ["kilimanjaro", "mountKenya", "incaTrail"]

    struct FixtureError: Error, CustomStringConvertible {
        let description: String
    }

    /// Camera / centre hints recovered from the web app's `trekConfig.ts`
    /// (keyed by journey slug). Optional — `Journey.center` falls back to the route.
    private static let cameraHints: [String: (lng: Double, lat: Double, bearing: Double, pitch: Double)] = [
        "kilimanjaro": (37.3556, -3.0674, -20, 60),
        "mount-kenya": (37.3084, -0.1521, -20, 60),
        "inca-trail": (-72.5450, -13.1631, 45, 60)
    ]

    /// Load and map every bundled fixture. `bundle` defaults to the main bundle;
    /// tests pass their own bundle (the fixtures are copied into both).
    static func loadAll(bundle: Bundle = .main) throws -> [Journey] {
        try fixtureNames.map { try load(named: $0, bundle: bundle) }
    }

    /// Load one fixture by resource base-name (e.g. "kilimanjaro").
    static func load(named name: String, bundle: Bundle = .main) throws -> Journey {
        guard let url = resourceURL(named: name, bundle: bundle) else {
            throw FixtureError(description: "Fixture '\(name).json' not found in bundle \(bundle.bundleIdentifier ?? "?")")
        }
        let data = try Data(contentsOf: url)
        let trek: FixtureTrek
        do {
            trek = try JSONDecoder().decode(FixtureTrek.self, from: data)
        } catch {
            throw FixtureError(description: "Failed to decode '\(name).json': \(error)")
        }
        return map(trek)
    }

    /// Decode a `Journey` directly from raw fixture JSON data (used by tests).
    static func journey(from data: Data) throws -> Journey {
        map(try JSONDecoder().decode(FixtureTrek.self, from: data))
    }

    // MARK: - Mapping

    static func map(_ trek: FixtureTrek) -> Journey {
        let route = trek.route

        let rawCamps: [Camp] = trek.camps.map { fc in
            Camp(
                id: fc.id,
                name: fc.name,
                dayNumber: fc.dayNumber,
                elevation: fc.elevation,
                coordinates: fc.coordinates,
                notes: fc.notes ?? "",
                highlights: fc.highlights ?? [],
                terrain: fc.terrain,
                timeFromPrevious: fc.timeFromPrevious,
                dateLabel: fc.date,
                routePointIndex: nil,
                routeDistanceKm: fc.distanceFromStart,
                weather: nil
            )
        }

        // Recompute per-day distance / gain / loss from the route geometry.
        let camps = DayStats.annotate(camps: rawCamps, route: route)

        let hp = trek.stats.highestPoint.map {
            HighestPoint(name: $0.name, elevation: $0.elevation, coordinates: $0.coordinates)
        }
        let stats = TrekStats(
            duration: trek.stats.duration,
            totalDistance: trek.stats.totalDistance,
            totalElevationGain: trek.stats.totalElevationGain,
            totalElevationLoss: trek.stats.totalElevationLoss,
            highestPoint: hp
        )

        let hint = cameraHints[trek.slug]

        return Journey(
            id: trek.slug,           // fixtures use slug as stable identity
            slug: trek.slug,
            name: trek.name,
            country: trek.country,
            description: trek.description ?? "",
            heroImageURL: trek.heroImage,
            dateStarted: trek.dates?.start,
            dateEnded: trek.dates?.end,
            isPublic: true,
            summitElevation: hp?.elevation,
            totalDistance: trek.stats.totalDistance,
            totalDays: trek.stats.duration,
            centerCoordinates: hint.map { [$0.lng, $0.lat] },
            preferredBearing: hint?.bearing,
            preferredPitch: hint?.pitch,
            stats: stats,
            route: route,
            camps: camps
        )
    }

    // MARK: - Resource lookup

    private static func resourceURL(named name: String, bundle: Bundle) -> URL? {
        // Try exact name, then a couple of common casings between fixture files
        // (files are `mountKenya.json` / `incaTrail.json`).
        let candidates = [name, name.lowercased(), slugCase(name)]
        for candidate in candidates {
            if let url = bundle.url(forResource: candidate, withExtension: "json") {
                return url
            }
        }
        return nil
    }

    /// "mountKenya" -> "mount-kenya" (best-effort alternate lookup).
    private static func slugCase(_ camel: String) -> String {
        var out = ""
        for ch in camel {
            if ch.isUppercase { out += "-" + ch.lowercased() } else { out.append(ch) }
        }
        return out
    }
}
