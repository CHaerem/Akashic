import SwiftUI

/// A horizontal strip of a day's photo thumbnails. Tapping one calls `onTap` with its index
/// (so the caller can open the lightbox at the right photo). Renders nothing when empty —
/// unless `onAdd` is supplied (edit mode), in which case a leading "+" tile is always shown so
/// media can be added to an empty day.
struct DayPhotoStrip: View {
    let photos: [Photo]
    var onTap: (Int) -> Void
    /// Edit hooks (nil = read-only). `onAdd` shows a "+" tile; `onEditPhoto` a context menu.
    var onAdd: (() -> Void)?
    var onEditPhoto: ((Photo) -> Void)?

    var body: some View {
        if !photos.isEmpty || onAdd != nil {
            VStack(alignment: .leading, spacing: 8) {
                SectionLabel(icon: "📷", title: "Photos", trailing: "\(photos.count)")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if let onAdd {
                            Button(action: onAdd) { AddTile() }
                                .buttonStyle(.plain)
                                .accessibilityLabel(Text("Add photos to this day",
                                                         comment: "Day photo strip: the add tile."))
                        }
                        ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                            Button { onTap(index) } label: {
                                StripThumbnail(photo: photo)
                            }
                            .buttonStyle(.plain)
                            // Position carries this one: the strip is a horizontal row where a
                            // VoiceOver user has no other way to know where they are in it.
                            .accessibilityLabel(Text("Photo \(index + 1) of \(photos.count)",
                                                     comment: "Day photo strip cell: position in the strip."))
                            .accessibilityHint(Text("Opens full screen.",
                                                    comment: "Day photo strip cell hint."))
                            .contextMenu {
                                if let onEditPhoto {
                                    Button { onEditPhoto(photo) } label: {
                                        Label("Edit…", systemImage: "slider.horizontal.3")
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                }
            }
        }
    }
}

/// The "add media" tile shown as the first cell of the strip in edit mode.
private struct AddTile: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.surfaceRaised)
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.accent.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
            VStack(spacing: 6) {
                Image(systemName: "photo.badge.plus").font(.title3).foregroundStyle(Theme.accent)
                Text("Add").font(.caption2).foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(width: 120, height: 120)
    }
}

/// A single 120×120 thumbnail cell loaded from the on-disk file URL, with a video badge.
/// Applies the stored `rotation` (0/90/180/270) as a display transform.
private struct StripThumbnail: View {
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
        .frame(width: 120, height: 120)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
        .overlay(alignment: .topLeading) {
            if photo.isHero {
                Image(systemName: "star.fill")
                    .font(.caption)
                    .foregroundStyle(.yellow)
                    .padding(6)
                    .shadow(radius: 2)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if photo.isVideo {
                Image(systemName: "play.circle.fill")
                    .font(.callout)
                    .foregroundStyle(.white)
                    .padding(6)
                    .shadow(radius: 2)
            }
        }
    }

    private func placeholder(icon: String) -> some View {
        ZStack {
            Theme.surfaceRaised
            Image(systemName: icon).foregroundStyle(Theme.textTertiary)
        }
    }
}
