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
    // Manual placement — local mirror of the coordinate so the readout updates in place after the
    // placement sheet writes through the store.
    @State private var currentCoordinates: [Double]?
    @State private var currentSource: String?
    @State private var showPlacement = false

    init(photo: Photo, journey: Journey, onChange: @escaping (Photo?) -> Void = { _ in }) {
        self.photo = photo
        self.journey = journey
        self.onChange = onChange
        _caption = State(initialValue: photo.caption ?? "")
        _isHero = State(initialValue: photo.isHero)
        _rotation = State(initialValue: photo.rotation)
        _waypointID = State(initialValue: photo.waypointId)
        _currentCoordinates = State(initialValue: photo.coordinates)
        _currentSource = State(initialValue: photo.locationSource)
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
            locationSection
            deleteSection
        }
        .sheet(isPresented: $showPlacement) {
            PhotoPlacementSheet(
                startCoordinate: currentCoordinates,
                fallbackCoordinate: placementFallback,
                onSave: applyManualLocation)
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

    private func rotateButton(system: String, label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: system)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .themedMaterial(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
            VStack(alignment: .leading, spacing: 10) {
                if let coords = currentCoordinates, coords.count >= 2 {
                    Text(String(format: "%.5f, %.5f  ·  %@", coords[1], coords[0],
                                (currentSource ?? "unknown").capitalized))
                        .font(.footnote.monospaced())
                        .foregroundStyle(Theme.textSecondary)
                } else {
                    Text("No location").font(.footnote).foregroundStyle(Theme.textTertiary)
                }
                Button {
                    clearLocation = false
                    showPlacement = true
                } label: {
                    Label(currentCoordinates == nil ? "Place on map" : "Adjust location",
                          systemImage: "mappin.and.ellipse")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.accent)
                }
                .buttonStyle(.plain)
                if currentCoordinates != nil {
                    Toggle(isOn: $clearLocation) {
                        Text("Clear location").font(.subheadline).foregroundStyle(Theme.textPrimary)
                    }
                    .tint(Theme.accent)
                }
            }
            .padding(12)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
    }

    /// Where the placement map opens when the photo has no coordinate: the assigned day's camp
    /// coordinate, else the journey's centre.
    private var placementFallback: [Double]? {
        if let waypointID, let camp = journey.camps.first(where: { $0.id == waypointID }),
           camp.coordinates.count >= 2 {
            return camp.coordinates
        }
        return journey.center
    }

    /// Write a manually placed coordinate straight through the store (records `locationSource =
    /// "manual"`), mirror it locally for the readout, and report the fresh photo to the presenter.
    private func applyManualLocation(_ coordinate: [Double]) {
        guard coordinate.count >= 2 else { return }
        clearLocation = false
        _ = store.setPhotoLocation(coordinate, source: "manual", forPhoto: photo.id)
        currentCoordinates = coordinate
        currentSource = "manual"
        let updated = store.photos(forJourneyID: journey.id).first { $0.id == photo.id }
        onChange(updated)
    }

    // MARK: Delete

    private var deleteSection: some View {
        Button(role: .destructive) {
            confirmingDelete = true
        } label: {
            // Two whole keys, not one key with the noun interpolated into it. The old form
            // ("Delete \(isVideo ? "video" : "photo")") produced the catalogue key "Delete %@" and
            // substituted the English noun into it verbatim, so a Norwegian read "Slett photo" —
            // a half-translated sentence, which is worse than either language alone. Interpolating
            // a *word* into a `LocalizedStringKey` is always this bug; only values belong there.
            Label(photo.isVideo ? "Delete video" : "Delete photo", systemImage: "trash")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .confirmationDialog(photo.isVideo ? "Delete this video?" : "Delete this photo?",
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
