import Foundation

#if canImport(CoreLocation)
import CoreLocation
#endif
#if canImport(WeatherKit)
import WeatherKit
#endif

/// Assisted journey creation — fill each day's historical weather from Apple's **WeatherKit**, so a
/// day note can honestly say "5 to 12°C, light rain" without the user typing it.
///
/// ## Absent, never broken (the critical contract)
/// WeatherKit needs the App ID's WeatherKit capability enabled (a portal step) and only serves a
/// bounded historical window. If the capability isn't live yet (auth/JWT errors) or the date is out
/// of range, `suggestWeather` returns **nil** — the suggestion row simply doesn't appear. There is
/// never an error dialog and never a broken row: exactly the same "feature is absent" posture as the
/// Intelligence gate. Every failure path funnels to nil.
///
/// The provider is behind a seam (`HistoricalWeatherProviding`) so the composition + the
/// WeatherKit→WeatherData mapping are unit-tested with fakes; the real `WeatherService` adapter is
/// `#if canImport(WeatherKit)` + `@available(iOS 16.0, *)` gated (framework exists on iOS 16+, the
/// app targets 17). The `weatherCode` we store is WMO-style (matching the Supabase/open-meteo data
/// the web app produced), so WeatherKit's `WeatherCondition` is mapped to WMO best-effort below.

// MARK: - Seam

/// Fetch one day's daily-aggregate weather for a coordinate, or nil when unavailable.
protocol HistoricalWeatherProviding: Sendable {
    func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData?
}

// MARK: - Input

/// A day we want weather for: identity, coordinate, and the (UTC) date.
struct WeatherDayInput: Equatable {
    var dayID: String
    var coordinate: [Double]   // [lng, lat]
    var date: Date

    var hasCoordinate: Bool { coordinate.count >= 2 }
}

/// A weather suggestion tied to a day identity.
struct WeatherSuggestion: Equatable {
    var dayID: String
    var weather: WeatherData
}

// MARK: - Service

// QUA-08: `Sendable` because `JourneySuggestionCoordinator` is `@MainActor` and awaits these
// off the main actor, so the value crosses an isolation boundary on every call. Genuinely
// immutable — only `let`s and injected seams, no reference storage.
struct WeatherEnrichment: Sendable {
    let provider: HistoricalWeatherProviding
    /// Serial courtesy delay between per-day queries (nanoseconds). 0 in tests.
    let interCallDelayNanos: UInt64

    init(provider: HistoricalWeatherProviding, interCallDelayNanos: UInt64 = 150_000_000) {
        self.provider = provider
        self.interCallDelayNanos = interCallDelayNanos
    }

    /// One day. Any thrown error (auth not enabled, out of range, network) degrades to nil so the
    /// caller shows nothing rather than an error.
    func suggestWeather(lng: Double, lat: Double, date: Date) async -> WeatherData? {
        (try? await provider.dailyWeather(lng: lng, lat: lat, date: date)) ?? nil
    }

    /// Every day with a coordinate, serially. Days that fail (or lack a coordinate) are simply
    /// absent from the result — never an error, never a placeholder.
    func suggestWeather(for days: [WeatherDayInput]) async -> [WeatherSuggestion] {
        var out: [WeatherSuggestion] = []
        var first = true
        for day in days {
            guard day.hasCoordinate else { continue }
            if !first { try? await Task.sleep(nanoseconds: interCallDelayNanos) }
            first = false
            if let weather = await suggestWeather(lng: day.coordinate[0], lat: day.coordinate[1], date: day.date) {
                out.append(WeatherSuggestion(dayID: day.dayID, weather: weather))
            }
        }
        return out
    }

    /// Convenience: the live WeatherKit-backed enrichment (device / signed build).
    static func live() -> WeatherEnrichment {
        WeatherEnrichment(provider: SystemHistoricalWeather())
    }
}

// MARK: - WeatherKit → WMO mapping (pure, tested)

/// Maps WeatherKit `WeatherCondition` **case tokens** (e.g. "partlyCloudy") to the WMO weather codes
/// our `WeatherData.weatherCode` uses. Best-effort and documented: several WeatherKit conditions
/// have no exact WMO twin (hail, hurricane, blowing dust) and are mapped to the nearest sensible
/// code; genuinely unknown tokens return nil so we store no code rather than a wrong one.
enum WeatherCodeMapping {

    /// Token → WMO code. Tokens are WeatherKit's enum case names (stable across locales, unlike the
    /// localized `.description`), matched case-insensitively.
    static let wmoByToken: [String: Int] = [
        // Clear / cloud cover
        "clear": 0, "hot": 0, "frigid": 0,
        "mostlyclear": 1, "windy": 1, "breezy": 1,
        "partlycloudy": 2,
        "mostlycloudy": 3, "cloudy": 3,
        // Fog / obscuration
        "foggy": 45, "haze": 45, "smoky": 45, "blowingdust": 45,
        // Drizzle
        "drizzle": 51, "sunshowers": 80,
        "freezingdrizzle": 56,
        // Rain
        "rain": 63, "heavyrain": 65,
        "freezingrain": 66,
        // Snow
        "flurries": 71, "sunflurries": 71,
        "snow": 73, "heavysnow": 75, "blowingsnow": 75, "blizzard": 75,
        "sleet": 77, "wintrymix": 77, "hail": 96,
        // Thunderstorms & tropical
        "isolatedthunderstorms": 95, "scatteredthunderstorms": 95, "thunderstorms": 95,
        "strongstorms": 95, "hurricane": 95, "tropicalstorm": 95,
    ]

    /// WMO code for a WeatherKit condition token, or nil when there is no honest mapping.
    static func wmoCode(for token: String) -> Int? {
        wmoByToken[token.lowercased().trimmingCharacters(in: .whitespaces)]
    }
}

// MARK: - Live provider (WeatherKit)

#if canImport(WeatherKit) && canImport(CoreLocation)

@available(iOS 16.0, *)
struct SystemHistoricalWeather: HistoricalWeatherProviding {
    func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? {
        let location = CLLocation(latitude: lat, longitude: lng)
        // Query the UTC calendar day containing `date`.
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let startOfDay = utc.startOfDay(for: date)
        let endOfDay = startOfDay.addingTimeInterval(86_400)

        let daily = try await WeatherService.shared.weather(
            for: location,
            including: .daily(startDate: startOfDay, endDate: endOfDay))

        // Pick the day whose date falls in our window (or the first returned).
        let day = daily.first(where: { $0.date >= startOfDay && $0.date < endOfDay }) ?? daily.first
        guard let day else { return nil }

        return WeatherData(
            temperatureMax: day.highTemperature.converted(to: .celsius).value,
            temperatureMin: day.lowTemperature.converted(to: .celsius).value,
            precipitationSum: day.precipitationAmount.converted(to: .millimeters).value,
            windSpeedMax: day.wind.speed.converted(to: .kilometersPerHour).value,
            weatherCode: WeatherCodeMapping.wmoCode(for: Self.token(for: day.condition)))
    }

    /// Normalise a `WeatherCondition` to a stable, locale-independent token for the WMO mapping.
    /// An explicit switch (not `.description`, which is localized) so the tokens match
    /// `WeatherCodeMapping.wmoByToken`. Unmapped/new cases return "" → no WMO code stored.
    static func token(for condition: WeatherCondition) -> String {
        switch condition {
        case .clear: return "clear"
        case .hot: return "hot"
        case .frigid: return "frigid"
        case .mostlyClear: return "mostlyClear"
        case .windy: return "windy"
        case .breezy: return "breezy"
        case .partlyCloudy: return "partlyCloudy"
        case .mostlyCloudy: return "mostlyCloudy"
        case .cloudy: return "cloudy"
        case .foggy: return "foggy"
        case .haze: return "haze"
        case .smoky: return "smoky"
        case .blowingDust: return "blowingDust"
        case .drizzle: return "drizzle"
        case .sunShowers: return "sunShowers"
        case .freezingDrizzle: return "freezingDrizzle"
        case .rain: return "rain"
        case .heavyRain: return "heavyRain"
        case .freezingRain: return "freezingRain"
        case .flurries: return "flurries"
        case .sunFlurries: return "sunFlurries"
        case .snow: return "snow"
        case .heavySnow: return "heavySnow"
        case .blowingSnow: return "blowingSnow"
        case .blizzard: return "blizzard"
        case .sleet: return "sleet"
        case .wintryMix: return "wintryMix"
        case .hail: return "hail"
        case .isolatedThunderstorms: return "isolatedThunderstorms"
        case .scatteredThunderstorms: return "scatteredThunderstorms"
        case .thunderstorms: return "thunderstorms"
        case .strongStorms: return "strongStorms"
        case .hurricane: return "hurricane"
        case .tropicalStorm: return "tropicalStorm"
        @unknown default: return ""
        }
    }
}

#else

/// Fallback when WeatherKit isn't in the SDK (older Xcode / CI): weather is simply never available,
/// so the suggestion never appears — the same "absent, never broken" outcome.
struct SystemHistoricalWeather: HistoricalWeatherProviding {
    func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? { nil }
}

#endif
