import SwiftUI

// MARK: - Hex helper
//
// Kept file-private so it never collides with a colour helper another module might define.
// Mirrors the web app's exact palette hex values (src/components/journey/*).

private func dayColor(_ hex: UInt32) -> Color {
    Color(
        .sRGB,
        red: Double((hex >> 16) & 0xFF) / 255,
        green: Double((hex >> 8) & 0xFF) / 255,
        blue: Double(hex & 0xFF) / 255,
        opacity: 1
    )
}

/// A colour that's the web's original hex under Dark Mode and a darker, more saturated shade of
/// the SAME hue under Light Mode — built from `dayColor` above and handed off to
/// `Color.adaptive(dark:light:)`, the shared helper in `Theme.swift` (the same technique
/// `StatsView.adaptiveHue` uses for its difficulty badge — both now call through to one place).
///
/// Unlike `dayColor` above (used for icon-tile *backgrounds* at ~16% opacity — where none of
/// these hues have a legibility problem, verified by inspection), `FunFactStyle.color` is also
/// drawn as small (`.caption2`) TEXT in `FunFactCardView`. Checked against the web's original
/// hex values on a white page: several dropped under a 2:1 contrast ratio (`wildlife`'s
/// `#FBBF24` ~1.7:1, `flora`'s `#34D399` ~1.9:1) — nowhere near WCAG's 4.5:1 floor for text this
/// size. Every `light` value below was chosen to clear 4.5:1 with margin.
private func dayColorAdaptive(dark: UInt32, light: UInt32) -> Color {
    Color.adaptive(dark: dayColor(dark), light: dayColor(light))
}

// MARK: - Weather

/// WMO weather-code → SF Symbol + human label. Ported to cover the full open-meteo table
/// (the real export uses 3, 53, 55, 61, 63, 71, 75). Pure + unit-tested.
enum WeatherPresentation {

    static func symbol(for code: Int?) -> String {
        guard let code else { return "cloud.fill" }
        switch code {
        case 0: return "sun.max.fill"
        case 1: return "sun.max.fill"
        case 2: return "cloud.sun.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51, 53, 55: return "cloud.drizzle.fill"
        case 56, 57: return "cloud.sleet.fill"
        case 61, 63, 65: return "cloud.rain.fill"
        case 66, 67: return "cloud.sleet.fill"
        case 71, 73, 75: return "cloud.snow.fill"
        case 77: return "snowflake"
        case 80, 81, 82: return "cloud.heavyrain.fill"
        case 85, 86: return "cloud.snow.fill"
        case 95: return "cloud.bolt.rain.fill"
        case 96, 99: return "cloud.bolt.rain.fill"
        default: return "cloud.fill"
        }
    }

    /// The WMO code's wording, translated.
    ///
    /// Every branch goes through `String(localized:)` rather than returning a bare literal. The
    /// return type stays `String` on purpose: the only caller hands it to `Text`, and a `String`
    /// there is rendered verbatim — which is exactly why these twenty-two labels were untranslatable
    /// before. Resolving at the switch keeps the signature (and `DayContentTests`) intact while
    /// putting every one of them in the catalogue.
    static func label(for code: Int?) -> String {
        let unknown = String(localized: "Weather",
                             comment: "Fallback label when a day has weather but no WMO code to describe it.")
        guard let code else { return unknown }
        switch code {
        case 0: return String(localized: "Clear sky", comment: "WMO weather code 0.")
        case 1: return String(localized: "Mainly clear", comment: "WMO weather code 1.")
        case 2: return String(localized: "Partly cloudy", comment: "WMO weather code 2.")
        case 3: return String(localized: "Overcast", comment: "WMO weather code 3.")
        case 45, 48: return String(localized: "Fog", comment: "WMO weather codes 45/48.")
        case 51: return String(localized: "Light drizzle", comment: "WMO weather code 51.")
        case 53: return String(localized: "Drizzle", comment: "WMO weather code 53.")
        case 55: return String(localized: "Heavy drizzle", comment: "WMO weather code 55.")
        case 56, 57: return String(localized: "Freezing drizzle", comment: "WMO weather codes 56/57.")
        case 61: return String(localized: "Light rain", comment: "WMO weather code 61.")
        case 63: return String(localized: "Rain", comment: "WMO weather code 63.")
        case 65: return String(localized: "Heavy rain", comment: "WMO weather code 65.")
        case 66, 67: return String(localized: "Freezing rain", comment: "WMO weather codes 66/67.")
        case 71: return String(localized: "Light snow", comment: "WMO weather code 71.")
        case 73: return String(localized: "Snow", comment: "WMO weather code 73.")
        case 75: return String(localized: "Heavy snow", comment: "WMO weather code 75.")
        case 77: return String(localized: "Snow grains", comment: "WMO weather code 77.")
        case 80, 81, 82: return String(localized: "Rain showers", comment: "WMO weather codes 80–82.")
        case 85, 86: return String(localized: "Snow showers", comment: "WMO weather codes 85/86.")
        case 95: return String(localized: "Thunderstorm", comment: "WMO weather code 95.")
        case 96, 99: return String(localized: "Thunderstorm & hail", comment: "WMO weather codes 96/99.")
        default: return unknown
        }
    }

    /// Tint for the weather glyph — warm for clear, cool for wet/cold.
    static func tint(for code: Int?) -> Color {
        guard let code else { return dayColor(0x60A5FA) }
        switch code {
        case 0, 1: return dayColor(0xFBBF24)          // sun
        case 2: return dayColor(0xFCD34D)
        case 71, 73, 75, 77, 85, 86: return dayColor(0xBAE6FD)  // snow
        case 95, 96, 99: return dayColor(0xA78BFA)    // storm
        default: return dayColor(0x60A5FA)            // cloud/rain
        }
    }
}

// MARK: - Fun fact categories (mirrors FunFactCard.tsx CATEGORY_CONFIG)

enum FunFactStyle {
    struct Config { let icon: String; let color: Color; let label: String }

    static func config(for category: String) -> Config {
        switch category.lowercased() {
        case "geology":   return Config(icon: "🪨", color: dayColorAdaptive(dark: 0xA78BFA, light: 0x6D28D9), label: String(localized: "Geology", comment: "Fun-fact category shown on a day."))
        case "wildlife":  return Config(icon: "🦁", color: dayColorAdaptive(dark: 0xFBBF24, light: 0xB45309), label: String(localized: "Wildlife", comment: "Fun-fact category shown on a day."))
        case "flora":     return Config(icon: "🌿", color: dayColorAdaptive(dark: 0x34D399, light: 0x047857), label: String(localized: "Flora", comment: "Fun-fact category shown on a day."))
        case "history":   return Config(icon: "📜", color: dayColorAdaptive(dark: 0xF59E0B, light: 0x92400E), label: String(localized: "History", comment: "Fun-fact category shown on a day."))
        case "culture":   return Config(icon: "🎭", color: dayColorAdaptive(dark: 0xF472B6, light: 0xBE185D), label: String(localized: "Culture", comment: "Fun-fact category shown on a day."))
        case "climate":   return Config(icon: "🌤", color: dayColorAdaptive(dark: 0x60A5FA, light: 0x1D4ED8), label: String(localized: "Climate", comment: "Fun-fact category shown on a day."))
        case "adventure": return Config(icon: "⛰️", color: dayColorAdaptive(dark: 0xEF4444, light: 0xB91C1C), label: String(localized: "Adventure", comment: "Fun-fact category shown on a day."))
        case "science":   return Config(icon: "🔬", color: dayColorAdaptive(dark: 0x8B5CF6, light: 0x6D28D9), label: String(localized: "Science", comment: "Fun-fact category shown on a day."))
        case "geography": return Config(icon: "🗺️", color: dayColorAdaptive(dark: 0x14B8A6, light: 0x0F766E), label: String(localized: "Geography", comment: "Fun-fact category shown on a day."))
        case "survival":  return Config(icon: "🧭", color: dayColorAdaptive(dark: 0xF97316, light: 0xC2410C), label: String(localized: "Survival", comment: "Fun-fact category shown on a day."))
        default:          return Config(icon: "🗺️", color: dayColorAdaptive(dark: 0x14B8A6, light: 0x0F766E), label: category.capitalized)
        }
    }
}

// MARK: - POI categories (mirrors DayDiscoveries.tsx POI_CONFIG)

enum POIStyle {
    struct Config { let icon: String; let color: Color }

    static func config(for category: String) -> Config {
        switch category.lowercased() {
        case "viewpoint":  return Config(icon: "👁️", color: dayColor(0x60A5FA))
        case "water":      return Config(icon: "💧", color: dayColor(0x38BDF8))
        case "landmark":   return Config(icon: "🏛️", color: dayColor(0xF59E0B))
        case "shelter":    return Config(icon: "🏕️", color: dayColor(0xA78BFA))
        case "warning":    return Config(icon: "⚠️", color: dayColor(0xEF4444))
        case "info":       return Config(icon: "ℹ️", color: dayColor(0x8B5CF6))
        case "wildlife":   return Config(icon: "🦒", color: dayColor(0xFBBF24))
        case "photo_spot": return Config(icon: "📸", color: dayColor(0xF472B6))
        case "rest_area":  return Config(icon: "🪑", color: dayColor(0x34D399))
        case "summit":     return Config(icon: "⛰️", color: dayColor(0xEF4444))
        default:           return Config(icon: "🏛️", color: dayColor(0xF59E0B))
        }
    }
}

// MARK: - Historical-site significance (mirrors DayDiscoveries.tsx SIGNIFICANCE_COLORS)

enum HistoricalSignificance {
    static func color(for significance: String?) -> Color {
        switch (significance ?? "minor").lowercased() {
        case "major":   return dayColor(0xF59E0B)
        case "notable": return dayColor(0x60A5FA)
        // "minor" used to fall back to 40%-white — legible only against the fixed dark
        // background this screen assumed. `.systemGray` is Apple's own answer for a muted,
        // still-legible tone that adapts its exact brightness to the appearance.
        default:        return Color(uiColor: .systemGray)
        }
    }

    /// The significance badge's wording.
    ///
    /// `significance` is a lowercase data token from the export ("major" / "notable" / "minor"),
    /// and this used to be `.capitalized` — a string transform, not a translation, so the badge
    /// read "Major" in every language. `color(for:)` above still switches on the raw token, so
    /// the two stay in step.
    static func label(for significance: String?) -> String {
        switch (significance ?? "minor").lowercased() {
        case "major":   return String(localized: "Major", comment: "Historical-site significance, highest of three.")
        case "notable": return String(localized: "Notable", comment: "Historical-site significance, middle of three.")
        default:        return String(localized: "Minor", comment: "Historical-site significance, lowest of three.")
        }
    }
}
