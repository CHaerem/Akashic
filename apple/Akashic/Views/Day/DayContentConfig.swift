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
        case "geology":   return Config(icon: "🪨", color: dayColor(0xA78BFA), label: "Geology")
        case "wildlife":  return Config(icon: "🦁", color: dayColor(0xFBBF24), label: "Wildlife")
        case "flora":     return Config(icon: "🌿", color: dayColor(0x34D399), label: "Flora")
        case "history":   return Config(icon: "📜", color: dayColor(0xF59E0B), label: "History")
        case "culture":   return Config(icon: "🎭", color: dayColor(0xF472B6), label: "Culture")
        case "climate":   return Config(icon: "🌤", color: dayColor(0x60A5FA), label: "Climate")
        case "adventure": return Config(icon: "⛰️", color: dayColor(0xEF4444), label: "Adventure")
        case "science":   return Config(icon: "🔬", color: dayColor(0x8B5CF6), label: "Science")
        case "geography": return Config(icon: "🗺️", color: dayColor(0x14B8A6), label: "Geography")
        case "survival":  return Config(icon: "🧭", color: dayColor(0xF97316), label: "Survival")
        default:          return Config(icon: "🗺️", color: dayColor(0x14B8A6), label: category.capitalized)
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
        default:        return Color.white.opacity(0.4)
        }
    }

    static func label(for significance: String?) -> String {
        (significance ?? "minor").capitalized
    }
}
