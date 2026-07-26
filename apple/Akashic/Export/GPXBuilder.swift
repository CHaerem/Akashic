import Foundation

/// Builds GPX 1.1 from a journey's route and camps (D10 — keep the exit cost low).
///
/// The archive has no GPX of its own: `journeys.gpx_url` was NULL for every journey and the
/// route lives as a GeoJSON LineString, so this *generates* the file rather than copying one.
///
/// Coordinate order is the one place this is easy to get catastrophically wrong. GeoJSON is
/// `[longitude, latitude, elevation]`; GPX attributes are `lat` then `lon`. Swapping them
/// produces a file that opens fine and points at the wrong hemisphere.
enum GPXBuilder {

    /// A journey as one `<trk>` with a single `<trkseg>`, plus one `<wpt>` per camp.
    static func gpx(for journey: Journey, generatedAt: Date? = nil) -> String {
        var lines: [String] = []
        lines.append(#"<?xml version="1.0" encoding="UTF-8"?>"#)
        lines.append("""
            <gpx version="1.1" creator="Akashic" xmlns="http://www.topografix.com/GPX/1/1" \
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" \
            xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
            """)

        lines.append("  <metadata>")
        lines.append("    <name>\(escape(journey.name))</name>")
        if !journey.description.isEmpty {
            lines.append("    <desc>\(escape(journey.description))</desc>")
        }
        if let generatedAt {
            lines.append("    <time>\(ISO8601Shared.string(from: generatedAt))</time>")
        }
        lines.append("  </metadata>")

        // Camps first: a GPX reader that only understands waypoints still gets the itinerary.
        for camp in journey.camps.sorted(by: { $0.dayNumber < $1.dayNumber }) {
            guard let point = point(from: camp.coordinates) else { continue }
            lines.append(#"  <wpt lat="\#(format(point.latitude))" lon="\#(format(point.longitude))">"#)
            lines.append("    <ele>\(camp.elevation)</ele>")
            lines.append("    <name>\(escape(camp.name))</name>")
            if !camp.notes.isEmpty {
                lines.append("    <desc>\(escape(camp.notes))</desc>")
            }
            lines.append("    <type>Day \(camp.dayNumber)</type>")
            lines.append("  </wpt>")
        }

        let points = journey.route.coordinates.compactMap(point(from:))
        if !points.isEmpty {
            lines.append("  <trk>")
            lines.append("    <name>\(escape(journey.name))</name>")
            lines.append("    <trkseg>")
            for point in points {
                lines.append(#"      <trkpt lat="\#(format(point.latitude))" lon="\#(format(point.longitude))">"#)
                if let elevation = point.elevation {
                    lines.append("        <ele>\(format(elevation))</ele>")
                }
                lines.append("      </trkpt>")
            }
            lines.append("    </trkseg>")
            lines.append("  </trk>")
        }

        lines.append("</gpx>")
        return lines.joined(separator: "\n") + "\n"
    }

    // MARK: - Helpers

    struct Point: Equatable {
        let longitude: Double
        let latitude: Double
        let elevation: Double?
    }

    /// `[lng, lat]` or `[lng, lat, ele]` -> a point. Anything shorter, or carrying values
    /// outside the valid ranges, is dropped rather than written out as a plausible-looking
    /// wrong location.
    static func point(from coordinate: [Double]) -> Point? {
        guard coordinate.count >= 2 else { return nil }
        let longitude = coordinate[0]
        let latitude = coordinate[1]
        guard longitude.isFinite, latitude.isFinite,
              (-180...180).contains(longitude), (-90...90).contains(latitude) else { return nil }
        let elevation = coordinate.count >= 3 && coordinate[2].isFinite ? coordinate[2] : nil
        return Point(longitude: longitude, latitude: latitude, elevation: elevation)
    }

    /// Fixed 6-decimal output (~10 cm), locale-independent. `"\(double)"` would be fine on a
    /// Norwegian device — Swift interpolation is not locale-aware — but `NumberFormatter`
    /// habits are, and a comma decimal separator makes the file invalid XML content.
    static func format(_ value: Double) -> String {
        String(format: "%.6f", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

}
