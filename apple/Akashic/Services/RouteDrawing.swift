import Foundation

/// Draw-on-map route authoring — the third way a route can come into existence, after GPX import
/// (`GPXParser`) and inference from photo locations (`RouteInference`).
///
/// It exists for the journeys the other two cannot serve: a trek walked before anyone carried a
/// tracker, or one whose photos have no GPS at all. The user traces the route with a finger and
/// gets the same `Route` value every other path produces, so stats, day linkage, export and sync
/// need no special case.
///
/// Everything here is a **pure function over value types** — no MapKit, no SwiftUI, no I/O. The
/// view (`RouteDrawingSheet`) owns only the gesture and the camera; every decision about which
/// points survive, how a stroke attaches to what is already drawn, and what the polyline finally
/// looks like lives here and is unit-tested directly.
///
/// **The honest limitation, stated once and carried into the UI:** a finger on a flat map produces
/// no elevation. Drawn coordinates are 2-element `[lng, lat]`, so `JourneyDraft.elevationGainLoss`
/// books nothing and `highestPoint` stays nil — ascent, descent and summit are *absent*, not zeroed
/// by accident. `elevationNote` is the sentence the UI shows so the user learns this before Apply,
/// not from wrong stats afterwards.
enum RouteDrawing {

    // MARK: Tuning

    /// Minimum ground distance between consecutive captured points while the finger moves. Below
    /// this a sample is the same place (finger tremor, a pause mid-gesture) and is dropped at
    /// capture time — cheaper than simplifying it away later, and it keeps the live polyline light.
    static let minPointSpacingMeters: Double = 12

    /// Douglas–Peucker tolerance applied when a stroke ends. Tuned to remove the wobble of a finger
    /// tracing a valley without rounding off real switchbacks.
    static let simplifyToleranceMeters: Double = 8

    /// Ceiling for the whole drawn polyline. The same route-size limit inference uses — it is a
    /// property of what the app can draw and sync, not of how the route was authored, so it is read
    /// from there rather than restated with a second value.
    static let maxRoutePoints: Int = RouteInference.maxRoutePoints

    /// How close a new stroke's endpoint must come to an existing endpoint to be treated as a
    /// continuation of it rather than a detached second leg.
    static let snapMeters: Double = 150

    /// The sentence the UI must show for any hand-drawn route.
    static let elevationNote =
        "A drawn route carries no elevation, so ascent, descent and summit stay unset. Import a GPX if you need them."

    // MARK: Capture

    /// Whether `candidate` is far enough from the last captured point to be worth keeping.
    /// The first point of a stroke is always kept.
    static func shouldAppend(_ candidate: [Double], to stroke: [[Double]],
                             minMeters: Double = minPointSpacingMeters) -> Bool {
        guard isValid(candidate) else { return false }
        guard let last = stroke.last, last.count >= 2 else { return true }
        return distanceMeters(last, candidate) >= minMeters
    }

    /// A coordinate is usable only when it is finite and inside the world.
    static func isValid(_ coordinate: RouteCoordinate) -> Bool {
        guard coordinate.count >= 2 else { return false }
        let lng = coordinate[0], lat = coordinate[1]
        guard lng.isFinite, lat.isFinite else { return false }
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    }

    // MARK: Simplification

    /// Simplify a finished stroke: Douglas–Peucker at a metric tolerance, then the point cap.
    /// Strokes of two points or fewer pass through untouched (there is nothing to simplify, and a
    /// two-point stroke is a legitimate straight leg).
    static func simplify(_ stroke: [[Double]],
                         toleranceMeters: Double = simplifyToleranceMeters,
                         maxPoints: Int = maxRoutePoints) -> [[Double]] {
        let points = stroke.filter(isValid)
        guard points.count > 2 else { return points }
        // Douglas–Peucker measures perpendicular distance in whatever plane it is handed, and raw
        // lng/lat is not one: a degree of longitude is ~111 km at the equator and ~19 km at 80°N, so
        // simplifying there directly would treat the same shape differently depending on where on
        // Earth it was drawn (pinned by test). Project to a local equirectangular plane first —
        // longitude scaled by cos(latitude) — where both axes are degrees-of-latitude, i.e. metres
        // to a constant. Then the tolerance is genuinely metric and isotropic.
        let scale = cos(min(max(meanLatitude(points), -89.5), 89.5) * .pi / 180)
        let projected = points.map { [$0[0] * scale, $0[1]] }
        let epsilon = toleranceMeters / metersPerDegreeLatitude
        let keptIndices = RouteInference.douglasPeucker(projected, epsilon: epsilon)
        let kept = keptIndices.map { points[$0] }
        guard kept.count > maxPoints else { return kept }
        // Still over the cap (a genuine zig-zag Douglas–Peucker can't thin on shape): fall back to
        // the adaptive point-count pass, which tightens epsilon until the route fits.
        let projectedKept = keptIndices.map { projected[$0] }
        return RouteInference.simplifyIndices(projectedKept, maxPoints: maxPoints).map { kept[$0] }
    }

    // MARK: Joining strokes

    /// Which orientation makes the shortest seam between a new stroke and the existing polyline.
    /// Private on purpose: it is how `join` decides, not something callers act on — they need the
    /// resulting points and whether a gap had to be bridged.
    private enum Orientation {
        case appendStroke           // stroke start met the polyline's end
        case appendReversed         // stroke was drawn backwards from the polyline's end
        case prependStroke          // stroke end met the polyline's start
        case prependReversed        // stroke was drawn outwards from the polyline's start
    }

    /// Attach `stroke` to `existing`, choosing the orientation that makes the shortest seam. When no
    /// endpoint pair falls within `snapMeters` the stroke becomes a straight-line continuation from
    /// the end — the user drew a detached leg, and a route is a single LineString, so the gap is
    /// bridged rather than silently dropped. `bridgeMeters` is 0 when the stroke snapped; non-zero
    /// means a deliberate straight leg, which the UI reports.
    static func join(existing: [[Double]], stroke: [[Double]],
                     snapMeters: Double = snapMeters) -> (points: [[Double]], bridgeMeters: Double) {
        let stroke = stroke.filter(isValid)
        guard stroke.count >= 2 else { return (existing, 0) }
        guard let head = existing.first, let tail = existing.last, existing.count >= 2 else {
            return (stroke, 0)
        }

        let strokeStart = stroke[0], strokeEnd = stroke[stroke.count - 1]
        let candidates: [(orientation: Orientation, distance: Double)] = [
            (.appendStroke, distanceMeters(tail, strokeStart)),
            (.appendReversed, distanceMeters(tail, strokeEnd)),
            (.prependStroke, distanceMeters(head, strokeEnd)),
            (.prependReversed, distanceMeters(head, strokeStart)),
        ]
        // Ties resolve in the listed order, which prefers growing forwards — the overwhelmingly
        // common intent when someone keeps drawing.
        let best = candidates.min { $0.distance < $1.distance }!

        guard best.distance <= snapMeters else {
            // Detached leg: bridge from the end, the direction the route reads in.
            return (existing + stroke, best.distance)
        }

        switch best.orientation {
        case .appendStroke:   return (existing + stroke.dropFirst(), 0)
        case .appendReversed: return (existing + stroke.reversed().dropFirst(), 0)
        case .prependStroke:  return (stroke.dropLast() + existing, 0)
        case .prependReversed: return (stroke.reversed().dropLast() + existing, 0)
        }
    }

    /// Fold a stroke list into one polyline, counting the gaps that had to be bridged. This is the
    /// single definition of "what has been drawn": the view keeps only the stroke list, so Undo is a
    /// `removeLast()` plus a refold — never a subtraction from a merged polyline, which is how
    /// drawing tools end up with points nobody can account for.
    static func fold(strokes: [[[Double]]],
                     snapMeters: Double = snapMeters) -> (points: [[Double]], bridgedGaps: Int) {
        var points: [[Double]] = []
        var bridged = 0
        for stroke in strokes {
            let result = join(existing: points, stroke: stroke, snapMeters: snapMeters)
            points = result.points
            if result.bridgeMeters > 0 { bridged += 1 }
        }
        return (points, bridged)
    }

    // MARK: Result

    /// A finished hand-drawn route and the provenance that goes with it — the drawing counterpart to
    /// `GPXFile` (route + waypoints + dropped points) and `RouteInferenceResult` (route + segments +
    /// confidence). It exists so the honesty computed here survives the trip to the UI: without it,
    /// each call site re-derived its own description and the bridged-gap count was lost at the seam.
    struct DrawnRoute: Equatable {
        var route: Route
        /// Straight legs inserted between strokes the user drew detached from each other.
        var bridgedGaps: Int

        var pointCount: Int { route.coordinates.count }
        var distanceKm: Double { JourneyDraft.totalDistanceKm(route: route.coordinates) }
        var isUsable: Bool { route.coordinates.count >= 2 }

        /// One-line, plain-language summary, in the house style of `RouteConfidence.summary`.
        var summary: String {
            var s = "Route drawn by hand · \(pointCount) point\(pointCount == 1 ? "" : "s")"
            s += " · \(Formatters.distanceKm(distanceKm))"
            if bridgedGaps > 0 {
                s += " · \(bridgedGaps) straight leg\(bridgedGaps == 1 ? "" : "s") between detached strokes"
            }
            return s
        }
    }

    /// The drawn polyline as a `Route`. Coordinates stay 2-element — see the type's note on
    /// elevation. An under-two-point polyline is not a line, and yields the empty route.
    static func route(from points: [[Double]]) -> Route {
        let coordinates = points.filter(isValid).map { [$0[0], $0[1]] }
        guard coordinates.count >= 2 else { return .empty }
        return Route(type: "LineString", coordinates: coordinates)
    }

    /// The finished result for a stroke list: the folded polyline as a `Route`, with its bridged-gap
    /// count. What the drawing sheet hands its caller.
    static func drawnRoute(strokes: [[[Double]]]) -> DrawnRoute {
        let folded = fold(strokes: strokes)
        return DrawnRoute(route: route(from: folded.points), bridgedGaps: folded.bridgedGaps)
    }

    // MARK: Geometry helpers

    /// Great-circle distance in metres (`PhotoDayMatcher.distanceKm` is the single haversine).
    private static func distanceMeters(_ a: [Double], _ b: [Double]) -> Double {
        guard a.count >= 2, b.count >= 2 else { return 0 }
        return PhotoDayMatcher.distanceKm(a[1], a[0], b[1], b[0]) * 1000
    }

    /// Mean metres per degree of latitude — the constant that makes the projected plane metric.
    private static let metersPerDegreeLatitude: Double = 111_320

    /// Degrees of **longitude** per metre at a given latitude. Used to place and reason about
    /// east-west distances; latitude is clamped so cos never reaches 0 at the poles.
    static func degreesPerMeter(atLatitude latitude: Double) -> Double {
        let clamped = min(max(latitude, -89.5), 89.5)
        let metersPerDegreeLng = metersPerDegreeLatitude * cos(clamped * .pi / 180)
        return 1 / max(metersPerDegreeLng, 1)
    }

    private static func meanLatitude(_ points: [[Double]]) -> Double {
        guard !points.isEmpty else { return 0 }
        return points.reduce(0.0) { $0 + $1[1] } / Double(points.count)
    }
}
