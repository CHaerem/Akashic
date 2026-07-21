import SwiftUI

/// Contextual photo editor — the native counterpart to the web `PhotoEditModal`.
/// Edits caption, hero flag, rotation (90° steps), day/waypoint assignment and location,
/// plus delete. All writes go through `JourneyStore` (→ `PersistenceController`), which is
/// the same seam the CloudKit write path will use (D4).
///
/// Presented as a sheet from the photo grid's context menu and from the lightbox. On dismiss
/// it reports the resulting `Photo` (or `nil` when deleted) via `onChange` so a caller holding
/// a local copy (the lightbox pager) can update in place without a full reload.
struct PhotoEditSheet: View {
    @EnvironmentObject private var store: JourneyStore
    @Environment(\.dismiss) private var dismiss

    let photo: Photo
    let journey: Journey
    /// Called with the updated photo, or `nil` if the photo was deleted.
    var onChange: (Photo?) -> Void = { _ in }

    @State private var caption: String
    @State private var isHero: Bool
    @State private var rotation: Int
    @State private var waypointID: String?
    @State private var clearLocation = false
    @State private var confirmingDelete = false
    @State private var isSaving = false

    init(photo: Photo, journey: Journey, onChange: @escaping (Photo?) -> Void = { _ in }) {
        self.photo = photo
        self.journey = journey
        self.onChange = onChange
        _caption = State(initialValue: photo.caption ?? "")
        _isHero = State(initialValue: photo.isHero)
        _rotation = State(initialValue: photo.rotation)
        _waypointID = State(initialValue: photo.waypointId)
    }

    var body: some View {
        EditSheetScaffold(
            title: photo.isVideo ? "Edit Video" : "Edit Photo",
            saveTitle: "Save",
            isSaving: isSaving,
            onCancel: { dismiss() },
            onSave: save
        ) {
            preview
            captionSection
            assignmentSection
            heroSection
            if photo.coordinates != nil { locationSection }
            deleteSection
        }
    }

    // MARK: Preview + rotation

    private var preview: some View {
        VStack(spacing: 12) {
            GeometryReader { geo in
                ZStack {
                    if let url = photo.originalFileURL ?? photo.thumbnailFileURL {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case let .success(image):
                                // A quarter turn exchanges width/height: fit into the swapped
                                // box, rotate, then re-frame to the container so it stays fit.
                                image.resizable().scaledToFit()
                                    .frame(width: rotation == 90 || rotation == 270 ? geo.size.height : geo.size.width,
                                           height: rotation == 90 || rotation == 270 ? geo.size.width : geo.size.height)
                                    .rotationEffect(.degrees(Double(rotation)))
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .animation(.easeInOut(duration: 0.2), value: rotation)
                            default:
                                Image(systemName: "photo").font(.largeTitle).foregroundStyle(Theme.textTertiary)
                            }
                        }
                    } else {
                        Image(systemName: "photo").font(.largeTitle).foregroundStyle(Theme.textTertiary)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            .frame(height: 200)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            HStack(spacing: 12) {
                rotateButton(system: "rotate.left", label: "Rotate left") { rotation = normalize(rotation - 90) }
                rotateButton(system: "rotate.right", label: "Rotate right") { rotation = normalize(rotation + 90) }
            }
        }
    }

    private func rotateButton(system: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: system)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: Caption

    private var captionSection: some View {
        GlassField(label: "Caption", systemImage: "text.alignleft") {
            GlassTextEditor(text: $caption, minHeight: 80)
        }
    }

    // MARK: Assignment

    private var assignmentSection: some View {
        GlassField(label: "Day", systemImage: "calendar") {
            Menu {
                Button {
                    waypointID = nil
                } label: {
                    Label("Unassigned", systemImage: waypointID == nil ? "checkmark" : "")
                }
                ForEach(journey.camps) { camp in
                    Button {
                        waypointID = camp.id
                    } label: {
                        Label("Day \(camp.dayNumber) — \(camp.name)",
                              systemImage: waypointID == camp.id ? "checkmark" : "")
                    }
                }
            } label: {
                HStack {
                    Text(assignmentLabel)
                        .foregroundStyle(Theme.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption).foregroundStyle(Theme.textTertiary)
                }
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            }
        }
    }

    private var assignmentLabel: String {
        guard let waypointID, let camp = journey.camps.first(where: { $0.id == waypointID }) else {
            return "Unassigned"
        }
        return "Day \(camp.dayNumber) — \(camp.name)"
    }

    // MARK: Hero

    private var heroSection: some View {
        GlassField(label: "Cover", systemImage: "star") {
            Toggle(isOn: $isHero) {
                Text("Use as journey cover photo")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
            }
            .tint(Theme.accent)
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }

    // MARK: Location

    private var locationSection: some View {
        GlassField(label: "Location", systemImage: "mappin.and.ellipse") {
            VStack(alignment: .leading, spacing: 8) {
                if let coords = photo.coordinates, coords.count >= 2 {
                    Text(String(format: "%.5f, %.5f  ·  %@", coords[1], coords[0],
                                (photo.locationSource ?? "unknown").capitalized))
                        .font(.footnote.monospaced())
                        .foregroundStyle(Theme.textSecondary)
                }
                Toggle(isOn: $clearLocation) {
                    Text("Clear location").font(.subheadline).foregroundStyle(Theme.textPrimary)
                }
                .tint(Theme.accent)
            }
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }

    // MARK: Delete

    private var deleteSection: some View {
        Button(role: .destructive) {
            confirmingDelete = true
        } label: {
            Label("Delete \(photo.isVideo ? "video" : "photo")", systemImage: "trash")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .confirmationDialog("Delete this \(photo.isVideo ? "video" : "photo")?",
                            isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: performDelete)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the file and cannot be undone.")
        }
    }

    // MARK: Actions

    private func save() {
        isSaving = true
        store.setPhotoCaption(caption, forPhoto: photo.id)
        if rotation != photo.rotation { store.setPhotoRotation(rotation, forPhoto: photo.id) }
        if isHero != photo.isHero { store.setPhotoHero(isHero, forPhoto: photo.id) }
        if waypointID != photo.waypointId { store.assignPhoto(photo.id, toWaypoint: waypointID) }
        if clearLocation { store.setPhotoLocation(nil, forPhoto: photo.id) }
        let updated = store.photos(forJourneyID: journey.id).first { $0.id == photo.id }
        onChange(updated)
        dismiss()
    }

    private func performDelete() {
        store.deletePhoto(photo)
        onChange(nil)
        dismiss()
    }

    private func normalize(_ deg: Int) -> Int { ((deg % 360) + 360) % 360 }
}
