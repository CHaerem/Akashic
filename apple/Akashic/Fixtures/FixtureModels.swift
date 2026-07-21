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
