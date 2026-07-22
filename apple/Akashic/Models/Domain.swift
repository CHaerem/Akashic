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

// MARK: - Day content payloads (waypoint JSONB columns)
//
// These mirror the web app's `FunFact` / `PointOfInterest` / `HistoricalSite`
// (src/types/trek.ts) and decode from BOTH:
//   * the Supabase export JSON (snake_case, via `.convertFromSnakeCase`), and
//   * the Core Data Binary attributes (camelCase, via `JSONCoding`'s default coder).
// Property names are camelCase so a single definition serves both paths.

/// An educational trivia card attached to a day. `category` stays a raw string so
/// unknown categories degrade gracefully to a default style.
struct FunFact: Codable, Equatable, Identifiable {
    var id: String
    var content: String
    var category: String
    var source: String?
    var learnMoreUrl: String?
    var icon: String?
}

/// A notable location encountered during a day's trek.
struct PointOfInterest: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var category: String
    var coordinates: [Double]?   // [lng, lat]
    var elevation: Int?
    var description: String?
    var routeDistanceKm: Double?
    var tips: [String]?
    var timeFromPrevious: String?
    var icon: String?
}

/// An outbound reference on a historical site.
struct SiteLink: Codable, Equatable, Identifiable {
    var label: String
    var url: String
    var id: String { url }
}

/// A historical site with an expandable description and significance badge.
struct HistoricalSite: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var coordinates: [Double]?   // [lng, lat]
    var elevation: Int?
    var routeDistanceKm: Double?
    var summary: String
    var description: String?
    var period: String?
    var significance: String?    // "major" | "notable" | "minor"
    var imageUrls: [String]?
    var links: [SiteLink]?
    var tags: [String]?
    var dayNumber: Int?
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

    // Day content (waypoint JSONB payloads). Optional so decode tolerates absence and the
    // memberwise initialiser keeps every existing call site (which omit them) compiling.
    var funFacts: [FunFact]?
    var pointsOfInterest: [PointOfInterest]?
    var historicalSites: [HistoricalSite]?

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

/// A photo/video attached to a journey (and optionally a waypoint/day).
///
/// Mirrors the Postgres `photos` row. `url` / `thumbnailURL` are the R2 object *paths*
/// (`journeys/{journeyId}/photos/{photoId}.{ext}`) exactly as stored in the DB. After a
/// local import, `localOriginalPath` / `localThumbPath` hold absolute on-disk paths under
/// the configured media root (resolved + existence-checked at import time) so the UI can
/// build a file `URL` without knowing where the export lives.
struct Photo: Codable, Equatable, Identifiable {
    var id: String              // stable identity — DB UUID string
    var journeyId: String
    var waypointId: String?
    var url: String             // R2 relative object path for the original
    var thumbnailURL: String?   // R2 relative object path for the thumbnail
    var caption: String?
    var coordinates: [Double]?  // normalised [lng, lat]
    var takenAt: String?        // ISO-8601 timestamp string (as exported)
    var isHero: Bool = false
    var sortOrder: Int = 0
    var rotation: Int = 0       // 0/90/180/270 display transform
    var mediaType: String = "image"  // "image" | "video"
    var duration: Int?          // seconds, for videos
    var locationSource: String? // "exif" | "estimated" | "manual"

    /// Absolute on-disk path to the original bytes, if present under the media root.
    var localOriginalPath: String?
    /// Absolute on-disk path to the thumbnail bytes, if present under the media root.
    var localThumbPath: String?

    var isVideo: Bool { mediaType == "video" }

    /// File URL for the thumbnail, preferring the resolved thumb, falling back to the
    /// original (so a photo with only its full-res downloaded still shows something).
    var thumbnailFileURL: URL? {
        if let localThumbPath { return URL(fileURLWithPath: localThumbPath) }
        if let localOriginalPath { return URL(fileURLWithPath: localOriginalPath) }
        return nil
    }

    /// File URL for the full-resolution original, if the bytes are on disk.
    var originalFileURL: URL? {
        if let localOriginalPath { return URL(fileURLWithPath: localOriginalPath) }
        return nil
    }

    /// Any displayable bytes on disk (thumb or original).
    var hasLocalMedia: Bool { localThumbPath != nil || localOriginalPath != nil }
}

// MARK: - Day comments
//
// Web parity: `src/components/comments/*` + `commentAPI` (see report-data-layer §1.9).
// A comment is attached to a waypoint/day (`waypointId`) within a `journeyId`.
//
// Author identity: under CloudKit the author is the participant identity resolved from the
// record's `creatorUserRecordID`, and `authorDisplayName` is populated ONLY for records
// migrated from Supabase (it preserves the original `profiles.display_name` because the
// migration runs in the owner's context and would otherwise collapse every author to the
// owner — see CloudKit/MAPPING.md §7). Locally (fixtures/.local mode) there is no CloudKit
// participant, so `CommentService` stamps a stable local user id + the "Your name" setting
// into `userId` / `authorDisplayName` at create time; `isMine` compares `userId` against the
// current local user id.
struct DayComment: Codable, Equatable, Identifiable {
    var id: String            // stable identity — UUID string
    var waypointId: String
    var journeyId: String
    var authorName: String    // display name (local "Your name" or migrated author)
    var content: String
    var createdAt: Date
    var updatedAt: Date
    /// True when the current local user authored this comment (drives edit/delete affordances).
    var isMine: Bool

    /// Web parity: an "(edited)" marker is shown when `updatedAt` is later than `createdAt`.
    var wasEdited: Bool { updatedAt > createdAt }
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
