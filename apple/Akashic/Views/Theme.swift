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
    /// Inline problem text (a failed sharing change, say) — readable on the dark surface
    /// without the alarm of full red.
    static let warning = Color(red: 1.0, green: 0.66, blue: 0.4)

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
/// A row of `StatChip`s that wraps instead of squeezing.
///
/// Four chips side by side on a 402 pt phone leaves ~45 pt for the number, and `Formatters.meters`
/// on a real summit is "5,895 m" — so Kilimanjaro's Summit chip rendered as "5,89…" even with
/// `minimumScaleFactor`. Two columns on a compact width give every number its full width; a regular
/// width (iPad, landscape) still gets the single row it has room for.
struct StatChipRow: View {
    struct Item: Identifiable {
        var icon: String
        var value: String
        var caption: String
        var id: String { caption }
    }

    @Environment(\.horizontalSizeClass) private var sizeClass
    let items: [Item]
    var spacing: CGFloat = 10

    /// Three or fewer chips already fit a phone row; only the four-chip case needs wrapping.
    private var wraps: Bool { sizeClass == .compact && items.count > 3 }

    var body: some View {
        if wraps {
            LazyVGrid(columns: [GridItem(spacing: spacing), GridItem(spacing: spacing)], spacing: spacing) {
                ForEach(items) { chip in
                    StatChip(icon: chip.icon, value: chip.value, caption: chip.caption)
                }
            }
        } else {
            HStack(spacing: spacing) {
                ForEach(items) { chip in
                    StatChip(icon: chip.icon, value: chip.value, caption: chip.caption)
                }
            }
        }
    }
}

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
