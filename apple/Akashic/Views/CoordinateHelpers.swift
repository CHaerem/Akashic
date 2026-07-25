import MapKit

extension Camp {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension Array where Element == RouteCoordinate {
    /// `[[lng, lat, ele?]]` → MapKit coordinates, skipping malformed points. The single definition of
    /// this conversion; `Route.clCoordinates` and every view that holds bare coordinate arrays
    /// (route drawing, previews) go through here.
    var clCoordinates: [CLLocationCoordinate2D] {
        compactMap { c in
            c.count >= 2 ? CLLocationCoordinate2D(latitude: c[1], longitude: c[0]) : nil
        }
    }
}

extension Route {
    var clCoordinates: [CLLocationCoordinate2D] { coordinates.clCoordinates }

    /// Whether any point carries an elevation. A route drawn by hand on a flat map never does, and
    /// a GPX without `<ele>` doesn't either — so consumers must ask rather than read `coordinates[2]`
    /// and get 0 m. `ElevationProfileModel` treats a missing third element as sea level, which is
    /// exactly why the profile has to be gated on this instead of on "is the route non-empty".
    var hasElevation: Bool {
        coordinates.contains { $0.count > 2 && $0[2].isFinite }
    }
}

extension MKCoordinateRegion {
    /// The region that frames `points`, padded 40 %, with a floor so a single point doesn't zoom to
    /// street level. Returns a wide world view when there is nothing to frame. One bounding-box
    /// implementation for `Journey.mapRegion`, the correction preview and the drawing sheet.
    static func fitting(_ points: [CLLocationCoordinate2D]) -> MKCoordinateRegion {
        guard let first = points.first else {
            return MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
                                      span: MKCoordinateSpan(latitudeDelta: 90, longitudeDelta: 180))
        }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for p in points {
            minLat = min(minLat, p.latitude); maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude); maxLon = max(maxLon, p.longitude)
        }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2,
                                           longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max((maxLat - minLat) * 1.4, 0.05),
                                   longitudeDelta: max((maxLon - minLon) * 1.4, 0.05))
        return MKCoordinateRegion(center: center, span: span)
    }
}

extension Journey {
    /// Bounding region that fits the whole route (falls back to camps, then a wide view).
    var mapRegion: MKCoordinateRegion {
        let points = route.clCoordinates.isEmpty ? camps.map(\.clCoordinate) : route.clCoordinates
        return .fitting(points)
    }
}
