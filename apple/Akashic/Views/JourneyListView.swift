import SwiftUI

/// Scrollable list of journey cards.
struct JourneyListView: View {
    @EnvironmentObject private var store: JourneyStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(store.journeys) { journey in
                    NavigationLink(value: journey.id) {
                        JourneyCard(journey: journey)
                    }
                    .buttonStyle(.plain)
                }

                if store.journeys.isEmpty {
                    ContentUnavailableView(
                        "No journeys",
                        systemImage: "moon.stars",
                        description: Text(store.loadError ?? "Nothing to show yet.")
                    )
                    .padding(.top, 80)
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Journeys")
        .navigationDestination(for: String.self) { id in
            if let journey = store.journey(withID: id) {
                JourneyDetailView(journey: journey)
            }
        }
    }
}

/// A single journey summary card.
struct JourneyCard: View {
    let journey: Journey

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Hero band (gradient placeholder + flag; real hero images arrive with sync).
            ZStack(alignment: .bottomLeading) {
                Theme.heroGradient
                    .frame(height: 120)
                    .overlay(alignment: .topTrailing) {
                        Text(journey.countryFlag)
                            .font(.system(size: 34))
                            .padding(12)
                    }
                VStack(alignment: .leading, spacing: 2) {
                    Text(journey.shortName)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(journey.country)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
                .padding(14)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

            if let dates = Formatters.dateRange(journey.dateStarted, journey.dateEnded) {
                Label(dates, systemImage: "calendar")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }

            HStack(spacing: 10) {
                StatChip(icon: "figure.walk", value: Formatters.distanceKm(journey.stats.totalDistance), caption: "Distance")
                StatChip(icon: "arrow.up.forward", value: Formatters.meters(journey.stats.totalElevationGain), caption: "Ascent")
                StatChip(icon: "calendar", value: "\(journey.stats.duration)", caption: "Days")
            }

            if let summit = journey.stats.highestPoint {
                Label("\(summit.name) · \(Formatters.meters(summit.elevation))", systemImage: "flag.checkered")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }
}

#Preview {
    NavigationStack { JourneyListView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
