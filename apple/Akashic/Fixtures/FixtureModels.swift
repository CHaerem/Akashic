import Foundation

// MARK: - Fixture (recovered pre-Supabase JSON) shapes
//
// These mirror the ON-DISK shape of apple/Fixtures/recovered/*.json, which predates the
// Supabase schema and uses a different "camp" layout than the current domain model. They
// are intentionally lenient: numeric fields tolerate String or number input via
// FlexibleNumber (older exports stored elevations as strings). FixtureLoader maps these
// into the domain `Journey`.

struct FixtureTrek: Decodable {
    var id: String
    var name: String
    var country: String
    var slug: String
    var description: String?
    var heroImage: String?
    var dates: FixtureDates?
    var stats: FixtureStats
    var route: Route
    var camps: [FixtureCamp]
}

struct FixtureDates: Decodable {
    var start: String?
    var end: String?
}

struct FixtureHighestPoint: Decodable {
    var name: String
    var elevation: Int
    var coordinates: [Double]?

    enum CodingKeys: String, CodingKey { case name, elevation, coordinates }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        elevation = FlexibleNumber.int(from: c, forKey: .elevation) ?? 0
        coordinates = try? c.decodeIfPresent([Double].self, forKey: .coordinates)
    }
}

struct FixtureStats: Decodable {
    var totalDistance: Double
    var totalElevationGain: Int
    var totalElevationLoss: Int?
    var duration: Int
    var highestPoint: FixtureHighestPoint?

    enum CodingKeys: String, CodingKey {
        case totalDistance, totalElevationGain, totalElevationLoss, duration, highestPoint
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalDistance = FlexibleNumber.double(from: c, forKey: .totalDistance) ?? 0
        totalElevationGain = FlexibleNumber.int(from: c, forKey: .totalElevationGain) ?? 0
        totalElevationLoss = FlexibleNumber.int(from: c, forKey: .totalElevationLoss)
        duration = FlexibleNumber.int(from: c, forKey: .duration) ?? 0
        highestPoint = try? c.decodeIfPresent(FixtureHighestPoint.self, forKey: .highestPoint)
    }
}

// MARK: - Photographs (DIFF-10)

/// One bundled photograph belonging to a fixture journey.
///
/// `file` names a JPEG in the same bundle (`Fixtures/demo-media/*.jpg`); `FixtureMedia` copies its
/// bytes into the app's media library under the R2-style object key the rest of the app already uses,
/// which is what makes it resolvable by `Photo.thumbnailFileURL` / `.originalFileURL`. `dayNumber`
/// attaches the photo to that day's waypoint, so it shows on the day sheet and the story chapter as
/// well as in the journey's grid.
///
/// Lenient in the same spirit as the rest of this file: everything but `id` and `file` is optional,
/// because a photo with no caption, no day and no GPS is still a photo worth showing.
struct FixturePhoto: Decodable, Equatable {
    var id: String
    /// Bundled resource file name, including extension.
    var file: String
    /// Which day (`FixtureCamp.dayNumber`) this photo belongs to; nil leaves it unassigned.
    var dayNumber: Int?
    var caption: String?
    /// `[lng, lat]` (GeoJSON order), for the photo's map marker.
    var coordinates: [Double]?
    /// ISO-8601 capture instant.
    var takenAt: String?
    var isHero: Bool?
    var sortOrder: Int?
}

/// The `Fixtures/demo-media/demo-photos.json` sidecar: photographs keyed by **journey slug**.
///
/// A sidecar rather than a `photos` array on `FixtureTrek` because `Fixtures/recovered/*.json` is the
/// recovered pre-Supabase archive, declared read-only in `project.yml` — it stays byte-identical.
/// `_comment` in the file is not decoded (documentation for whoever swaps the images out).
struct FixturePhotoManifest: Decodable, Equatable {
    var journeys: [String: [FixturePhoto]]

    /// Photographs for a journey slug, in `sortOrder` then id order (deterministic regardless of how
    /// the JSON happened to be written).
    func photos(forSlug slug: String) -> [FixturePhoto] {
        (journeys[slug] ?? []).sorted {
            ($0.sortOrder ?? 0, $0.id) < ($1.sortOrder ?? 0, $1.id)
        }
    }
}

struct FixtureCamp: Decodable {
    var id: String
    var name: String
    var dayNumber: Int
    var date: String?
    var elevation: Int
    var coordinates: [Double]        // [lng, lat]
    var distanceFromStart: Double?
    var distanceFromPrevious: Double?
    var elevationGainFromPrevious: Int?
    var timeFromPrevious: String?
    var terrain: String?
    var notes: String?
    var highlights: [String]?

    enum CodingKeys: String, CodingKey {
        case id, name, dayNumber, date, elevation, coordinates
        case distanceFromStart, distanceFromPrevious, elevationGainFromPrevious
        case timeFromPrevious, terrain, notes, highlights
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        dayNumber = FlexibleNumber.int(from: c, forKey: .dayNumber) ?? 0
        date = try? c.decodeIfPresent(String.self, forKey: .date)
        // Elevation may be a number OR a decorated string in older exports.
        elevation = FlexibleNumber.int(from: c, forKey: .elevation) ?? 0
        coordinates = (try? c.decode([Double].self, forKey: .coordinates)) ?? []
        distanceFromStart = FlexibleNumber.double(from: c, forKey: .distanceFromStart)
        distanceFromPrevious = FlexibleNumber.double(from: c, forKey: .distanceFromPrevious)
        elevationGainFromPrevious = FlexibleNumber.int(from: c, forKey: .elevationGainFromPrevious)
        timeFromPrevious = try? c.decodeIfPresent(String.self, forKey: .timeFromPrevious)
        terrain = try? c.decodeIfPresent(String.self, forKey: .terrain)
        notes = try? c.decodeIfPresent(String.self, forKey: .notes)
        highlights = try? c.decodeIfPresent([String].self, forKey: .highlights)
    }
}
