import Foundation

// MARK: - Draft day

/// A proposed day/camp while a journey is being built. Turned into a `Camp` on create
/// (`dayNumber` = position + 1). Coordinates are `[lng, lat]` (GeoJSON order) and may be empty
/// for a manual day the user hasn't placed yet.
struct DraftDay: Identifiable, Equatable {
    /// Where this day came from — drives copy and lets the UI badge auto-proposed rows.
    enum Source: Equatable { case gpxWaypoint, photoCluster, manual }

    var id: String = UUID().uuidString
    var name: String
    var elevation: Int = 0
    var coordinates: [Double] = []      // [lng, lat]
    var dateLabel: String?
    var notes: String = ""
    var source: Source = .manual
}

// MARK: - Draft

/// A journey being created from scratch. Route is optional and a draft with no route and no days
/// is still valid (a photos-only trip). The static proposal + stats engine below is pure and
/// heavily unit-tested; the UI (`NewJourneySheet`) is a thin editor over this value.
struct JourneyDraft: Equatable {
    /// Stable identity, minted up front so photo files ingested before create already key to it.
    var id: String = UUID().uuidString.lowercased()
    var name: String = ""
    var country: String = ""
    var description: String = ""
    var dateStarted: Date?
    var dateEnded: Date?
    /// Optional route (GeoJSON LineString, `[lng, lat, ele?]`). `nil` = no route yet.
    var route: Route?
    var days: [DraftDay] = []

    /// A journey needs at least a name; everything else (route, days, dates) is optional.
    var isValid: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var hasRoute: Bool { (route?.coordinates.isEmpty == false) }

    // MARK: Day proposal

    /// One day per GPX waypoint, in document order (name, elevation, coordinates, date).
    static func days(fromWaypoints waypoints: [GPXWaypoint]) -> [DraftDay] {
        waypoints.enumerated().map { index, wpt in
            let name = wpt.name?.trimmingCharacters(in: .whitespacesAndNewlines)
            return DraftDay(
                name: (name?.isEmpty == false ? name! : "Day \(index + 1)"),
                elevation: wpt.elevation.map { Int($0.rounded()) } ?? 0,
                coordinates: wpt.coordinates.count >= 2 ? [wpt.coordinates[0], wpt.coordinates[1]] : [],
                dateLabel: wpt.time.map(Self.dateLabel(from:)),
                notes: wpt.desc?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
                source: .gpxWaypoint)
        }
    }

    /// PhotoDayMatcher in reverse: cluster photos by calendar day (UTC), then propose Day 1…N in
    /// chronological order. Each day's coordinates are the median of that day's geotagged photos
    /// (empty when none carry GPS). Photos with no `takenAt` are ignored (they can't seed a day).
    static func days(fromPhotos photos: [Photo]) -> [DraftDay] {
        var buckets: [String: [Photo]] = [:]
        for photo in photos {
            guard let date = PhotoDayMatcher.parseDate(photo.takenAt) else { continue }
            buckets[dayKey(from: date), default: []].append(photo)
        }
        return buckets.keys.sorted().enumerated().map { index, key in
            let bucket = buckets[key] ?? []
            let coords = medianCoordinate(bucket.compactMap { $0.coordinates })
            return DraftDay(
                name: "Day \(index + 1)",
                coordinates: coords ?? [],
                dateLabel: displayLabel(fromDayKey: key),
                source: .photoCluster)
        }
    }

    // MARK: Stats

    /// Elevation gain/loss over a route, in metres, with a small smoothing threshold so GPS
    /// jitter doesn't inflate the totals. Hysteresis: a running reference elevation only advances
    /// once the signal moves more than `smoothing` from it, and each such move is booked as gain
    /// or loss. Points without a finite elevation are skipped.
    static func elevationGainLoss(route: [RouteCoordinate], smoothing: Double = 3.0) -> (gain: Int, loss: Int) {
        var reference: Double?
        var gain = 0.0
        var loss = 0.0
        for coordinate in route where coordinate.count >= 3 {
            let elevation = coordinate[2]
            guard elevation.isFinite else { continue }
            guard let ref = reference else { reference = elevation; continue }
            let delta = elevation - ref
            if abs(delta) < smoothing { continue }
            if delta > 0 { gain += delta } else { loss += -delta }
            reference = elevation
        }
        return (Int(gain.rounded()), Int(loss.rounded()))
    }

    /// Great-circle length of the route in km (Haversine over consecutive `[lng, lat]` points).
    static func totalDistanceKm(route: [RouteCoordinate]) -> Double {
        guard route.count > 1 else { return 0 }
        var total = 0.0
        for i in 1..<route.count {
            let a = route[i - 1], b = route[i]
            guard a.count >= 2, b.count >= 2 else { continue }
            total += PhotoDayMatcher.distanceKm(a[1], a[0], b[1], b[0])
        }
        return total
    }

    /// Highest point of the route (max elevation), named after the journey.
    static func highestPoint(route: [RouteCoordinate], name: String) -> HighestPoint? {
        var best: [Double]?
        for coordinate in route where coordinate.count >= 3 && coordinate[2].isFinite {
            if best == nil || coordinate[2] > best![2] { best = coordinate }
        }
        guard let best else { return nil }
        return HighestPoint(name: name.isEmpty ? "Highest point" : name,
                            elevation: Int(best[2].rounded()),
                            coordinates: [best[0], best[1]])
    }

    /// Duration in days: the day count when days exist, else the inclusive date span, else 0.
    static func duration(dayCount: Int, dateStarted: Date?, dateEnded: Date?) -> Int {
        if dayCount > 0 { return dayCount }
        if let start = dateStarted, let end = dateEnded, end >= start {
            return Int(floor(end.timeIntervalSince(start) / 86_400)) + 1
        }
        return 0
    }

    /// Auto-computed stats for the draft (distance / elevation from the route when present,
    /// duration from days or dates).
    static func computeStats(route: Route?, days: [DraftDay],
                             dateStarted: Date?, dateEnded: Date?, name: String) -> TrekStats {
        let coordinates = route?.coordinates ?? []
        let distance = (totalDistanceKm(route: coordinates) * 10).rounded() / 10
        let (gain, loss) = elevationGainLoss(route: coordinates)
        return TrekStats(
            duration: duration(dayCount: days.count, dateStarted: dateStarted, dateEnded: dateEnded),
            totalDistance: distance,
            totalElevationGain: gain,
            totalElevationLoss: coordinates.isEmpty ? nil : loss,
            highestPoint: highestPoint(route: coordinates, name: name))
    }

    // MARK: Build

    /// Materialise the draft into a domain `Journey` ready for persistence. `existingSlugs`
    /// uniquifies the generated slug. Per-day route stats are (re)derived on read by
    /// `CoreDataMapping`/`DayStats`, so camps carry only the authored fields here.
    func makeJourney(existingSlugs: [String] = []) -> Journey {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let slug = Self.uniqueSlug(from: trimmedName, existing: existingSlugs)
        let theRoute = route ?? .empty

        let camps: [Camp] = days.enumerated().map { index, day in
            let dayName = day.name.trimmingCharacters(in: .whitespacesAndNewlines)
            return Camp(
                id: day.id,
                name: dayName.isEmpty ? "Day \(index + 1)" : dayName,
                dayNumber: index + 1,
                elevation: day.elevation,
                coordinates: day.coordinates,
                notes: day.notes,
                highlights: [],
                terrain: nil,
                timeFromPrevious: nil,
                dateLabel: day.dateLabel,
                routePointIndex: nil,
                routeDistanceKm: nil,
                weather: nil)
        }

        let stats = Self.computeStats(route: route, days: days,
                                      dateStarted: dateStarted, dateEnded: dateEnded,
                                      name: trimmedName)

        return Journey(
            id: id,
            slug: slug,
            name: trimmedName,
            country: country.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            heroImageURL: nil,
            dateStarted: DateOnly.string(from: dateStarted),
            dateEnded: DateOnly.string(from: dateEnded),
            isPublic: false,
            summitElevation: stats.highestPoint?.elevation,
            totalDistance: stats.totalDistance,
            totalDays: stats.duration,
            centerCoordinates: nil,
            preferredBearing: nil,
            preferredPitch: nil,
            stats: stats,
            route: theRoute,
            camps: camps)
    }

    // MARK: - Slug

    /// kebab-case an arbitrary name into an URL-safe slug (ASCII letters/digits, dash-separated).
    static func slugify(_ name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive],
                                  locale: Locale(identifier: "en_US_POSIX"))
        var out = ""
        var lastWasDash = false
        for scalar in folded.unicodeScalars {
            let ch = Character(scalar)
            if scalar.isASCII && (ch.isLetter || ch.isNumber) {
                out.append(Character(ch.lowercased()))
                lastWasDash = false
            } else if !lastWasDash {
                out.append("-")
                lastWasDash = true
            }
        }
        let trimmed = out.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return trimmed.isEmpty ? "journey" : trimmed
    }

    /// Slug for `name`, suffixed `-2`, `-3`… until it doesn't collide with `existing`.
    static func uniqueSlug(from name: String, existing: [String]) -> String {
        let base = slugify(name)
        let taken = Set(existing)
        guard taken.contains(base) else { return base }
        var suffix = 2
        while taken.contains("\(base)-\(suffix)") { suffix += 1 }
        return "\(base)-\(suffix)"
    }

    // MARK: - Date / clustering helpers

    /// UTC `yyyy-MM-dd` bucket key (sorts chronologically as a plain string).
    static func dayKey(from date: Date) -> String {
        Self.keyFormatter.string(from: date)
    }

    /// Median `[lng, lat]` of a set of coordinates (per-axis median), or nil when empty.
    static func medianCoordinate(_ coordinates: [[Double]]) -> [Double]? {
        let valid = coordinates.filter { $0.count >= 2 }
        guard !valid.isEmpty else { return nil }
        let lngs = valid.map { $0[0] }.sorted()
        let lats = valid.map { $0[1] }.sorted()
        return [median(lngs), median(lats)]
    }

    private static func median(_ sorted: [Double]) -> Double {
        let count = sorted.count
        if count % 2 == 1 { return sorted[count / 2] }
        return (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    }

    /// Human date label for a day, e.g. "29 Sep 2023" (UTC).
    static func dateLabel(from date: Date) -> String {
        Self.labelFormatter.string(from: date)
    }

    private static func displayLabel(fromDayKey key: String) -> String? {
        guard let date = keyFormatter.date(from: key) else { return nil }
        return labelFormatter.string(from: date)
    }

    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let labelFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMM yyyy"
        return f
    }()
}
