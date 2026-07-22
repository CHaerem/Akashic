import Foundation
import CoreGraphics

/// Pure, view-agnostic elevation-profile geometry — a Swift port of the web app's
/// `generateElevationProfile` (`src/utils/stats.ts`).
///
/// Given a route (`[lng, lat, ele]` triples) and its camps it produces the data both
/// elevation charts render from:
///   * cumulative-distance / elevation `Point`s, each pre-projected into the interactive
///     chart's **300 × 120** logical space (SVG viewBox parity with the web),
///   * `CampMarker`s snapped onto the route (preferring the camp's stored
///     `routeDistanceKm` / `routePointIndex`, else the nearest route vertex within 500 m),
///   * the raw (`minEle`/`maxEle`) and 10 %-padded (`plotMinEle`/`plotMaxEle`) elevation
///     bounds.
///
/// Distances use the same Haversine (R = 6371 km) as `ExtendedStatsCalculator` — the stats
/// math is reused, never duplicated. The 10 % elevation padding and the `max(0, …)` floor
/// mirror the web exactly.
///
/// Consumed by `InteractiveElevationProfileView` (the 300 × 120 plot-padded space) and by
/// `MiniElevationProfileView` (a 100 × 48 space that re-projects from each point's raw
/// `dist`/`ele`, matching the web's separate min/max normalisation). Build with
/// `init?(route:camps:)` / `init?(journey:)` — returns `nil` for an empty route.
struct ElevationProfileModel: Equatable {

    /// Logical width of the interactive chart's coordinate space (web SVG viewBox width).
    static let logicalWidth: CGFloat = 300
    /// Logical height of the interactive chart's coordinate space (web SVG viewBox height).
    static let logicalHeight: CGFloat = 120

    /// One elevation sample: cumulative `dist` (km) + `ele` (m) and its 300 × 120 projection.
    struct Point: Equatable {
        var dist: Double
        var ele: Double
        var x: CGFloat
        var y: CGFloat
    }

    /// A camp snapped onto the profile: its route data plus its 300 × 120 projection.
    struct CampMarker: Equatable, Identifiable {
        var campID: String
        var dayNumber: Int
        var name: String
        var dist: Double
        var ele: Double
        var x: CGFloat
        var y: CGFloat
        var id: String { campID }
    }

    let points: [Point]
    let campMarkers: [CampMarker]
    let minEle: Double
    let maxEle: Double
    let totalDist: Double
    let plotMinEle: Double
    let plotMaxEle: Double

    // MARK: - Construction

    init?(route: Route, camps: [Camp] = []) {
        self.init(coordinates: route.coordinates, camps: camps)
    }

    init?(journey: Journey) {
        self.init(coordinates: journey.route.coordinates, camps: journey.camps)
    }

    init?(coordinates: [RouteCoordinate], camps: [Camp] = []) {
        guard !coordinates.isEmpty else { return nil }

        // 1) Cumulative distance + elevation, tracking the raw elevation range.
        var cumulative: [Double] = []
        cumulative.reserveCapacity(coordinates.count)
        var totalDist = 0.0
        var minEle = Double.greatestFiniteMagnitude
        var maxEle = -Double.greatestFiniteMagnitude

        for i in coordinates.indices {
            let coord = coordinates[i]
            let ele = coord.count > 2 ? coord[2] : 0
            if i > 0 {
                let prev = coordinates[i - 1]
                if prev.count >= 2, coord.count >= 2 {
                    totalDist += ExtendedStatsCalculator.distanceKm(
                        lat1: prev[1], lon1: prev[0], lat2: coord[1], lon2: coord[0])
                }
            }
            if ele < minEle { minEle = ele }
            if ele > maxEle { maxEle = ele }
            cumulative.append(totalDist)
        }

        // 2) Plot bounds — pad the elevation range by 10 % (or ±100 m if flat); floor at 0.
        let eleRange = maxEle - minEle
        let plotMinEle = Swift.max(0, minEle - (eleRange > 0 ? eleRange * 0.1 : 100))
        let plotMaxEle = maxEle + (eleRange > 0 ? eleRange * 0.1 : 100)
        let plotEleRange = plotMaxEle - plotMinEle

        let width = Self.logicalWidth
        let height = Self.logicalHeight

        func project(dist: Double, ele: Double) -> (x: CGFloat, y: CGFloat) {
            let x = totalDist > 0 ? CGFloat(dist / totalDist) * width : 0
            let y = plotEleRange > 0
                ? height - CGFloat((ele - plotMinEle) / plotEleRange) * height
                : height / 2
            return (x, y)
        }

        // 3) Projected points.
        var points: [Point] = []
        points.reserveCapacity(coordinates.count)
        for i in coordinates.indices {
            let ele = coordinates[i].count > 2 ? coordinates[i][2] : 0
            let p = project(dist: cumulative[i], ele: ele)
            points.append(Point(dist: cumulative[i], ele: ele, x: p.x, y: p.y))
        }

        // 4) Camp markers — stored route position when available, else nearest-vertex snap.
        var markers: [CampMarker] = []
        for camp in camps {
            let campPos: (dist: Double, ele: Double)?
            if let rd = camp.routeDistanceKm, let rpi = camp.routePointIndex {
                let idx = Swift.min(Swift.max(rpi, 0), coordinates.count - 1)
                let ele = coordinates[idx].count > 2 ? coordinates[idx][2] : 0
                campPos = (rd, ele)
            } else {
                campPos = Self.findCampDistanceOnRoute(
                    camp: camp.coordinates, coordinates: coordinates, cumulative: cumulative)
            }
            if let pos = campPos {
                let p = project(dist: pos.dist, ele: pos.ele)
                markers.append(CampMarker(
                    campID: camp.id, dayNumber: camp.dayNumber, name: camp.name,
                    dist: pos.dist, ele: pos.ele, x: p.x, y: p.y))
            }
        }
        markers.sort { $0.dist < $1.dist }

        self.points = points
        self.campMarkers = markers
        self.minEle = minEle
        self.maxEle = maxEle
        self.totalDist = totalDist
        self.plotMinEle = plotMinEle
        self.plotMaxEle = plotMaxEle
    }

    /// Nearest route vertex to a camp, accepted only within 500 m — mirrors the web fallback
    /// (`findCampDistanceOnRoute`). Returns the camp's cumulative distance + route elevation.
    private static func findCampDistanceOnRoute(camp: [Double],
                                                coordinates: [RouteCoordinate],
                                                cumulative: [Double]) -> (dist: Double, ele: Double)? {
        guard camp.count >= 2 else { return nil }
        var minDistance = Double.greatestFiniteMagnitude
        var closest = 0
        for i in coordinates.indices where coordinates[i].count >= 2 {
            let d = ExtendedStatsCalculator.distanceKm(
                lat1: camp[1], lon1: camp[0],
                lat2: coordinates[i][1], lon2: coordinates[i][0])
            if d < minDistance { minDistance = d; closest = i }
        }
        guard minDistance <= 0.5 else { return nil }   // only match within 500 m of the route
        let ele = coordinates[closest].count > 2 ? coordinates[closest][2] : 0
        return (cumulative[closest], ele)
    }
}

extension ElevationProfileModel {
    /// The point whose projected `x` is nearest a given logical x (0…300). `nil` if empty.
    func nearestPoint(toLogicalX x: CGFloat) -> Point? {
        points.min { abs($0.x - x) < abs($1.x - x) }
    }

    /// The camp marker nearest a given logical x, within `threshold` logical units.
    func nearestCampMarker(toLogicalX x: CGFloat, within threshold: CGFloat) -> CampMarker? {
        guard let marker = campMarkers.min(by: { abs($0.x - x) < abs($1.x - x) }) else { return nil }
        return abs(marker.x - x) <= threshold ? marker : nil
    }
}
