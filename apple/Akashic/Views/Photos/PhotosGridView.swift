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
    @State private var showImport = false
    @State private var photoPendingDelete: Photo?

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
                        dayLabel: "Day \(day)",
                        journey: journey
                    )
                }
                if !grouped.unassigned.isEmpty {
                    section(title: "Unassigned", subtitle: "Not matched to a day",
                            photos: grouped.unassigned, dayLabel: nil, journey: journey)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(journey?.shortName ?? "Photos")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showImport = true } label: {
                    Image(systemName: "plus")
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

    private func section(title: String, subtitle: String?, photos: [Photo],
                         dayLabel: String?, journey: Journey?) -> some View {
        Section {
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    Button {
                        lightbox = LightboxData(photos: photos, startIndex: index, dayLabel: dayLabel)
                    } label: {
                        GridThumbnail(photo: photo)
                    }
                    .buttonStyle(.plain)
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

        if let journey {
            Menu {
                Button {
                    store.assignPhoto(photo.id, toWaypoint: nil)
                } label: {
                    Label("Unassigned", systemImage: photo.waypointId == nil ? "checkmark" : "")
                }
                ForEach(journey.camps) { camp in
                    Button {
                        store.assignPhoto(photo.id, toWaypoint: camp.id)
                    } label: {
                        Label("Day \(camp.dayNumber) — \(camp.name)",
                              systemImage: photo.waypointId == camp.id ? "checkmark" : "")
                    }
                }
            } label: {
                Label("Assign to day", systemImage: "calendar")
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
