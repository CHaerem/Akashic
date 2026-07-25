import SwiftUI
import UIKit

/// Full stats experience for a single journey — the SwiftUI port of the web's `StatsTab.tsx`.
///
/// Layout (top → bottom):
///   * a summit hero card + `duration / distance / total gain` header chips (`TrekStats`),
///   * the interactive elevation profile; selecting a camp reveals that day's stat row,
///   * the extended-stats grids (journey / elevation / highlights) rendered exactly like the
///     web `StatItem` cards, plus a colour-coded difficulty badge.
///
/// The heavy math is reused from `ExtendedStatsCalculator` (never reimplemented here); the
/// profile geometry comes from `ElevationProfileModel`.
struct StatsView: View {
    let journey: Journey

    /// Selected camp id (drives the blue profile overlay + the day stat row).
    @State private var selectedCampID: String?

    /// Debug/screenshot seam (env-driven, resolved at init so the chart's own `onAppear`
    /// sees it on first render). No effect on normal launches.
    private let debugZoom: CGFloat

    init(journey: Journey) {
        self.journey = journey
        let env = ProcessInfo.processInfo.environment
        self.debugZoom = env["AKASHIC_STATS_ZOOM"].flatMap { Double($0) }.map { CGFloat($0) } ?? 1
        // Pre-select a day for screenshots (`AKASHIC_STATS_DAY`); user taps override later.
        let day = env["AKASHIC_STATS_DAY"].flatMap { Int($0) }
        let initialCampID = day.flatMap { d in journey.camps.first { $0.dayNumber == d }?.id }
        _selectedCampID = State(initialValue: initialCampID)
    }

    private var extended: ExtendedStats {
        ExtendedStatsCalculator.calculate(route: journey.route, stats: journey.stats, camps: journey.camps)
    }
    /// Nil when the route carries no elevation at all — a hand-drawn route never does, and
    /// `ElevationProfileModel` reads a missing third coordinate as sea level, so without this gate a
    /// drawn journey renders a profile pinned flat at 0 m as if that were measured.
    private var profile: ElevationProfileModel? {
        journey.route.hasElevation ? ElevationProfileModel(journey: journey) : nil
    }
    private var selectedCamp: Camp? {
        guard let id = selectedCampID else { return nil }
        return journey.camps.first { $0.id == id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            summitHero
            headerChips
            elevationSection
            journeyStatsSection
            elevationStatsSection
            highlightsSection
        }
    }

    /// Screenshot crosshair position: the selected camp's x (only when zoomed via the debug env).
    private func debugCrosshairLogicalX(in profile: ElevationProfileModel) -> CGFloat? {
        guard debugZoom > 1, let id = selectedCampID else { return nil }
        return profile.campMarkers.first { $0.campID == id }?.x
    }

    // MARK: - Header (TrekStats)

    @ViewBuilder
    private var summitHero: some View {
        if let hp = journey.stats.highestPoint {
            Card(padding: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    sectionLabel("Summit")
                    Text(Formatters.meters(hp.elevation))
                        .font(.largeTitle.weight(.light))
                        .foregroundStyle(Theme.textPrimary)
                    Text(hp.name)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    private var headerChips: some View {
        HStack(spacing: 12) {
            StatChip(icon: "calendar", value: "\(journey.stats.duration) d", caption: "Duration")
            StatChip(icon: "figure.walk", value: Formatters.distanceKm(journey.stats.totalDistance), caption: "Distance")
            StatChip(icon: "arrow.up.forward", value: "+\(Formatters.meters(journey.stats.totalElevationGain))", caption: "Ascent")
        }
    }

    // MARK: - Elevation profile + selected-day row

    @ViewBuilder
    private var elevationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Elevation Profile")
            if let profile {
                InteractiveElevationProfileView(
                    model: profile,
                    selectedCampID: selectedCampID,
                    onSelectCamp: { marker in
                        withAnimation(.easeOut(duration: 0.2)) {
                            selectedCampID = (selectedCampID == marker.campID) ? nil : marker.campID
                        }
                    },
                    initialZoom: debugZoom,
                    initialCrosshairLogicalX: debugCrosshairLogicalX(in: profile)
                )
            } else if journey.route.coordinates.isEmpty {
                ContentUnavailableView("No route", systemImage: "mountain.2")
                    .frame(height: 120)
            } else {
                ContentUnavailableView(
                    "No elevation data", systemImage: "mountain.2",
                    description: Text("This route has no elevation — a route drawn by hand never does. Replace it from a GPX to get a profile."))
                    .frame(height: 150)
            }
            if let camp = selectedCamp { selectedDayRow(camp) }
        }
    }

    private func selectedDayRow(_ camp: Camp) -> some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Day \(camp.dayNumber)")
                        .font(.headline).foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Text(camp.name)
                        .font(.subheadline).foregroundStyle(Theme.textSecondary)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                HStack(spacing: 0) {
                    dayMetric("Distance", Formatters.distanceKm(camp.dayDistance), "figure.walk")
                    dayMetric("Ascent", "+\(camp.elevationGainFromPrevious)m", "arrow.up.forward")
                    dayMetric("Descent", "-\(camp.elevationLossFromPrevious)m", "arrow.down.forward")
                    dayMetric("Elevation", Formatters.meters(camp.elevation), "mountain.2")
                }
                if camp.terrain != nil || camp.timeFromPrevious != nil {
                    HStack(spacing: 14) {
                        if let terrain = camp.terrain, !terrain.isEmpty {
                            Label(terrain, systemImage: "map").font(.caption).foregroundStyle(Theme.textTertiary)
                        }
                        if let time = camp.timeFromPrevious, !time.isEmpty {
                            Label(time, systemImage: "clock").font(.caption).foregroundStyle(Theme.textTertiary)
                        }
                    }
                }
            }
        }
        .transition(.opacity)
    }

    private func dayMetric(_ label: String, _ value: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Image(systemName: icon).font(.caption2).foregroundStyle(Theme.accent)
            Text(value).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(label).font(.caption2).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Extended stats grids (web StatsTab parity)

    private var journeyStatsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Journey Stats")
            // D4: Total Distance and Duration used to repeat here — the header chips above
            // already say them. Only figures the header doesn't carry belong in this grid.
            statGrid {
                StatItem(label: "Est. Hiking Time", value: extended.estimatedTotalTime, color: Self.violet)
                StatItem(label: "Avg. Daily Distance", value: "\(extended.avgDailyDistance) km")
            }
        }
    }

    private var elevationStatsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Elevation")
            statGrid {
                StatItem(label: "Total Ascent", value: "+\(extended.totalElevationGain)m", color: Self.green)
                StatItem(label: "Total Descent", value: "-\(extended.totalElevationLoss)m", color: Self.red)
                StatItem(label: "Start Elev.", value: "\(extended.startElevation)m")
                StatItem(label: "End Elev.", value: "\(extended.endElevation)m")
                StatItem(label: "Avg. Altitude", value: "\(extended.avgAltitude)m")
                StatItem(label: "Max Daily Gain", value: "+\(extended.maxDailyGain)m", color: Self.green)
                StatItem(label: "Max Daily Loss", value: "-\(extended.maxDailyLoss)m", color: Self.red)
                StatItem(label: "Longest Day",
                         value: Formatters.distanceKm(extended.longestDayDistance),
                         sublabel: "Day \(extended.longestDayNumber)")
            }
        }
    }

    private var highlightsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Difficulty")
            HStack(spacing: 12) {
                difficultyBadge
                StatItem(label: "Steepest Day",
                         value: "\(extended.steepestDayGradient) m/km",
                         sublabel: "Day \(extended.steepestDayNumber)")
            }
        }
    }

    private var difficultyBadge: some View {
        let color = Self.difficultyColor(extended.difficulty)
        return Card(padding: 16) {
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("Rating")
                HStack(spacing: 8) {
                    Circle().fill(color).frame(width: 10, height: 10)
                    Text(extended.difficulty)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(color)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(color.opacity(0.4)))
    }

    // MARK: - Building blocks

    private func sectionLabel(_ text: String) -> some View {
        // Was a fixed 10 pt at `Theme.textTertiary` (40% white) — small size and low contrast
        // compounded into the least readable text in the tab. `.caption2` is the size floor;
        // `textSecondary` (62% white) is the fix for a *label*, as opposed to a de-emphasised
        // value, sitting at that size.
        Text(text.uppercased())
            .font(.caption2.weight(.medium))
            .tracking(1.4)
            .foregroundStyle(Theme.textSecondary)
    }

    @ViewBuilder
    private func statGrid<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            content()
        }
    }

    // MARK: - Palette
    //
    // Verified on screen (Kilimanjaro, Stats tab, both appearances): `violet` and `red` read
    // fine against a white page — 3.7:1 and 4.2:1, both above the 3:1 floor for text this size
    // (`.title3`, which clears WCAG's "large text" threshold). `green` and the difficulty
    // badge's orange/amber did NOT — the "Hard" badge visibly washed out at ~2.8:1 and ~1.9:1
    // (green ~2.3:1), all mirroring the web's hex 1:1 with no allowance for a light background.
    // Rather than replace the hue family, `adaptiveHue` keeps the original (dark-mode-proven)
    // value for dark and swaps in a darker, more saturated shade of the SAME hue for light —
    // the same "the trait picks the value" technique `Theme` already uses for Increase
    // Contrast, applied here to light/dark instead.
    private static let violet = Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255)   // #8b5cf6
    private static let green = adaptiveHue(dark: (34, 197, 94), light: (21, 128, 61))      // #22c55e / #15803d
    private static let red = Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)        // #ef4444

    static func difficultyColor(_ difficulty: String) -> Color {
        switch difficulty {
        case "Extreme": return Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)   // red
        case "Hard": return adaptiveHue(dark: (249, 115, 22), light: (194, 65, 12))      // orange / dark orange
        case "Moderate": return adaptiveHue(dark: (234, 179, 8), light: (180, 83, 9))    // amber / dark amber
        default: return Self.green                                                       // green (Easy)
        }
    }

    /// A colour that's `dark` (0–255 RGB) under Dark Mode and `light` under Light Mode —
    /// the system re-resolves it automatically, exactly like `Theme`'s Increase-Contrast
    /// `UIColor`s, just keyed on `userInterfaceStyle` instead of `accessibilityContrast`.
    private static func adaptiveHue(dark: (Int, Int, Int), light: (Int, Int, Int)) -> Color {
        func uiColor(_ rgb: (Int, Int, Int)) -> UIColor {
            UIColor(red: CGFloat(rgb.0) / 255, green: CGFloat(rgb.1) / 255, blue: CGFloat(rgb.2) / 255, alpha: 1)
        }
        return Color(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? uiColor(dark) : uiColor(light)
        })
    }
}

/// A single stat cell mirroring the web `StatItem`: uppercase label, large light value,
/// optional accent colour and sublabel.
struct StatItem: View {
    let label: String
    let value: String
    var sublabel: String?
    var color: Color?

    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 4) {
                // Same fix as `StatsView.sectionLabel`: a 10 pt label at `textTertiary` is small
                // and low-contrast together. `value` below keeps `textTertiary` as its fallback —
                // it's a de-emphasised number, not a label, so out of scope for the lift.
                Text(label.uppercased())
                    .font(.caption2.weight(.medium))
                    .tracking(1.0)
                    .foregroundStyle(Theme.textSecondary)
                Text(value)
                    .font(.title3.weight(.light))
                    .foregroundStyle(color ?? Theme.textPrimary)
                    .lineLimit(1).minimumScaleFactor(0.7)
                if let sublabel {
                    Text(sublabel)
                        .font(.caption)
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Stats tab: journey picker + `StatsView`.
struct StatsTabView: View {
    @EnvironmentObject private var store: JourneyStore
    @State private var selectedID: String?
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private var selected: Journey? {
        store.journey(withID: selectedID ?? store.journeys.first?.id ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.journeys.count > 1 {
                    journeyChipRow
                }

                if let journey = selected {
                    StatsView(journey: journey)
                        .id(journey.id)   // reset per-journey selection state
                } else {
                    ContentUnavailableView("No stats", systemImage: "chart.bar")
                }
            }
            .padding(16)
            // D2: full-width stat grids and a full-width elevation chart across a 13" iPad read
            // as a stretched phone screen; cap and centre instead.
            .constrainedReadingWidth()
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Stats")
        .onAppear { if selectedID == nil { selectedID = resolveInitialJourneyID() } }
    }

    // MARK: - Journey picker (D4)
    //
    // Was a `.segmented` Picker — SwiftUI truncates segment titles once there isn't room
    // ("Inca Trail to Mac…"), and the paid tier's entire promise is *unlimited* journeys, so
    // the control broke precisely when someone paid. A horizontally scrolling chip row has no
    // such ceiling: every journey gets its full name, and it borrows the same capsule
    // selected/unselected language as the globe strip's day pills (`DayNavigationView`) rather
    // than a `Menu`, so the picker stays visually consistent with the rest of the app's chrome
    // instead of hiding the journey list behind a tap.
    private var journeyChipRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.journeys) { journey in
                    journeyChip(journey)
                }
            }
            // Room for the selected chip's stroke/shadow at the scroll edges.
            .padding(.horizontal, 2)
        }
    }

    private func journeyChip(_ journey: Journey) -> some View {
        let isSelected = journey.id == (selected?.id ?? "")
        return Button {
            withAnimation(.easeOut(duration: 0.2)) { selectedID = journey.id }
        } label: {
            Text(journey.name)
                .font(.subheadline.weight(isSelected ? .semibold : .regular))
                .lineLimit(1)
                .foregroundStyle(isSelected ? Theme.onAccent : Theme.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .frame(minHeight: 44)
                .background {
                    if isSelected {
                        Capsule().fill(Theme.accent)
                    } else {
                        Capsule().fill(reduceTransparency ? AnyShapeStyle(Theme.surface) : AnyShapeStyle(.ultraThinMaterial))
                            .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(journey.name)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    /// Default to the first journey, or one named by `AKASHIC_STATS_JOURNEY` (id or name
    /// substring) — a screenshot/deep-link seam.
    private func resolveInitialJourneyID() -> String? {
        let env = ProcessInfo.processInfo.environment
        if let query = env["AKASHIC_STATS_JOURNEY"], !query.isEmpty {
            if let exact = store.journeys.first(where: { $0.id == query }) { return exact.id }
            let lowered = query.lowercased()
            if let match = store.journeys.first(where: { $0.name.lowercased().contains(lowered) }) {
                return match.id
            }
        }
        return store.journeys.first?.id
    }
}

#Preview {
    NavigationStack { StatsTabView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
