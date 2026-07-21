import Foundation

/// Per-day route statistics, ported from the web app's `src/lib/journeys/transforms.ts`.
///
/// Given a journey route (`[lng, lat, ele]` triples) and its camps, this walks the route
/// segment between each pair of consecutive camps to derive that day's elevation gain (sum of
/// positive deltas) and loss (sum of negative deltas). Day distance PREFERS the camps' stored
/// `routeDistanceKm` cumulative values over Haversine, matching the web:
///   * Day 1 = the first camp's `routeDistanceKm` (rounded to one decimal) when present.
///   * Day i>0 = the delta `curr - prev` (rounded to one decimal) when BOTH camps carry a
///     stored `routeDistanceKm`.
///   * Otherwise fall back to the Haversine route length between the two route indices.
/// Day 1 is measured from the route start (index 0), matching the web implementation.
enum DayStats {

    /// Nearest route vertex to a camp, by squared planar distance (good enough for snapping).
    static func closestRoutePointIndex(camp coordinate: [Double],
                                       route: [RouteCoordinate]) -> Int {
        guard !route.isEmpty, coordinate.count >= 2 else { return 0 }
        var minDistance = Double.greatestFiniteMagnitude
        var closest = 0
        for (i, point) in route.enumerated() where point.count >= 2 {
            let dLng = point[0] - coordinate[0]
            let dLat = point[1] - coordinate[1]
            let dist = dLng * dLng + dLat * dLat
            if dist < minDistance {
                minDistance = dist
                closest = i
            }
        }
        return closest
    }

    static func elevationGain(route: [RouteCoordinate], from start: Int, to end: Int) -> Int {
        guard start < end else { return 0 }
        var gain = 0.0
        for i in (start + 1)...end where i < route.count {
            guard route[i].count >= 3, route[i - 1].count >= 3 else { continue }
            let delta = route[i][2] - route[i - 1][2]
            if delta > 0 { gain += delta }
        }
        return Int(gain.rounded())
    }

    static func elevationLoss(route: [RouteCoordinate], from start: Int, to end: Int) -> Int {
        guard start < end else { return 0 }
        var loss = 0.0
        for i in (start + 1)...end where i < route.count {
            guard route[i].count >= 3, route[i - 1].count >= 3 else { continue }
            let delta = route[i][2] - route[i - 1][2]
            if delta < 0 { loss += abs(delta) }
        }
        return Int(loss.rounded())
    }

    /// Great-circle distance (km) accumulated along the route between two indices.
    static func distance(route: [RouteCoordinate], from start: Int, to end: Int) -> Double {
        guard start < end else { return 0 }
        let earthRadiusKm = 6371.0
        var total = 0.0
        for i in (start + 1)...end where i < route.count {
            guard route[i].count >= 2, route[i - 1].count >= 2 else { continue }
            let lng1 = route[i - 1][0], lat1 = route[i - 1][1]
            let lng2 = route[i][0], lat2 = route[i][1]
            let dLat = (lat2 - lat1) * .pi / 180
            let dLng = (lng2 - lng1) * .pi / 180
            let a = sin(dLat / 2) * sin(dLat / 2)
                + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLng / 2) * sin(dLng / 2)
            let c = 2 * atan2(sqrt(a), sqrt(1 - a))
            total += earthRadiusKm * c
        }
        return (total * 10).rounded() / 10
    }

    /// Returns a copy of `camps` with `routePointIndex`, `dayDistance`,
    /// `elevationGainFromPrevious` and `elevationLossFromPrevious` filled in.
    ///
    /// Camps are processed in `dayNumber` (then existing) order. When a camp already
    /// carries an explicit `routePointIndex` it is respected (clamped to the route),
    /// otherwise the nearest route vertex is used.
    static func annotate(camps: [Camp], route: Route) -> [Camp] {
        let coords = route.coordinates
        guard !coords.isEmpty else { return camps }

        // Sort by dayNumber, keeping original order as a stable tiebreaker
        // (some journeys have two camps sharing a dayNumber).
        let ordered = camps.enumerated()
            .sorted { lhs, rhs in
                lhs.element.dayNumber != rhs.element.dayNumber
                    ? lhs.element.dayNumber < rhs.element.dayNumber
                    : lhs.offset < rhs.offset
            }
            .map(\.element)
        let indices: [Int] = ordered.map { camp in
            if let explicit = camp.routePointIndex {
                return min(max(explicit, 0), coords.count - 1)
            }
            return closestRoutePointIndex(camp: camp.coordinates, route: coords)
        }

        var result: [Camp] = []
        for (i, camp) in ordered.enumerated() {
            var updated = camp
            let prevIndex = i == 0 ? 0 : indices[i - 1]
            let currIndex = indices[i]
            updated.routePointIndex = currIndex
            if currIndex > prevIndex {
                updated.dayDistance = dayDistance(index: i,
                                                  camp: camp,
                                                  previous: i == 0 ? nil : ordered[i - 1],
                                                  route: coords,
                                                  from: prevIndex,
                                                  to: currIndex)
                updated.elevationGainFromPrevious = elevationGain(route: coords, from: prevIndex, to: currIndex)
                updated.elevationLossFromPrevious = elevationLoss(route: coords, from: prevIndex, to: currIndex)
            } else {
                updated.dayDistance = 0
                updated.elevationGainFromPrevious = 0
                updated.elevationLossFromPrevious = 0
            }
            result.append(updated)
        }
        return result
    }

    /// Per-day distance (km), preferring stored `routeDistanceKm` over Haversine.
    ///
    /// Mirrors the web's `transforms.ts` preference order:
    ///   * Day 1 (`index == 0`): the first camp's stored `routeDistanceKm` (rounded to one
    ///     decimal) when present, else the Haversine length from the route start.
    ///   * Day i>0: the delta `curr - prev` (rounded to one decimal) when BOTH camps carry a
    ///     stored `routeDistanceKm`, else the Haversine length between their route indices.
    ///
    /// Guard: a negative stored delta is NOT trusted — it falls back to Haversine so a day
    /// distance is never negative. (Mount Kenya's day-5 safari camp jumps back to
    /// `routeDistanceKm == 0` after 50 km, giving a −50 delta.) `transforms.ts` has no such
    /// guard; this is a deliberate hardening that only affects the sign-flip edge case and
    /// leaves the normal monotonic path identical to the web.
    private static func dayDistance(index: Int, camp: Camp, previous: Camp?,
                                    route: [RouteCoordinate], from prevIndex: Int, to currIndex: Int) -> Double {
        if index == 0 {
            if let stored = camp.routeDistanceKm {
                return (stored * 10).rounded() / 10
            }
            return distance(route: route, from: 0, to: currIndex)
        }
        if let curr = camp.routeDistanceKm, let prev = previous?.routeDistanceKm {
            let delta = curr - prev
            if delta >= 0 {
                return (delta * 10).rounded() / 10
            }
        }
        return distance(route: route, from: prevIndex, to: currIndex)
    }
}
