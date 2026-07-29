import SwiftUI

/// S1 — the story view: one journey, read top to bottom, as chapters.
///
/// This is the "finished thing" the whole S-series reframe is about (DESIGN-PLAN.md §S-series):
/// today a journey is a live database behind a map and a stack of edit sheets, and nothing in the
/// app is ever *done*. This screen is what makes it done — a cover, then one chapter per day, each
/// showing exactly the section stack `DayDetailSheet` already renders (`DayChapterSections`), so a
/// family can hand a phone to a grandparent and have them read the trip like a book instead of
/// having to drive a map.
///
/// Re-assembly, not a new design: the layout mirrors the web's `JourneyTimeline` + `DayChapter`
/// (`src/components/journey/*.tsx`) — cover, then day cards with a hero photo up top and the same
/// content sections below it.
struct JourneyStoryView: View {
    @EnvironmentObject private var store: JourneyStore
    let journey: Journey

    @State private var lightbox: LightboxData?

    /// QUA-77: the PDF-book render lifecycle. `.ready` holds the written file for ShareLink.
    private enum PDFBookState: Equatable {
        case idle, rendering, ready(URL), failed
    }
    @State private var pdfBookState: PDFBookState = .idle

    /// True when this journey lives in our own database — a shared-in viewer reads exactly the
    /// same story but never sees the notes' write affordance (S3).
    private var isOwner: Bool { store.isOwnedByCurrentUser(journeyID: journey.id) }

    /// The freshest copy so a note written on one chapter is reflected the instant the store
    /// reloads, same reasoning as `JourneyDetailView.live`.
    private var live: Journey { store.journey(withID: journey.id) ?? journey }

    /// Chronological order regardless of whether a route exists to derive it from — a photos-only
    /// diary (no route yet) must still read start-to-finish. Mirrors the web
    /// `JourneyTimeline.sortedCamps`.
    private var orderedCamps: [Camp] { live.camps.sorted { $0.dayNumber < $1.dayNumber } }

    private var journeyPhotos: [Photo] { store.photos(forJourneyID: live.id) }

    var body: some View {
        let live = self.live
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                coverHeader(live)

                ForEach(orderedCamps) { camp in
                    StoryChapterCard(
                        camp: camp,
                        photos: store.photos(forDay: camp.dayNumber, journeyID: live.id),
                        dateLabel: Formatters.dayDate(dateStarted: live.dateStarted, dayNumber: camp.dayNumber),
                        isOwner: isOwner,
                        onNotesSave: { saveNotes($0, camp: camp) },
                        onPhotoTap: { photos, index in
                            lightbox = LightboxData(photos: photos, startIndex: index,
                                                    dayLabel: String(localized: "Day \(camp.dayNumber)",
                                                                     comment: "Photo lightbox: badge naming the day a photo belongs to."),
                                                    dateLabel: Formatters.dayDate(dateStarted: live.dateStarted,
                                                                                  dayNumber: camp.dayNumber))
                        }
                    )
                }

                if !orderedCamps.isEmpty {
                    journeyComplete(live)
                }
            }
            .padding(16)
            .padding(.bottom, 40)
            // D2: this is the "finished thing" a family hands to a grandparent (S1) and the
            // screenshot that sells the book-alternative thesis — a chapter's photo-plus-prose
            // stretched across 13" of iPad is the opposite of a book page, so cap it like one.
            .constrainedReadingWidth()
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(live.shortName)
        .navigationBarTitleDisplayMode(.inline)
        // QUA-77: the book's entry point. StoryPDFRenderer + StoryPagination shipped complete and
        // tested under DIFF-07 (6 dev-days, the largest DIFF item) with ZERO production callers —
        // the store-subtitle strategy anchors on the book and no customer could create one. The
        // reader is already ON the finished thing here; saving it as the book is one tap.
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { pdfBookButton }
        }
        .fullScreenCover(item: $lightbox) { data in
            PhotoLightboxView(data: data, journey: live).environmentObject(store)
        }
    }

    // MARK: - PDF book (QUA-77)

    /// Per-day photo budget for the book: the opening spread plus one photo page. Accepted
    /// curation (DIFF-04/06) applies itself by writing `sortOrder` — the best photos already sort
    /// first — so a prefix IS the curated best-of, exactly the input `StoryPagination`'s doc asks
    /// for ("a 939-photo journey with 449 unique images produces a book nobody wants" otherwise).
    private static let bookPhotosPerDay =
        StoryPagination.photosOnOpeningPage + StoryPagination.photosPerPhotoPage

    @ViewBuilder
    private var pdfBookButton: some View {
        switch pdfBookState {
        case .idle, .failed:
            Button {
                renderPDFBook()
            } label: {
                Label("Save as PDF book", systemImage: "book.closed")
            }
            .accessibilityHint("Renders this story as a printable PDF")
        case .rendering:
            ProgressView()
                .accessibilityLabel("Rendering the PDF book")
        case .ready(let url):
            ShareLink(item: url) {
                Label("Share PDF book", systemImage: "square.and.arrow.up")
            }
        }
    }

    private func renderPDFBook() {
        guard pdfBookState != .rendering else { return }
        pdfBookState = .rendering
        let journey = live
        let (byDay, _) = store.photosByDay(forJourneyID: journey.id)
        let curated = byDay.mapValues { photos in
            Array(photos.sorted { $0.sortOrder < $1.sortOrder }.prefix(Self.bookPhotosPerDay))
        }
        let hero = journeyPhotos.first(where: { $0.isHero }) ?? journeyPhotos.first
        Task {
            guard let data = await StoryPDFRenderer.render(journey: journey,
                                                           photosByDay: curated,
                                                           heroPhoto: hero) else {
                pdfBookState = .failed
                return
            }
            do {
                let workspace = try ExportWorkspace.make()
                let url = workspace.appendingPathComponent("\(journey.slug)-book.pdf")
                try data.write(to: url)
                pdfBookState = .ready(url)
            } catch {
                pdfBookState = .failed
            }
        }
    }

    // MARK: - Cover header

    /// Hero, title, dates, country — "this is a finished thing" (S1). Prefers the journey's
    /// flagged hero photo, falling back to the first photo the same way `JourneyStore`'s widget
    /// snapshot already picks a thumbnail, and to a plain gradient when there are no photos yet
    /// (a photos-only diary mid-way through being written is still a valid state to read).
    private func coverHeader(_ live: Journey) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            coverImage
            VStack(alignment: .leading, spacing: 8) {
                Text(live.shortName)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                HStack(spacing: 8) {
                    Text(live.countryFlag)
                    Text(live.country).foregroundStyle(Theme.textSecondary)
                    if let dates = Formatters.dateRange(live.dateStarted, live.dateEnded) {
                        Text("·").foregroundStyle(Theme.textTertiary)
                        Text(dates).foregroundStyle(Theme.textSecondary)
                    }
                }
                .font(.subheadline)
            }
            .padding(20)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var coverImage: some View {
        ZStack {
            // The thumbnail, not the original, mirrors the web cover's own rationale (see
            // `DayChapter.tsx`): a cover only needs to read at card size, and the thumbnail
            // survives an original being repacked out of its record.
            if let hero = journeyPhotos.first(where: { $0.isHero }) ?? journeyPhotos.first,
               let url = hero.thumbnailFileURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        Theme.heroGradient
                    }
                }
            } else {
                Theme.heroGradient
                Image(systemName: "book.pages")
                    .font(.largeTitle)
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .frame(height: 200)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    // MARK: - Closing card

    /// The web timeline ends on a small "Journey Complete" summary card; keeping it gives the
    /// story an actual ending instead of just running out of days.
    private func journeyComplete(_ live: Journey) -> some View {
        VStack(spacing: 6) {
            Text("JOURNEY COMPLETE")
                .font(.caption2.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.textTertiary)
            if !live.route.coordinates.isEmpty {
                Text(Formatters.distanceKm(live.stats.totalDistance))
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
            }
            Text(summaryLine(live))
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func summaryLine(_ live: Journey) -> String {
        var parts = [String(localized: "\(live.stats.duration) days",
                            comment: "Journey story header: how many days the trip lasted.")]
        if let summit = live.stats.highestPoint {
            parts.append(String(localized: "Summit: \(Formatters.meters(summit.elevation))",
                                comment: "Journey story header: the highest point reached, e.g. \"Summit: 5 895 m\"."))
        }
        return parts.joined(separator: " · ")
    }

    // MARK: - Writes

    /// S3's write path — identical to `DayDetailSheet.saveNotes`: through `JourneyStore.updateWaypoint`
    /// so a note written from the story reads back exactly like one written from the day sheet.
    private func saveNotes(_ text: String, camp: Camp) {
        store.updateWaypoint(id: camp.id, name: camp.name, description: text,
                             highlights: camp.highlights, elevation: camp.elevation,
                             dayNumber: camp.dayNumber)
    }
}

/// One day chapter: a hero photo (if the day has one), then `DayChapterSections` — the same
/// stack `DayDetailSheet` renders, minus the photo-strip edit hooks (a story is read, not edited
/// from here) and swapping the shared header rules for a static one (no chevron nav; the chapters
/// are read by scrolling, not by paging).
private struct StoryChapterCard: View {
    let camp: Camp
    let photos: [Photo]
    let dateLabel: String?
    let isOwner: Bool
    var onNotesSave: (String) -> Void
    var onPhotoTap: ([Photo], Int) -> Void

    private var heroPhoto: Photo? { photos.first(where: { $0.isHero }) ?? photos.first }
    private var stripPhotos: [Photo] {
        guard let heroPhoto else { return photos }
        return photos.filter { $0.id != heroPhoto.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let heroPhoto {
                heroImage(heroPhoto)
            }
            VStack(alignment: .leading, spacing: 16) {
                StoryChapterHeader(camp: camp, dateLabel: dateLabel)

                DayChapterSections(
                    camp: camp,
                    photos: stripPhotos,
                    isOwner: isOwner,
                    onNotesSave: onNotesSave,
                    onPhotoTap: { index in
                        // The hero photo (shown above, outside the strip) occupies slot 0 in the
                        // lightbox's day-photo list, so an index into `stripPhotos` needs +1 —
                        // same adjustment the web `DayChapter.onPhotoClick` makes.
                        onPhotoTap(photos, heroPhoto != nil ? index + 1 : index)
                    }
                )
            }
            .padding(20)
        }
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func heroImage(_ photo: Photo) -> some View {
        ZStack(alignment: .topLeading) {
            if let url = photo.thumbnailFileURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        Theme.surfaceRaised
                    }
                }
            } else {
                Theme.surfaceRaised
            }

            Text("DAY \(camp.dayNumber)")
                .font(.caption2.weight(.bold))
                .tracking(1)
                .foregroundStyle(Theme.textPrimary)
                .padding(.vertical, 6)
                .padding(.horizontal, 10)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(10)
        }
        .frame(height: 200)
        .frame(maxWidth: .infinity)
        .clipped()
        .contentShape(Rectangle())
        .onTapGesture {
            guard let index = photos.firstIndex(where: { $0.id == photo.id }) else { return }
            onPhotoTap(photos, index)
        }
    }
}

/// A chapter's own kicker/title/date/elevation — `DayRow`'s day-badge language (JourneyDetailView)
/// rather than `DayDetailSheet`'s chevron header, because chapters are scrolled past, not paged
/// between.
private struct StoryChapterHeader: View {
    let camp: Camp
    let dateLabel: String?

    /// The day badge was sized to fit a fixed 46 pt square around a `.title3` digit — same
    /// reasoning as `DayRow.dayBadgeSize`, which this mirrors.
    @ScaledMetric(relativeTo: .title3) private var dayBadgeSize: CGFloat = 46

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            dayBadge
            VStack(alignment: .leading, spacing: 4) {
                Text(camp.name)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.textPrimary)
                HStack(spacing: 10) {
                    if let dateLabel {
                        Label(dateLabel, systemImage: "calendar")
                    }
                    Label(Formatters.meters(camp.elevation), systemImage: "mountain.2.fill")
                }
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
        }
    }

    private var dayBadge: some View {
        VStack(spacing: 0) {
            Text("DAY").font(.caption2.weight(.bold)).foregroundStyle(Theme.textTertiary)
            Text("\(camp.dayNumber)").font(.title3.weight(.bold)).foregroundStyle(Theme.accentText)
        }
        .frame(width: dayBadgeSize, height: dayBadgeSize)
        .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

#Preview {
    NavigationStack {
        if let journey = try? FixtureLoader.load(named: "kilimanjaro") {
            JourneyStoryView(journey: journey)
        }
    }
    .environmentObject(JourneyStore(persistence: .preview))
    .preferredColorScheme(.dark)
}
