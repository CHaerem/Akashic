import Foundation

/// Resolves R2 object *paths* (as stored in the DB, e.g.
/// `journeys/{jid}/photos/{pid}.jpg`) to absolute on-disk paths under a media root
/// (e.g. `<export>/r2/objects`), returning `nil` when the bytes are not present.
///
/// This is shared by every import sink: the local importer records the path for file-URL
/// display; the future CloudKit importer would read the same path to attach CKAsset bytes.
struct MediaResolver: Sendable {
    let root: URL

    /// QUA-34: computed, not stored. `FileManager` is not `Sendable`, and this was an injection seam
    /// no caller ever used — exactly the shape `MediaLibrary` had in QUA-08. Storing one would keep
    /// this struct non-`Sendable`, which is what stopped it being handed into a `Task`.
    private var fileManager: FileManager { .default }

    init(root: URL) {
        self.root = root
    }

    /// Absolute path if the object exists under the media root, else `nil`.
    func resolve(_ relativePath: String?) -> String? {
        guard let rel = relativePath, !rel.isEmpty else { return nil }
        let cleaned = rel.hasPrefix("/") ? String(rel.dropFirst()) : rel
        let url = root.appendingPathComponent(cleaned)
        return fileManager.fileExists(atPath: url.path) ? url.path : nil
    }
}

/// Pure, sink-agnostic transform from `ExportBundle` rows into the app's domain model.
///
/// Reused verbatim by any importer (local Core Data tonight; CloudKit in T2.5) — only the
/// write step downstream differs. Preserves ALL original UUIDs (journey/waypoint/photo ids)
/// so the R2 object layout and any external references stay valid end-to-end.
enum ExportMapper {

    // MARK: Journeys

    /// Every journey in the bundle, with its waypoints mapped to camps and per-day route
    /// stats recomputed (matching `FixtureLoader`). Waypoints are matched by `journey_id`.
    static func journeys(from bundle: ExportBundle) -> [Journey] {
        let waypointsByJourney = Dictionary(grouping: bundle.waypoints) { $0.journeyId ?? "" }
        return bundle.journeys.map { row in
            journey(from: row, waypoints: waypointsByJourney[row.id] ?? [])
        }
    }

    static func journey(from row: JourneyRow, waypoints: [WaypointRow]) -> Journey {
        let route = row.route ?? .empty

        let ordered = waypoints.sorted { lhs, rhs in
            let ls = lhs.sortOrder ?? lhs.dayNumber ?? Int.max
            let rs = rhs.sortOrder ?? rhs.dayNumber ?? Int.max
            if ls != rs { return ls < rs }
            return (lhs.dayNumber ?? 0) < (rhs.dayNumber ?? 0)
        }
        let rawCamps = ordered.map(camp(from:))
        let camps = DayStats.annotate(camps: rawCamps, route: route)

        let stats = row.stats ?? TrekStats(
            duration: row.totalDays ?? 0,
            totalDistance: row.totalDistance ?? 0,
            totalElevationGain: 0,
            totalElevationLoss: nil,
            highestPoint: nil)

        return Journey(
            id: row.id,                       // preserve the original Postgres UUID
            slug: row.slug,
            name: row.name,
            country: row.country ?? "",
            description: row.description ?? "",
            heroImageURL: row.heroImageUrl,
            dateStarted: row.dateStarted,
            dateEnded: row.dateEnded,
            isPublic: row.isPublic ?? false,
            // S2: the Supabase export already carries `journey_type` (`JourneyRow.journeyType`)
            // — it was just being dropped on the floor here instead of reaching the domain model.
            journeyType: row.journeyType ?? "trek",
            summitElevation: row.summitElevation ?? stats.highestPoint?.elevation,
            totalDistance: row.totalDistance,
            totalDays: row.totalDays,
            centerCoordinates: row.centerCoordinates?.lngLat,
            preferredBearing: row.preferredBearing,
            preferredPitch: row.preferredPitch,
            stats: stats,
            route: route,
            camps: camps)
    }

    static func camp(from wp: WaypointRow) -> Camp {
        Camp(
            id: wp.id,                        // preserve the original Postgres UUID
            name: wp.name,
            dayNumber: wp.dayNumber ?? 0,
            elevation: wp.elevation ?? 0,
            coordinates: wp.coordinates.lngLat,
            notes: wp.description ?? "",
            highlights: wp.highlights ?? [],
            terrain: nil,
            timeFromPrevious: nil,
            dateLabel: nil,
            routePointIndex: wp.routePointIndex,
            routeDistanceKm: wp.routeDistanceKm,
            weather: wp.weather,
            funFacts: wp.funFacts,
            pointsOfInterest: wp.pointsOfInterest,
            historicalSites: wp.historicalSites)
    }

    // MARK: Photos

    /// Every photo in the bundle, mapped to the domain `Photo` with local media paths
    /// resolved against `media` (existence-checked; `nil` when the object hasn't downloaded).
    static func photos(from bundle: ExportBundle, media: MediaResolver) -> [Photo] {
        bundle.photos.map { photo(from: $0, media: media) }
    }

    static func photo(from row: PhotoRow, media: MediaResolver) -> Photo {
        Photo(
            id: row.id,                       // preserve the original Postgres UUID (= R2 photoId)
            journeyId: row.journeyId ?? "",
            waypointId: row.waypointId,
            url: row.url,
            thumbnailURL: row.thumbnailUrl,
            caption: row.caption,
            coordinates: row.coordinates?.lngLat,
            takenAt: row.takenAt,
            isHero: row.isHero ?? false,
            sortOrder: row.sortOrder ?? 0,
            rotation: row.rotation ?? 0,
            mediaType: row.mediaType ?? "image",
            duration: row.duration,
            locationSource: row.locationSource,
            localOriginalPath: media.resolve(row.url),
            localThumbPath: media.resolve(row.thumbnailUrl))
    }
}
