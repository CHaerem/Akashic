import Foundation

// MARK: - Day renumbering (pure)

/// Deterministic renumbering for structural day edits (add / delete / reorder). The single source
/// of truth for "days are always 1…N by `dayNumber` and 0…N-1 by `sortOrder`, in one order". Kept
/// pure so the invariant is unit-tested directly, then applied by `PersistenceController`.
enum DayRenumbering {
    struct Assignment: Equatable {
        var id: String
        var dayNumber: Int
        var sortOrder: Int
    }

    /// One assignment per id, in the given order: `sortOrder = index`, `dayNumber = index + 1`.
    static func assignments(orderedIDs: [String]) -> [Assignment] {
        orderedIDs.enumerated().map { index, id in
            Assignment(id: id, dayNumber: index + 1, sortOrder: index)
        }
    }
}

// MARK: - Route correction (pure)

/// The pure math behind route corrections on an existing journey (replace-from-GPX,
/// draft-from-photos, recompute-stats). Reuses the `JourneyDraft` stats engine so a corrected route
/// produces exactly the stats a freshly created one would — no second implementation to drift.
enum RouteCorrection {

    /// Recompute a journey's `TrekStats` from a (new) route. Only the route-derived numbers move:
    /// distance, ascent, descent and summit. `name` names the highest point.
    ///
    /// **Duration is carried over, not recomputed.** How many days a trek took is authored, not a
    /// property of its geometry, and deriving it from `camps.count` rewrote it on every correction:
    /// Kilimanjaro has eight camps for a seven-day trek (the summit and the finish gate are
    /// waypoints, not days), so replacing its route silently reported and persisted "Days 7 → 8".
    /// `currentDuration` of 0 means the journey never had one, and only then is it derived from the
    /// day count or the date span — a heal for unset data rather than an overwrite of good data.
    static func recomputedStats(route: Route, currentDuration: Int, dayCount: Int,
                                dateStarted: String?, dateEnded: String?, name: String) -> TrekStats {
        let coords = route.coordinates
        let distance = (JourneyDraft.totalDistanceKm(route: coords) * 10).rounded() / 10
        let (gain, loss) = JourneyDraft.elevationGainLoss(route: coords)
        let duration = currentDuration > 0
            ? currentDuration
            : JourneyDraft.duration(dayCount: dayCount,
                                    dateStarted: DateOnly.date(from: dateStarted),
                                    dateEnded: DateOnly.date(from: dateEnded))
        return TrekStats(
            duration: duration,
            totalDistance: distance,
            totalElevationGain: gain,
            totalElevationLoss: coords.isEmpty ? nil : loss,
            highestPoint: JourneyDraft.highestPoint(route: coords, name: name))
    }

    /// Build route-inference fixes from a journey's photos: those with a coordinate and a parseable
    /// capture time. The basis for "Draft route from photos" on an existing journey.
    static func fixes(from photos: [Photo]) -> [PhotoFix] {
        photos.compactMap { photo in
            guard let coords = photo.coordinates, coords.count >= 2,
                  let takenAt = photo.takenAt, let date = PhotoDayMatcher.parseDate(takenAt)
            else { return nil }
            let altitude = coords.count >= 3 ? coords[2] : nil
            return PhotoFix(coordinate: [coords[0], coords[1]], timestamp: date, altitude: altitude)
        }
    }

    // MARK: Diff (for the Apply preview)

    /// One before→after line in the stats-diff preview.
    struct DiffLine: Equatable, Identifiable {
        var label: String
        var before: String
        var after: String
        var changed: Bool
        var id: String { label }
    }

    /// Human before→after lines for distance / ascent / descent / summit / days. Only the fields
    /// that actually move are marked `changed` so the preview can emphasise them.
    static func diff(old: TrekStats, new: TrekStats) -> [DiffLine] {
        var lines: [DiffLine] = []
        lines.append(line("Distance", km(old.totalDistance), km(new.totalDistance)))
        lines.append(line("Ascent", meters(old.totalElevationGain), meters(new.totalElevationGain)))
        lines.append(line("Descent", meters(old.totalElevationLoss ?? 0), meters(new.totalElevationLoss ?? 0)))
        lines.append(line("Summit", meters(old.highestPoint?.elevation ?? 0), meters(new.highestPoint?.elevation ?? 0)))
        lines.append(line("Days", "\(old.duration)", "\(new.duration)"))
        return lines
    }

    private static func line(_ label: String, _ before: String, _ after: String) -> DiffLine {
        DiffLine(label: label, before: before, after: after, changed: before != after)
    }

    private static func km(_ value: Double) -> String {
        String(format: "%g km", (value * 10).rounded() / 10)
    }
    private static func meters(_ value: Int) -> String { "\(value) m" }
}
