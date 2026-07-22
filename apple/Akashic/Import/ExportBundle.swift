import Foundation

// MARK: - Coordinate normalization
//
// Point coordinates arrive in TWO encodings across the export (see CloudKit/MAPPING.md §5):
//   1. GeoJSON Point object — { "type": "Point", "coordinates": [lng, lat] }
//   2. Bare array          — [lng, lat]
// `GeoCoordinate` decodes either shape and always exposes a `[lng, lat]` pair in
// Postgres/GeoJSON order (NO swap here — the swap to CLLocation (lat, lng) happens only
// where a CoreLocation value is built).

/// A `[lng, lat]` point that decodes from either the GeoJSON Point object or a bare array.
struct GeoCoordinate: Equatable {
    var longitude: Double
    var latitude: Double

    /// `[lng, lat]` — Postgres/GeoJSON order, ready to store as-is.
    var lngLat: [Double] { [longitude, latitude] }
}

extension GeoCoordinate: Decodable {
    private enum GeoKeys: String, CodingKey { case type, coordinates }

    init(from decoder: Decoder) throws {
        // Try the GeoJSON Point object first.
        if let keyed = try? decoder.container(keyedBy: GeoKeys.self),
           keyed.contains(.coordinates) {
            let pair = try keyed.decode([Double].self, forKey: .coordinates)
            guard pair.count >= 2 else {
                throw DecodingError.dataCorruptedError(
                    forKey: .coordinates, in: keyed,
                    debugDescription: "GeoJSON coordinates need at least [lng, lat]")
            }
            self.init(longitude: pair[0], latitude: pair[1])
            return
        }
        // Fall back to a bare [lng, lat(, ele)] array.
        var unkeyed = try decoder.unkeyedContainer()
        var values: [Double] = []
        while !unkeyed.isAtEnd { values.append(try unkeyed.decode(Double.self)) }
        guard values.count >= 2 else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath,
                      debugDescription: "Bare coordinate array needs at least [lng, lat]"))
        }
        self.init(longitude: values[0], latitude: values[1])
    }
}

// MARK: - Raw table rows (snake_case JSON, decoded via .convertFromSnakeCase)
//
// One struct per exported Postgres table. All are tolerant: unknown columns are ignored,
// dates stay as ISO strings, JSONB payloads decode into their nested shapes. These structs
// are the sink-agnostic input to `ExportMapper`; the CloudKit importer (T2.5) consumes the
// exact same rows.

struct ProfileRow: Decodable, Equatable {
    var id: String
    var email: String?
    var displayName: String?
    var avatarUrl: String?
    var createdAt: String?
}

struct JourneyMemberRow: Decodable, Equatable {
    var id: String
    var journeyId: String
    var userId: String
    var role: String
    var invitedBy: String?
    var createdAt: String?
}

struct JourneyRow: Decodable, Equatable {
    var id: String
    var createdBy: String?
    var name: String
    var slug: String
    var description: String?
    var country: String?
    var journeyType: String?
    var summitElevation: Int?
    var totalDistance: Double?
    var totalDays: Int?
    var dateStarted: String?
    var dateEnded: String?
    var heroImageUrl: String?
    var gpxUrl: String?
    var centerCoordinates: GeoCoordinate?
    var defaultZoom: Double?
    var isPublic: Bool?
    var route: Route?
    var stats: TrekStats?
    var preferredBearing: Double?
    var preferredPitch: Double?
}

struct WaypointRow: Decodable, Equatable {
    var id: String
    var journeyId: String?
    var name: String
    var waypointType: String?
    var dayNumber: Int?
    var coordinates: GeoCoordinate
    var elevation: Int?
    var description: String?
    var highlights: [String]?
    var arrivalTime: String?
    var departureTime: String?
    var dateVisited: String?
    var sortOrder: Int?
    var routeDistanceKm: Double?
    var routePointIndex: Int?
    var weather: WeatherData?
    // JSONB day-content columns (snake_case → camelCase via `.convertFromSnakeCase`).
    var funFacts: [FunFact]?
    var pointsOfInterest: [PointOfInterest]?
    var historicalSites: [HistoricalSite]?
}

struct PhotoRow: Decodable, Equatable {
    var id: String
    var journeyId: String?
    var waypointId: String?
    var url: String
    var thumbnailUrl: String?
    var caption: String?
    var coordinates: GeoCoordinate?
    var takenAt: String?
    var isHero: Bool?
    var sortOrder: Int?
    var rotation: Int?
    var mediaType: String?
    var duration: Int?
    var locationSource: String?
}

struct DayCommentRow: Decodable, Equatable {
    var id: String
    var waypointId: String
    var journeyId: String
    var userId: String
    var content: String
    var createdAt: String?
    var updatedAt: String?
}

// MARK: - ExportBundle

/// In-memory representation of a Supabase JSON export directory (`supabase/*.json`).
///
/// This is the **sink-agnostic reader**: both the local Core Data importer (tonight) and
/// the future CloudKit importer (T2.5) load the same `ExportBundle` and run the same
/// `ExportMapper` over it — only the write sink differs. See `LocalImporter` for the seam.
struct ExportBundle: Equatable {
    var profiles: [ProfileRow] = []
    var journeys: [JourneyRow] = []
    var members: [JourneyMemberRow] = []
    var waypoints: [WaypointRow] = []
    var photos: [PhotoRow] = []
    var comments: [DayCommentRow] = []

    /// Profile display names keyed by profile id (for `authorDisplayName` attribution).
    var profileNamesByID: [String: String] {
        Dictionary(uniqueKeysWithValues: profiles.compactMap { p in
            p.displayName.map { (p.id, $0) }
        })
    }

    struct BundleError: Error, CustomStringConvertible {
        let description: String
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        // Top-level columns are snake_case; nested JSONB (stats) is already camelCase and
        // passes through unchanged, while nested snake_case (weather) is converted too.
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    /// Standard file names inside the `supabase/` export directory.
    enum File: String, CaseIterable {
        case profiles, journeys
        case members = "journey_members"
        case waypoints, photos
        case comments = "day_comments"
    }

    // MARK: Filesystem loading

    /// Load an export from a `supabase/` directory. Missing files are tolerated (treated as
    /// empty tables) so a partial export still imports what it has.
    static func load(supabaseDirectory dir: URL) throws -> ExportBundle {
        let fm = FileManager.default
        guard fm.fileExists(atPath: dir.path) else {
            throw BundleError(description: "Export directory not found: \(dir.path)")
        }
        func rows<T: Decodable>(_ file: File, as type: [T].Type) throws -> [T] {
            let url = dir.appendingPathComponent(file.rawValue + ".json")
            guard fm.fileExists(atPath: url.path) else { return [] }
            let data = try Data(contentsOf: url)
            do {
                return try decoder.decode([T].self, from: data)
            } catch {
                throw BundleError(description: "Failed to decode \(file.rawValue).json: \(error)")
            }
        }
        return ExportBundle(
            profiles: try rows(.profiles, as: [ProfileRow].self),
            journeys: try rows(.journeys, as: [JourneyRow].self),
            members: try rows(.members, as: [JourneyMemberRow].self),
            waypoints: try rows(.waypoints, as: [WaypointRow].self),
            photos: try rows(.photos, as: [PhotoRow].self),
            comments: try rows(.comments, as: [DayCommentRow].self)
        )
    }

    /// Resolve the `supabase/` directory from a bundle root that may be either the export
    /// root (containing `supabase/`) or the `supabase/` directory itself.
    static func load(exportRoot root: URL) throws -> ExportBundle {
        let fm = FileManager.default
        let nested = root.appendingPathComponent("supabase")
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: nested.path, isDirectory: &isDir), isDir.boolValue {
            return try load(supabaseDirectory: nested)
        }
        return try load(supabaseDirectory: root)
    }

    // MARK: In-memory decoding (tests / fixtures)

    /// Decode a single table's JSON blob (for inline-fixture unit tests).
    static func decodeRows<T: Decodable>(_ type: [T].Type, from data: Data) throws -> [T] {
        try decoder.decode([T].self, from: data)
    }
}
