import Foundation

/// Display formatting helpers (grouped numbers, distances, elevations, date ranges).
enum Formatters {
    /// The grouping separator is the locale's, not a hardcoded comma — and in Norwegian that is
    /// not a cosmetic difference. `,` is the *decimal* separator in nb, so a hardcoded
    /// "5,895 m" summit reads to a Norwegian as five point nine metres rather than as
    /// 5 895. This one formatter feeds every elevation and distance in the app.
    private static func grouping(_ locale: Locale) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = locale
        return f
    }

    static func number(_ value: Double, locale: Locale = .current) -> String {
        grouping(locale).string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }

    static func number(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), locale: locale)
    }

    static func distanceKm(_ km: Double, locale: Locale = .current) -> String {
        let rounded = (km * 10).rounded() / 10
        if rounded == rounded.rounded() { return "\(number(rounded, locale: locale)) km" }
        // Same reason as the grouping separator: `String(format: "%.1f")` is locale-independent
        // and always emits a period, so a Norwegian saw "12.4 km" where the language wants
        // "12,4 km". A one-fraction-digit formatter asks the locale instead.
        let f = grouping(locale)
        f.minimumFractionDigits = 1
        f.maximumFractionDigits = 1
        return "\(f.string(from: NSNumber(value: rounded)) ?? "\(rounded)") km"
    }

    static func meters(_ m: Int, locale: Locale = .current) -> String {
        "\(number(m, locale: locale)) m"
    }

    /// Human one-liner for the consumer Settings storage row, e.g. "3 journeys · 1,538 photos"
    /// (en_US) or "3 turer · 1 538 bilder" (nb).
    ///
    /// Both halves are plural-varied **in the string catalogue**, not by appending an "s" — which
    /// is what this did before and which cannot be translated at all: Norwegian pluralises
    /// "reise → reiser" and "bilde → bilder" with different endings, and a language with more than
    /// two plural categories has no "s" to append in the first place.
    ///
    /// The thousands grouping survives the move: interpolating an `Int` into a
    /// `String.LocalizationValue` formats it for the resolving locale, so the catalogue's `%lld`
    /// still comes out grouped — and grouped the way the *locale* wants, which the old hardcoded
    /// comma was not.
    static func librarySummary(journeys: Int, photos: Int, locale: Locale = .current) -> String {
        let j = String(localized: "\(journeys) journeys", locale: locale,
                       comment: "Settings › Library: how many journeys are stored on the device.")
        let p = String(localized: "\(photos) photos", locale: locale,
                       comment: "Settings › Library: how many photos are stored on the device.")
        return "\(j) · \(p)"
    }

    /// "29 Sep – 9 Oct 2023" from ISO `yyyy-MM-dd` bounds (en_GB); "29. sep. – 9. okt. 2023" in nb.
    ///
    /// The formats are built from *templates* via `setLocalizedDateFormatFromTemplate`, not from a
    /// fixed "d MMM yyyy" pattern against `en_US_POSIX`. A fixed pattern localises the month name
    /// but never the field order or the punctuation, so Norwegian got "29 Sep 2023" where the
    /// language writes "29. sep. 2023" — and `en_US_POSIX` is a *parsing* locale, deliberately
    /// frozen, which is the wrong tool for anything a customer reads.
    static func dateRange(_ start: String?, _ end: String?, locale: Locale = .current) -> String? {
        let startDate = DateOnly.date(from: start)
        let endDate = DateOnly.date(from: end)
        switch (startDate, endDate) {
        case let (s?, e?):
            // The year is carried by the end date alone, so the range reads once. (The previous
            // version computed `sameYear` and then appended "" whichever way it came out — dead
            // code that looked like it was suppressing a repeated year and was not.)
            return "\(display("dMMM", locale).string(from: s)) – \(display("dMMMyyyy", locale).string(from: e))"
        case let (s?, nil):
            return display("dMMMyyyy", locale).string(from: s)
        default:
            return nil
        }
    }

    /// The calendar date for a 1-based day number within a journey ("MMM d, yyyy"), or nil when
    /// the journey has no start date. UTC throughout (both the calendar doing the day-arithmetic
    /// and the formatter reading it back) to match `DateOnly`'s UTC day boundaries — a device west
    /// of Greenwich must not roll Day 1 back to the previous calendar date. Shared by
    /// `DayDetailSheet` and `JourneyStoryView` so both name a day's date identically.
    static func dayDate(dateStarted: String?, dayNumber: Int, locale: Locale = .current) -> String? {
        guard let start = DateOnly.date(from: dateStarted),
              let date = utcDayCalendar.date(byAdding: .day, value: dayNumber - 1, to: start)
        else { return nil }
        let f = display("MMMdyyyy", locale)
        // The day arithmetic above is in UTC to match `DateOnly`'s day boundaries; the formatter
        // has to read it back in UTC too or a device west of Greenwich renders Day 1 as the day
        // before. (Unchanged behaviour — only the locale of the *wording* moved.)
        f.timeZone = TimeZone(identifier: "UTC")
        return f.string(from: date)
    }

    private static let utcDayCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    /// A formatter for text a customer reads: the locale picks the field order, the separators and
    /// the month name from a template. `en_US` still renders "Jun 1, 2024" and `en_GB` "1 Jun 2024",
    /// so this is not a change of English behaviour — it is the removal of a fixed American-ish
    /// pattern that every other language was being forced through.
    private static func display(_ template: String, _ locale: Locale) -> DateFormatter {
        let f = DateFormatter()
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate(template)
        return f
    }
}
