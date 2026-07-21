import Foundation

// MARK: - Domain value types
//
// These are the app-facing (camelCase) value types the SwiftUI layer consumes.
// They are:
//   * decoded FROM the Core Data layer (see CoreDataMapping.swift), and
//   * encoded/decoded as JSON for Core Data Binary attributes and round-trip tests.
//
// The fixture JSON uses an OLDER camp shape; it is decoded by FixtureModels.swift and
// mapped into these types by FixtureLoader — the fixtures never decode straight into
// these structs.

/// `[longitude, latitude, elevation?]` — GeoJSON coordinate order.
typealias RouteCoordinate = [Double]

struct HighestPoint: Codable, Equatable {
    var name: String
    var elevation: Int
    var coordinates: [Double]?  // [lng, lat]
}

struct TrekStats: Codable, Equatable {
    var duration: Int          // days
    var totalDistance: Double   // km
    var totalElevationGain: Int
    var totalElevationLoss: Int?
    var highestPoint: HighestPoint?
}

/// GeoJSON-style LineString: coordinates are `[lng, lat, elevation]` triples.
struct Route: Codable, Equatable {
    var type: String
    var coordinates: [RouteCoordinate]

    static let empty = Route(type: "LineString", coordinates: [])
}

struct WeatherData: Codable, Equatable {
    var temperatureMax: Double?
    var temperatureMin: Double?
    var precipitationSum: Double?
    var windSpeedMax: Double?
    var weatherCode: Int?
}

/// A "day"/waypoint along a journey (a camp in trek terms).
struct Camp: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var dayNumber: Int
    var elevation: Int
    var coordinates: [Double]   // [lng, lat]
    var notes: String
    var highlights: [String]

    // Fixture display extras (denormalised; not first-class Postgres columns).
    var terrain: String?
    var timeFromPrevious: String?
    var dateLabel: String?

    // Route positioning.
    var routePointIndex: Int?
    var routeDistanceKm: Double?

    // Per-day values computed by walking the route between camps (DayStats).
    var dayDistance: Double = 0
    var elevationGainFromPrevious: Int = 0
    var elevationLossFromPrevious: Int = 0

    var weather: WeatherData?

    /// Latitude convenience (coordinates are `[lng, lat]`).
    var latitude: Double { coordinates.count > 1 ? coordinates[1] : 0 }
    var longitude: Double { coordinates.first ?? 0 }
}

/// A full journey/trek the views render.
struct Journey: Codable, Equatable, Identifiable {
    var id: String          // stable identity — DB UUID string (or slug for fixtures)
    var slug: String
    var name: String
    var country: String
    var description: String
    var heroImageURL: String?
    var dateStarted: String?
    var dateEnded: String?
    var isPublic: Bool = false

    var summitElevation: Int?
    var totalDistance: Double?
    var totalDays: Int?
    var centerCoordinates: [Double]?   // [lng, lat]
    var preferredBearing: Double?
    var preferredPitch: Double?

    var stats: TrekStats
    var route: Route
    var camps: [Camp]

    /// "Kilimanjaro - Lemosho Route" -> "Kilimanjaro".
    var shortName: String {
        name.components(separatedBy: " - ").first ?? name
    }

    /// Best-effort map centre: explicit centre, else highest point, else route midpoint.
    var center: [Double]? {
        if let center = centerCoordinates, center.count >= 2 { return center }
        if let hp = stats.highestPoint?.coordinates, hp.count >= 2 { return hp }
        guard !route.coordinates.isEmpty else { return nil }
        let mid = route.coordinates[route.coordinates.count / 2]
        return mid.count >= 2 ? [mid[0], mid[1]] : nil
    }
}

// MARK: - Country flags

extension Journey {
    /// Emoji flag for the journey's country (best effort; globe fallback).
    var countryFlag: String { Self.flag(for: country) }

    static func flag(for country: String) -> String {
        let table: [String: String] = [
            "tanzania": "🇹🇿",
            "kenya": "🇰🇪",
            "peru": "🇵🇪",
            "nepal": "🇳🇵",
            "norway": "🇳🇴",
            "norge": "🇳🇴",
            "chile": "🇨🇱",
            "argentina": "🇦🇷",
            "united states": "🇺🇸",
            "usa": "🇺🇸",
            "switzerland": "🇨🇭",
            "france": "🇫🇷",
            "italy": "🇮🇹",
            "iceland": "🇮🇸"
        ]
        let key = country.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if let flag = table[key] { return flag }
        // Derive a flag from a 2-letter code if one was supplied.
        if key.count == 2, key.allSatisfy({ $0.isLetter }) {
            let base: UInt32 = 0x1F1E6
            var scalarView = String.UnicodeScalarView()
            for ch in key.uppercased().unicodeScalars {
                if let scalar = Unicode.Scalar(base + (ch.value - 65)) { scalarView.append(scalar) }
            }
            return String(scalarView)
        }
        return "🌍"
    }
}
