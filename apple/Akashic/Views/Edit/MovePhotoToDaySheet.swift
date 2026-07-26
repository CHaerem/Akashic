import SwiftUI

/// A focused "Move to day…" picker — pick a day (or Unassigned) and the photo's `waypointId` is
/// rewritten through the normal photo edit path (`JourneyStore.assignPhoto`). Correcting which day a
/// photo belongs to is always free and touches only the Photo record.
struct MovePhotoToDaySheet: View {
    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss

    let photo: Photo
    let journey: Journey
    var onMoved: (Photo?) -> Void = { _ in }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    dayButton(title: "Unassigned", subtitle: nil,
                              isSelected: photo.waypointId == nil) {
                        move(to: nil)
                    }
                }
                Section("Days") {
                    ForEach(journey.camps) { camp in
                        dayButton(title: "Day \(camp.dayNumber)", subtitle: camp.name,
                                  isSelected: photo.waypointId == camp.id) {
                            move(to: camp.id)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Move to day")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .presentationBackground(Theme.background)
        .presentationDetents([.medium, .large])
    }

    private func dayButton(title: LocalizedStringKey, subtitle: String?, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.textPrimary)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption2).foregroundStyle(Theme.textTertiary)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark").font(.subheadline.weight(.bold)).foregroundStyle(Theme.accent)
                }
            }
        }
        .listRowBackground(Theme.surface)
    }

    private func move(to waypointID: String?) {
        let updated = store.assignPhoto(photo.id, toWaypoint: waypointID)
        onMoved(updated)
        dismiss()
    }
}
