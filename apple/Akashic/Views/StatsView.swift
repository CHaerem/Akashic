import SwiftUI

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
    private var profile: ElevationProfileModel? { ElevationProfileModel(journey: journey) }
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
                        .font(.system(size: 34, weight: .light))
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
            } else {
                ContentUnavailableView("No route", systemImage: "mountain.2")
                    .frame(height: 120)
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
            statGrid {
                StatItem(label: "Total Distance", value: Formatters.distanceKm(journey.stats.totalDistance))
                StatItem(label: "Duration", value: "\(journey.stats.duration) days")
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
        Text(text.uppercased())
            .font(.system(size: 10, weight: .medium))
            .tracking(1.4)
            .foregroundStyle(Theme.textTertiary)
    }

    @ViewBuilder
    private func statGrid<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            content()
        }
    }

    // MARK: - Palette

    private static let violet = Color(red: 139 / 255, green: 92 / 255, blue: 246 / 255)   // #8b5cf6
    private static let green = Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255)      // #22c55e
    private static let red = Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)        // #ef4444

    static func difficultyColor(_ difficulty: String) -> Color {
        switch difficulty {
        case "Extreme": return Color(red: 239 / 255, green: 68 / 255, blue: 68 / 255)   // red
        case "Hard": return Color(red: 249 / 255, green: 115 / 255, blue: 22 / 255)     // orange
        case "Moderate": return Color(red: 234 / 255, green: 179 / 255, blue: 8 / 255)  // amber
        default: return Color(red: 34 / 255, green: 197 / 255, blue: 94 / 255)          // green (Easy)
        }
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
                Text(label.uppercased())
                    .font(.system(size: 10, weight: .medium))
                    .tracking(1.0)
                    .foregroundStyle(Theme.textTertiary)
                Text(value)
                    .font(.system(size: 20, weight: .light))
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

    private var selected: Journey? {
        store.journey(withID: selectedID ?? store.journeys.first?.id ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.journeys.count > 1 {
                    Picker("Journey", selection: Binding(
                        get: { selected?.id ?? "" },
                        set: { selectedID = $0 }
                    )) {
                        ForEach(store.journeys) { Text($0.shortName).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                }

                if let journey = selected {
                    StatsView(journey: journey)
                        .id(journey.id)   // reset per-journey selection state
                } else {
                    ContentUnavailableView("No stats", systemImage: "chart.bar")
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Stats")
        .onAppear { if selectedID == nil { selectedID = resolveInitialJourneyID() } }
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
