import SwiftUI

/// S3 — the user's own words, made first-class.
///
/// `Camp.notes` already existed, synced and rendered fine — it was just buried behind
/// Edit → `WaypointEditSheet`. The whole point of the S-series reframe (DESIGN-PLAN.md) is that
/// the notes, not the map, are what separates a *told* story from Polarsteps' auto-generated
/// GPS timeline, so they need a first-class, inviting affordance right where the story is read:
/// tap the text (or its empty state) and write, no modal form in between.
///
/// Three states:
///  - **has notes:** the text, tappable by the owner to edit in place; static (no tap target)
///    for anyone else, because a shared-in viewer's words are never this journey's to change.
///  - **empty, owner:** a question, not a labelled blank field — "What happened this day?" reads
///    as an invitation; "Notes" over nothing reads as an unfilled form.
///  - **empty, not owner:** nothing. A shared-in viewer has nothing to add, so — like every other
///    section in this stack — it self-hides rather than showing a prompt that would fail.
///
/// Saves go through `onSave`, which every host wires to `JourneyStore.updateWaypoint` — the same
/// write path `WaypointEditSheet` already uses, so CloudKit sync behaves exactly as it does for
/// any other edit. This view never talks to the store directly.
struct DayNotesField: View {
    let notes: String
    let isOwner: Bool
    var onSave: (String) -> Void

    @State private var isEditing = false
    @State private var draft = ""
    /// The whole point of this field is that writing feels inviting, and it did not: tapping the
    /// prompt opened an empty box that then had to be tapped AGAIN before the keyboard appeared.
    /// Focus has to be set after the editor exists, so it is deferred one run-loop turn — the same
    /// fix the creation sheet's name field needed for the same reason.
    @FocusState private var isFocused: Bool

    var body: some View {
        Group {
            if isEditing {
                editor
            } else if !notes.isEmpty {
                Button(action: beginEditing) {
                    Text(notes)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .disabled(!isOwner)
                .accessibilityLabel(isOwner ? "Day notes, tap to edit" : "Day notes")
                .accessibilityHint(isOwner ? "Opens the notes for editing" : "")
            } else if isOwner {
                emptyPrompt
            }
        }
    }

    /// The inviting empty state — a question, styled like the "add" affordances elsewhere in this
    /// stack (`DayPhotoStrip.AddTile`), not like a form field with nothing in it.
    private var emptyPrompt: some View {
        Button {
            draft = ""
            isEditing = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "square.and.pencil")
                    .font(.subheadline)
                    .foregroundStyle(Theme.accentText)
                Text("What happened this day?")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Theme.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Write what happened this day")
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            GlassTextEditor(text: $draft, minHeight: 80)
                .focused($isFocused)
            HStack(spacing: 16) {
                Button("Save") {
                    onSave(draft.trimmingCharacters(in: .whitespacesAndNewlines))
                    isEditing = false
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.accentText)

                Button("Cancel") { isEditing = false }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .onAppear {
            // Deferred: the editor is not in the responder chain in the tick it appears.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(50))
                isFocused = true
            }
        }
    }

    private func beginEditing() {
        guard isOwner else { return }
        draft = notes
        isEditing = true
    }
}
