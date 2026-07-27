import Foundation

/// Assisted journey creation — draft a route from the places a set of photos was taken.
///
/// The photos the user picks already carry most of the journey: EXIF GPS, capture time, and
/// (often) GPS altitude. When there is NO GPX to import, those locations, ordered by time and
/// cleaned up, are a perfectly good first draft of the route — which the user then accepts,
/// edits, or discards. Nothing here is written silently: the caller turns a `RouteInferenceResult`
/// into a *suggestion* the user accepts in `NewJourneySheet`.
///
/// Everything in this file is a **pure, deterministic function** over value types (no PhotosUI,
/// no CoreLocation, no I/O), so the ordering / outlier / simplification / segmentation logic is
/// unit-tested directly. The view layer builds `[PhotoFix]` from picked items' `PhotoMetadata`
/// and hands them here.

// MARK: - Input

/// One geotagged photo observation the route is drafted from. `[lng, lat]` (GeoJSON order),
/// a capture instant, and an optional GPS altitude in metres (nil when the EXIF carried none).
struct PhotoFix: Equatable {
    var coordinate: [Double]   // [lng, lat]
    var timestamp: Date
    var altitude: Double?      // metres above sea level, when present

    init(coordinate: [Double], timestamp: Date, altitude: Double? = nil) {
        self.coordinate = coordinate
        self.timestamp = timestamp
        self.altitude = altitude
    }

    /// A fix is usable only with a finite, in-range `[lng, lat]`.
    var isValid: Bool {
        guard coordinate.count >= 2 else { return false }
        let lng = coordinate[0], lat = coordinate[1]
        guard lng.isFinite, lat.isFinite else { return false }
        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    }
}

// MARK: - Output

/// A run of consecutive route points that fall on the same UTC calendar day — the boundary the
/// creation flow aligns its proposed days to. Indices are into `RouteInferenceResult.route.coordinates`.
struct RouteDaySegment: Equatable {
    /// UTC `yyyy-MM-dd` key (same clustering as `JourneyDraft.days(fromPhotos:)`).
    var dayKey: String
    var startIndex: Int   // inclusive
    var endIndex: Int     // inclusive
    var pointCount: Int { endIndex - startIndex + 1 }
}

/// How trustworthy the drafted route is, phrased so the UI can be honest ("Route drafted from
/// 214 photo locations · 1 gap over 3 h").
struct RouteConfidence: Equatable {
    /// Geotagged photos actually used (valid fixes surviving the outlier pass).
    var sourcePointCount: Int
    /// Vertices in the simplified route.
    var routePointCount: Int
    /// Fixes discarded as GPS spikes (impossible speed) or duplicates.
    var droppedOutliers: Int
    /// Largest stretch, in hours, with no photo location at all.
    var largestGapHours: Double
    /// Number of consecutive gaps longer than `RouteInference.gapThresholdHours`.
    var gapCount: Int

    /// One-line, plain-language summary for the suggestion row.
    ///
    /// Localised per clause with real plural rules rather than an English `"s"` ternary — see the
    /// same note on `RouteDrawing.DrawnRoute.summary` (QUA-26).
    var summary: String {
        var s = String(localized: "Route drafted from \(sourcePointCount) photo locations",
                       comment: "Route provenance line: how many geotagged photos the drafted route was inferred from.")
        if gapCount > 0 {
            let hrs = Int(largestGapHours.rounded())
            s += " · " + String(localized: "\(gapCount) gaps (up to \(hrs) h without GPS)",
                                comment: "Route provenance line: stretches with no photo location at all. First placeholder is how many gaps, second is the longest one in whole hours.")
        }
        return s
    }
}

/// The full result: the drafted route, its per-day segments, and its confidence signals.
struct RouteInferenceResult: Equatable {
    var route: Route
    var daySegments: [RouteDaySegment]
    var confidence: RouteConfidence

    var isEmpty: Bool { route.coordinates.isEmpty }
}

// MARK: - Inference

enum RouteInference {

    /// Consecutive fixes implying a ground speed above this (km/h) are treated as GPS spikes and
    /// dropped. Generous for hiking/travel journals — a fast train or a plane hop is unusual for
    /// this app, and the point is only to kill obvious garbage, not to police the itinerary.
    static let maxPlausibleSpeedKmh: Double = 15

    /// Two fixes closer than this (km) at (near-)identical times are the same location — a burst of
    /// photos — and collapse to one point.
    static let duplicateDistanceKm: Double = 0.005   // 5 m

    /// A time gap longer than this (hours) between consecutive fixes counts as a coverage gap.
    static let gapThresholdHours: Double = 3

    /// Target ceiling for the simplified route (Douglas–Peucker tightens until at/under this).
    static let maxRoutePoints: Int = 400

    /// Draft a route from photo fixes. Pure and deterministic.
    ///
    /// 1. keep valid fixes, order by time;
    /// 2. drop GPS spikes (implausible speed) and collapse same-place bursts;
    /// 3. simplify with Douglas–Peucker to at most `maxRoutePoints`, preserving each kept point's
    ///    original altitude;
    /// 4. emit a `Route` of `[lng, lat, ele?]` (ele only where the photo carried altitude);
    /// 5. segment by UTC day (aligned with the photo-day clustering the days list uses);
    /// 6. report confidence (counts + coverage gaps).
    static func infer(from fixes: [PhotoFix],
                      maxSpeedKmh: Double = maxPlausibleSpeedKmh,
                      maxPoints: Int = maxRoutePoints) -> RouteInferenceResult {
        // 1. Valid + time-ordered. Sort is stable on timestamp; ties keep input order.
        let ordered = fixes.filter { $0.isValid }
            .enumerated()
            .sorted { a, b in
                if a.element.timestamp == b.element.timestamp { return a.offset < b.offset }
                return a.element.timestamp < b.element.timestamp
            }
            .map { $0.element }

        guard !ordered.isEmpty else {
            return RouteInferenceResult(route: .empty, daySegments: [],
                                        confidence: RouteConfidence(sourcePointCount: 0, routePointCount: 0,
                                                                    droppedOutliers: 0, largestGapHours: 0,
                                                                    gapCount: 0))
        }

        // 2. Outlier / duplicate pass against the last ACCEPTED fix.
        var accepted: [PhotoFix] = [ordered[0]]
        var dropped = 0
        for fix in ordered.dropFirst() {
            let last = accepted[accepted.count - 1]
            let km = PhotoDayMatcher.distanceKm(last.coordinate[1], last.coordinate[0],
                                                fix.coordinate[1], fix.coordinate[0])
            let hours = fix.timestamp.timeIntervalSince(last.timestamp) / 3600
            if hours <= 0 {
                // Same instant (or out-of-order tie): keep only if essentially the same place.
                if km <= duplicateDistanceKm { continue }   // burst duplicate — silently merged
                dropped += 1                                 // teleport at t=0 — a spike
                continue
            }
            if km <= duplicateDistanceKm { continue }        // stationary burst across a small gap
            let speed = km / hours
            if speed > maxSpeedKmh { dropped += 1; continue } // implausible jump — GPS spike
            accepted.append(fix)
        }

        // 3. Simplify (Douglas–Peucker over indices so altitude rides along).
        let keptIndices = simplifyIndices(accepted.map { $0.coordinate }, maxPoints: maxPoints)
        let kept = keptIndices.map { accepted[$0] }

        // 4. Route coordinates: [lng, lat] + ele only where altitude is present & finite.
        let coordinates: [RouteCoordinate] = kept.map { fix in
            if let ele = fix.altitude, ele.isFinite {
                return [fix.coordinate[0], fix.coordinate[1], ele]
            }
            return [fix.coordinate[0], fix.coordinate[1]]
        }
        let route = Route(type: "LineString", coordinates: coordinates)

        // 5. UTC-day segments over the kept points (contiguous since time-ordered).
        let segments = daySegments(for: kept)

        // 6. Coverage gaps computed over the accepted observations (the real signal, pre-simplify).
        let (largestGap, gapCount) = coverageGaps(accepted)
        let confidence = RouteConfidence(
            sourcePointCount: accepted.count,
            routePointCount: coordinates.count,
            droppedOutliers: dropped,
            largestGapHours: largestGap,
            gapCount: gapCount)

        return RouteInferenceResult(route: route, daySegments: segments, confidence: confidence)
    }

    // MARK: Day segmentation

    /// Contiguous per-UTC-day runs over time-ordered fixes.
    static func daySegments(for fixes: [PhotoFix]) -> [RouteDaySegment] {
        guard !fixes.isEmpty else { return [] }
        var out: [RouteDaySegment] = []
        var currentKey = JourneyDraft.dayKey(from: fixes[0].timestamp)
        var start = 0
        for i in 1..<fixes.count {
            let key = JourneyDraft.dayKey(from: fixes[i].timestamp)
            if key != currentKey {
                out.append(RouteDaySegment(dayKey: currentKey, startIndex: start, endIndex: i - 1))
                currentKey = key
                start = i
            }
        }
        out.append(RouteDaySegment(dayKey: currentKey, startIndex: start, endIndex: fixes.count - 1))
        return out
    }

    // MARK: Coverage gaps

    /// Largest inter-fix gap (hours) and the count of gaps longer than `gapThresholdHours`.
    static func coverageGaps(_ fixes: [PhotoFix]) -> (largestHours: Double, gapCount: Int) {
        guard fixes.count > 1 else { return (0, 0) }
        var largest = 0.0
        var count = 0
        for i in 1..<fixes.count {
            let hours = fixes[i].timestamp.timeIntervalSince(fixes[i - 1].timestamp) / 3600
            if hours > largest { largest = hours }
            if hours > gapThresholdHours { count += 1 }
        }
        return (largest, count)
    }

    // MARK: Douglas–Peucker

    /// Indices of the points to keep after simplifying the polyline `[[lng, lat], …]`, tightening
    /// the tolerance until at most `maxPoints` survive. Returns all indices when the input is
    /// already small. First/last are always kept.
    static func simplifyIndices(_ points: [[Double]], maxPoints: Int) -> [Int] {
        let n = points.count
        guard n > 2, maxPoints >= 2 else { return Array(0..<n) }
        // Under the cap: keep every observed location. These are real photo positions, few enough
        // to draw directly — simplifying here would only discard honest data.
        if n <= maxPoints { return Array(0..<n) }
        // Adaptively grow epsilon (in squared lng/lat units — cheap, monotonic) until under the cap.
        var lo = 0.0
        var hi = 1.0   // ~1 degree; enormous, guaranteed to over-simplify
        var best = Array(0..<n)
        for _ in 0..<24 {
            let mid = (lo + hi) / 2
            let kept = douglasPeucker(points, epsilon: mid)
            if kept.count > maxPoints {
                lo = mid                      // too many → simplify harder
            } else {
                best = kept
                hi = mid                      // few enough → try to keep more detail
            }
        }
        return best
    }

    /// Classic Douglas–Peucker returning kept indices. `epsilon` is a perpendicular-distance
    /// tolerance in planar lng/lat space (adequate for local simplification; the caller only needs
    /// monotonic behaviour, not metric accuracy).
    static func douglasPeucker(_ points: [[Double]], epsilon: Double) -> [Int] {
        let n = points.count
        guard n > 2 else { return Array(0..<n) }
        var keep = [Bool](repeating: false, count: n)
        keep[0] = true
        keep[n - 1] = true
        var stack: [(Int, Int)] = [(0, n - 1)]
        while let (first, last) = stack.popLast() {
            guard last > first + 1 else { continue }
            var maxDist = -1.0
            var idx = first
            for i in (first + 1)..<last {
                let d = perpendicularDistance(points[i], points[first], points[last])
                if d > maxDist { maxDist = d; idx = i }
            }
            if maxDist > epsilon {
                keep[idx] = true
                stack.append((first, idx))
                stack.append((idx, last))
            }
        }
        return (0..<n).filter { keep[$0] }
    }

    /// Perpendicular distance of `p` from the segment `a`–`b` in planar lng/lat space.
    static func perpendicularDistance(_ p: [Double], _ a: [Double], _ b: [Double]) -> Double {
        let ax = a[0], ay = a[1], bx = b[0], by = b[1], px = p[0], py = p[1]
        let dx = bx - ax, dy = by - ay
        let lenSq = dx * dx + dy * dy
        if lenSq == 0 { return hypot(px - ax, py - ay) }   // degenerate segment
        // Project p onto the (infinite) line, clamp to the segment, measure the residual.
        var t = ((px - ax) * dx + (py - ay) * dy) / lenSq
        t = max(0, min(1, t))
        let projX = ax + t * dx, projY = ay + t * dy
        return hypot(px - projX, py - projY)
    }
}
