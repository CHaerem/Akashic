import SwiftUI

/// Derived, presentation-only stats for a journey.
struct JourneyStats {
    let totalDistance: Double
    let totalAscent: Int
    let totalDescent: Int
    let avgDailyDistance: Double
    let maxDailyGain: Int
    let longestDayDistance: Double
    let longestDayNumber: Int
    let startElevation: Int
    let endElevation: Int
    let highestPoint: HighestPoint?

    init(journey: Journey) {
        totalDistance = journey.stats.totalDistance
        totalAscent = journey.stats.totalElevationGain
        totalDescent = journey.stats.totalElevationLoss
            ?? journey.camps.reduce(0) { $0 + $1.elevationLossFromPrevious }
        let days = max(journey.stats.duration, 1)
        avgDailyDistance = (journey.stats.totalDistance / Double(days) * 10).rounded() / 10
        maxDailyGain = journey.camps.map(\.elevationGainFromPrevious).max() ?? 0
        let longest = journey.camps.max { $0.dayDistance < $1.dayDistance }
        longestDayDistance = longest?.dayDistance ?? 0
        longestDayNumber = longest?.dayNumber ?? 0
        let elevations = journey.route.coordinates.compactMap { $0.count >= 3 ? $0[2] : nil }
        startElevation = Int((elevations.first ?? 0).rounded())
        endElevation = Int((elevations.last ?? 0).rounded())
        highestPoint = journey.stats.highestPoint
    }
}

/// Per-journey stats panel (reused by the Stats tab).
struct StatsView: View {
    let journey: Journey
    private var stats: JourneyStats { JourneyStats(journey: journey) }

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ElevationSparkline(route: journey.route)
                .frame(height: 96)

            LazyVGrid(columns: columns, spacing: 12) {
                statTile("Total distance", Formatters.distanceKm(stats.totalDistance), "figure.walk")
                statTile("Total ascent", Formatters.meters(stats.totalAscent), "arrow.up.forward")
                statTile("Total descent", Formatters.meters(stats.totalDescent), "arrow.down.forward")
                statTile("Avg / day", Formatters.distanceKm(stats.avgDailyDistance), "calendar")
                statTile("Biggest climb", Formatters.meters(stats.maxDailyGain), "flame")
                statTile("Longest day", "\(Formatters.distanceKm(stats.longestDayDistance)) · D\(stats.longestDayNumber)", "ruler")
                statTile("Start elevation", Formatters.meters(stats.startElevation), "arrow.up.to.line")
                statTile("End elevation", Formatters.meters(stats.endElevation), "arrow.down.to.line")
            }

            if let summit = stats.highestPoint {
                Card {
                    HStack(spacing: 12) {
                        Image(systemName: "mountain.2.fill")
                            .font(.title2)
                            .foregroundStyle(Theme.accent)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Highest point")
                                .font(.caption)
                                .foregroundStyle(Theme.textTertiary)
                            Text("\(summit.name) · \(Formatters.meters(summit.elevation))")
                                .font(.headline)
                                .foregroundStyle(Theme.textPrimary)
                        }
                        Spacer()
                    }
                }
            }
        }
    }

    private func statTile(_ title: String, _ value: String, _ icon: String) -> some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: icon).font(.caption).foregroundStyle(Theme.accent)
                    Text(title).font(.caption).foregroundStyle(Theme.textTertiary)
                }
                Text(value)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }
        }
    }
}

/// Minimal filled elevation profile derived from the route's `[lng, lat, ele]` coords.
struct ElevationSparkline: View {
    let route: Route

    var body: some View {
        GeometryReader { geo in
            let elevations = route.coordinates.compactMap { $0.count >= 3 ? $0[2] : nil }
            if elevations.count > 1 {
                let minE = elevations.min() ?? 0
                let maxE = elevations.max() ?? 1
                let range = max(maxE - minE, 1)
                let w = geo.size.width
                let h = geo.size.height
                let step = w / CGFloat(elevations.count - 1)

                let points: [CGPoint] = elevations.enumerated().map { i, e in
                    CGPoint(x: CGFloat(i) * step,
                            y: h - CGFloat((e - minE) / range) * (h - 6) - 3)
                }

                ZStack {
                    Path { p in
                        p.move(to: CGPoint(x: 0, y: h))
                        for pt in points { p.addLine(to: pt) }
                        p.addLine(to: CGPoint(x: w, y: h))
                        p.closeSubpath()
                    }
                    .fill(LinearGradient(colors: [Theme.accent.opacity(0.35), Theme.accent.opacity(0.02)],
                                         startPoint: .top, endPoint: .bottom))
                    Path { p in
                        p.move(to: points[0])
                        for pt in points.dropFirst() { p.addLine(to: pt) }
                    }
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 2, lineJoin: .round))
                }
            }
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
                if !store.journeys.isEmpty {
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
                } else {
                    ContentUnavailableView("No stats", systemImage: "chart.bar")
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Stats")
        .onAppear { if selectedID == nil { selectedID = store.journeys.first?.id } }
    }
}

#Preview {
    NavigationStack { StatsTabView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
