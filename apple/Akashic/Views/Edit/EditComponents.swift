import SwiftUI

// Shared building blocks for the native, contextual editing sheets (photo / waypoint /
// journey / import). "Liquid-glass" language: translucent surfaces, hairline strokes,
// periwinkle accent — consistent with `Theme`, which now adapts with the system appearance
// instead of being fixed dark, so these sheets do too.

/// Standard sheet scaffold: adaptive background, inline title, Cancel + a primary action button.
/// `isSaving` swaps the action for a spinner; `saveDisabled` gates it.
struct EditSheetScaffold<Content: View>: View {
    let title: LocalizedStringKey
    var saveTitle: LocalizedStringKey = "Save"
    var saveDisabled: Bool = false
    var isSaving: Bool = false
    let onCancel: () -> Void
    let onSave: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    content()
                }
                .padding(20)
                .padding(.bottom, 40)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .foregroundStyle(Theme.textSecondary)
                        // QUA-10: see `A11yID`. `saveTitle` alone varies per sheet AND per state
                        // ("Save" / "Create" / "Done"), so the affirmative control of whichever
                        // sheet is on screen needs a stable handle for the UI tests.
                        .accessibilityIdentifier(A11yID.editSheetCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().tint(Theme.accent)
                    } else {
                        Button(saveTitle, action: onSave)
                            .fontWeight(.semibold)
                            .foregroundStyle(saveDisabled ? Theme.textTertiary : Theme.accent)
                            .disabled(saveDisabled)
                            .accessibilityIdentifier(A11yID.editSheetSave)
                    }
                }
            }
        }
        .presentationBackground(Theme.background)
    }
}

/// A labelled section wrapping arbitrary field content in a glass surface card.
struct GlassField<Content: View>: View {
    let label: LocalizedStringKey
    var systemImage: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let systemImage {
                    // QUA-24: the glyph restates the label ("flag" beside NAME, "globe" beside
                    // COUNTRY) — decoration, and SF Symbols carry their own accessibility
                    // descriptions, so leaving it visible makes VoiceOver announce the field twice.
                    Image(systemName: systemImage).font(.caption2).foregroundStyle(Theme.accent)
                        .accessibilityHidden(true)
                }
                // `.textCase(.uppercase)`, not `label.uppercased()`. The old form forced the
                // label to be a `String` — and a `String` handed to `Text` is displayed verbatim,
                // so every one of these field labels ("Name", "Country", "Elevation (m)") was
                // unreachable by localisation no matter what the catalogue said. The modifier
                // uppercases at render time and also does it locale-correctly.
                Text(label)
                    .textCase(.uppercase)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.textTertiary)
                    // "Summit elevation (m)" is already near the sheet width in English; the
                    // Norwegian "Topphøyde (m)" is shorter, but "Points of interest" ->
                    // "Interessepunkter" and "Historical sites" -> "Historiske steder" are not.
                    .fixedSize(horizontal: false, vertical: true)
                    // QUA-24: these labels are the structure of every edit sheet, so they are the
                    // right rotor stops — heading navigation jumps field to field instead of
                    // swiping through every control in between.
                    .accessibilityAddTraits(.isHeader)
            }
            content()
        }
    }
}

/// A single-line glass text field.
///
/// `accessibilityLabel` exists because the visible placeholder is frequently NOT a usable name for
/// the field: `GlassField(label: "Summit elevation (m)")` wraps a field whose placeholder is "0",
/// and the weather grid's are all "—". SwiftUI takes a `TextField`'s placeholder as its
/// accessibility label, so those announced as "0", "1" and "dash" — the enclosing `GlassField`
/// label is a sibling `Text` and never reaches the control. Pass the field's real name here
/// whenever the placeholder is an example or a stand-in rather than a name.
struct GlassTextField: View {
    let placeholder: LocalizedStringKey
    @Binding var text: String
    var keyboard: UIKeyboardType = .default
    var accessibilityLabel: LocalizedStringKey?

    var body: some View {
        TextField(placeholder, text: $text)
            .keyboardType(keyboard)
            .textFieldStyle(.plain)
            .foregroundStyle(Theme.textPrimary)
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
            .modifier(OptionalAccessibilityLabel(key: accessibilityLabel))
    }
}

/// A multi-line glass text editor.
///
/// A `TextEditor` has no placeholder at all, so it has no accessibility label either — VoiceOver
/// announces bare "text field" for the journey description and every day's notes. `label` is not
/// optional here for that reason.
struct GlassTextEditor: View {
    @Binding var text: String
    var minHeight: CGFloat = 96
    var label: LocalizedStringKey = "Text"

    var body: some View {
        TextEditor(text: $text)
            .scrollContentBackground(.hidden)
            .foregroundStyle(Theme.textPrimary)
            .frame(minHeight: minHeight)
            .padding(8)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Theme.hairline, lineWidth: 1)
            )
            .accessibilityLabel(label)
    }
}

/// Applies `.accessibilityLabel` only when there is one, leaving SwiftUI's own derived label
/// (a `TextField`'s placeholder) in place otherwise.
///
/// `.accessibilityLabel(key ?? placeholder)` cannot express that: `LocalizedStringKey` is not
/// `Equatable` or inspectable, so "no override" has to be the absence of the modifier rather than a
/// value passed through it.
private struct OptionalAccessibilityLabel: ViewModifier {
    let key: LocalizedStringKey?

    func body(content: Content) -> some View {
        if let key {
            content.accessibilityLabel(key)
        } else {
            content
        }
    }
}

/// Add/remove chip editor for a list of short strings (highlights). Mirrors the web
/// `WaypointEditModal` highlights (there a newline-separated textarea; here first-class chips).
struct HighlightChipsEditor: View {
    @Binding var items: [String]
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !items.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                        HStack(spacing: 6) {
                            Text(item)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Theme.accent)
                            Button {
                                items.remove(at: index)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.caption2)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                            .buttonStyle(.plain)
                            // QUA-24: names what it removes. A chip row's delete used to be an
                            // unlabelled glyph, so a screenful of highlights was a screenful of
                            // identical "button" announcements with no way to tell them apart.
                            .accessibilityLabel(Text("Remove \(item)"))
                        }
                        .padding(.vertical, 5)
                        .padding(.horizontal, 10)
                        .background(Theme.accentSoft, in: Capsule())
                    }
                }
            }
            HStack(spacing: 8) {
                TextField("Add a highlight", text: $draft)
                    .textFieldStyle(.plain)
                    .foregroundStyle(Theme.textPrimary)
                    .onSubmit(commit)
                    .padding(10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(Theme.hairline, lineWidth: 1)
                    )
                Button(action: commit) {
                    Image(systemName: "plus")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.onAccent)
                        .frame(width: 40, height: 40)
                        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(draft.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
                .accessibilityLabel("Add highlight")
            }
        }
    }

    private func commit() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        items.append(trimmed)
        draft = ""
    }
}

/// A minimal flowing (wrapping) layout for chips — avoids pulling in any dependency.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rows: [[CGSize]] = [[]]
        var x: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, !rows[rows.count - 1].isEmpty {
                rows.append([]); x = 0
            }
            rows[rows.count - 1].append(size)
            x += size.width + spacing
        }
        let height = rows.reduce(0) { partial, row in
            partial + (row.map(\.height).max() ?? 0) + spacing
        } - (rows.isEmpty ? 0 : spacing)
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: max(height, 0))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        let maxWidth = bounds.width
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// A small thumbnail loaded from a photo's on-disk file URL, with rotation applied — reused by
/// the edit and assignment sheets. `size` is the square edge length.
struct EditablePhotoThumb: View {
    let photo: Photo
    var size: CGFloat = 72

    var body: some View {
        ZStack {
            if let url = photo.thumbnailFileURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                            .rotationEffect(.degrees(Double(photo.rotation)))
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
        .overlay(alignment: .bottomTrailing) {
            if photo.isVideo {
                Image(systemName: "play.circle.fill")
                    .font(.caption2).foregroundStyle(.white).padding(3).shadow(radius: 2)
            }
        }
        // QUA-24: the row this sits in already announces "Video" and the day assignment, and the
        // image itself is a thumbnail no screen reader can describe — so it is decoration here
        // rather than a second, emptier announcement of the same item.
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack { Theme.surfaceRaised; Image(systemName: "photo").foregroundStyle(Theme.textTertiary) }
    }
}
