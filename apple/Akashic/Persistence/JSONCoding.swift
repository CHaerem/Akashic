import Foundation

/// Shared JSON coders for packing JSONB-style payloads into Core Data Binary attributes.
///
/// The Postgres JSONB columns (route, stats, coordinates, weather, highlights, fun_facts,
/// points_of_interest, historical_sites, center_coordinates) are stored as JSON `Data` in
/// Core Data — mirroring how they will be JSON-encoded strings / large CKAssets in CloudKit.
enum JSONCoding {
    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    static let decoder = JSONDecoder()

    static func encode<T: Encodable>(_ value: T?) -> Data? {
        guard let value else { return nil }
        return try? encoder.encode(value)
    }

    static func decode<T: Decodable>(_ type: T.Type, from data: Data?) -> T? {
        guard let data else { return nil }
        return try? decoder.decode(type, from: data)
    }
}

/// Lossless `YYYY-MM-DD` <-> `Date` conversion for DATE columns (UTC, POSIX).
enum DateOnly {
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func date(from string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        return formatter.date(from: string)
    }

    static func string(from date: Date?) -> String? {
        guard let date else { return nil }
        return formatter.string(from: date)
    }
}
