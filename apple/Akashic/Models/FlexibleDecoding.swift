import Foundation

/// Decodes a numeric value that may arrive as a JSON number *or* a JSON string.
///
/// The recovered fixture files store most numbers as JSON numbers, but some
/// historical exports encoded elevations / distances as strings (e.g. "2812" or
/// "2,812m"). This wrapper tolerates both so a single decode path works for every
/// fixture generation.
enum FlexibleNumber {
    /// Extract an `Int` from a decoding container, tolerating String or Double input.
    static func int<Key: CodingKey>(from container: KeyedDecodingContainer<Key>,
                                    forKey key: Key) -> Int? {
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) { return Int(value.rounded()) }
        if let raw = try? container.decodeIfPresent(String.self, forKey: key) { return parseInt(raw) }
        return nil
    }

    /// Extract a `Double` from a decoding container, tolerating String or Int input.
    static func double<Key: CodingKey>(from container: KeyedDecodingContainer<Key>,
                                       forKey key: Key) -> Double? {
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) { return Double(value) }
        if let raw = try? container.decodeIfPresent(String.self, forKey: key) { return parseDouble(raw) }
        return nil
    }

    /// Parse an Int out of a possibly-decorated string ("2,812m" -> 2812).
    static func parseInt(_ raw: String) -> Int? {
        parseDouble(raw).map { Int($0.rounded()) }
    }

    /// Parse a Double out of a possibly-decorated string ("5,895 m" -> 5895).
    static func parseDouble(_ raw: String) -> Double? {
        let filtered = raw.unicodeScalars.filter {
            CharacterSet(charactersIn: "0123456789.-").contains($0)
        }
        return Double(String(String.UnicodeScalarView(filtered)))
    }
}
