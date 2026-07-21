import Foundation

/// A compact, self-contained snapshot of a journey for the WidgetKit extension.
///
/// The widget runs in a separate process and cannot read the app's Core Data store without an
/// App Group (see `AppGroup`). So the app precomputes everything a widget needs — display
/// strings, a country flag, a downsampled elevation profile for the sparkline, and an optional
/// thumbnail path — into this small `Codable` value and writes it to the shared container
/// (`WidgetDataStore`). The widget only ever *decodes* these snapshots; it never sees a
/// `Journey`, Core Data, or the country-flag lookup table.
///
/// This type is deliberately free of any dependency on the app's domain model so it can be
/// compiled into BOTH the app target and the `AkashicWidgets` target. The `Journey → Snapshot`
/// builder lives in the app-only `WidgetSnapshot+Journey.swift`.
struct WidgetSnapshot: Codable, Hashable, Identifiable {
    /// Journey id (slug in Fixtures, UUID in CloudKit) — the same identity Spotlight deep-links use.
    var id: String
    /// Short display name, e.g. "Kilimanjaro".
    var name: String
    var country: String
    /// Precomputed country emoji flag (so the widget avoids the app's lookup table).
    var flag: String

    var distanceKm: Double
    var days: Int
    var summitElevation: Int?
    var summitName: String?

    /// Elevations (metres) sampled along the route for the medium widget's sparkline.
    /// Empty when the route carries no elevation data.
    var elevationSamples: [Double]

    /// Absolute path to a thumbnail *inside the shared container*, if one was copied in.
    var thumbnailPath: String?

    // Precomputed display strings (so the widget needs no formatters / locale logic).
    var distanceText: String
    var daysText: String
    var summitText: String?

    var hasThumbnail: Bool { thumbnailPath != nil }
}

extension WidgetSnapshot {

    /// Downsample a route's elevation channel (the 3rd component of each `[lng, lat, ele]`
    /// coordinate) to at most `count` evenly spaced points. Returns `[]` when there is no
    /// elevation data, and the raw series unchanged when it already fits within `count`.
    static func sampleElevations(_ coordinates: [[Double]], count: Int) -> [Double] {
        let elevations = coordinates.compactMap { $0.count >= 3 ? $0[2] : nil }
        guard elevations.count > 1, count > 1 else { return elevations }
        if elevations.count <= count { return elevations }
        let step = Double(elevations.count - 1) / Double(count - 1)
        return (0..<count).map { i in
            let index = Int((Double(i) * step).rounded())
            return elevations[min(index, elevations.count - 1)]
        }
    }

    /// "70 km" / "12.4 km" — one decimal, dropping a trailing ".0".
    static func kilometresText(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        if rounded == rounded.rounded() { return "\(Int(rounded)) km" }
        return String(format: "%.1f km", rounded)
    }

    /// Locale-free thousands grouping: 5895 → "5,895".
    static func groupedThousands(_ value: Int) -> String {
        let negative = value < 0
        var digits = Array(String(abs(value)))
        var i = digits.count - 3
        while i > 0 {
            digits.insert(",", at: i)
            i -= 3
        }
        return (negative ? "-" : "") + String(digits)
    }
}
