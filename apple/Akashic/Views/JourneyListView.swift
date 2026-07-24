import SwiftUI

/// Scrollable list of journey cards.
struct JourneyListView: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingNewJourney = false
    @State private var showingPaywall = false

    /// Start a create attempt: below the free limit → open the creation sheet; at the limit →
    /// present the paywall instead (never silently blocked). See `EntitlementStore`.
    private func startCreate() {
        if entitlements.canCreateJourney(ownedCount: store.ownedJourneyCount) {
            showingNewJourney = true
        } else {
            showingPaywall = true
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if store.journeys.isEmpty {
                    JourneyEmptyState { startCreate() }
                        .padding(.top, 60)
                } else {
                    ForEach(store.journeys) { journey in
                        NavigationLink(value: journey.id) {
                            JourneyCard(journey: journey)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Journeys")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    startCreate()
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                }
                .accessibilityLabel("New journey")
            }
        }
        .sheet(isPresented: $showingNewJourney) {
            // On create, close the list so the globe (which observes `pendingJourneySelection`)
            // flies straight into the new journey.
            NewJourneySheet(onCreated: { _ in dismiss() })
                .environmentObject(store)
                .environmentObject(entitlements)
        }
        .sheet(isPresented: $showingPaywall) {
            PaywallView(reason: .journeyLimit)
                .environmentObject(entitlements)
        }
        .navigationDestination(for: String.self) { id in
            if let journey = store.journey(withID: id) {
                JourneyDetailView(journey: journey)
            }
        }
    }
}

/// First-run hero shown when there are no journeys yet — the front door for a new family.
struct JourneyEmptyState: View {
    var onCreate: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(Theme.accentSoft)
                    .frame(width: 96, height: 96)
                Image(systemName: "mountain.2.fill")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(Theme.accent)
            }
            VStack(spacing: 8) {
                Text("Start your first journey")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                Text("Name a trek, drop in a GPX route, and let your photos fill the days.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onCreate) {
                Label("Create a journey", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.background)
                    .padding(.vertical, 14)
                    .padding(.horizontal, 24)
                    .background(Theme.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(28)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
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
        .environmentObject(EntitlementStore.previewFree)
        .preferredColorScheme(.dark)
}
