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
        if entitlements.canCreateJourney(ownedCount: store.billableOwnedJourneyCount) {
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
                            JourneyCard(journey: journey, isSample: store.showsSampleBadge(journey.id))
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
                        .font(.callout.weight(.semibold))
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
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(Theme.accent)
            }
            .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text("Start your first journey")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text("Name a trek, drop in a GPX route, and let your photos fill the days.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onCreate) {
                Label("Create a journey", systemImage: "plus")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.onAccent)
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
    /// D9: true for the bundled demo journey. The badge is the "tell it apart" half of the
    /// requirement; the "delete is obvious and easy" half needs no bespoke UI — it already shares
    /// the ordinary destructive delete in `JourneyDetailView`'s overflow menu.
    var isSample: Bool = false

    /// The flag glyph sits in a fixed 120 pt hero band; scale it (same treatment as
    /// `JourneyGlobeCard.flagSize` in D1) so it stays proportionate instead of eventually
    /// overflowing that fixed-height strip.
    @ScaledMetric(relativeTo: .largeTitle) private var flagSize: CGFloat = 34

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Hero band (gradient placeholder + flag; real hero images arrive with sync).
            ZStack(alignment: .bottomLeading) {
                Theme.heroGradient
                    .frame(height: 120)
                    .overlay(alignment: .topTrailing) {
                        Text(journey.countryFlag)
                            .font(.system(size: flagSize))
                            .padding(12)
                            // The country is named in words two lines below; the flag emoji is the
                            // same fact as a picture, and VoiceOver reads it as its own element.
                            .accessibilityHidden(true)
                    }
                    .overlay(alignment: .topLeading) {
                        if isSample { SampleBadge().padding(12) }
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
                    .accessibilityElement(children: .combine)
                StatChip(icon: "arrow.up.forward", value: Formatters.meters(journey.stats.totalElevationGain), caption: "Ascent")
                    .accessibilityElement(children: .combine)
                StatChip(icon: "calendar", value: "\(journey.stats.duration)", caption: "Days")
                    .accessibilityElement(children: .combine)
            }

            if let summit = journey.stats.highestPoint {
                Label("\(summit.name) · \(Formatters.meters(summit.elevation))", systemImage: "flag.checkered")
                    .font(.footnote)
                    .foregroundStyle(Theme.textTertiary)
                    .accessibilityLabel(Text("Summit \(summit.name), \(Formatters.meters(summit.elevation))"))
            }
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
        // QUA-07: one card is one journey. Left uncombined it was up to twelve elements — a flag, a
        // badge, a name, a country, a date range, six chip fragments and a summit — which is a lot of
        // swiping to decide whether this is the trip you wanted to open. `children: .combine` rather
        // than a hand-written label so a card gains nothing to forget when a field is added; the
        // decoration above is hidden so the combination is the parts that mean something.
        .accessibilityElement(children: .combine)
    }
}

/// D9: small "SAMPLE" pill marking the bundled demo journey wherever it surfaces (this list's
/// card, the globe's journey strip, the detail header) — the one component so the three call
/// sites can't drift in wording or styling. Uses `Theme.accent`/`Theme.onAccent`, the same pair
/// already doing CTA duty elsewhere (e.g. `JourneyEmptyState`'s "Start your first journey"), so
/// this doesn't introduce a new colour to the palette.
struct SampleBadge: View {
    var body: some View {
        Text("SAMPLE")
            .font(.caption2.weight(.bold))
            .foregroundStyle(Theme.onAccent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.accent, in: Capsule())
            // QUA-07: all-caps is a visual weight, not a word — VoiceOver spells short uppercase
            // runs out letter by letter, and "E-K-S-E-M-P-E-L" is not what this badge means. The
            // label restores the sentence and says what the badge is telling you.
            .accessibilityLabel("Sample journey")
    }
}

#Preview {
    NavigationStack { JourneyListView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .environmentObject(EntitlementStore.previewFree)
        .preferredColorScheme(.dark)
}
