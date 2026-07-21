import CoreData

/// Maps between the domain `Journey`/`Camp` value types and the Core Data entities.
///
/// This is the seam that lets the same domain model come from either the fixtures or a
/// (Cloud)Kit-backed store. JSONB-style payloads are packed into Binary attributes as JSON;
/// per-day camp stats are *recomputed* on read via `DayStats`, so they never drift.
enum CoreDataMapping {

    // MARK: - Domain -> Core Data

    /// Insert or update the journey (matched by `id`) and rebuild its waypoints.
    @discardableResult
    static func upsertJourney(_ journey: Journey, into context: NSManagedObjectContext) -> CDJourney {
        let request = NSFetchRequest<CDJourney>(entityName: "CDJourney")
        request.predicate = NSPredicate(format: "id == %@", journey.id)
        request.fetchLimit = 1
        let cd = (try? context.fetch(request))?.first ?? CDJourney(context: context)

        cd.id = journey.id
        cd.slug = journey.slug
        cd.name = journey.name
        cd.country = journey.country
        cd.journeyDescription = journey.description
        cd.heroImageURL = journey.heroImageURL
        cd.dateStarted = DateOnly.date(from: journey.dateStarted)
        cd.dateEnded = DateOnly.date(from: journey.dateEnded)
        cd.isPublic = journey.isPublic
        cd.journeyType = "trek"
        cd.summitElevation = Int64(journey.summitElevation ?? 0)
        cd.totalDistance = journey.totalDistance ?? 0
        cd.totalDays = Int64(journey.totalDays ?? 0)
        cd.preferredBearing = journey.preferredBearing ?? 0
        cd.preferredPitch = journey.preferredPitch ?? 60
        cd.centerCoordinates = JSONCoding.encode(journey.centerCoordinates)
        cd.route = JSONCoding.encode(journey.route)
        cd.stats = JSONCoding.encode(journey.stats)
        if cd.createdAt == nil { cd.createdAt = Date() }
        cd.updatedAt = Date()

        // Rebuild waypoints from scratch (seed/upsert is authoritative).
        if let existing = cd.waypoints as? Set<CDWaypoint> {
            existing.forEach(context.delete)
        }
        for (index, camp) in journey.camps.enumerated() {
            let wp = CDWaypoint(context: context)
            apply(camp: camp, to: wp, sortOrder: index, journeyId: journey.id)
            wp.journey = cd
        }
        return cd
    }

    private static func apply(camp: Camp, to wp: CDWaypoint, sortOrder: Int, journeyId: String) {
        wp.id = camp.id
        wp.journeyId = journeyId
        wp.name = camp.name
        wp.waypointType = "camp"
        wp.dayNumber = Int64(camp.dayNumber)
        wp.elevation = Int64(camp.elevation)
        wp.coordinates = JSONCoding.encode(camp.coordinates)
        wp.waypointDescription = camp.notes
        wp.highlights = JSONCoding.encode(camp.highlights)
        wp.terrain = camp.terrain
        wp.timeFromPrevious = camp.timeFromPrevious
        wp.dateLabel = camp.dateLabel
        // Use -1 (not 0) as the "absent" sentinel: 0.0 is a legitimate cumulative distance
        // (e.g. Mount Kenya's Saruni Basecamp) that a 0-sentinel would silently drop to nil.
        wp.routeDistanceKm = camp.routeDistanceKm ?? -1
        wp.routePointIndex = Int64(camp.routePointIndex ?? 0)
        wp.sortOrder = Int64(sortOrder)
        wp.weather = JSONCoding.encode(camp.weather)
        wp.createdAt = wp.createdAt ?? Date()
    }

    // MARK: - Core Data -> Domain

    static func journey(from cd: CDJourney) -> Journey {
        let route = JSONCoding.decode(Route.self, from: cd.route) ?? .empty
        let stats = JSONCoding.decode(TrekStats.self, from: cd.stats)
            ?? TrekStats(duration: Int(cd.totalDays),
                         totalDistance: cd.totalDistance,
                         totalElevationGain: 0,
                         totalElevationLoss: nil,
                         highestPoint: nil)

        let waypoints = (cd.waypoints as? Set<CDWaypoint> ?? [])
            .sorted { $0.sortOrder < $1.sortOrder }
        let rawCamps = waypoints.map(camp(from:))
        // Recompute per-day stats so reads are consistent regardless of what was stored.
        let camps = DayStats.annotate(camps: rawCamps, route: route)

        return Journey(
            id: cd.id ?? UUID().uuidString,
            slug: cd.slug ?? "",
            name: cd.name ?? "",
            country: cd.country ?? "",
            description: cd.journeyDescription ?? "",
            heroImageURL: cd.heroImageURL,
            dateStarted: DateOnly.string(from: cd.dateStarted),
            dateEnded: DateOnly.string(from: cd.dateEnded),
            isPublic: cd.isPublic,
            summitElevation: cd.summitElevation == 0 ? stats.highestPoint?.elevation : Int(cd.summitElevation),
            totalDistance: cd.totalDistance,
            totalDays: Int(cd.totalDays),
            centerCoordinates: JSONCoding.decode([Double].self, from: cd.centerCoordinates),
            preferredBearing: cd.preferredBearing,
            preferredPitch: cd.preferredPitch,
            stats: stats,
            route: route,
            camps: camps
        )
    }

    private static func camp(from wp: CDWaypoint) -> Camp {
        Camp(
            id: wp.id ?? UUID().uuidString,
            name: wp.name ?? "",
            dayNumber: Int(wp.dayNumber),
            elevation: Int(wp.elevation),
            coordinates: JSONCoding.decode([Double].self, from: wp.coordinates) ?? [],
            notes: wp.waypointDescription ?? "",
            highlights: JSONCoding.decode([String].self, from: wp.highlights) ?? [],
            terrain: wp.terrain,
            timeFromPrevious: wp.timeFromPrevious,
            dateLabel: wp.dateLabel,
            routePointIndex: Int(wp.routePointIndex),
            routeDistanceKm: wp.routeDistanceKm < 0 ? nil : wp.routeDistanceKm,
            weather: JSONCoding.decode(WeatherData.self, from: wp.weather)
        )
    }
}
