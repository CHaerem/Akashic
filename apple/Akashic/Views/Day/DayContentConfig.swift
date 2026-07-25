import SwiftUI
import UIKit

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

private func dayUIColor(_ hex: UInt32) -> UIColor {
    UIColor(
        red: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: 1
    )
}

/// A colour that's the web's original hex under Dark Mode and a darker, more saturated shade of
/// the SAME hue under Light Mode — the same technique `StatsView.adaptiveHue` uses for its
/// difficulty badge, applied here for `FunFactStyle`'s category label.
///
/// Unlike `dayColor` above (used for icon-tile *backgrounds* at ~16% opacity — where none of
/// these hues have a legibility problem, verified by inspection), `FunFactStyle.color` is also
/// drawn as small (`.caption2`) TEXT in `FunFactCardView`. Checked against the web's original
/// hex values on a white page: several dropped under a 2:1 contrast ratio (`wildlife`'s
/// `#FBBF24` ~1.7:1, `flora`'s `#34D399` ~1.9:1) — nowhere near WCAG's 4.5:1 floor for text this
/// size. Every `light` value below was chosen to clear 4.5:1 with margin.
private func dayColorAdaptive(dark: UInt32, light: UInt32) -> Color {
    Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? dayUIColor(dark) : dayUIColor(light)
    })
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

    static func label(for code: Int?) -> String {
        guard let code else { return "Weather" }
        switch code {
        case 0: return "Clear sky"
        case 1: return "Mainly clear"
        case 2: return "Partly cloudy"
        case 3: return "Overcast"
        case 45, 48: return "Fog"
        case 51: return "Light drizzle"
        case 53: return "Drizzle"
        case 55: return "Heavy drizzle"
        case 56, 57: return "Freezing drizzle"
        case 61: return "Light rain"
        case 63: return "Rain"
        case 65: return "Heavy rain"
        case 66, 67: return "Freezing rain"
        case 71: return "Light snow"
        case 73: return "Snow"
        case 75: return "Heavy snow"
        case 77: return "Snow grains"
        case 80, 81, 82: return "Rain showers"
        case 85, 86: return "Snow showers"
        case 95: return "Thunderstorm"
        case 96, 99: return "Thunderstorm & hail"
        default: return "Weather"
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
        case "geology":   return Config(icon: "🪨", color: dayColorAdaptive(dark: 0xA78BFA, light: 0x6D28D9), label: "Geology")
        case "wildlife":  return Config(icon: "🦁", color: dayColorAdaptive(dark: 0xFBBF24, light: 0xB45309), label: "Wildlife")
        case "flora":     return Config(icon: "🌿", color: dayColorAdaptive(dark: 0x34D399, light: 0x047857), label: "Flora")
        case "history":   return Config(icon: "📜", color: dayColorAdaptive(dark: 0xF59E0B, light: 0x92400E), label: "History")
        case "culture":   return Config(icon: "🎭", color: dayColorAdaptive(dark: 0xF472B6, light: 0xBE185D), label: "Culture")
        case "climate":   return Config(icon: "🌤", color: dayColorAdaptive(dark: 0x60A5FA, light: 0x1D4ED8), label: "Climate")
        case "adventure": return Config(icon: "⛰️", color: dayColorAdaptive(dark: 0xEF4444, light: 0xB91C1C), label: "Adventure")
        case "science":   return Config(icon: "🔬", color: dayColorAdaptive(dark: 0x8B5CF6, light: 0x6D28D9), label: "Science")
        case "geography": return Config(icon: "🗺️", color: dayColorAdaptive(dark: 0x14B8A6, light: 0x0F766E), label: "Geography")
        case "survival":  return Config(icon: "🧭", color: dayColorAdaptive(dark: 0xF97316, light: 0xC2410C), label: "Survival")
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

    static func label(for significance: String?) -> String {
        (significance ?? "minor").capitalized
    }
}
