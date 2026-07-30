import Foundation

/// Matches photos to journey days, ported from the web app's `src/hooks/usePhotoDay.ts`.
///
/// Four tiers, applied in order until one resolves a day number:
///   1. Explicit `waypoint_id` → the matching camp's `dayNumber`.
///   2. **Route proximity**: snap the photo to the nearest route vertex; if within **2 km**,
///      pick the first camp at/after that vertex (else the last).
///   3. Date match: `floor((taken_at − dateStarted) / 1 day) + 1`, if in `1...campCount`.
///   4. Nearest camp within **5 km** (great-circle).
/// Returns `nil` ("unassigned") when none apply.
///
/// ## QUA-94: why route proximity now outranks the date, and why the date tier was wrong
///
/// The web order put the date tier second and this file was a 1:1 port. **Measured against the
/// owner's real archive (1538 photos, 3 journeys), the date tier is wrong for the majority of a
/// library and route proximity is right.** A photo's time and its position both come from EXIF, so
/// which route leg it sits on is an independent check on which day it was filed under. Sweeping the
/// day anchor over ±4 days and scoring how many on-trek photos land on the leg of their own day:
/// Inca Trail peaks at −3 days (146/165 = 88% correct, against 0/31 at no shift) and Kilimanjaro at
/// −1 day (513/673 = 76%, against 125/621 = 20%).
///
/// The cause is not a typo. `dateStarted` is the first day of the **trip**, and a real trip begins
/// with travel: Inca Trail's day 1 is "Cusco — Preparation", 74 km from the trail. So the anchor sits
/// 1–3 days before the first camp and every photo the date tier resolves lands that many days early.
/// Independently corroborated by the authored data itself — `kilimanjaro.json` labels its day-1 camp
/// "Oct 1" while the journey's `dateStarted` is Sep 30.
///
/// The date tier is kept, because a photo with no coordinates has nothing else, and because a journey
/// whose `dateStarted` really is its first camp day is common. It is simply no longer allowed to
/// overrule a position.
///
/// ## And why tier 2 never fired before
///
/// It required `camp.routePointIndex`, which **no camp in the owner's data carries** — the recovered
/// fixtures leave it empty and the Supabase waypoints never had the column. So `campsByRouteIndex`
/// was empty, route proximity was dead code on real journeys, and the date tier answered everything
/// by default. The index is now derived from the camp's coordinates when it is absent, which is what
/// `MapGeoMath.resolvedRouteIndex` already does for the map.
struct PhotoDayMatcher {
    let waypointToDay: [String: Int]

    private let campCount: Int
    private let startDate: Date?
    private let routeCoords: [RouteCoordinate]
    /// Every camp positioned along the route, sorted by route index (tier 2).
    ///
    /// QUA-94: this used to be `compactMap { camp.routePointIndex }`, which silently produced an
    /// EMPTY list on every real journey — nothing in the owner's data carries that field — and left
    /// route proximity as dead code. The index is derived from the camp's own coordinates when the
    /// explicit one is missing.
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
        let route = journey.route.coordinates
        self.campsByRouteIndex = journey.camps
            .compactMap { camp -> (index: Int, day: Int)? in
                if let explicit = camp.routePointIndex {
                    return (min(max(explicit, 0), max(0, route.count - 1)), camp.dayNumber)
                }
                guard camp.coordinates.count >= 2, !route.isEmpty else { return nil }
                return (Self.nearestRouteIndex(route, lng: camp.coordinates[0], lat: camp.coordinates[1]),
                        camp.dayNumber)
            }
            .sorted { $0.index < $1.index }
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

        // 2. Route-segment estimation (within 2 km of the route). Ahead of the date tier since
        //    QUA-94: a position measured by the camera beats a day counted from a start date that
        //    includes travel days. See the note on this type.
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

        // 3. Date match against the journey start. Now a fallback for photos whose position cannot
        //    decide — no coordinates, or more than 2 km off the route.
        if let takenAt = photo.takenAt, let taken = Self.parseDate(takenAt), let start = startDate {
            let diffDays = floor(taken.timeIntervalSince(start) / 86_400)
            let dayNum = Int(diffDays) + 1
            if dayNum >= 1 && dayNum <= campCount { return dayNum }
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

    /// Parse a timestamp that may be a full ISO-8601 instant, or a bare `yyyy-MM-dd`
    /// date (interpreted as UTC midnight, matching JS `new Date("YYYY-MM-DD")`).
    ///
    /// QUA-08: the two `ISO8601DateFormatter` statics that used to live here were a real race, not a
    /// bookkeeping warning — this function is reached from `@MainActor JourneyStore` during SwiftUI
    /// body evaluation *and*, concurrently, from the cooperative pool through nonisolated `async`
    /// `PhotoCurationService.curate` and `PublicMirrorPublisher.publish`. `ISO8601Shared` serialises
    /// them; see that file for why serialising beats `nonisolated(unsafe)` here.
    ///
    /// Deliberately NOT confined to the `PhotoDayMatcher` instance instead: this struct is
    /// implicitly `Sendable` today (every member is `Int`/`Date?`/`[[Double]]`), and holding a
    /// formatter reference would make it non-`Sendable` — which would break the
    /// `dayOf: { matcher.day(for: $0) }` closures that cross into async work at
    /// `PublicMirrorPublisher.swift:509` and `PhotoCurationService.swift:46`.
    static func parseDate(_ string: String?) -> Date? {
        ISO8601Shared.date(from: string)
            ?? DateOnly.date(from: string)   // bare yyyy-MM-dd → UTC midnight
    }
}
