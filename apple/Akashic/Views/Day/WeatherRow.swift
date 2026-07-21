import SwiftUI

/// A compact weather summary for a day: an SF-Symbol glyph (chosen from the WMO weather
/// code) with its label, plus temperature high/low, precipitation and max wind.
/// Individual metrics are hidden when their value is absent.
struct WeatherRow: View {
    let weather: WeatherData

    private var hasAnyMetric: Bool {
        weather.temperatureMax != nil || weather.temperatureMin != nil
            || weather.precipitationSum != nil || weather.windSpeedMax != nil
    }

    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 4) {
                Image(systemName: WeatherPresentation.symbol(for: weather.weatherCode))
                    .font(.system(size: 26))
                    .symbolRenderingMode(.multicolor)
                    .foregroundStyle(WeatherPresentation.tint(for: weather.weatherCode))
                Text(WeatherPresentation.label(for: weather.weatherCode))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .frame(width: 72)

            if hasAnyMetric {
                Divider()
                    .frame(height: 40)
                    .overlay(Theme.hairline)

                HStack(spacing: 16) {
                    if let hi = weather.temperatureMax {
                        metric(icon: "thermometer.high", value: temp(hi), label: "High",
                               tint: dayTint(0xF87171))
                    }
                    if let lo = weather.temperatureMin {
                        metric(icon: "thermometer.low", value: temp(lo), label: "Low",
                               tint: dayTint(0x60A5FA))
                    }
                    if let precip = weather.precipitationSum, precip > 0 {
                        metric(icon: "drop.fill", value: String(format: "%.0f mm", precip),
                               label: "Precip", tint: dayTint(0x38BDF8))
                    }
                    if let wind = weather.windSpeedMax {
                        metric(icon: "wind", value: String(format: "%.0f", wind) + " km/h",
                               label: "Wind", tint: dayTint(0x94A3B8))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }

    private func metric(icon: String, value: String, label: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 13))
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(Theme.textTertiary)
        }
    }

    private func temp(_ value: Double) -> String {
        "\(Int(value.rounded()))°"
    }

    private func dayTint(_ hex: UInt32) -> Color {
        Color(.sRGB,
              red: Double((hex >> 16) & 0xFF) / 255,
              green: Double((hex >> 8) & 0xFF) / 255,
              blue: Double(hex & 0xFF) / 255,
              opacity: 1)
    }
}
