import CoreData

/// Maps between the domain `Journey`/`Camp` value types and the Core Data entities.
///
/// This is the seam that lets the same domain model come from either the fixtures or a
/// (Cloud)Kit-backed store. JSONB-style payloads are packed into Binary attributes as JSON;
/// per-day camp stats are *recomputed* on read via `DayStats`, so they never drift.
enum CoreDataMapping {

    // MARK: - Domain -> Core Data

    /// Insert or update the journey (matched by `id`) and upsert its waypoints.
    ///
    /// User-editable fields (photo captions/rotation/hero/assignment; waypoint
    /// name/description/highlights/elevation/dayNumber) are seeded on **create only**, so a
    /// re-import never clobbers native edits — it refreshes structural/media fields and leaves
    /// the edited fields intact. A fresh import after `resetJourneys()` still writes everything
    /// (every row is created anew).
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

        // Upsert waypoints by id (keyed on `camp.id`) so a re-import preserves natively-edited
        // waypoint fields. Waypoints no longer present in the import are removed.
        let existingWaypoints = cd.waypoints as? Set<CDWaypoint> ?? []
        var existingByID: [String: CDWaypoint] = [:]
        for wp in existingWaypoints {
            if let id = wp.id { existingByID[id] = wp }
        }
        var keptIDs: Set<String> = []
        for (index, camp) in journey.camps.enumerated() {
            let existing = existingByID[camp.id]
            let wp = existing ?? CDWaypoint(context: context)
            apply(camp: camp, to: wp, sortOrder: index, journeyId: journey.id, created: existing == nil)
            wp.journey = cd
            keptIDs.insert(camp.id)
        }
        for wp in existingWaypoints where !(wp.id.map(keptIDs.contains) ?? false) {
            context.delete(wp)
        }
        return cd
    }

    private static func apply(camp: Camp, to wp: CDWaypoint, sortOrder: Int, journeyId: String, created: Bool) {
        wp.id = camp.id
        wp.journeyId = journeyId
        wp.waypointType = "camp"
        wp.coordinates = JSONCoding.encode(camp.coordinates)
        wp.terrain = camp.terrain
        wp.timeFromPrevious = camp.timeFromPrevious
        wp.dateLabel = camp.dateLabel
        // Use -1 (not 0) as the "absent" sentinel: 0.0 is a legitimate cumulative distance
        // (e.g. Mount Kenya's Saruni Basecamp) that a 0-sentinel would silently drop to nil.
        wp.routeDistanceKm = camp.routeDistanceKm ?? -1
        wp.routePointIndex = Int64(camp.routePointIndex ?? 0)
        wp.sortOrder = Int64(sortOrder)
        wp.weather = JSONCoding.encode(camp.weather)
        wp.funFacts = JSONCoding.encode(camp.funFacts)
        wp.pointsOfInterest = JSONCoding.encode(camp.pointsOfInterest)
        wp.historicalSites = JSONCoding.encode(camp.historicalSites)
        // User-editable fields: seed on create only so a re-import preserves native edits.
        if created {
            wp.name = camp.name
            wp.dayNumber = Int64(camp.dayNumber)
            wp.elevation = Int64(camp.elevation)
            wp.waypointDescription = camp.notes
            wp.highlights = JSONCoding.encode(camp.highlights)
        }
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
            mediaShareURL: cd.mediaShareURL,
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

    // MARK: - Photos

    /// Insert or update a photo (matched by `id`), wiring the (already-resolved) journey and
    /// waypoint relationships. Returns the row and whether it was newly created.
    ///
    /// Relationships are passed in (rather than fetched here) so a bulk import can resolve
    /// them once from an in-memory cache instead of a fetch-per-photo.
    @discardableResult
    static func upsertPhoto(_ photo: Photo,
                            into context: NSManagedObjectContext,
                            journey: CDJourney?,
                            waypoint: CDWaypoint?) -> (photo: CDPhoto, created: Bool) {
        let request = NSFetchRequest<CDPhoto>(entityName: "CDPhoto")
        request.predicate = NSPredicate(format: "id == %@", photo.id)
        request.fetchLimit = 1
        let existing = (try? context.fetch(request))?.first
        let created = existing == nil
        let cd = existing ?? CDPhoto(context: context)

        cd.id = photo.id
        cd.journeyId = photo.journeyId
        // Structural / media fields: always refreshed so a re-import picks up new URLs,
        // resolved local paths and metadata.
        cd.url = photo.url
        cd.thumbnailURL = photo.thumbnailURL
        cd.takenAt = PhotoDayMatcher.parseDate(photo.takenAt)
        cd.mediaType = photo.mediaType
        cd.duration = Int64(photo.duration ?? 0)
        cd.localOriginalPath = photo.localOriginalPath
        cd.localThumbPath = photo.localThumbPath
        // User-editable fields: seed on create only so a re-import never clobbers native edits.
        if created {
            cd.waypointId = photo.waypointId
            cd.caption = photo.caption
            cd.coordinates = JSONCoding.encode(photo.coordinates)
            cd.isHero = photo.isHero
            cd.sortOrder = Int64(photo.sortOrder)
            cd.rotation = Int64(photo.rotation)
            cd.locationSource = photo.locationSource
        }
        if cd.createdAt == nil { cd.createdAt = Date() }
        cd.journey = journey
        cd.waypoint = waypoint
        return (cd, created)
    }

    static func photo(from cd: CDPhoto) -> Photo {
        Photo(
            id: cd.id ?? UUID().uuidString,
            journeyId: cd.journeyId ?? "",
            waypointId: cd.waypointId,
            url: cd.url ?? "",
            thumbnailURL: cd.thumbnailURL,
            caption: cd.caption,
            coordinates: JSONCoding.decode([Double].self, from: cd.coordinates),
            takenAt: isoString(from: cd.takenAt),
            isHero: cd.isHero,
            sortOrder: Int(cd.sortOrder),
            rotation: Int(cd.rotation),
            mediaType: cd.mediaType ?? "image",
            duration: cd.duration == 0 ? nil : Int(cd.duration),
            locationSource: cd.locationSource,
            localOriginalPath: cd.localOriginalPath,
            localThumbPath: cd.localThumbPath)
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static func isoString(from date: Date?) -> String? {
        guard let date else { return nil }
        return isoFormatter.string(from: date)
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
            weather: JSONCoding.decode(WeatherData.self, from: wp.weather),
            funFacts: JSONCoding.decode([FunFact].self, from: wp.funFacts),
            pointsOfInterest: JSONCoding.decode([PointOfInterest].self, from: wp.pointsOfInterest),
            historicalSites: JSONCoding.decode([HistoricalSite].self, from: wp.historicalSites)
        )
    }

    // MARK: - Comments
    //
    // Day-comment mapping (web parity: `commentAPI`). Kept in a self-contained section so it
    // sits apart from the sibling photo/journey work in this file. `CommentService` owns
    // validation + local author identity; this layer only translates rows <-> domain.

    /// Insert a new `CDDayComment`, wiring the (already-resolved) journey/waypoint relationships.
    /// Timestamps and identity are passed in so the caller (`CommentService`) stays the single
    /// source of truth for the local author and clock.
    @discardableResult
    static func insertDayComment(id: String,
                                 waypointId: String,
                                 journeyId: String,
                                 userId: String,
                                 authorName: String,
                                 content: String,
                                 createdAt: Date,
                                 updatedAt: Date,
                                 into context: NSManagedObjectContext,
                                 journey: CDJourney?,
                                 waypoint: CDWaypoint?) -> CDDayComment {
        let cd = CDDayComment(context: context)
        cd.id = id
        cd.waypointId = waypointId
        cd.journeyId = journeyId
        cd.userId = userId
        cd.authorDisplayName = authorName
        cd.content = content
        cd.createdAt = createdAt
        cd.updatedAt = updatedAt
        cd.journey = journey
        cd.waypoint = waypoint
        return cd
    }

    /// Map a stored comment to the domain type. `isMine` is resolved against `currentUserId`
    /// (the local user id in fixtures/.local mode; the `creatorUserRecordID` under CloudKit).
    static func dayComment(from cd: CDDayComment, currentUserId: String?) -> DayComment {
        let created = cd.createdAt ?? Date()
        return DayComment(
            id: cd.id ?? UUID().uuidString,
            waypointId: cd.waypointId ?? "",
            journeyId: cd.journeyId ?? "",
            authorName: (cd.authorDisplayName?.isEmpty == false ? cd.authorDisplayName : nil) ?? "Anonymous",
            content: cd.content ?? "",
            createdAt: created,
            updatedAt: cd.updatedAt ?? created,
            isMine: currentUserId != nil && cd.userId == currentUserId
        )
    }
}
