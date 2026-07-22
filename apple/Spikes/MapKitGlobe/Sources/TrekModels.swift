import Foundation
import CoreLocation

// MARK: - Fixture decoding
// The recovered kilimanjaro.json fixture: a GeoJSON-ish LineString route
// ([[lng, lat, ele], ...]) plus an array of camps. We only decode what the
// spike needs.

struct TrekFixture: Decodable {
    let id: String
    let name: String
    let country: String
    let route: Route
    let camps: [Camp]

    struct Route: Decodable {
        let type: String
        let coordinates: [[Double]] // [lng, lat, ele]
    }

    struct Camp: Decodable {
        let id: String
        let name: String
        let dayNumber: Int
        let date: String
        let elevation: Double
        let coordinates: [Double] // [lng, lat]
        let terrain: String?
        let bearing: Double?
        let pitch: Double?
    }
}

// MARK: - Runtime model

/// A single route vertex with elevation.
struct RoutePoint {
    let coordinate: CLLocationCoordinate2D
    let elevation: Double
}

/// A camp, resolved to its nearest route-vertex index so we can slice legs.
struct TrekCamp: Identifiable {
    let id: String
    let name: String
    let dayNumber: Int
    let date: String
    let elevation: Double
    let terrain: String
    let coordinate: CLLocationCoordinate2D
    /// index into the route array of the nearest vertex (leg endpoint)
    let routeIndex: Int
    /// per-camp camera overrides from the fixture (Mapbox spec 1e)
    let bearingOverride: Double?
    let pitchOverride: Double?
}

/// The whole loaded journey plus the marker/config values that in the real app
/// live in trekConfig.ts.
struct Trek {
    let id: String
    let name: String
    let country: String
    let route: [RoutePoint]
    let camps: [TrekCamp]

    // From trekConfig.ts (kilimanjaro entry)
    let markerCoordinate: CLLocationCoordinate2D  // lat -3.0674, lng 37.3556
    let preferredBearing: Double                  // -20
    let preferredPitch: Double                    // 60
}

enum TrekLoader {
    static func loadKilimanjaro() -> Trek {
        guard let url = Bundle.main.url(forResource: "kilimanjaro", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let fixture = try? JSONDecoder().decode(TrekFixture.self, from: data)
        else {
            fatalError("Could not load kilimanjaro.json from bundle")
        }

        let route: [RoutePoint] = fixture.route.coordinates.compactMap { c in
            guard c.count >= 2 else { return nil }
            let ele = c.count >= 3 ? c[2] : 0
            return RoutePoint(
                coordinate: CLLocationCoordinate2D(latitude: c[1], longitude: c[0]),
                elevation: ele
            )
        }

        let camps: [TrekCamp] = fixture.camps.map { camp in
            let coord = CLLocationCoordinate2D(latitude: camp.coordinates[1],
                                               longitude: camp.coordinates[0])
            let idx = GeoMath.nearestRouteIndex(to: coord, in: route)
            return TrekCamp(
                id: camp.id,
                name: camp.name,
                dayNumber: camp.dayNumber,
                date: camp.date,
                elevation: camp.elevation,
                terrain: camp.terrain ?? "",
                coordinate: coord,
                routeIndex: idx,
                bearingOverride: camp.bearing,
                pitchOverride: camp.pitch
            )
        }

        return Trek(
            id: fixture.id,
            name: fixture.name,
            country: fixture.country,
            route: route,
            camps: camps,
            // trekConfig.ts -> kilimanjaro
            markerCoordinate: CLLocationCoordinate2D(latitude: -3.0674, longitude: 37.3556),
            preferredBearing: -20,
            preferredPitch: 60
        )
    }
}
