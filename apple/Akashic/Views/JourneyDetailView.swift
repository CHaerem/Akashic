import SwiftUI

/// Journey detail: header, inline route map, stats summary, and a per-day list.
struct JourneyDetailView: View {
    let journey: Journey

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                RouteMapView(journey: journey, interactive: false)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(Theme.hairline, lineWidth: 1)
                    )

                statsSummary

                if !journey.description.isEmpty {
                    Text(journey.description)
                        .font(.callout)
                        .foregroundStyle(Theme.textSecondary)
                }

                daySection
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(journey.shortName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(journey.shortName)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(journey.countryFlag).font(.system(size: 40))
            }
            HStack(spacing: 8) {
                Text(journey.country).foregroundStyle(Theme.textSecondary)
                if let dates = Formatters.dateRange(journey.dateStarted, journey.dateEnded) {
                    Text("·").foregroundStyle(Theme.textTertiary)
                    Text(dates).foregroundStyle(Theme.textSecondary)
                }
            }
            .font(.subheadline)
        }
    }

    private var statsSummary: some View {
        HStack(spacing: 10) {
            StatChip(icon: "figure.walk", value: Formatters.distanceKm(journey.stats.totalDistance), caption: "Distance")
            StatChip(icon: "arrow.up.forward", value: Formatters.meters(journey.stats.totalElevationGain), caption: "Ascent")
            StatChip(icon: "mountain.2", value: Formatters.meters(journey.stats.highestPoint?.elevation ?? 0), caption: "Summit")
            StatChip(icon: "calendar", value: "\(journey.stats.duration)", caption: "Days")
        }
    }

    private var daySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Days")
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            ForEach(journey.camps) { camp in
                DayRow(camp: camp)
            }
        }
    }
}

/// One day/camp row: day badge, name, elevation, per-day distance + gain, notes, highlights.
struct DayRow: View {
    let camp: Camp

    var body: some View {
        Card(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    dayBadge
                    VStack(alignment: .leading, spacing: 3) {
                        Text(camp.name)
                            .font(.headline)
                            .foregroundStyle(Theme.textPrimary)
                        HStack(spacing: 6) {
                            Image(systemName: "arrow.up.to.line.compact")
                                .font(.caption2)
                                .foregroundStyle(Theme.accent)
                            Text(Formatters.meters(camp.elevation))
                                .font(.subheadline)
                                .foregroundStyle(Theme.textSecondary)
                            if let terrain = camp.terrain, !terrain.isEmpty {
                                Text("· \(terrain)")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                    }
                    Spacer()
                }

                HStack(spacing: 18) {
                    metric(icon: "point.topleft.down.to.point.bottomright.curvepath",
                           label: "Day distance", value: Formatters.distanceKm(camp.dayDistance))
                    metric(icon: "arrow.up.forward",
                           label: "Ascent", value: Formatters.meters(camp.elevationGainFromPrevious))
                    if camp.elevationLossFromPrevious > 0 {
                        metric(icon: "arrow.down.forward",
                               label: "Descent", value: Formatters.meters(camp.elevationLossFromPrevious))
                    }
                }

                if !camp.notes.isEmpty {
                    Text(camp.notes)
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }

                if !camp.highlights.isEmpty {
                    FlowChips(items: camp.highlights)
                }
            }
        }
    }

    private var dayBadge: some View {
        VStack(spacing: 0) {
            Text("DAY").font(.system(size: 8, weight: .bold)).foregroundStyle(Theme.textTertiary)
            Text("\(camp.dayNumber)").font(.title3.weight(.bold)).foregroundStyle(Theme.accent)
        }
        .frame(width: 46, height: 46)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func metric(icon: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(value, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(Theme.textTertiary)
        }
    }
}

/// Simple wrapping chip row for highlights.
struct FlowChips: View {
    let items: [String]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(items.prefix(4), id: \.self) { item in
                Text(item)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.accent)
                    .padding(.vertical, 4)
                    .padding(.horizontal, 9)
                    .background(Theme.accentSoft, in: Capsule())
            }
        }
    }
}

#Preview {
    NavigationStack {
        if let journey = try? FixtureLoader.load(named: "kilimanjaro") {
            JourneyDetailView(journey: journey)
        }
    }
    .preferredColorScheme(.dark)
}
