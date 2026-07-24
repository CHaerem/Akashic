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
            HStack(spacing: 12) {
                GlassField(label: "Elevation (m)", systemImage: "mountain.2") {
                    GlassTextField(placeholder: "0", text: $elevation, keyboard: .numberPad)
                }
                GlassField(label: "Day number", systemImage: "number") {
                    GlassTextField(placeholder: "1", text: $dayNumber, keyboard: .numberPad)
                }
            }
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
        isDrafting = true
        Task {
            defer { isDrafting = false }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                do {
                    let draft = try await DayNoteDrafter.generate(for: input)
                    guard !draft.isEmpty else { draftFailed = true; return }
                    description = draft
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
