import Foundation

/// Computes `ExtendedStats` for a journey, ported 1:1 from the legacy MCP Worker's
/// `calculateExtendedStats` (`workers/media-proxy/src/mcp/tools/index.ts`).
///
/// The algorithm walks the route between consecutive camp route-point indices, summing
/// per-segment elevation gain/loss (rounded per segment) and Haversine distance, then
/// derives a hiking-time estimate and an Easy/Moderate/Hard/Extreme difficulty score.
///
/// Kept deliberately separate from `DayStats` (which powers the UI's per-day numbers) so the
/// MCP-parity math is exact and independently testable.
enum ExtendedStatsCalculator {

    static func calculate(route: Route, stats: TrekStats, camps: [Camp]) -> ExtendedStats {
        let coords = route.coordinates
        let distance = stats.totalDistance
        let duration = stats.duration

        let safeDuration = duration > 0 ? duration : 1
        let avgDailyDistance = String(format: "%.1f", distance / Double(safeDuration))

        var maxDailyGain = 0
        var maxDailyLoss = 0
        var longestDayDistance = 0.0
        var longestDayNumber = 1
        var steepestDayGradient = 0.0
        var steepestDayNumber = 1

        // Stable sort by dayNumber (JS `Array.sort` is stable; ties keep source order).
        let sortedWaypoints = camps.enumerated()
            .sorted { lhs, rhs in
                lhs.element.dayNumber != rhs.element.dayNumber
                    ? lhs.element.dayNumber < rhs.element.dayNumber
                    : lhs.offset < rhs.offset
            }
            .map(\.element)

        let waypointIndices: [Int] = sortedWaypoints.map { wp in
            if let idx = wp.routePointIndex {
                return min(idx, coords.count - 1)
            }
            return findRoutePointIndex(wp.coordinates, coords)
        }

        var totalGain = 0
        var totalLoss = 0

        for i in 0..<sortedWaypoints.count {
            let startIdx = i == 0 ? 0 : waypointIndices[i - 1]
            let endIdx = waypointIndices[i]

            let (gain, loss) = calculateSegmentElevation(coords, startIdx, endIdx)
            let segmentDist = calculateRouteDistance(coords, startIdx, endIdx)

            totalGain += gain
            totalLoss += loss

            if gain > maxDailyGain { maxDailyGain = gain }
            if loss > maxDailyLoss { maxDailyLoss = loss }
            if segmentDist > longestDayDistance {
                longestDayDistance = segmentDist
                longestDayNumber = sortedWaypoints[i].dayNumber
            }
            if segmentDist > 0 {
                let gradient = Double(gain + loss) / segmentDist
                if gradient > steepestDayGradient {
                    steepestDayGradient = gradient
                    steepestDayNumber = sortedWaypoints[i].dayNumber
                }
            }
        }

        let avgAltitude = coords.isEmpty
            ? 0
            : Int((coords.reduce(0.0) { $0 + elevation(of: $1) } / Double(coords.count)).rounded())

        let totalTimeMinutes = estimateHikingTimeMinutes(distance, totalGain, totalLoss)
        let estimatedTotalTime = formatHikingTime(totalTimeMinutes)

        let startElevation = coords.isEmpty ? 0 : Int(elevation(of: coords[0]).rounded())
        let endElevation = coords.isEmpty ? 0 : Int(elevation(of: coords[coords.count - 1]).rounded())

        let difficulty = calculateDifficultyRating(
            distance,
            totalGain,
            totalLoss,
            Double(avgDailyDistance) ?? 0,
            maxDailyGain
        )

        return ExtendedStats(
            avgDailyDistance: avgDailyDistance,
            maxDailyGain: maxDailyGain,
            maxDailyLoss: maxDailyLoss,
            totalElevationGain: totalGain,
            totalElevationLoss: totalLoss,
            difficulty: difficulty,
            startElevation: startElevation,
            endElevation: endElevation,
            avgAltitude: avgAltitude,
            longestDayDistance: (longestDayDistance * 10).rounded() / 10,
            longestDayNumber: longestDayNumber,
            estimatedTotalTime: estimatedTotalTime,
            steepestDayGradient: Int(steepestDayGradient.rounded()),
            steepestDayNumber: steepestDayNumber
        )
    }

    // MARK: - Ported helpers

    private static func elevation(of coordinate: [Double]) -> Double {
        coordinate.count > 2 ? coordinate[2] : 0
    }

    /// Haversine great-circle distance in km (R = 6371).
    static func distanceKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double) -> Double {
        let radius = 6371.0
        let dLat = deg2rad(lat2 - lat1)
        let dLon = deg2rad(lon2 - lon1)
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(deg2rad(lat1)) * cos(deg2rad(lat2)) * sin(dLon / 2) * sin(dLon / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return radius * c
    }

    private static func deg2rad(_ deg: Double) -> Double { deg * (.pi / 180) }

    /// Sum of positive / absolute-negative elevation deltas between two route indices,
    /// rounded per segment (matches the MCP's `calculateSegmentElevation`).
    static func calculateSegmentElevation(_ coords: [[Double]], _ startIdx: Int, _ endIdx: Int) -> (gain: Int, loss: Int) {
        guard startIdx < endIdx else { return (0, 0) }
        var gain = 0.0
        var loss = 0.0
        var i = startIdx + 1
        while i <= endIdx && i < coords.count {
            guard coords[i].count > 2, coords[i - 1].count > 2 else { i += 1; continue }
            let diff = coords[i][2] - coords[i - 1][2]
            if diff > 0 { gain += diff } else { loss += abs(diff) }
            i += 1
        }
        return (Int(gain.rounded()), Int(loss.rounded()))
    }

    /// Nearest route vertex to a camp by squared planar distance (`findRoutePointIndex`).
    static func findRoutePointIndex(_ point: [Double], _ coords: [[Double]]) -> Int {
        var minDist = Double.greatestFiniteMagnitude
        var closest = 0
        for (i, c) in coords.enumerated() where c.count >= 2 {
            let dx = c[0] - point[0]
            let dy = c[1] - point[1]
            let dist = dx * dx + dy * dy
            if dist < minDist {
                minDist = dist
                closest = i
            }
        }
        return closest
    }

    /// Accumulated Haversine distance between two route indices (`calculateRouteDistance`).
    static func calculateRouteDistance(_ coords: [[Double]], _ startIdx: Int, _ endIdx: Int) -> Double {
        guard startIdx < endIdx else { return 0 }
        var dist = 0.0
        var i = startIdx + 1
        while i <= endIdx && i < coords.count {
            guard coords[i].count >= 2, coords[i - 1].count >= 2 else { i += 1; continue }
            dist += distanceKm(lat1: coords[i - 1][1], lon1: coords[i - 1][0],
                               lat2: coords[i][1], lon2: coords[i][0])
            i += 1
        }
        return dist
    }

    /// `"5h 30min"` style formatting (`formatHikingTime`).
    static func formatHikingTime(_ totalMinutes: Double) -> String {
        let hours = Int(floor(totalMinutes / 60))
        let minutes = Int(totalMinutes.truncatingRemainder(dividingBy: 60).rounded())
        if hours == 0 { return "\(minutes)min" }
        if minutes == 0 { return "\(hours)h" }
        return "\(hours)h \(minutes)min"
    }

    /// Time model: `(km / 5) * 60 + gain / 10 + loss / 20` minutes.
    static func estimateHikingTimeMinutes(_ distanceKm: Double, _ elevGain: Int, _ elevLoss: Int) -> Double {
        let baseTime = (distanceKm / 5) * 60
        let ascentTime = Double(elevGain) / 10
        let descentTime = Double(elevLoss) / 20
        return baseTime + ascentTime + descentTime
    }

    /// Difficulty scoring thresholds (`calculateDifficultyRating`).
    static func calculateDifficultyRating(_ totalDistance: Double,
                                          _ totalGain: Int,
                                          _ totalLoss: Int,
                                          _ avgDailyDist: Double,
                                          _ maxDayGain: Int) -> String {
        var score = 0

        if avgDailyDist > 20 { score += 3 }
        else if avgDailyDist > 15 { score += 2 }
        else if avgDailyDist > 10 { score += 1 }

        if maxDayGain > 1500 { score += 3 }
        else if maxDayGain > 1000 { score += 2 }
        else if maxDayGain > 600 { score += 1 }

        let totalElev = totalGain + totalLoss
        if totalElev > 8000 { score += 2 }
        else if totalElev > 5000 { score += 1 }

        if score >= 6 { return "Extreme" }
        if score >= 4 { return "Hard" }
        if score >= 2 { return "Moderate" }
        return "Easy"
    }
}
