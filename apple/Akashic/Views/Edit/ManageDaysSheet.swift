import SwiftUI

/// Owner-only day management for an existing journey — days are no longer frozen after creation.
///
/// Add a day (at the end or after another), delete a day (with confirm; its photos and comments
/// become UNASSIGNED, never deleted), and drag to reorder. Every operation writes through the normal
/// edit paths (`JourneyStore.addDay` / `deleteDay` / `reorderDays`) so sync carries it, and days
/// renumber consistently. Photos are keyed by the stable `waypointId`, so a reorder keeps each
/// photo with its day.
struct ManageDaysSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss
    let journeyID: String

    @State private var days: [Camp] = []
    @State private var pendingDelete: Camp?
    @State private var editMode: EditMode = .inactive

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(days) { camp in
                        row(camp)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { pendingDelete = camp } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button {
                                    addDay(after: camp.dayNumber)
                                } label: { Label("Add day after", systemImage: "plus") }
                                Button(role: .destructive) { pendingDelete = camp } label: {
                                    Label("Delete day", systemImage: "trash")
                                }
                            }
                    }
                    .onMove(perform: move)
                } footer: {
                    Text("Deleting a day never deletes its photos or comments — they move to Unassigned.")
                        .font(.caption2).foregroundStyle(Theme.textTertiary)
                }

                Section {
                    Button { addDay(after: nil) } label: {
                        Label("Add day", systemImage: "plus.circle.fill")
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Manage days")
            .navigationBarTitleDisplayMode(.inline)
            .environment(\.editMode, $editMode)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }.foregroundStyle(Theme.accent)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(editMode.isEditing ? "Done reordering" : "Reorder") {
                        withAnimation { editMode = editMode.isEditing ? .inactive : .active }
                    }
                    .foregroundStyle(Theme.accent)
                }
            }
            .confirmationDialog("Delete this day?",
                                isPresented: deletePresented, titleVisibility: .visible) {
                Button("Delete day", role: .destructive) {
                    if let pendingDelete { delete(pendingDelete) }
                    pendingDelete = nil
                }
                Button("Cancel", role: .cancel) { pendingDelete = nil }
            } message: {
                Text("The day is removed and the remaining days renumber. Its photos and comments become Unassigned — nothing is deleted.")
            }
        }
        .presentationBackground(Theme.background)
        .onAppear(perform: sync)
    }

    private func row(_ camp: Camp) -> some View {
        HStack(spacing: 12) {
            Text("\(camp.dayNumber)")
                .font(.caption.weight(.bold)).foregroundStyle(Theme.accent)
                .frame(width: 28, height: 28)
                .background(Theme.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(camp.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                if camp.elevation > 0 {
                    Text(Formatters.meters(camp.elevation)).font(.caption2).foregroundStyle(Theme.textTertiary)
                }
            }
            Spacer()
        }
        .listRowBackground(Theme.surface)
    }

    // MARK: Operations

    private var deletePresented: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    private func sync() {
        days = store.journey(withID: journeyID)?.camps ?? []
    }

    private func move(from source: IndexSet, to destination: Int) {
        days.move(fromOffsets: source, toOffset: destination)
        store.reorderDays(journeyID: journeyID, orderedIDs: days.map(\.id))
        sync()
    }

    private func addDay(after dayNumber: Int?) {
        // The default name for a freshly added day is text the customer reads and then edits, so
        // it is localised at the point of creation — the same way the system names a new folder in
        // the user's language. It is persisted from here on and never re-derived, so a later
        // language change leaves existing days alone, which is the behaviour you want: a name the
        // user may have kept or edited is their data, not a label.
        let name = String(localized: "Day \((store.journey(withID: journeyID)?.camps.count ?? 0) + 1)",
                          comment: "Default name for a day added from Manage days, e.g. \"Day 4\".")
        _ = store.addDay(toJourney: journeyID, name: name, afterDayNumber: dayNumber)
        sync()
    }

    private func delete(_ camp: Camp) {
        _ = store.deleteDay(camp.id)
        sync()
    }
}
