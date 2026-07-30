import Foundation

/// Does a journey agree with its own photographs? (QUA-95)
///
/// Everything else that validates journey data checks SHAPE — does the field parse, is the
/// coordinate well formed. This asks the other question, and it exists because the answer was
/// measured and it was no: across the owner's three real journeys, two carried a wrong YEAR (one
/// reading as a 374-day trip), 939 photographs on one journey had no day at all, 144 on another
/// shared a single coordinate 265 km off its route, and one journey had no photograph with real GPS.
/// Not one of those surfaced in the app. They were found by auditing a 16 GiB export offline.
///
/// This is a customer feature and not owner tooling. `DIFF-21` imports Polarsteps exports, which
/// arrive with exactly these defects, and `QUA-89` already records that unassigned photos read to a
/// customer as lost photographs.
///
/// ## Kept in step with the export tooling, deliberately
///
/// The same rules exist in TypeScript as `auditJourneyCoherence`
/// (`scripts/export/lib.ts`, QUA-93), where they run over an export bundle. Two implementations of
/// one rule set is a real cost, and the alternative was worse: the export tooling is Node and this is
/// the app. The thresholds below are therefore stated once here and once there with the same values
/// and the same names, and `JourneyCoherenceTests` asserts the cases that the smoke test asserts, so
/// a divergence shows up as a failing test on one side rather than as two quietly different answers.
enum JourneyCoherence {

    /// A trek longer than this is a typo until proven otherwise. The owner's Kilimanjaro row read 374.
    static let maxSpanDays = 90
    /// Flag a shared coordinate at or above this share of a journey's located photos…
    static let collapsedShare = 0.25
    /// …but never on a handful, where "all three at camp" is ordinary rather than an estimate.
    static let collapsedMinimum = 20

    enum Finding: Equatable, Identifiable {
        /// Photos fall outside the journey's own recorded dates.
        case datesExcludePhotos(outside: Int, total: Int, firstPhotoDate: String, lastPhotoDate: String)
        /// The recorded range is implausibly long for a trek.
        case implausibleSpan(days: Int)
        /// Two camps claim the same day number, so "which day is this photo on" has no single answer.
        case duplicateDayNumbers([Int])
        /// No photo on the journey is attached to a day.
        case noDayAssignment(photos: Int)
        /// Many photos share one coordinate — an estimate collapsed to a point.
        case collapsedCoordinate(count: Int, located: Int, latitude: Double, longitude: Double)
        /// Nothing on the journey came from EXIF, so every coordinate is a guess.
        case noRealLocation(located: Int)

        var id: String {
            switch self {
            case .datesExcludePhotos: return "datesExcludePhotos"
            case .implausibleSpan: return "implausibleSpan"
            case .duplicateDayNumbers: return "duplicateDayNumbers"
            case .noDayAssignment: return "noDayAssignment"
            case let .collapsedCoordinate(_, _, lat, lon): return "collapsedCoordinate.\(lat),\(lon)"
            case .noRealLocation: return "noRealLocation"
            }
        }

        /// Whether this is something wrong with the data, or something absent from it. An absence is
        /// worth showing but is not the owner's mistake — a phone that recorded no GPS is not a typo.
        var isDefect: Bool {
            switch self {
            case .datesExcludePhotos, .implausibleSpan, .duplicateDayNumbers: return true
            case .noDayAssignment, .collapsedCoordinate, .noRealLocation: return false
            }
        }
    }

    /// Every way `journey` contradicts `photos`. Empty means coherent.
    static func findings(journey: Journey, photos: [Photo]) -> [Finding] {
        guard !photos.isEmpty else { return [] }
        var out: [Finding] = []

        // --- dates
        let start = DateOnly.date(from: journey.dateStarted)
        let end = DateOnly.date(from: journey.dateEnded)
        if let start, let end {
            let span = Int((end.timeIntervalSince(start) / 86_400).rounded())
            if span > maxSpanDays { out.append(.implausibleSpan(days: span)) }

            // `dateEnded` is a DATE, so it parses to midnight at the START of that day — a photo taken
            // at 14:00 on the last day of the trek is already "after the end" without this. Then a day
            // of slack at each edge, because a photo taken just before setting off belongs to the trip
            // and a time zone moves a timestamp by hours.
            let lower = start.addingTimeInterval(-86_400)
            let upper = end.addingTimeInterval(2 * 86_400 - 1)
            let dated = photos.compactMap { photo -> Date? in
                photo.takenAt.flatMap { PhotoDayMatcher.parseDate($0) }
            }
            let outside = dated.filter { $0 < lower || $0 > upper }
            if !outside.isEmpty, let lo = dated.min(), let hi = dated.max() {
                out.append(.datesExcludePhotos(outside: outside.count, total: photos.count,
                                               firstPhotoDate: DateOnly.string(from: lo) ?? "?",
                                               lastPhotoDate: DateOnly.string(from: hi) ?? "?"))
            }
        }

        // --- day structure
        var seen = Set<Int>()
        var duplicates: [Int] = []
        for camp in journey.camps where !seen.insert(camp.dayNumber).inserted {
            if !duplicates.contains(camp.dayNumber) { duplicates.append(camp.dayNumber) }
        }
        if !duplicates.isEmpty { out.append(.duplicateDayNumbers(duplicates.sorted())) }

        if !photos.contains(where: { ($0.waypointId?.isEmpty == false) }) {
            out.append(.noDayAssignment(photos: photos.count))
        }

        // --- locations
        let located = photos.compactMap { photo -> (lat: Double, lon: Double)? in
            guard let c = photo.coordinates, c.count >= 2, c[0].isFinite, c[1].isFinite else { return nil }
            return (lat: c[1], lon: c[0])
        }
        if located.count >= collapsedMinimum {
            var tally: [String: (n: Int, lat: Double, lon: Double)] = [:]
            for p in located {
                let key = "\(p.lat),\(p.lon)"
                tally[key] = (n: (tally[key]?.n ?? 0) + 1, lat: p.lat, lon: p.lon)
            }
            for entry in tally.values.sorted(by: { $0.n > $1.n })
            where entry.n >= collapsedMinimum && Double(entry.n) / Double(located.count) >= collapsedShare {
                out.append(.collapsedCoordinate(count: entry.n, located: located.count,
                                                latitude: entry.lat, longitude: entry.lon))
            }
        }
        // Only meaningful once something IS located: a journey with no coordinates at all is a
        // different and honest state, not a broken location pipeline.
        if !located.isEmpty, !photos.contains(where: { $0.locationSource == "exif" }) {
            out.append(.noRealLocation(located: located.count))
        }

        return out
    }
}
