import SwiftUI

/// Points of Interest + Historical Sites for a day, as expandable cards.
/// Mirrors the web `DayDiscoveries`. Renders nothing when both lists are empty.
struct DayDiscoveriesView: View {
    var pointsOfInterest: [PointOfInterest] = []
    var historicalSites: [HistoricalSite] = []

    private var total: Int { pointsOfInterest.count + historicalSites.count }

    var body: some View {
        if total > 0 {
            VStack(alignment: .leading, spacing: 12) {
                SectionLabel(icon: "🔍", title: "Discoveries",
                             trailing: String(localized: "\(total) places",
                                              comment: "Day discoveries: count badge over the POI + historical-site list."))

                if !historicalSites.isEmpty {
                    subheader(marker: "★", markerColor: HistoricalSignificance.color(for: "major"),
                              title: "Historical Sites")
                    ForEach(historicalSites) { site in
                        HistoricalSiteCardView(site: site)
                    }
                }

                if !pointsOfInterest.isEmpty {
                    subheader(marker: "📍", markerColor: .clear, title: "Points of Interest")
                    ForEach(pointsOfInterest) { poi in
                        POICardView(poi: poi)
                    }
                }
            }
        }
    }

    private func subheader(marker: String, markerColor: Color, title: LocalizedStringKey) -> some View {
        HStack(spacing: 6) {
            // "★" and "📍" are bullets. VoiceOver reads them as "white medium star" and "round
            // pushpin" before the heading they decorate.
            Text(marker)
                .font(.caption)
                .foregroundStyle(markerColor == .clear ? Theme.textSecondary : markerColor)
                .accessibilityHidden(true)
            Text(title)
                .textCase(.uppercase)
                .font(.caption2.weight(.medium))
                .tracking(0.5)
                .foregroundStyle(Theme.textTertiary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Reusable expandable card shell

private struct ExpandableCard<Content: View>: View {
    let title: String
    var subtitle: String?
    let icon: String
    let iconColor: Color
    @ViewBuilder var content: () -> Content

    @State private var expanded = false

    /// The category emoji was sized to fit a fixed 28 pt box; scale the box with the glyph
    /// (`.callout`, the nearest semantic step to the old 16 pt) so it doesn't outgrow its tile.
    @ScaledMetric(relativeTo: .callout) private var iconBoxSize: CGFloat = 28

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Text(icon)
                        .font(.callout)
                        .frame(width: iconBoxSize, height: iconBoxSize)
                        .background(iconColor.opacity(0.16),
                                    in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(title)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(Theme.textPrimary)
                            .multilineTextAlignment(.leading)
                        if let subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.caption2)
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Theme.textTertiary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // QUA-07: a rotating chevron is how a sighted reader knows this card opens and whether it
            // is currently open. There is no accessibility *trait* for expansion (UIKit conveys it
            // through the value, and `AccessibilityTraits` has no `isExpanded`), so the state is the
            // value and the consequence is the hint. Without both, every discovery announced as a
            // plain place name with no sign that a description was behind it.
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            .accessibilityHint(expanded ? "Collapses the details" : "Expands the details")

            if expanded {
                VStack(alignment: .leading, spacing: 0) {
                    content()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
            }
        }
        // A barely-there white tint only read correctly on the fixed dark background this
        // screen used to assume; `Theme.fillSubtle` (`.quaternarySystemFill`) is the system's
        // own "a hair lighter than what's underneath" and adapts to light/dark on its own.
        .background(Theme.fillSubtle, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - POI card

private struct POICardView: View {
    let poi: PointOfInterest

    private var style: POIStyle.Config { POIStyle.config(for: poi.category) }

    var body: some View {
        ExpandableCard(
            title: poi.name,
            subtitle: poi.elevation.map { "\($0)m" },
            icon: poi.icon ?? style.icon,
            iconColor: style.color
        ) {
            if let description = poi.description, !description.isEmpty {
                Text(description)
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }
            if let tips = poi.tips, !tips.isEmpty {
                Text("TIPS")
                    .font(.caption2.weight(.semibold))
                    .tracking(0.5)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.top, 10)
                ForEach(Array(tips.enumerated()), id: \.offset) { _, tip in
                    HStack(alignment: .top, spacing: 6) {
                        Text("•").foregroundStyle(Theme.textTertiary).accessibilityHidden(true)
                        Text(tip)
                            .font(.caption)
                            .foregroundStyle(Theme.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 2)
                }
            }
            if let time = poi.timeFromPrevious, !time.isEmpty {
                Text("⏱ \(time) from previous stop")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.top, 8)
            }
        }
    }
}

// MARK: - Historical site card

private struct HistoricalSiteCardView: View {
    let site: HistoricalSite

    var body: some View {
        ExpandableCard(
            title: site.name,
            subtitle: site.period,
            icon: "🏛️",
            iconColor: HistoricalSignificance.color(for: site.significance)
        ) {
            // Significance badge + summary.
            HStack(spacing: 6) {
                // The dot repeats the significance in colour only.
                Circle()
                    .fill(HistoricalSignificance.color(for: site.significance))
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
                Text(HistoricalSignificance.label(for: site.significance))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(HistoricalSignificance.color(for: site.significance))
            }
            .padding(.top, 10)

            Text(site.summary)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)

            if let description = site.description, !description.isEmpty {
                Text(description)
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 10)
            }

            if let tags = site.tags, !tags.isEmpty {
                FlowTags(tags: tags).padding(.top, 10)
            }

            if let links = site.links, !links.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(links) { link in
                        if let url = URL(string: link.url) {
                            Link(destination: url) {
                                HStack(spacing: 4) {
                                    Text(link.label)
                                    Image(systemName: "arrow.up.right")
                                        .font(.caption2)
                                        .accessibilityHidden(true)
                                }
                                .font(.caption)
                                .foregroundStyle(Theme.accent)
                            }
                            // The arrow glyph is what tells a sighted reader this leaves the app.
                            .accessibilityHint("Opens in Safari")
                        }
                    }
                }
                .padding(.top, 10)
            }
        }
    }
}

/// Tag row (blue chips) for historical-site tags. Scrolls horizontally when the tags
/// overflow the card width — reliable without custom wrap math.
private struct FlowTags: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.caption2)
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.accentSoft,
                                    in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                }
            }
        }
    }
}
