import SwiftUI

/// Contextual day/waypoint editor — native counterpart to the web `WaypointEditModal`.
/// Fields mirror it 1:1: name, description, highlights, elevation, day number. Writes go
/// through `JourneyStore.updateWaypoint` (→ `PersistenceController`).
struct WaypointEditSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    @EnvironmentObject private var intelligence: Intelligence
    @Environment(\.dismiss) private var dismiss

    let journeyID: String
    let camp: Camp
    var onSave: () -> Void = {}

    @State private var name: String
    @State private var description: String
    @State private var highlights: [String]
    @State private var elevation: String
    @State private var dayNumber: String

    // M6 — on-device day-note drafting (Apple Intelligence).
    @State private var isDrafting = false
    @State private var draftFailed = false
    /// A generated draft awaiting the user's confirmation to replace existing notes.
    @State private var pendingDraft: String?
    @State private var showReplaceConfirm = false

    // Grounded fact drafting (FactDrafter) — draft, then Add-to-day accept.
    @State private var isDraftingFacts = false
    @State private var factsFailed = false
    @State private var pendingFacts: DraftedFacts?

    /// The Draft button appears only when the on-device model is available AND the user has Akashic
    /// Complete — otherwise the feature is simply absent (no dead button, no upsell in the editor).
    private var showsDraftButton: Bool { intelligence.isAvailable && entitlements.isComplete }

    init(journeyID: String, camp: Camp, onSave: @escaping () -> Void = {}) {
        self.journeyID = journeyID
        self.camp = camp
        self.onSave = onSave
        _name = State(initialValue: camp.name)
        _description = State(initialValue: camp.notes)
        _highlights = State(initialValue: camp.highlights)
        _elevation = State(initialValue: camp.elevation == 0 ? "" : String(camp.elevation))
        _dayNumber = State(initialValue: String(camp.dayNumber))
    }

    var body: some View {
        EditSheetScaffold(
            title: "Edit Day \(camp.dayNumber)",
            saveDisabled: name.trimmingCharacters(in: .whitespaces).isEmpty,
            onCancel: { dismiss() },
            onSave: save
        ) {
            GlassField(label: "Name", systemImage: "mappin") {
                GlassTextField(placeholder: "Camp name", text: $name)
            }
            GlassField(label: "Description", systemImage: "text.alignleft") {
                if showsDraftButton {
                    draftButton
                }
                GlassTextEditor(text: $description)
            }
            GlassField(label: "Highlights", systemImage: "sparkles") {
                HighlightChipsEditor(items: $highlights)
            }
            if showsDraftButton {
                factsField
            }
            HStack(spacing: 12) {
                GlassField(label: "Elevation (m)", systemImage: "mountain.2") {
                    GlassTextField(placeholder: "0", text: $elevation, keyboard: .numberPad)
                }
                GlassField(label: "Day number", systemImage: "number") {
                    GlassTextField(placeholder: "1", text: $dayNumber, keyboard: .numberPad)
                }
            }
        }
        .alert("Replace your notes?", isPresented: $showReplaceConfirm) {
            Button("Cancel", role: .cancel) { pendingDraft = nil }
            Button("Replace") {
                if let pendingDraft { description = pendingDraft }
                pendingDraft = nil
            }
        } message: {
            Text("This day already has notes. Replace them with the drafted version? Your current text will be lost.")
        }
    }

    // MARK: - Draft with Apple Intelligence (M6)

    @ViewBuilder
    private var draftButton: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button(action: draftNote) {
                HStack(spacing: 6) {
                    if isDrafting {
                        ProgressView().controlSize(.small).tint(Theme.accent)
                    } else {
                        Image(systemName: "apple.intelligence")
                    }
                    Text(isDrafting ? "Drafting…" : "Draft with Apple Intelligence")
                        .font(.caption.weight(.semibold))
                }
                .foregroundStyle(Theme.accent)
            }
            .buttonStyle(.plain)
            .disabled(isDrafting)
            if draftFailed {
                Text("Couldn't draft — try again")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Build the day's facts from data we already store and fill the notes field with a draft. The
    /// result is only ever placed in the editable field — it is NEVER auto-saved.
    private func draftNote() {
        guard !isDrafting else { return }
        draftFailed = false
        guard let journey = store.journey(withID: journeyID) else { return }
        let photos = store.photos(forDay: camp.dayNumber, journeyID: journeyID)
        let input = DayNoteInput(journey: journey, camp: camp, photos: photos)
        // Capture the notes field as it is NOW, so the result can be compared against it: if the
        // user types during the multi-second generation, the stale draft is discarded rather than
        // wiping what they wrote. And existing notes are never silently replaced.
        let fieldAtRequest = description
        isDrafting = true
        Task {
            defer { isDrafting = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    let draft = try await DayNoteDrafter.generate(for: input)
                    guard !draft.isEmpty else { draftFailed = true; return }
                    switch DayNoteDrafter.decision(fieldAtRequest: fieldAtRequest, fieldNow: description) {
                    case .apply:
                        description = draft
                    case .confirmReplace:
                        pendingDraft = draft
                        showReplaceConfirm = true
                    case .discardStale:
                        break   // the user edited the field mid-generation — never clobber it
                    }
                } catch {
                    draftFailed = true
                }
            } else {
                draftFailed = true
            }
            #else
            draftFailed = true
            #endif
        }
    }

    // MARK: - Draft facts with Apple Intelligence (grounded)

    /// Facts drafting field: a "Draft facts" button, and once a draft lands, a small preview with
    /// Add-to-day / discard — grounded strictly in the day's own name and highlights.
    @ViewBuilder
    private var factsField: some View {
        GlassField(label: "Facts", systemImage: "lightbulb") {
            VStack(alignment: .leading, spacing: 8) {
                Button(action: draftFacts) {
                    HStack(spacing: 6) {
                        if isDraftingFacts {
                            ProgressView().controlSize(.small).tint(Theme.accent)
                        } else {
                            Image(systemName: "apple.intelligence")
                        }
                        Text(isDraftingFacts ? "Drafting facts…" : "Draft facts")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(Theme.accent)
                }
                .buttonStyle(.plain)
                .disabled(isDraftingFacts)

                if let facts = pendingFacts, !facts.isEmpty {
                    ForEach(facts.funFacts) { fact in
                        factPreview(icon: "lightbulb", text: fact.content)
                    }
                    ForEach(facts.historicalSites) { site in
                        factPreview(icon: "building.columns", text: "\(site.name) — \(site.summary)")
                    }
                    HStack(spacing: 12) {
                        Button("Add to day") { addPendingFacts() }
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
                        Button("Discard") { pendingFacts = nil }
                            .font(.caption).foregroundStyle(Theme.textTertiary)
                    }
                }
                if factsFailed {
                    Text("Couldn't draft facts — try again")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func factPreview(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: icon).font(.caption2).foregroundStyle(Theme.accent)
            Text(text).font(.caption2).foregroundStyle(Theme.textSecondary)
        }
    }

    /// Draft grounded facts from the day's own name + highlights + any existing POIs — nothing
    /// invented. The result is previewed, never auto-saved; the user taps Add to day to persist.
    private func draftFacts() {
        guard !isDraftingFacts else { return }
        factsFailed = false
        pendingFacts = nil
        let poiNames = (camp.pointsOfInterest ?? []).map(\.name)
        let journeyName = store.journey(withID: journeyID)?.shortName ?? ""
        let country = store.journey(withID: journeyID)?.country ?? ""
        let input = DayFactInput(journeyName: journeyName, country: country,
                                 dayNumber: camp.dayNumber, campName: name,
                                 placeNames: highlights, poiNames: poiNames,
                                 dateLabel: camp.dateLabel, elevation: Int(elevation) ?? camp.elevation)
        guard input.hasGrounding else { factsFailed = true; return }
        isDraftingFacts = true
        Task {
            defer { isDraftingFacts = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                if let drafted = try? await FactDrafter.generate(for: input), !drafted.isEmpty {
                    pendingFacts = drafted
                } else {
                    factsFailed = true
                }
            } else {
                factsFailed = true
            }
            #else
            factsFailed = true
            #endif
        }
    }

    /// Persist the previewed facts onto this day's waypoint (append, never replace) and refresh.
    private func addPendingFacts() {
        guard let facts = pendingFacts else { return }
        store.addDayContent(funFacts: facts.funFacts, historicalSites: facts.historicalSites,
                            toWaypoint: camp.id)
        pendingFacts = nil
        onSave()
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }
        store.updateWaypoint(
            id: camp.id,
            name: trimmedName,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            highlights: highlights,
            elevation: Int(elevation) ?? camp.elevation,
            dayNumber: Int(dayNumber) ?? camp.dayNumber
        )
        onSave()
        dismiss()
    }
}
