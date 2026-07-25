import SwiftUI

// Shared building blocks for the native, contextual editing sheets (photo / waypoint /
// journey / import). "Liquid-glass" language: translucent surfaces, hairline strokes,
// periwinkle accent — consistent with `Theme`, which now adapts with the system appearance
// instead of being fixed dark, so these sheets do too.

/// Standard sheet scaffold: adaptive background, inline title, Cancel + a primary action button.
/// `isSaving` swaps the action for a spinner; `saveDisabled` gates it.
struct EditSheetScaffold<Content: View>: View {
    let title: String
    var saveTitle: String = "Save"
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
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView().tint(Theme.accent)
                    } else {
                        Button(saveTitle, action: onSave)
                            .fontWeight(.semibold)
                            .foregroundStyle(saveDisabled ? Theme.textTertiary : Theme.accent)
                            .disabled(saveDisabled)
                    }
                }
            }
        }
        .presentationBackground(Theme.background)
    }
}

/// A labelled section wrapping arbitrary field content in a glass surface card.
struct GlassField<Content: View>: View {
    let label: String
    var systemImage: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage).font(.caption2).foregroundStyle(Theme.accent)
                }
                Text(label.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(Theme.textTertiary)
            }
            content()
        }
    }
}

/// A single-line glass text field.
struct GlassTextField: View {
    let placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .default

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
    }
}

/// A multi-line glass text editor.
struct GlassTextEditor: View {
    @Binding var text: String
    var minHeight: CGFloat = 96

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
    }

    private var placeholder: some View {
        ZStack { Theme.surfaceRaised; Image(systemName: "photo").foregroundStyle(Theme.textTertiary) }
    }
}
