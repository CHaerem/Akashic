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

    // Editable day content — every one of these is a CORRECTION (edit/delete/add a single fact, POI,
    // historical site, or weather value), so they are always available, never paywalled.
    @State private var funFacts: [FunFact]
    @State private var pointsOfInterest: [PointOfInterest]
    @State private var historicalSites: [HistoricalSite]
    @State private var wTempMax: String
    @State private var wTempMin: String
    @State private var wPrecip: String
    @State private var wWind: String

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
        self.existingWeatherCode = camp.weather?.weatherCode
        _name = State(initialValue: camp.name)
        _description = State(initialValue: camp.notes)
        _highlights = State(initialValue: camp.highlights)
        _elevation = State(initialValue: camp.elevation == 0 ? "" : String(camp.elevation))
        _dayNumber = State(initialValue: String(camp.dayNumber))
        _funFacts = State(initialValue: camp.funFacts ?? [])
        _pointsOfInterest = State(initialValue: camp.pointsOfInterest ?? [])
        _historicalSites = State(initialValue: camp.historicalSites ?? [])
        _wTempMax = State(initialValue: Self.numString(camp.weather?.temperatureMax))
        _wTempMin = State(initialValue: Self.numString(camp.weather?.temperatureMin))
        _wPrecip = State(initialValue: Self.numString(camp.weather?.precipitationSum))
        _wWind = State(initialValue: Self.numString(camp.weather?.windSpeedMax))
    }

    /// Existing `weatherCode` (WMO) is preserved across edits — the editor only exposes the numeric
    /// fields, so a hand-corrected temperature keeps the condition icon derived from the code.
    private let existingWeatherCode: Int?

    private static func numString(_ value: Double?) -> String {
        guard let value else { return "" }
        return String(format: "%g", value)
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
            funFactsField
            pointsOfInterestField
            historicalSitesField
            weatherField
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

    // MARK: - Editable day content (corrections — always available)

    /// Fun facts: edit each fact's text inline, delete a row, add a blank row. (The grounded-fact
    /// drafter above still handles ADDING generated facts; this edits/removes whatever is there.)
    @ViewBuilder
    private var funFactsField: some View {
        GlassField(label: "Fun facts", systemImage: "lightbulb") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach($funFacts) { $fact in
                    contentRow(text: $fact.content, placeholder: "Fact") {
                        funFacts.removeAll { $0.id == fact.id }
                    }
                }
                addRowButton("Add fact") {
                    funFacts.append(FunFact(id: UUID().uuidString, content: "", category: "general",
                                            source: nil, learnMoreUrl: nil, icon: nil))
                }
            }
        }
    }

    /// Points of interest: edit each POI's name inline, delete, add.
    @ViewBuilder
    private var pointsOfInterestField: some View {
        GlassField(label: "Points of interest", systemImage: "mappin.and.ellipse") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach($pointsOfInterest) { $poi in
                    contentRow(text: $poi.name, placeholder: "Place name") {
                        pointsOfInterest.removeAll { $0.id == poi.id }
                    }
                }
                addRowButton("Add point of interest") {
                    pointsOfInterest.append(PointOfInterest(id: UUID().uuidString, name: "",
                                                            category: "poi", coordinates: nil,
                                                            elevation: nil, description: nil,
                                                            routeDistanceKm: nil, tips: nil,
                                                            timeFromPrevious: nil, icon: nil))
                }
            }
        }
    }

    /// Historical sites: edit name + summary inline, delete, add.
    @ViewBuilder
    private var historicalSitesField: some View {
        GlassField(label: "Historical sites", systemImage: "building.columns") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach($historicalSites) { $site in
                    VStack(alignment: .leading, spacing: 6) {
                        contentRow(text: $site.name, placeholder: "Site name") {
                            historicalSites.removeAll { $0.id == site.id }
                        }
                        GlassTextField(placeholder: "Summary", text: Binding(
                            get: { site.summary },
                            set: { site.summary = $0 }))
                    }
                    .padding(10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                }
                addRowButton("Add historical site") {
                    historicalSites.append(HistoricalSite(id: UUID().uuidString, name: "",
                                                          coordinates: nil, elevation: nil,
                                                          routeDistanceKm: nil, summary: "",
                                                          description: nil, period: nil,
                                                          significance: nil, imageUrls: nil,
                                                          links: nil, tags: nil, dayNumber: nil))
                }
            }
        }
    }

    /// Weather: editable numeric fields + a clear. Values are °C / mm / km/h; blank means absent.
    @ViewBuilder
    private var weatherField: some View {
        GlassField(label: "Weather", systemImage: "cloud.sun") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    weatherNumber("High °C", $wTempMax)
                    weatherNumber("Low °C", $wTempMin)
                }
                HStack(spacing: 12) {
                    weatherNumber("Precip mm", $wPrecip)
                    weatherNumber("Wind km/h", $wWind)
                }
                if !weatherIsEmpty {
                    Button(role: .destructive) {
                        wTempMax = ""; wTempMin = ""; wPrecip = ""; wWind = ""
                    } label: {
                        Label("Clear weather", systemImage: "xmark.circle")
                            .font(.caption.weight(.semibold)).foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func weatherNumber(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.system(size: 10, weight: .semibold))
                .tracking(0.6).foregroundStyle(Theme.textTertiary)
            GlassTextField(placeholder: "—", text: text, keyboard: .numbersAndPunctuation)
        }
    }

    private func contentRow(text: Binding<String>, placeholder: String, onDelete: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            GlassTextField(placeholder: placeholder, text: text)
            Button(action: onDelete) {
                Image(systemName: "trash").font(.subheadline).foregroundStyle(.red)
                    .frame(width: 40, height: 40)
                    .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    private func addRowButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: "plus.circle.fill")
                .font(.caption.weight(.semibold)).foregroundStyle(Theme.accent)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var weatherIsEmpty: Bool {
        [wTempMax, wTempMin, wPrecip, wWind].allSatisfy { $0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Build `WeatherData` from the numeric fields (preserving the existing WMO code), or nil when
    /// every field is blank (the "cleared" state).
    private func composedWeather() -> WeatherData? {
        if weatherIsEmpty && existingWeatherCode == nil { return nil }
        if weatherIsEmpty { return nil }
        return WeatherData(temperatureMax: Double(wTempMax),
                           temperatureMin: Double(wTempMin),
                           precipitationSum: Double(wPrecip),
                           windSpeedMax: Double(wWind),
                           weatherCode: existingWeatherCode)
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
        // Persist the edited content lists + weather (authoritative SET, so deletes/edits round-trip).
        // Blank facts/POIs/sites are dropped so an empty "Add" row never persists as noise.
        store.setDayContent(
            id: camp.id,
            funFacts: funFacts.filter { !$0.content.trimmingCharacters(in: .whitespaces).isEmpty },
            pointsOfInterest: pointsOfInterest.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty },
            historicalSites: historicalSites.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty },
            weather: composedWeather())
        onSave()
        dismiss()
    }
}
