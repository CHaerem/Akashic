import Foundation
import CoreLocation
import MapKit

/// Geometry helpers: bearings, bounding boxes, and MapCamera builders that
/// translate the Mapbox choreography (center/zoom/pitch/bearing/fitBounds)
/// into MKMapCamera parameters (centerCoordinate/distance/heading/pitch).
enum GeoMath {

    // Exact globe-view values preserved from the Mapbox spec.
    // center [lng, lat] = [30, 15]; approximate zoom 1.2-1.5 with a very large
    // centerCoordinateDistance so the whole planet is framed.
    static let globeCenter = CLLocationCoordinate2D(latitude: 15, longitude: 30)
    static let globeDistance: CLLocationDistance = 42_000_000 // ~6.6 Earth radii from surface -> full disc
    static let nightSky = "0B0B19" // rgb(11,11,25) space color

    // MARK: - Bearing

    /// Initial bearing (heading) from a -> b, degrees 0..360, 0 = North.
    static func bearing(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> Double {
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        let theta = atan2(y, x)
        return (theta * 180 / .pi).truncatingRemainder(dividingBy: 360)
    }

    // MARK: - Distance

    static func meters(from a: CLLocationCoordinate2D, to b: CLLocationCoordinate2D) -> CLLocationDistance {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }

    static func nearestRouteIndex(to coord: CLLocationCoordinate2D, in route: [RoutePoint]) -> Int {
        var best = 0
        var bestD = Double.greatestFiniteMagnitude
        for (i, p) in route.enumerated() {
            let d = meters(from: coord, to: p.coordinate)
            if d < bestD { bestD = d; best = i }
        }
        return best
    }

    // MARK: - Bounding box

    struct BBox {
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

    // MARK: - Camera builders (Mapbox fitBounds -> MKMapCamera)

    /// Globe framing. Mapbox: center [30,15], zoom 1.2/1.5, pitch 0, bearing 0.
    static func globeCamera() -> MKMapCamera {
        let cam = MKMapCamera()
        cam.centerCoordinate = globeCenter
        cam.centerCoordinateDistance = globeDistance
        cam.pitch = 0
        cam.heading = 0
        return cam
    }

    /// Fit a set of coordinates with a pitched/rotated camera.
    /// `fitFactor` converts the box's largest span into a viewing distance;
    /// larger pitch needs a larger factor to keep the far edge in frame.
    static func fittingCamera(coords: [CLLocationCoordinate2D],
                              pitch: Double,
                              heading: Double,
                              fitFactor: Double,
                              minDistance: CLLocationDistance) -> MKMapCamera {
        let box = bbox(of: coords)
        let cam = MKMapCamera()
        cam.centerCoordinate = box.center
        cam.centerCoordinateDistance = max(box.maxSpanMeters * fitFactor, minDistance)
        cam.pitch = pitch
        cam.heading = heading
        return cam
    }
}
