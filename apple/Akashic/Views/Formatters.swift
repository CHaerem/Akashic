import Foundation

/// Display formatting helpers (grouped numbers, distances, elevations, date ranges).
enum Formatters {
    private static let grouping: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.groupingSeparator = ","
        return f
    }()

    static func number(_ value: Double) -> String {
        grouping.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }

    static func number(_ value: Int) -> String { number(Double(value)) }

    static func distanceKm(_ km: Double) -> String {
        let rounded = (km * 10).rounded() / 10
        if rounded == rounded.rounded() { return "\(number(rounded)) km" }
        return String(format: "%.1f km", rounded)
    }

    static func meters(_ m: Int) -> String { "\(number(m)) m" }

    /// Human one-liner for the consumer Settings storage row, e.g. "3 journeys · 1,538 photos".
    /// Singular is handled ("1 journey · 1 photo"); counts are grouped with thousands separators.
    static func librarySummary(journeys: Int, photos: Int) -> String {
        let j = "\(number(journeys)) journey\(journeys == 1 ? "" : "s")"
        let p = "\(number(photos)) photo\(photos == 1 ? "" : "s")"
        return "\(j) · \(p)"
    }

    /// "29 Sep – 9 Oct 2023" from ISO `yyyy-MM-dd` bounds.
    static func dateRange(_ start: String?, _ end: String?) -> String? {
        let startDate = DateOnly.date(from: start)
        let endDate = DateOnly.date(from: end)
        switch (startDate, endDate) {
        case let (s?, e?):
            let sameYear = Calendar.current.component(.year, from: s) == Calendar.current.component(.year, from: e)
            let dayMonth = DateFormatter.cached("d MMM")
            let full = DateFormatter.cached("d MMM yyyy")
            return "\(dayMonth.string(from: s)) – \(full.string(from: e))" + (sameYear ? "" : "")
        case let (s?, nil):
            return DateFormatter.cached("d MMM yyyy").string(from: s)
        default:
            return nil
        }
    }
}

private extension DateFormatter {
    static func cached(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = format
        return f
    }
}
