import SwiftUI

/// Demo browser for imported data: lists journeys and, per journey, a day-grouped photo
/// grid rendered from thumbnails on disk (resolved during import). Reachable from Settings.
///
/// This lives in the Import module (not the shared Views layer) so the import feature is
/// self-contained; the main Journeys tab already renders the imported journeys + days.
struct ImportBrowserView: View {
    @EnvironmentObject private var store: JourneyStore

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(store.journeys) { journey in
                    NavigationLink {
                        JourneyPhotosView(journeyID: journey.id)
                    } label: {
                        journeyRow(journey)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Imported photos")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func journeyRow(_ journey: Journey) -> some View {
        let count = store.photos(forJourneyID: journey.id).count
        return HStack(spacing: 12) {
            Text(journey.countryFlag).font(.system(size: 28))
            VStack(alignment: .leading, spacing: 2) {
                Text(journey.shortName).font(.headline).foregroundStyle(Theme.textPrimary)
                Text("\(count) photos · \(journey.camps.count) days")
                    .font(.footnote).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Theme.textTertiary)
        }
        .padding(14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }
}

/// Per-journey photo grid, grouped by day via `PhotoDayMatcher`.
struct JourneyPhotosView: View {
    @EnvironmentObject private var store: JourneyStore
    let journeyID: String

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: 4)]

    var body: some View {
        let grouped = store.photosByDay(forJourneyID: journeyID)
        let days = grouped.byDay.keys.sorted()

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18, pinnedViews: [.sectionHeaders]) {
                ForEach(days, id: \.self) { day in
                    section(title: "Day \(day)", photos: grouped.byDay[day] ?? [])
                }
                if !grouped.unassigned.isEmpty {
                    section(title: "Unassigned", photos: grouped.unassigned)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 16)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(store.journey(withID: journeyID)?.shortName ?? "Photos")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func section(title: String, photos: [Photo]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title).font(.headline).foregroundStyle(Theme.textPrimary)
                Spacer()
                Text("\(photos.count)").font(.subheadline).foregroundStyle(Theme.textTertiary)
            }
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(photos) { photo in
                    PhotoThumbnail(photo: photo)
                }
            }
        }
    }
}

/// A single thumbnail cell loaded from the resolved on-disk file URL, with graceful
/// fallbacks for missing bytes and a badge for videos.
struct PhotoThumbnail: View {
    let photo: Photo

    var body: some View {
        ZStack {
            if let url = photo.thumbnailFileURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
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
        .frame(width: 96, height: 96)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
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
    }
}

#Preview {
    NavigationStack { ImportBrowserView() }
        .environmentObject(JourneyStore(persistence: .preview))
        .preferredColorScheme(.dark)
}
