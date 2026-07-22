import SwiftUI

/// Contextual day/waypoint editor — native counterpart to the web `WaypointEditModal`.
/// Fields mirror it 1:1: name, description, highlights, elevation, day number. Writes go
/// through `JourneyStore.updateWaypoint` (→ `PersistenceController`).
struct WaypointEditSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss

    let journeyID: String
    let camp: Camp
    var onSave: () -> Void = {}

    @State private var name: String
    @State private var description: String
    @State private var highlights: [String]
    @State private var elevation: String
    @State private var dayNumber: String

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
