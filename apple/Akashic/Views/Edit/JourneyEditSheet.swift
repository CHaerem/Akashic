import SwiftUI

/// Contextual journey editor — native counterpart to the web `JourneyEditModal` (the
/// `JourneyUpdate` fields; member management is out of scope for the local store and lands
/// with CKShare in D4). Writes go through `JourneyStore.updateJourney`.
struct JourneyEditSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss

    let journey: Journey
    var onSave: () -> Void = {}

    @State private var name: String
    @State private var description: String
    @State private var country: String
    @State private var hasStart: Bool
    @State private var startDate: Date
    @State private var hasEnd: Bool
    @State private var endDate: Date
    @State private var totalDays: String
    @State private var totalDistance: String
    @State private var summitElevation: String

    init(journey: Journey, onSave: @escaping () -> Void = {}) {
        self.journey = journey
        self.onSave = onSave
        _name = State(initialValue: journey.name)
        _description = State(initialValue: journey.description)
        _country = State(initialValue: journey.country)
        let start = DateOnly.date(from: journey.dateStarted)
        let end = DateOnly.date(from: journey.dateEnded)
        _hasStart = State(initialValue: start != nil)
        _startDate = State(initialValue: start ?? Date())
        _hasEnd = State(initialValue: end != nil)
        _endDate = State(initialValue: end ?? start ?? Date())
        _totalDays = State(initialValue: journey.totalDays.map(String.init) ?? "")
        _totalDistance = State(initialValue: journey.totalDistance.map { String(format: "%g", $0) } ?? "")
        _summitElevation = State(initialValue: journey.summitElevation.map(String.init) ?? "")
    }

    var body: some View {
        EditSheetScaffold(
            title: "Edit Journey",
            saveDisabled: name.trimmingCharacters(in: .whitespaces).isEmpty,
            onCancel: { dismiss() },
            onSave: save
        ) {
            GlassField(label: "Name", systemImage: "flag") {
                GlassTextField(placeholder: "Journey name", text: $name)
            }
            GlassField(label: "Country", systemImage: "globe") {
                GlassTextField(placeholder: "Country", text: $country)
            }
            GlassField(label: "Description", systemImage: "text.alignleft") {
                GlassTextEditor(text: $description, minHeight: 110)
            }
            datesSection
            HStack(spacing: 12) {
                GlassField(label: "Total days", systemImage: "calendar") {
                    GlassTextField(placeholder: "0", text: $totalDays, keyboard: .numberPad)
                }
                GlassField(label: "Distance (km)", systemImage: "figure.walk") {
                    GlassTextField(placeholder: "0", text: $totalDistance, keyboard: .decimalPad)
                }
            }
            GlassField(label: "Summit elevation (m)", systemImage: "mountain.2.fill") {
                GlassTextField(placeholder: "0", text: $summitElevation, keyboard: .numberPad)
            }
        }
    }

    private var datesSection: some View {
        GlassField(label: "Dates", systemImage: "calendar.badge.clock") {
            VStack(spacing: 10) {
                dateRow(label: "Start", isOn: $hasStart, date: $startDate)
                dateRow(label: "End", isOn: $hasEnd, date: $endDate)
            }
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }

    private func dateRow(label: String, isOn: Binding<Bool>, date: Binding<Date>) -> some View {
        HStack {
            Toggle(isOn: isOn) {
                Text(label).font(.subheadline).foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.accent)
            .fixedSize()
            Spacer()
            if isOn.wrappedValue {
                DatePicker("", selection: date, displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.timeZone, TimeZone(identifier: "UTC")!)
            }
        }
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }
        store.updateJourney(
            id: journey.id,
            name: trimmedName,
            description: description.trimmingCharacters(in: .whitespacesAndNewlines),
            country: country.trimmingCharacters(in: .whitespacesAndNewlines),
            dateStarted: hasStart ? DateOnly.string(from: startDate) : nil,
            dateEnded: hasEnd ? DateOnly.string(from: endDate) : nil,
            totalDays: Int(totalDays),
            totalDistance: Double(totalDistance),
            summitElevation: Int(summitElevation)
        )
        onSave()
        dismiss()
    }
}
