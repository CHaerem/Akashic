import SwiftUI

/// Night-sky visual language. Deep indigo background (#0B0B19) with starlight accents.
enum Theme {
    static let background = Color(red: 11 / 255, green: 11 / 255, blue: 25 / 255)   // #0B0B19
    static let surface = Color(red: 22 / 255, green: 23 / 255, blue: 44 / 255)      // card fill
    static let surfaceRaised = Color(red: 30 / 255, green: 32 / 255, blue: 58 / 255)
    static let accent = Color(red: 0.56, green: 0.62, blue: 1.0)                    // periwinkle
    static let accentSoft = Color(red: 0.56, green: 0.62, blue: 1.0).opacity(0.16)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.62)
    static let textTertiary = Color.white.opacity(0.4)
    static let hairline = Color.white.opacity(0.08)

    /// Subtle top-to-bottom gradient used behind hero areas.
    static let heroGradient = LinearGradient(
        colors: [
            Color(red: 26 / 255, green: 24 / 255, blue: 58 / 255),
            Color(red: 11 / 255, green: 11 / 255, blue: 25 / 255)
        ],
        startPoint: .top,
        endPoint: .bottom
    )
}

/// A rounded "surface" card container.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
    }
}

/// A small labelled stat pill (icon + value + caption).
struct StatChip: View {
    let icon: String
    let value: String
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(Theme.accent)
                Text(value)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Text(caption)
                .font(.caption2)
                .foregroundStyle(Theme.textTertiary)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
