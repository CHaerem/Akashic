import SwiftUI

/// A per-journey photo grid grouped by day (with an "Unassigned" group for photos the
/// 4-tier `PhotoDayMatcher` could not place). Tapping a thumbnail opens the full-screen
/// lightbox scoped to that group. Supersedes the Import module's debug grid, adding the
/// lightbox and richer section headers; `ImportBrowserView` stays for the Settings path.
///
/// Editing (Phase 3): a toolbar "+" adds media via `PhotoImportSheet`, and each thumbnail's
/// context menu offers the quick edits (cover / rotate / assign / delete) plus a full editor.
struct PhotosGridView: View {
    @EnvironmentObject private var store: JourneyStore
    @EnvironmentObject private var entitlements: EntitlementStore
    let journeyID: String

    @State private var lightbox: LightboxData?
    @State private var editingPhoto: Photo?
    @State private var placingPhoto: Photo?
    @State private var movingPhoto: Photo?
    @State private var showImport = false
    @State private var photoPendingDelete: Photo?
    /// QUA-96: bulk correction. 939 of the owner's Kilimanjaro photographs have no day, and one
    /// sheet each is not a workflow anyone finishes.
    @State private var isSelecting = false
    @State private var selection: Set<String> = []

    private let columns = [GridItem(.adaptive(minimum: 108), spacing: 4)]

    var body: some View {
        let grouped = store.photosByDay(forJourneyID: journeyID)
        let days = grouped.byDay.keys.sorted()
        let journey = store.journey(withID: journeyID)

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20, pinnedViews: [.sectionHeaders]) {
                ForEach(days, id: \.self) { day in
                    section(
                        title: "Day \(day)",
                        subtitle: camp(in: journey, day: day)?.name,
                        photos: grouped.byDay[day] ?? [],
                        // Resolved here, not passed as a literal: `dayLabel` is a `String` (it ends
                        // up in `Text(verbatim:)`-equivalent position inside the lightbox), so the
                        // same literal that localises fine as `title` above would ship English.
                        dayLabel: String(localized: "Day \(day)",
                                         comment: "Photo lightbox: badge naming the day a photo belongs to."),
                        journey: journey
                    )
                }
                if !grouped.unassigned.isEmpty {
                    section(title: "Unassigned",
                            subtitle: String(localized: "Not matched to a day",
                                             comment: "Photo grid: subtitle of the section holding photos with no day."),
                            photos: grouped.unassigned, dayLabel: nil, journey: journey)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(journey?.shortName ?? "Photos")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if isSelecting { selectionBar(journey: journey) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showImport = true } label: {
                    Image(systemName: "plus")
                }
                .tint(Theme.accent)
                .accessibilityLabel(Text("Add photos", comment: "Photo grid toolbar button."))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isSelecting.toggle()
                    if !isSelecting { selection.removeAll() }
                } label: {
                    Text(isSelecting ? "Done" : "Select")
                }
                .tint(Theme.accent)
            }
        }
        .fullScreenCover(item: $lightbox) { data in
            PhotoLightboxView(data: data, journey: journey)
                .environmentObject(store)
        }
        .sheet(item: $editingPhoto) { photo in
            if let journey {
                PhotoEditSheet(photo: photo, journey: journey).environmentObject(store)
            }
        }
        .sheet(item: $placingPhoto) { photo in
            PhotoPlacementSheet(
                startCoordinate: photo.coordinates,
                fallbackCoordinate: placementFallback(for: photo, journey: journey),
                onSave: { store.setPhotoLocation($0, source: "manual", forPhoto: photo.id) })
        }
        .sheet(item: $movingPhoto) { photo in
            if let journey {
                MovePhotoToDaySheet(photo: photo, journey: journey).environmentObject(store)
            }
        }
        .sheet(isPresented: $showImport) {
            if let journey {
                PhotoImportSheet(journey: journey).environmentObject(store).environmentObject(entitlements)
            }
        }
        .confirmationDialog("Delete this photo?", isPresented: deleteDialogPresented,
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let photoPendingDelete { store.deletePhoto(photoPendingDelete) }
                photoPendingDelete = nil
            }
            Button("Cancel", role: .cancel) { photoPendingDelete = nil }
        } message: {
            Text("This removes the file and cannot be undone.")
        }
    }

    private var deleteDialogPresented: Binding<Bool> {
        Binding(get: { photoPendingDelete != nil },
                set: { if !$0 { photoPendingDelete = nil } })
    }

    /// The bulk-correction bar (QUA-96).
    ///
    /// Inline, and it presents **nothing** — deliberately. This view already carries six presentation
    /// modifiers, and this project's own notes record a fourth on one view breaking presentation for
    /// the whole view; that contradiction is unresolved (see the ledger note on QUA-96), so the safe
    /// move is not to add a seventh. It also happens to be the better interaction for a bulk edit:
    /// the day chips apply immediately, with no modal round-trip per correction.
    @ViewBuilder
    private func selectionBar(journey: Journey?) -> some View {
        let days = (journey?.camps ?? []).sorted { $0.dayNumber < $1.dayNumber }
        VStack(alignment: .leading, spacing: 8) {
            Text("\(selection.count) selected")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(days, id: \.id) { camp in
                        Button("Day \(camp.dayNumber)") {
                            apply { store.assignPhotos(Array(selection), toWaypoint: camp.id) }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Theme.accent)
                    }
                    Button("Unassign") {
                        apply { store.assignPhotos(Array(selection), toWaypoint: nil) }
                    }
                    .buttonStyle(.bordered)
                    Button("Clear location") {
                        apply { store.setPhotoLocation(nil, forPhotos: Array(selection)) }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, 2)
            }
        }
        .disabled(selection.isEmpty)
        .padding(12)
        .background(.bar)
    }

    /// Run a bulk correction and drop the selection, so a second tap cannot silently re-apply to a
    /// set the customer believes they have already dealt with.
    private func apply(_ action: () -> Int) {
        _ = action()
        selection.removeAll()
    }

    /// `subtitle` stays a `String?`: in the per-day sections it is the camp's own name, which is
    /// the customer's data and must not go near the catalogue. Only the Unassigned section passes
    /// prose, and it resolves it at the call site.
    private func section(title: LocalizedStringKey, subtitle: String?, photos: [Photo],
                         dayLabel: String?, journey: Journey?) -> some View {
        Section {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    Button {
                        if isSelecting {
                            // Toggling, not opening: while selecting, a tap must never take someone
                            // out of a half-built selection into a full-screen viewer.
                            if selection.contains(photo.id) { selection.remove(photo.id) }
                            else { selection.insert(photo.id) }
                        } else {
                            lightbox = LightboxData(photos: photos, startIndex: index, dayLabel: dayLabel)
                        }
                    } label: {
                        GridThumbnail(photo: photo)
                            .overlay(alignment: .topLeading) {
                                if isSelecting {
                                    Image(systemName: selection.contains(photo.id)
                                          ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, selection.contains(photo.id)
                                                         ? Theme.accent : .black.opacity(0.35))
                                        .padding(6)
                                        .accessibilityHidden(true)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    // The selected state is a TRAIT, not words in the label: appending "selected" to
                    // a caption would make it part of the photograph's identity to VoiceOver.
                    .accessibilityAddTraits(selection.contains(photo.id) ? [.isSelected] : [])
                    // A thumbnail button announces nothing on its own. The caption is the only thing
                    // that tells one photograph from another, and the position is what keeps a
                    // VoiceOver user oriented in a grid of hundreds — so both, and the video/hero
                    // state as traits rather than words baked into the label.
                    .accessibilityLabel(photoLabel(photo, index: index, of: photos.count))
                    .accessibilityHint(Text("Opens full screen.",
                                            comment: "Photo grid cell hint."))
                    .contextMenu { photoMenu(photo, journey: journey) }
                }
            }
        } header: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(.headline).foregroundStyle(Theme.textPrimary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.caption).foregroundStyle(Theme.textTertiary).lineLimit(1)
                }
                Spacer()
                Text("\(photos.count)").font(.subheadline).foregroundStyle(Theme.textTertiary)
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.background)
        }
    }

    /// What a screen reader says for one grid cell.
    ///
    /// Caption first when there is one, because it is the only thing that identifies the photograph;
    /// otherwise the position carries it. "Video" is stated rather than left to a trait because
    /// whether tapping starts playback is the thing a user most needs to know before tapping.
    private func photoLabel(_ photo: Photo, index: Int, of total: Int) -> Text {
        let position = String(localized: "Photo \(index + 1) of \(total)",
                              comment: "Photo grid cell accessibility label: position within the grid.")
        var parts: [String] = []
        if let caption = photo.caption?.trimmingCharacters(in: .whitespacesAndNewlines),
           !caption.isEmpty {
            parts.append(caption)
        }
        parts.append(position)
        if photo.isVideo {
            parts.append(String(localized: "Video",
                                comment: "Photo grid cell accessibility label: this item is a video."))
        }
        if photo.isHero {
            parts.append(String(localized: "Cover photo",
                                comment: "Photo grid cell accessibility label: this is the journey's hero image."))
        }
        return Text(parts.joined(separator: ", "))
    }

    @ViewBuilder
    private func photoMenu(_ photo: Photo, journey: Journey?) -> some View {
        Button { editingPhoto = photo } label: { Label("Edit…", systemImage: "slider.horizontal.3") }

        Button {
            store.setPhotoHero(!photo.isHero, forPhoto: photo.id)
        } label: {
            Label(photo.isHero ? "Remove as cover" : "Set as cover",
                  systemImage: photo.isHero ? "star.slash" : "star")
        }

        Button {
            store.setPhotoRotation(photo.rotation + 90, forPhoto: photo.id)
        } label: {
            Label("Rotate right", systemImage: "rotate.right")
        }

        Button { placingPhoto = photo } label: {
            Label("Adjust location", systemImage: "mappin.and.ellipse")
        }

        if journey != nil {
            Button { movingPhoto = photo } label: {
                Label("Move to day…", systemImage: "calendar")
            }
        }

        Divider()
        Button(role: .destructive) { photoPendingDelete = photo } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private func camp(in journey: Journey?, day: Int) -> Camp? {
        journey?.camps.first { $0.dayNumber == day }
    }

    /// Opening coordinate for a photo with no GPS: its assigned day's camp, else journey centre.
    private func placementFallback(for photo: Photo, journey: Journey?) -> [Double]? {
        if let journey, let wpID = photo.waypointId,
           let camp = journey.camps.first(where: { $0.id == wpID }), camp.coordinates.count >= 2 {
            return camp.coordinates
        }
        return journey?.center
    }
}

/// Square thumbnail cell for the grid, loaded from the on-disk file URL. Applies the stored
/// `rotation` (0/90/180/270) as a display transform.
private struct GridThumbnail: View {
    let photo: Photo

    var body: some View {
        ZStack {
            if let url = photo.thumbnailFileURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                            .rotationEffect(.degrees(Double(photo.rotation)))
                    case .failure:
                        placeholder(icon: "exclamationmark.triangle")
                    case .empty:
                        placeholder(icon: "photo")
                    @unknown default:
                        placeholder(icon: "photo")
                    }
                }
            } else {
                placeholder(icon: "icloud.and.arrow.down")
            }
        }
        .aspectRatio(1, contentMode: .fill)
        .frame(minWidth: 0, maxWidth: .infinity)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(alignment: .topLeading) {
            if photo.isHero {
                Image(systemName: "star.fill")
                    .font(.caption2)
                    .foregroundStyle(.yellow)
                    .padding(4)
                    .shadow(radius: 2)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if photo.isVideo {
                Image(systemName: "play.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.white)
                    .padding(4)
                    .shadow(radius: 2)
            }
        }
    }

    private func placeholder(icon: String) -> some View {
        ZStack {
            Theme.surface
            Image(systemName: icon).foregroundStyle(Theme.textTertiary)
        }
        .aspectRatio(1, contentMode: .fill)
    }
}
