import SwiftUI

/// "Enrich journey" for an EXISTING journey — the big unlock so the three migrated journeys can
/// finally gain WeatherKit weather, places and points of interest (Kilimanjaro's 2023 weather, at
/// last). It runs the SAME `JourneySuggestionCoordinator` providers used in creation, but against
/// the live journey: auto-named-day detection against current names, weather rows for days with a
/// date+coordinate that LACK weather, POI rows for days without POIs, country only if empty. There
/// is deliberately NO route suggestion here — route lives in the editor.
///
/// Nothing is applied without Accept. Each Accept writes through the normal edit paths
/// (`updateJourney` / `updateWaypoint` / `setDayContent`), so sync carries it and no new record
/// type is involved. Enrichment is assistance (not correction), so it is part of Akashic Complete
/// and owner-only — the menu entry is gated the same way.
struct EnrichJourneySheet: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    @Environment(\.dismiss) private var dismiss

    let journey: Journey

    @StateObject private var suggestions = JourneySuggestionCoordinator.live(factsEnabled: false)
    @State private var draft: JourneyDraft
    @State private var hasRun = false
    @State private var showPaywall = false

    init(journey: Journey) {
        self.journey = journey
        _draft = State(initialValue: Self.makeDraft(from: journey))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if entitlements.isComplete {
                        intro
                        if suggestions.isRunning {
                            running
                        } else if suggestions.model.pending.isEmpty && hasRun {
                            emptyState
                        }
                        if suggestions.model.pending.count > 1 {
                            Button("Accept all", action: acceptAll)
                                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accentText)
                                .frame(maxWidth: .infinity, alignment: .trailing)
                                .accessibilityLabel(Text("Accept all \(suggestions.model.pending.count) suggestions"))
                        }
                        ForEach(suggestions.model.pending, id: \.self) { key in
                            row(key)
                        }
                    } else {
                        locked
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Enrich journey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accentText)
                }
            }
            .sheet(isPresented: $showPaywall) {
                PaywallView(reason: .enrich).environmentObject(entitlements)
            }
        }
        .presentationBackground(Theme.background)
        .task {
            guard entitlements.isComplete, !hasRun else { return }
            suggestions.factsEnabled = intelligence.isAvailable && entitlements.isComplete
            // fixes: [] → no route suggestion; existing-journey enrichment fills only the gaps.
            await suggestions.run(fixes: [], draft: draft)
            hasRun = true
        }
    }

    // MARK: Sections

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Suggestions for this journey")
                .font(.headline).foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("Weather, places and points of interest for days that don't have them yet. Nothing is applied until you tap Accept.")
                .font(.caption).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var running: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.small).tint(Theme.accent)
                .accessibilityHidden(true)
            Text("Looking for suggestions…").font(.caption).foregroundStyle(Theme.textTertiary)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "checkmark.seal").font(.title2).foregroundStyle(Theme.accentText)
                .accessibilityHidden(true)
            Text("Nothing to add right now.")
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
            Text("Every day already has weather, places and points of interest — or WeatherKit has no data for these dates and coordinates.")
                .font(.caption).foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var locked: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "wand.and.stars").font(.largeTitle).foregroundStyle(Theme.accentText)
                .accessibilityHidden(true)
            Text("Enrich journey is part of Akashic Complete")
                .font(.headline).foregroundStyle(Theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text("Correcting your own data is always free. Enriching a journey with suggested weather, places and points of interest is part of Akashic Complete.")
                .font(.callout).foregroundStyle(Theme.textSecondary)
            Button { showPaywall = true } label: {
                Text("Unlock Akashic Complete")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.onAccent)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the Akashic Complete purchase sheet")
        }
    }

    /// QUA-24: identical to `NewJourneySheet.suggestionRow`'s problem and fix — two unlabelled glyphs
    /// per row, the destructive one first, repeated once per pending suggestion.
    private func row(_ key: SuggestionKey) -> some View {
        let title = suggestions.title(for: key, in: draft)
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                if let subtitle = suggestions.subtitle(for: key, in: draft), !subtitle.isEmpty {
                    Text(subtitle).font(.caption2).foregroundStyle(Theme.textTertiary).lineLimit(2)
                }
            }
            .accessibilityElement(children: .combine)
            Spacer()
            Button { suggestions.dismiss(key) } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.textTertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Dismiss \(title)"))
            Button { accept(key) } label: {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accentText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Accept \(title)"))
        }
        .padding(12)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Accept → write through the normal edit paths

    private func accept(_ key: SuggestionKey) {
        suggestions.accept(key, into: &draft)   // places the payload onto the draft day/journey
        persist(key)
    }

    private func acceptAll() {
        for key in suggestions.model.pending {   // snapshot; each accept mutates the model
            suggestions.accept(key, into: &draft)
            persist(key)
        }
    }

    /// Persist the just-accepted suggestion by reading the now-updated draft and writing it through
    /// the ordinary edit path. Because the draft was built from the journey (carrying its existing
    /// content), a `setDayContent` write preserves every other field on that day.
    private func persist(_ key: SuggestionKey) {
        switch key {
        case .routeFromPhotos:
            break   // never offered in enrich
        case .country:
            store.updateJourney(id: journey.id, name: journey.name, description: journey.description,
                                country: draft.country, dateStarted: journey.dateStarted,
                                dateEnded: journey.dateEnded, totalDays: journey.totalDays,
                                totalDistance: journey.totalDistance, summitElevation: journey.summitElevation)
        case let .campName(dayID):
            guard let day = draft.days.first(where: { $0.id == dayID }),
                  let camp = journey.camps.first(where: { $0.id == dayID }) else { return }
            store.updateWaypoint(id: dayID, name: day.name, description: camp.notes,
                                 highlights: camp.highlights, elevation: camp.elevation,
                                 dayNumber: camp.dayNumber)
        case let .weather(dayID), let .pois(dayID), let .facts(dayID):
            guard let day = draft.days.first(where: { $0.id == dayID }) else { return }
            store.setDayContent(id: dayID,
                                funFacts: day.funFacts ?? [],
                                pointsOfInterest: day.pointsOfInterest ?? [],
                                historicalSites: day.historicalSites ?? [],
                                weather: day.weather)
        }
    }

    // MARK: Draft from the live journey

    /// Snapshot the journey into a `JourneyDraft` so the SHARED coordinator can reason over it. Day
    /// identities are preserved (so suggestions apply by id), and each day carries its EXISTING
    /// weather / POIs / facts so the coordinator's gap-only guards skip days that already have them.
    static func makeDraft(from journey: Journey) -> JourneyDraft {
        var draft = JourneyDraft()
        draft.id = journey.id
        draft.name = journey.name
        draft.country = journey.country
        draft.description = journey.description
        draft.dateStarted = DateOnly.date(from: journey.dateStarted)
        draft.dateEnded = DateOnly.date(from: journey.dateEnded)
        draft.route = journey.route.coordinates.isEmpty ? nil : journey.route
        draft.days = journey.camps.map { camp in
            DraftDay(id: camp.id, name: camp.name, elevation: camp.elevation,
                     coordinates: camp.coordinates, dateLabel: camp.dateLabel, notes: camp.notes,
                     source: .gpxWaypoint, weather: camp.weather,
                     pointsOfInterest: camp.pointsOfInterest, funFacts: camp.funFacts,
                     historicalSites: camp.historicalSites)
        }
        return draft
    }
}
