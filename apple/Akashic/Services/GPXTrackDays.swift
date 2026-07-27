import Foundation

/// **Day derivation from a timestamped GPX track** (DIFF-09).
///
/// A Strava / Garmin / komoot export of a multi-day trek is usually a *trackpoint-only* file: one
/// `<trkpt>` every few seconds, each with its own `<time>`, and **no `<wpt>` camp markers at all**.
/// `JourneyDraft.days(fromWaypoints:)` therefore proposed nothing for it, and the user had to hand-
/// build every day of a trek whose day structure was sitting right there in the timestamps. This is
/// the missing half: the track's own times, clustered into days.
///
/// Deliberately **pure** and free of `GPXFile` / `DraftDay` / Core Data, so the whole clustering rule
/// is unit-testable from plain arrays — the same split the codebase already uses for `DayStats`
/// (route math, no parse) and `PhotoDayMatcher` (matching rule, no store).
///
/// ## Grouping: local calendar date, not gap detection
/// Both were considered. **Calendar date won**, and gap detection is deliberately *not* used:
///
///   * The product model is "Day 1, Day 2, …" over dates, and the sibling path
///     (`JourneyDraft.daysWithAssignments(fromPhotos:)`) already buckets by calendar date. A journey
///     built from a GPX and one built from the same trip's photos must number their days the same
///     way, or the two creation routes disagree about what "Day 3" means.
///   * A gap threshold misfires in both directions: a long rest at a camp, a battery swap or a
///     paused recorder splits one day in two, while a device that logs continuously (some Garmins
///     do) has no overnight gap at all and would collapse a week into a single day.
///   * Calendar grouping is total and deterministic — N distinct dates in, N days out — which is
///     also what makes the single-day case correct by construction: one date, one day, never one
///     day per hour and never zero.
///
/// The overnight gap is still what makes this *work* in practice; it is simply not the rule. It is
/// why a trek's local dates and its walking segments coincide, so calendar grouping lands the
/// boundaries in the same places gap detection would have — without the threshold.
///
/// ## Timezone: the track's own longitude, never the device's zone and never raw UTC
/// GPX `<time>` is a genuine UTC instant (unlike EXIF `DateTimeOriginal`, which carries no zone and
/// which this app stores *as if* it were UTC — a known finding, and precisely the mistake not to
/// repeat here). But bucketing UTC instants by their **UTC** calendar date is still wrong: at
/// UTC-5, an Inca Trail day still walking at 19:00 local has already crossed into the next UTC date,
/// so a 4-day trek would come out as 5 days with a sliver at each end. Using
/// `TimeZone.current` would be worse again — the answer would depend on where the *phone* is when
/// the file is imported, so the same file would yield different days at home and abroad.
///
/// So the offset is derived from the **track's own median longitude** (solar time: 15° per hour).
/// That needs no network, no timezone database lookup by coordinate, and no user input, and it is
/// stable for a given file forever. It is an approximation of political time — Tanzania is UTC+3
/// while Kilimanjaro's longitude gives +2 — which only matters for a point within an hour of local
/// midnight. That is a real edge (a Kilimanjaro summit push leaves camp before midnight), and the
/// consequence is bounded: such a push is split across the two calendar days it genuinely spans.
enum GPXTrackDays {

    /// One derived day: the points that fall on it, its span, and the route math over just those
    /// points. `date`/`start`/`end` are true instants; `localDateKey` is the `yyyy-MM-dd` the
    /// grouping used, in the track's own local time.
    struct Day: Equatable {
        /// `yyyy-MM-dd` in the track's local (longitude-derived) time — the grouping key.
        var localDateKey: String
        /// Local midnight of `localDateKey`, as the UTC instant a `yyyy-MM-dd` formatter reproduces.
        /// This is what the `DraftDay.dateLabel` is rendered from, so it round-trips through
        /// `JourneyDraft.date(fromDayLabel:)`.
        var localDate: Date
        /// First and last trackpoint time on this day (true UTC instants).
        var start: Date
        var end: Date
        /// This day's trackpoints, `[lng, lat, ele?]`, in chronological order.
        var coordinates: [RouteCoordinate]
        /// Great-circle length of just this day's points, km.
        var distanceKm: Double
        /// Elevation gain / loss over just this day's points, metres.
        var elevationGain: Int
        var elevationLoss: Int

        /// Where the day *ended* — the last point, `[lng, lat]`. A trek day is named for and located
        /// at the camp you reach, not the one you left, which is also how a `<wpt>`-seeded day
        /// behaves (the marker sits at the destination).
        var endCoordinate: [Double] {
            guard let last = coordinates.last, last.count >= 2 else { return [] }
            return [last[0], last[1]]
        }

        /// Elevation at the day's end point, when the track carries one.
        var endElevation: Int? {
            guard let last = coordinates.last, last.count >= 3, last[2].isFinite else { return nil }
            return Int(last[2].rounded())
        }

        /// Duration of the recorded activity on this day.
        var duration: TimeInterval { end.timeIntervalSince(start) }
    }

    // MARK: - Derivation

    /// Cluster `coordinates` (`[lng, lat, ele?]`) into one `Day` per local calendar date, using the
    /// index-aligned `times` (`nil` = that point carried no `<time>`).
    ///
    /// Returns `[]` when no point carries a time — a track with no timestamps cannot tell us how
    /// many days it spans, and inventing a single day for it would be a guess dressed as data.
    ///
    /// Points are sorted by time before grouping: document order is chronological in every real
    /// file, but a concatenation of segments recorded out of order is cheap to be right about.
    /// `utcOffsetSeconds` overrides the longitude-derived offset (tests, and any future caller that
    /// knows the real zone).
    static func derive(coordinates: [RouteCoordinate],
                       times: [Date?],
                       utcOffsetSeconds: Int? = nil) -> [Day] {
        // Pair up, keeping only points that have both a usable coordinate and a time.
        var timed: [(coordinate: RouteCoordinate, time: Date)] = []
        for (coordinate, time) in zip(coordinates, times) {
            guard let time, coordinate.count >= 2,
                  coordinate[0].isFinite, coordinate[1].isFinite else { continue }
            timed.append((coordinate, time))
        }
        guard !timed.isEmpty else { return [] }
        timed.sort { $0.time < $1.time }

        let offset = utcOffsetSeconds
            ?? solarUTCOffsetSeconds(medianLongitude: medianLongitude(of: timed.map(\.coordinate)))

        // Group into runs of equal local date. The points are time-sorted, so equal dates are
        // contiguous and a single pass suffices (no dictionary, so order needs no re-sorting).
        var days: [Day] = []
        var runKey: String?
        var runPoints: [(coordinate: RouteCoordinate, time: Date)] = []

        func closeRun() {
            guard let key = runKey, !runPoints.isEmpty else { return }
            let dayCoordinates = runPoints.map(\.coordinate)
            let (gain, loss) = JourneyDraft.elevationGainLoss(route: dayCoordinates)
            days.append(Day(
                localDateKey: key,
                localDate: Self.keyFormatter.date(from: key) ?? runPoints[0].time,
                start: runPoints[0].time,
                end: runPoints[runPoints.count - 1].time,
                coordinates: dayCoordinates,
                distanceKm: JourneyDraft.totalDistanceKm(route: dayCoordinates),
                elevationGain: gain,
                elevationLoss: loss))
        }

        for point in timed {
            let key = localDateKey(for: point.time, utcOffsetSeconds: offset)
            if key != runKey {
                closeRun()
                runKey = key
                runPoints = []
            }
            runPoints.append(point)
        }
        closeRun()
        return days
    }

    // MARK: - Local time

    /// The `yyyy-MM-dd` a UTC instant falls on once shifted by `utcOffsetSeconds`.
    static func localDateKey(for time: Date, utcOffsetSeconds: Int) -> String {
        keyFormatter.string(from: time.addingTimeInterval(Double(utcOffsetSeconds)))
    }

    /// Solar UTC offset for a longitude: 15° of longitude per hour, rounded to the nearest hour.
    /// Clamped to the real-world range (UTC-12…UTC+14) and 0 for a non-finite input.
    static func solarUTCOffsetSeconds(medianLongitude longitude: Double) -> Int {
        guard longitude.isFinite else { return 0 }
        let hours = min(14, max(-12, Int((longitude / 15).rounded())))
        return hours * 3600
    }

    /// Median longitude of a set of `[lng, lat, ele?]` points — the median rather than the mean so a
    /// single wild fix can't drag the whole track's offset. (A track straddling the ±180 antimeridian
    /// would need unwrapping first; no trek GPX this app has seen does, and getting the offset wrong
    /// there costs a day boundary, not correctness of the points themselves.)
    static func medianLongitude(of coordinates: [RouteCoordinate]) -> Double {
        let longitudes = coordinates.compactMap { $0.count >= 2 && $0[0].isFinite ? $0[0] : nil }.sorted()
        guard !longitudes.isEmpty else { return 0 }
        let count = longitudes.count
        if count % 2 == 1 { return longitudes[count / 2] }
        return (longitudes[count / 2 - 1] + longitudes[count / 2]) / 2
    }

    /// UTC `yyyy-MM-dd`. Applied to an already-offset instant, so the "UTC" here is the vehicle for
    /// rendering a local wall-clock date, not a claim that the date is a UTC one.
    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
