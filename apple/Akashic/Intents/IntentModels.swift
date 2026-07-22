import Foundation

// MARK: - MCP wire models
//
// These Codable types mirror, 1:1, the JSON shapes emitted by the legacy MCP Worker
// (`workers/media-proxy/src/mcp`). They are the machine-readable payloads the App Intents
// return as a `String` so a future system-MCP bridge receives semantically equivalent JSON:
// the same keys, key casing, and values as the MCP tools. It is NOT byte-for-byte identical —
// our output is compact with alphabetized keys (the MCP pretty-prints in insertion order), and
// nil optionals are OMITTED here whereas the MCP emits an explicit `null` for its nullable
// columns (routeDistanceKm, routePointIndex, waypoint_id, caption, taken_at). See `IntentJSON`.
//
// snake_case wire keys are mapped via `CodingKeys`; camelCase keys (dayNumber,
// routeDistanceKm, avgDailyDistance, …) are left as-is because the MCP used camelCase there.
// The nested `stats`/`basicStats` payloads reuse the domain `TrekStats`/`HighestPoint`
// (they are the stored `journeys.stats` JSONB that the MCP passes through verbatim).

// MARK: list_journeys / search_journeys

/// One row of `list_journeys` / `search_journeys` (`JourneyListItem` in the MCP).
struct JourneyListItem: Codable, Equatable {
    var id: String
    var slug: String
    var name: String
    var country: String?
    var totalDays: Int?
    var totalDistance: Double?
    var summitElevation: Int?
    var dateStarted: String?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, country
        case totalDays = "total_days"
        case totalDistance = "total_distance"
        case summitElevation = "summit_elevation"
        case dateStarted = "date_started"
    }
}

/// `list_journeys` result: `{ journeys, total, hasMore }`.
struct JourneyListResult: Codable, Equatable {
    var journeys: [JourneyListItem]
    var total: Int
    var hasMore: Bool
}

/// `search_journeys` result: `{ journeys, total }` (`total` = returned count).
struct JourneySearchResult: Codable, Equatable {
    var journeys: [JourneyListItem]
    var total: Int
}

// MARK: get_journey_details

/// A `Camp` in the MCP `JourneyDetails.camps` array. `highlights` is omitted when empty
/// (the MCP wrote `highlights || undefined`); `routeDistanceKm`/`routePointIndex` are
/// nullable numbers.
struct MCPCamp: Codable, Equatable {
    var id: String
    var name: String
    var dayNumber: Int
    var elevation: Int
    var coordinates: [Double]   // [lng, lat]
    var notes: String
    var highlights: [String]?
    var routeDistanceKm: Double?
    var routePointIndex: Int?
}

/// `get_journey_details` result (`JourneyDetails`).
struct JourneyDetailsResult: Codable, Equatable {
    var id: String
    var slug: String
    var name: String
    var country: String?
    var description: String?
    var dateStarted: String?
    var stats: TrekStats?
    var camps: [MCPCamp]
    var route: Route?

    enum CodingKeys: String, CodingKey {
        case id, slug, name, country, description
        case dateStarted = "date_started"
        case stats, camps, route
    }
}

// MARK: get_journey_stats

/// Computed statistics (`ExtendedStats`). Note `avgDailyDistance` and `estimatedTotalTime`
/// are STRINGS (matching the MCP), and `longestDayDistance` is a one-decimal number.
struct ExtendedStats: Codable, Equatable {
    var avgDailyDistance: String
    var maxDailyGain: Int
    var maxDailyLoss: Int
    var totalElevationGain: Int
    var totalElevationLoss: Int
    var difficulty: String
    var startElevation: Int
    var endElevation: Int
    var avgAltitude: Int
    var longestDayDistance: Double
    var longestDayNumber: Int
    var estimatedTotalTime: String
    var steepestDayGradient: Int
    var steepestDayNumber: Int
}

/// `get_journey_stats` result: `{ journeyName, basicStats, extendedStats }`.
struct JourneyStatsResult: Codable, Equatable {
    var journeyName: String
    var basicStats: TrekStats
    var extendedStats: ExtendedStats
}

// MARK: get_journey_photos

/// A `Photo` in `get_journey_photos`. All snake_case keys mapped via `CodingKeys`.
struct MCPPhoto: Codable, Equatable {
    var id: String
    var journeyId: String
    var waypointId: String?
    var url: String
    var thumbnailURL: String?
    var caption: String?
    var coordinates: [Double]?
    var takenAt: String?
    var isHero: Bool?
    var sortOrder: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case journeyId = "journey_id"
        case waypointId = "waypoint_id"
        case url
        case thumbnailURL = "thumbnail_url"
        case caption, coordinates
        case takenAt = "taken_at"
        case isHero = "is_hero"
        case sortOrder = "sort_order"
    }
}

/// `get_journey_photos` result: `{ photos, total }`.
struct JourneyPhotosResult: Codable, Equatable {
    var photos: [MCPPhoto]
    var total: Int
}

// MARK: - JSON encoding

/// The single encoder used for every intent's machine-readable payload.
///
/// Compact (no pretty-printing), `.withoutEscapingSlashes` so slugs / URLs match the MCP's
/// `JSON.stringify` output, and `.sortedKeys` for deterministic, reproducible output.
/// (Foundation's `JSONEncoder` does not guarantee property-declaration key order, so sorting
/// is the only way to get stable output.) The keys, casing, and values are identical to the
/// MCP tool responses, so the payload is *semantically* equivalent — but not byte-identical:
/// the key order is alphabetical here vs the MCP's insertion order, and Foundation OMITS nil
/// optionals whereas the MCP emits an explicit `null` for its nullable columns
/// (routeDistanceKm, routePointIndex, waypoint_id, caption, taken_at).
enum IntentJSON {
    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.withoutEscapingSlashes, .sortedKeys]
        return e
    }()

    static func string<T: Encodable>(_ value: T) -> String {
        guard let data = try? encoder.encode(value),
              let string = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return string
    }
}
