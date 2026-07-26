import SwiftUI

/// A single fun-fact card: category icon + label, content, and an optional source line.
/// Mirrors the web `FunFactCard` (non-compact variant).
struct FunFactCardView: View {
    let fact: FunFact

    private var style: FunFactStyle.Config { FunFactStyle.config(for: fact.category) }

    /// The category icon was sized to fit a fixed 32 pt box; scale the box with the glyph
    /// (`.title3`, the nearest semantic step up from the old 20 pt) so a growing emoji doesn't
    /// outgrow its background tile.
    @ScaledMetric(relativeTo: .title3) private var iconBoxSize: CGFloat = 32

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(fact.icon ?? style.icon)
                    .font(.title3)
                    .frame(width: iconBoxSize, height: iconBoxSize)
                    .background(style.color.opacity(0.16),
                                in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(style.label.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(style.color)
                Spacer(minLength: 0)
            }

            Text(fact.content)
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            if let source = fact.source, !source.isEmpty {
                Divider().overlay(Theme.hairline)
                Text("Source: \(source)")
                    .font(.caption2)
                    .italic()
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Was a two-stop white-opacity gradient tuned for the fixed dark background this card
        // used to sit on; `Theme.fillSubtle` reads correctly in both appearances, and a flat
        // fill reads just as "barely raised" as the gradient did at these opacities.
        .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }
}

/// A horizontal, swipeable carousel of fun-fact cards with page dots (the "Did you know?"
/// section). Falls back to a single card when there is only one fact.
struct FunFactsCarousel: View {
    let facts: [FunFact]
    @State private var index = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(icon: "💡", title: "Did you know?")

            if facts.count == 1, let fact = facts.first {
                FunFactCardView(fact: fact)
            } else {
                TabView(selection: $index) {
                    ForEach(Array(facts.enumerated()), id: \.element.id) { i, fact in
                        FunFactCardView(fact: fact)
                            .padding(.bottom, 28)   // room for the page dots
                            .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .frame(height: carouselHeight)
            }
        }
    }

    // Facts vary in length; a generous fixed height keeps the pager stable for the tallest.
    private var carouselHeight: CGFloat {
        let longest = facts.map(\.content.count).max() ?? 0
        return longest > 180 ? 230 : (longest > 110 ? 190 : 160)
    }
}

/// A small uppercase section header with a leading emoji (shared across day sections).
struct SectionLabel: View {
    let icon: String
    let title: LocalizedStringKey
    /// Stays a `String`: every caller passes a already-formatted count ("12", "4 places"), not
    /// prose. The prose ones are built with `Formatters` so they localise at their source.
    var trailing: String?

    var body: some View {
        HStack(spacing: 6) {
            Text(icon).font(.subheadline)
            // `.textCase(.uppercase)` rather than `title.uppercased()` — see `GlassField`: the
            // `String` form made every section header ("Photos", "Comments", "Highlights",
            // "Discoveries", "Did you know?") invisible to the string catalogue.
            Text(title)
                .textCase(.uppercase)
                .font(.caption2.weight(.semibold))
                .tracking(0.8)
                .foregroundStyle(Theme.textTertiary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Theme.accentSoft, in: Capsule())
            }
        }
    }
}
