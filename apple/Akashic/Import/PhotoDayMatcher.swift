import Foundation

/// Matches photos to journey days, ported 1:1 from the web app's `src/hooks/usePhotoDay.ts`.
///
/// Four-tier strategy, applied in order until one resolves a day number:
///   1. Explicit `waypoint_id` → the matching camp's `dayNumber`.
///   2. Date match: `floor((taken_at − dateStarted) / 1 day) + 1`, if in `1...campCount`.
///   3. Route proximity: snap the photo to the nearest route vertex; if within **2 km**,
///      pick the first camp whose `routePointIndex` is at/after that vertex (else the last).
///   4. Nearest camp within **5 km** (great-circle).
/// Returns `nil` ("unassigned") when none apply.
struct PhotoDayMatcher {
    let waypointToDay: [String: Int]

    private let campCount: Int
    private let startDate: Date?
    private let routeCoords: [RouteCoordinate]
    /// Camps carrying a `routePointIndex`, sorted ascending (tier 3).
    private let campsByRouteIndex: [(index: Int, day: Int)]
    /// (lng, lat, day) for every camp with coordinates (tier 4).
    private let campPoints: [(lng: Double, lat: Double, day: Int)]

    init(journey: Journey) {
        var map: [String: Int] = [:]
        for camp in journey.camps { map[camp.id] = camp.dayNumber }
        self.waypointToDay = map
        self.campCount = journey.camps.count
        self.startDate = Self.parseDate(journey.dateStarted)
        self.routeCoords = journey.route.coordinates
        self.campsByRouteIndex = journey.camps
            .compactMap { camp in camp.routePointIndex.map { ($0, camp.dayNumber) } }
            .sorted { $0.0 < $1.0 }
        self.campPoints = journey.camps
            .filter { $0.coordinates.count >= 2 }
            .map { (lng: $0.coordinates[0], lat: $0.coordinates[1], day: $0.dayNumber) }
    }

    /// The day number for a single photo, or `nil` if it can't be determined.
    func day(for photo: Photo) -> Int? {
        // 1. Explicit waypoint assignment.
        if let wpID = photo.waypointId, let day = waypointToDay[wpID] {
            return day
        }

        // 2. Date match against the journey start.
        if let takenAt = photo.takenAt, let taken = Self.parseDate(takenAt), let start = startDate {
            let diffDays = floor(taken.timeIntervalSince(start) / 86_400)
            let dayNum = Int(diffDays) + 1
            if dayNum >= 1 && dayNum <= campCount { return dayNum }
        }

        // 3. Route-segment estimation (within 2 km of the route).
        if let coords = photo.coordinates, coords.count >= 2,
           !routeCoords.isEmpty, campCount > 0 {
            let photoLng = coords[0], photoLat = coords[1]
            let idx = Self.nearestRouteIndex(routeCoords, lng: photoLng, lat: photoLat)
            let point = routeCoords[idx]
            if point.count >= 2 {
                let distToRoute = Self.distanceKm(photoLat, photoLng, point[1], point[0])
                if distToRoute < 2 {
                    for camp in campsByRouteIndex where idx <= camp.index {
                        return camp.day
                    }
                    if let last = campsByRouteIndex.last { return last.day }
                }
            }
        }

        // 4. Nearest camp within 5 km.
        if let coords = photo.coordinates, coords.count >= 2, !campPoints.isEmpty {
            let photoLng = coords[0], photoLat = coords[1]
            var nearestDay: Int?
            var minDistance = Double.greatestFiniteMagnitude
            for camp in campPoints {
                let d = Self.distanceKm(photoLat, photoLng, camp.lat, camp.lng)
                if d < minDistance { minDistance = d; nearestDay = camp.day }
            }
            if let nearestDay, minDistance < 5 { return nearestDay }
        }

        return nil
    }

    /// Photos assigned to a specific day.
    func photos(forDay day: Int, from photos: [Photo]) -> [Photo] {
        photos.filter { self.day(for: $0) == day }
    }

    /// Photos grouped by resolved day, plus everything that couldn't be matched.
    func groupByDay(_ photos: [Photo]) -> (byDay: [Int: [Photo]], unassigned: [Photo]) {
        var byDay: [Int: [Photo]] = [:]
        var unassigned: [Photo] = []
        for photo in photos {
            if let day = day(for: photo) {
                byDay[day, default: []].append(photo)
            } else {
                unassigned.append(photo)
            }
        }
        return (byDay, unassigned)
    }

    // MARK: - Geometry (matches src/utils/geography.ts)

    /// Great-circle distance in km (Haversine).
    static func distanceKm(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let earthRadiusKm = 6371.0
        let dLat = deg2rad(lat2 - lat1)
        let dLon = deg2rad(lon2 - lon1)
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(deg2rad(lat1)) * cos(deg2rad(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadiusKm * c
    }

    /// Index of the nearest route vertex by squared planar distance in lng/lat space
    /// (matches `findNearestCoordIndex` — faster than Haversine for comparison only).
    static func nearestRouteIndex(_ route: [RouteCoordinate], lng: Double, lat: Double) -> Int {
        guard !route.isEmpty else { return 0 }
        var minDist = Double.greatestFiniteMagnitude
        var nearest = 0
        for (i, c) in route.enumerated() where c.count >= 2 {
            let dist = (c[0] - lng) * (c[0] - lng) + (c[1] - lat) * (c[1] - lat)
            if dist < minDist { minDist = dist; nearest = i }
        }
        return nearest
    }

    private static func deg2rad(_ deg: Double) -> Double { deg * .pi / 180 }

    // MARK: - Date parsing

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Parse a timestamp that may be a full ISO-8601 instant, or a bare `yyyy-MM-dd`
    /// date (interpreted as UTC midnight, matching JS `new Date("YYYY-MM-DD")`).
    static func parseDate(_ string: String?) -> Date? {
        guard let s = string, !s.isEmpty else { return nil }
        if let d = iso.date(from: s) { return d }
        if let d = isoWithFraction.date(from: s) { return d }
        return DateOnly.date(from: s)   // bare yyyy-MM-dd → UTC midnight
    }
}
