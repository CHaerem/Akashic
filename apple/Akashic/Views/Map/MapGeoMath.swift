import Foundation
import CoreLocation
import MapKit

/// Geometry helpers for the signature globe / trek map.
///
/// Ported from the MapKitGlobe spike (`apple/Spikes/MapKitGlobe/Sources/GeoMath.swift`)
/// and adapted to the app domain model (`Journey`/`Camp`/`Route`). These translate the
/// Mapbox choreography (center / zoom / pitch / bearing / fitBounds) into `MKMapCamera`
/// parameters (centerCoordinate / centerCoordinateDistance / heading / pitch).
///
/// Everything here is pure and side-effect free so it can be unit tested
/// (`AkashicTests/MapMathTests.swift`) without a live map.
enum MapGeoMath {

    // MARK: - Globe framing (exact spec values)

    /// Mapbox globe center `[lng 30, lat 15]` (Africa / Middle East).
    static let globeCenter = CLLocationCoordinate2D(latitude: 15, longitude: 30)

    /// Mapbox globe zoom 1.2–1.5 has no MapKit equivalent (MapKit is mercator, not a
    /// true globe projection). A very large `centerCoordinateDistance` frames the disc as wide as
    /// MapKit will allow.
    ///
    /// **This value is already at MapKit's clamp, and raising it does nothing.** Measured while
    /// investigating A4-4 (the ocean labels that clip at the screen edges): at 42,000 km the disc
    /// spans x=0…1205 of a 1206 px screen, and at 52,000 km it spans *exactly the same pixels*. So the
    /// globe always slightly overflows the width, and no camera change can pull it inside the frame —
    /// which is why A4-4 cannot be fixed by framing. The previous version of this comment claimed this
    /// distance "frames the full disc: ~6.6 Earth radii"; it does not, and cannot.
    static let globeDistance: CLLocationDistance = 42_000_000

    /// Earth circumference at the equator (WGS-84), used for the zoom→distance mapping.
    static let earthCircumference: Double = 40_075_016.686

    // MARK: - Bearing

    /// Initial bearing (heading) from `a` to `b`, degrees `0..<360`, 0 = North.
    static func bearing(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let theta = atan2(y, x) * 180 / .pi
        return theta.truncatingRemainder(dividingBy: 360) < 0
            ? theta.truncatingRemainder(dividingBy: 360) + 360
            : theta.truncatingRemainder(dividingBy: 360)
    }

    /// Heading along the route arriving at the vertex `endIndex`, computed from a point
    /// `lookback` vertices earlier (spec §1e: "5 route-vertices back to the camp").
    /// Falls back to a 1-vertex delta when the route is shorter than `lookback`.
    static func routeBearing(toVertex endIndex: Int,
                             route: [CLLocationCoordinate2D],
                             lookback: Int = 5) -> Double {
        guard route.count >= 2 else { return 0 }
        let end = min(max(endIndex, 1), route.count - 1)
        let back = max(0, end - lookback)
        return bearing(from: route[back], to: route[end])
    }

    // MARK: - Distance

    static func meters(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }

    /// Nearest route-vertex index to a coordinate (planar squared distance is fine for snapping).
    static func nearestRouteIndex(to coord: CLLocationCoordinate2D,
                                  in route: [CLLocationCoordinate2D]) -> Int {
        guard !route.isEmpty else { return 0 }
        var best = 0
        var bestD = Double.greatestFiniteMagnitude
        for (i, p) in route.enumerated() {
            let dLat = p.latitude - coord.latitude
            let dLon = p.longitude - coord.longitude
            let d = dLat * dLat + dLon * dLon
            if d < bestD { bestD = d; best = i }
        }
        return best
    }

    // MARK: - Zoom → camera distance

    /// Convert a Mapbox web-mercator zoom into an `MKMapCamera.centerCoordinateDistance`.
    ///
    /// Mapbox zoom and MapKit eye altitude both roughly halve per zoom level, so
    /// `distance = earthCircumference / 2^zoom` reproduces the spec's anchor points:
    /// z15 ≈ 1.2 km, z16 ≈ 0.6 km, z14.5 ≈ 1.7 km (the day / photo / POI fly-ins).
    /// Globe framing (zoom 1.2–1.5) is special-cased to `globeDistance` instead, because
    /// Mapbox's globe projection there is not mercator.
    static func distance(forZoom zoom: Double) -> CLLocationDistance {
        earthCircumference / pow(2, zoom)
    }

    // MARK: - Bounding box

    struct BBox: Equatable {
        var minLat: Double, maxLat: Double, minLon: Double, maxLon: Double

        var center: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                   longitude: (minLon + maxLon) / 2)
        }

        /// Largest edge of the box in meters (used to derive a camera distance).
        var maxSpanMeters: CLLocationDistance {
            let latMeters = (maxLat - minLat) * 111_320
            let midLat = (minLat + maxLat) / 2
            let lonMeters = (maxLon - minLon) * 111_320 * cos(midLat * .pi / 180)
            return max(latMeters, lonMeters)
        }
    }

    static func bbox(of coords: [CLLocationCoordinate2D]) -> BBox {
        var b = BBox(minLat: 90, maxLat: -90, minLon: 180, maxLon: -180)
        for c in coords {
            b.minLat = min(b.minLat, c.latitude)
            b.maxLat = max(b.maxLat, c.latitude)
            b.minLon = min(b.minLon, c.longitude)
            b.maxLon = max(b.maxLon, c.longitude)
        }
        return b
    }

    // MARK: - Day-segment slicing

    /// The route span (start→end vertex indices) and coordinates for one day's leg —
    /// mirrors Mapbox's `fitBounds` over the segment between the previous camp and the
    /// selected camp (spec §1e / §2b — the highlighted cyan segment).
    struct DaySegment {
        /// Lower route-vertex index of the leg.
        var startIndex: Int
        /// Upper route-vertex index of the leg (the selected camp's vertex).
        var endIndex: Int
        /// The sliced route coordinates, with the camp coordinate appended so the segment
        /// always reaches the camp even when the camp sits off the polyline.
        var coordinates: [CLLocationCoordinate2D]
    }

    /// Resolve a camp to its route-vertex index: honour an explicit `routePointIndex`
    /// (clamped to the route), otherwise fall back to the nearest vertex (spec: "camps
    /// without routePointIndex → nearest-point fallback").
    static func resolvedRouteIndex(for camp: Camp, route: [RouteCoordinate]) -> Int {
        if let explicit = camp.routePointIndex {
            return min(max(explicit, 0), max(0, route.count - 1))
        }
        return DayStats.closestRoutePointIndex(camp: camp.coordinates, route: route)
    }

    /// Slice the day `dayIndex` (0-based into `camps`, assumed ordered by day) out of the
    /// route. Day 1 (`dayIndex == 0`) starts at the route origin (index 0), matching the
    /// web. `lo`/`hi` are ordered with `min`/`max` so an off-route or backtracking camp
    /// (e.g. a safari side-trip whose nearest vertex precedes the previous camp's) never
    /// produces an inverted slice.
    static func daySegment(dayIndex: Int,
                           camps: [Camp],
                           route: [RouteCoordinate]) -> DaySegment {
        guard camps.indices.contains(dayIndex), !route.isEmpty else {
            return DaySegment(startIndex: 0, endIndex: 0, coordinates: [])
        }
        let camp = camps[dayIndex]
        let endIndex = resolvedRouteIndex(for: camp, route: route)
        let startIndex = dayIndex == 0
            ? 0
            : resolvedRouteIndex(for: camps[dayIndex - 1], route: route)

        let lo = min(startIndex, endIndex)
        let hi = max(startIndex, endIndex)
        var coords = route[lo...hi].compactMap { c -> CLLocationCoordinate2D? in
            c.count >= 2 ? CLLocationCoordinate2D(latitude: c[1], longitude: c[0]) : nil
        }
        coords.append(camp.clCoordinate)
        return DaySegment(startIndex: startIndex, endIndex: endIndex, coordinates: coords)
    }

    // MARK: - Camera builders (Mapbox fitBounds → MKMapCamera)

    /// Globe framing. Mapbox: center `[30,15]`, zoom 1.2/1.5, pitch 0, bearing 0.
    static func globeCamera(longitude: Double? = nil) -> MKMapCamera {
        let cam = MKMapCamera()
        cam.centerCoordinate = longitude
            .map { CLLocationCoordinate2D(latitude: globeCenter.latitude, longitude: $0) }
            ?? globeCenter
        cam.centerCoordinateDistance = globeDistance
        cam.pitch = 0
        cam.heading = 0
        return cam
    }

    /// Fit a set of coordinates with a pitched / rotated camera. `fitFactor` converts the
    /// box's largest span into a viewing distance; a steeper pitch needs a larger factor to
    /// keep the far edge in frame.
    static func fittingCamera(coords: [CLLocationCoordinate2D],
                              pitch: Double,
                              heading: Double,
                              fitFactor: Double,
                              minDistance: CLLocationDistance,
                              covered: CoveredEdge = .none) -> MKMapCamera {
        let box = bbox(of: coords)
        var center = box.center
        var distance = max(box.maxSpanMeters * fitFactor, minDistance)

        // QUA-66: bias for the part of the screen the presented chrome covers. The day fly-in
        // used to fit its leg for the FULL viewport while selecting a day simultaneously presents
        // the day sheet at .medium (iPhone, lower half) or the 400pt panel (iPad, leading edge) —
        // so the choreographed landing shot ended with the selected camp behind the sheet: the
        // signature interaction hid its own subject. The bias is two moves: widen the distance so
        // the subject fits the visible remainder, and walk the centre TOWARD the covered edge so
        // the subject slides into the uncovered half. Screen-bottom on a heading-rotated camera is
        // the reverse bearing; screen-leading is heading − 90°.
        switch covered {
        case .none:
            break
        case .bottom(let fraction):
            let f = min(max(fraction, 0), 0.6)
            distance /= max(1 - f, 0.4)
            center = coordinate(from: center, bearingDegrees: heading + 180, distanceMeters: distance * f / 2)
        case .leading(let fraction):
            let f = min(max(fraction, 0), 0.6)
            distance /= max(1 - f, 0.4)
            center = coordinate(from: center, bearingDegrees: heading - 90, distanceMeters: distance * f / 2)
        }

        let cam = MKMapCamera()
        cam.centerCoordinate = center
        cam.centerCoordinateDistance = distance
        cam.pitch = pitch
        cam.heading = heading
        return cam
    }

    /// QUA-66: which screen edge presented chrome covers, as a fraction of the viewport.
    /// `Equatable` so hosts can push it on size-class changes without redundant work.
    enum CoveredEdge: Equatable {
        case none
        case bottom(fraction: Double)
        case leading(fraction: Double)
    }

    /// Great-circle destination point: `distanceMeters` from `origin` along `bearingDegrees`.
    /// Pure spherical math (mean Earth radius), unit-tested — precision at camera-offset scales
    /// (kilometres) is far inside a pixel.
    static func coordinate(from origin: CLLocationCoordinate2D,
                           bearingDegrees: Double,
                           distanceMeters: Double) -> CLLocationCoordinate2D {
        let radius = 6_371_000.0
        let bearing = bearingDegrees * .pi / 180
        let lat1 = origin.latitude * .pi / 180
        let lon1 = origin.longitude * .pi / 180
        let angular = distanceMeters / radius
        let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearing))
        let lon2 = lon1 + atan2(sin(bearing) * sin(angular) * cos(lat1),
                                cos(angular) - sin(lat1) * sin(lat2))
        return CLLocationCoordinate2D(latitude: lat2 * 180 / .pi, longitude: lon2 * 180 / .pi)
    }

    // MARK: - Photo clustering and marker precedence (QUA-83)
    //
    // The iOS twin of the web's QUA-49/QUA-58. Everything here is pure so the two decisions that
    // actually caused the defect — how photos group, and who wins a tap — are unit-testable
    // without a live map, which is what let the web guard its own regression cheaply.

    /// A grid cell of geotagged photos drawn as one stack marker — the iOS counterpart of the
    /// web's `PhotoGroup` (`src/lib/map/mapkit/geometry.ts:175`).
    ///
    /// Stores latitude/longitude rather than a `CLLocationCoordinate2D` for the same reason
    /// `MapPhoto` does (`GlobeMapComponents.swift:75`): `CLLocationCoordinate2D` is not
    /// `Equatable`, so a stored one would cost this type its synthesised conformance.
    struct PhotoCluster: Identifiable, Equatable {
        /// Grid cell key. Stable for a given camera distance and deliberately NOT across
        /// distances — re-clustering on zoom is the point.
        var id: String
        var photos: [MapPhoto]
        /// The photo whose thumbnail is drawn for the stack.
        var representative: MapPhoto
        var latitude: Double
        var longitude: Double

        var count: Int { photos.count }
        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
    }

    /// Inverse of ``distance(forZoom:)``, so the web's zoom-derived grid can be driven from an
    /// `MKMapCamera`'s `centerCoordinateDistance`.
    ///
    /// Clamped to `0...24`, and the clamp is load-bearing rather than tidiness: the cell size below
    /// divides by `2^(zoom − 8)`, and converting the resulting quotient to `Int` **traps** in Swift
    /// when the value is non-finite or outside `Int`'s range. A zero or absurd camera distance would
    /// therefore crash the map rather than mis-draw it. MapKit's real range here is about −0.1
    /// (globe, 42,000 km) to 18.6 (100 m), so the clamp never touches a genuine camera.
    static func zoom(forDistance distance: CLLocationDistance) -> Double {
        guard distance > 0, distance.isFinite else { return 24 }
        return min(max(log2(earthCircumference / distance), 0), 24)
    }

    /// Group photos into a camera-derived spatial grid, one stack marker per cell.
    ///
    /// The cell size is the web's formula verbatim — `0.1 / 2^(zoom − 8)`
    /// (`src/lib/map/mapkit/geometry.ts:197`) — reached from the camera through
    /// ``zoom(forDistance:)`` so both surfaces cluster identically at the same framing. The web's
    /// note that MapKit's own clustering (`clusteringIdentifier`) was deliberately declined applies
    /// here too: these markers carry a count badge the built-in cluster annotation cannot draw.
    ///
    /// One deliberate difference from the web: the result is **sorted by cell key**. JavaScript's
    /// `Map` iterates in insertion order, so the web's array is stable for free; a Swift
    /// `Dictionary` guarantees no order at all, and an unstable one would give SwiftUI's `ForEach`
    /// a different sequence of identities on an unrelated redraw and rebuild every annotation view.
    static func photoClusters(_ photos: [MapPhoto], zoom: Double) -> [PhotoCluster] {
        guard !photos.isEmpty else { return [] }
        let z = min(max(zoom.isFinite ? zoom : 24, 0), 24)
        let cellSize = 0.1 / pow(2, z - 8)

        var cells: [String: [MapPhoto]] = [:]
        for photo in photos {
            guard photo.latitude.isFinite, photo.longitude.isFinite else { continue }
            let key = "\(Int(floor(photo.longitude / cellSize))),\(Int(floor(photo.latitude / cellSize)))"
            cells[key, default: []].append(photo)
        }

        return cells.keys.sorted().compactMap { key in
            guard let bucket = cells[key], let first = bucket.first else { return nil }
            let n = Double(bucket.count)
            return PhotoCluster(id: key,
                                photos: bucket,
                                representative: first,
                                latitude: bucket.reduce(0) { $0 + $1.latitude } / n,
                                longitude: bucket.reduce(0) { $0 + $1.longitude } / n)
        }
    }

    /// Clearance kept between a photo stack's centre and the nearest camp badge's centre, in
    /// points — the web's `MARKER_CLEARANCE_PX` (`src/lib/map/mapkit/annotations.ts:77`).
    ///
    /// Sized there off the two elements' own boxes rather than picked: 36 pt camp (42 selected),
    /// 32 pt stack (40 highlighted), so 30 pt puts each marker's centre outside the other's box
    /// with 9 pt to spare in the worst combination, while staying small enough that the pair still
    /// reads as one place. It ports unchanged because the iOS markers carry the same 44 pt minimum
    /// tap frames (`GlobeMapComponents.swift:210`, `:257`).
    static let markerClearancePoints: Double = 30

    /// Push any cluster sitting within `clearancePoints` of a camp badge directly away from it, so
    /// the two tap frames stop overlapping.
    ///
    /// **This mirrors the web and not the ledger entry.** QUA-83's finish line describes clusters
    /// "filtered within a clearance radius"; the web does not filter — `clearedAnchorOffset`
    /// OFFSETS the stack and keeps it (`src/lib/map/mapkit/annotations.ts:70-77`). Dropping a
    /// cluster would silently hide photos, which is a worse failure than the overlap being fixed,
    /// so the web's choice is the one ported. The ledger text is the looser statement of intent.
    ///
    /// `metersPerPoint` comes from the live projection rather than a formula, because the honest
    /// conversion depends on viewport size and pitch. When it is unavailable the clusters are
    /// returned untouched: the tap-precedence half of QUA-83 is declaration order and does not
    /// depend on this, so a missing projection degrades to "no nudge", never to "camps unreachable".
    static func clustersCleared(_ clusters: [PhotoCluster],
                                of camps: [Camp],
                                metersPerPoint: Double,
                                clearancePoints: Double = markerClearancePoints) -> [PhotoCluster] {
        guard metersPerPoint > 0, metersPerPoint.isFinite, !camps.isEmpty else { return clusters }
        let clearance = clearancePoints * metersPerPoint

        return clusters.map { cluster in
            var nearest: (coordinate: CLLocationCoordinate2D, meters: CLLocationDistance)?
            for camp in camps {
                let d = meters(from: camp.clCoordinate, to: cluster.coordinate)
                if nearest == nil || d < nearest!.meters { nearest = (camp.clCoordinate, d) }
            }
            guard let hit = nearest, hit.meters < clearance else { return cluster }

            // A photo geotagged exactly at the camp — the most common case in the defect report,
            // since that is what "a photo taken at camp" produces — has no away-direction at all.
            // Due north is chosen so the result is deterministic rather than dependent on
            // floating-point noise inside `bearing`.
            let away = hit.meters == 0
                ? 0
                : bearing(from: hit.coordinate, to: cluster.coordinate)
            let moved = coordinate(from: hit.coordinate,
                                   bearingDegrees: away,
                                   distanceMeters: clearance)
            var out = cluster
            out.latitude = moved.latitude
            out.longitude = moved.longitude
            return out
        }
    }

    /// Upper bound on rendered photo stack markers.
    ///
    /// Each one is a live SwiftUI `Annotation` hosting an `AsyncImage`, so a photo-heavy journey's
    /// overview built hundreds of them at once — the first half of QUA-83's finding. Clustering
    /// removes most of that; this bounds what remains when the photos are spread widely enough
    /// that nearly every cell holds one.
    static let maxRenderedPhotoClusters = 60

    /// The `limit` biggest clusters, ties broken by cell key, returned back in key order.
    ///
    /// Sorted twice on purpose: by size to choose, then by key so the rendered sequence keeps the
    /// stable `ForEach` identity that ``photoClusters(_:zoom:)`` establishes.
    static func topClusters(_ clusters: [PhotoCluster],
                            limit: Int = maxRenderedPhotoClusters) -> [PhotoCluster] {
        guard limit > 0 else { return [] }
        guard clusters.count > limit else { return clusters }
        return clusters
            .sorted { $0.count != $1.count ? $0.count > $1.count : $0.id < $1.id }
            .prefix(limit)
            .sorted { $0.id < $1.id }
    }

    // MARK: - Coincident camps (QUA-83)

    /// Camps sharing one location, drawn as a single badge.
    struct CampGroup: Identifiable, Equatable {
        /// The first member camp's id.
        var id: String
        /// Indices into the journey's `camps`, in day order — what selection is expressed in.
        var indices: [Int]
        /// Day numbers the badge offers, in the same order as `indices`.
        var dayNumbers: [Int]
        var latitude: Double
        var longitude: Double

        var coordinate: CLLocationCoordinate2D {
            CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
        var isMerged: Bool { indices.count > 1 }
    }

    /// Merge camps within `radiusMeters` of one another into one badge.
    ///
    /// A multi-night stay — a rest day, an acclimatisation day, a base camp returned to — writes
    /// two camps at the same coordinate. Both badges were drawn exactly on top of each other, and
    /// since SwiftUI's later declaration takes the tap, **only the later day was ever reachable**
    /// and the earlier one was permanently unselectable. That is the ":372" half of QUA-83's
    /// finding, and grouping is what makes the badge able to offer both days.
    ///
    /// Grouping is greedy against every existing group rather than only the previous camp, so a
    /// base camp returned to on a much later day merges with its first visit too.
    ///
    /// `radiusMeters` is a judgement, not a measurement: large enough that two camps typed with the
    /// same coordinate — or one re-derived from a GPS fix a few metres off — merge, and far smaller
    /// than the kilometres between two genuinely different camps.
    static func campGroups(_ camps: [Camp], radiusMeters: Double = 25) -> [CampGroup] {
        var groups: [CampGroup] = []
        for (index, camp) in camps.enumerated() {
            let coord = camp.clCoordinate
            if let hit = groups.firstIndex(where: { meters(from: $0.coordinate, to: coord) <= radiusMeters }) {
                groups[hit].indices.append(index)
                groups[hit].dayNumbers.append(camp.dayNumber)
            } else {
                groups.append(CampGroup(id: camp.id,
                                        indices: [index],
                                        dayNumbers: [camp.dayNumber],
                                        latitude: coord.latitude,
                                        longitude: coord.longitude))
            }
        }
        return groups
    }

    /// Which camp index a tap on `group` should select, given what is selected now.
    ///
    /// A merged badge is one tap target standing for several days, so it advances: tapping it
    /// selects its first day, and tapping again walks to the next, wrapping at the end. That is how
    /// a badge "offers both days" without inventing a second control on a 44 pt target.
    static func tapSelection(in group: CampGroup, current: Int?) -> Int {
        guard let current, let position = group.indices.firstIndex(of: current) else {
            return group.indices.first ?? 0
        }
        return group.indices[(position + 1) % group.indices.count]
    }
}
