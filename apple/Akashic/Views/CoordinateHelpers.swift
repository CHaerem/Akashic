import MapKit

extension Camp {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension Route {
    var clCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { c in
            c.count >= 2 ? CLLocationCoordinate2D(latitude: c[1], longitude: c[0]) : nil
        }
    }
}

extension Journey {
    /// Bounding region that fits the whole route (falls back to camps, then a wide view).
    var mapRegion: MKCoordinateRegion {
        let points = route.clCoordinates.isEmpty ? camps.map(\.clCoordinate) : route.clCoordinates
        guard let first = points.first else {
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 0, longitude: 0),
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
