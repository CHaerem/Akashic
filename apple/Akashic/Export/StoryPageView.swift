import SwiftUI

/// DIFF-07 — the page views the PDF renderer draws.
///
/// Every one of these takes **plain values and already-decoded `UIImage`s**. Nothing here loads,
/// fetches or awaits, because `ImageRenderer` is synchronous and gets no run loop: an `AsyncImage`
/// in this tree comes out blank, and a SwiftUI `Map` comes out empty. That constraint is the reason
/// this file exists separately from `JourneyStoryView` rather than the on-screen story being reused.
///
/// Print, not screen, drives the styling: white ground and dark ink regardless of appearance, because
/// this becomes a PDF someone may put on paper and the app's dark canvas would cost them a cartridge
/// and read as a mistake. That is a deliberate departure from `Theme`, not an oversight.
struct StoryPageView: View {
    let page: StoryPage
    let resolved: StoryPDFRenderer.Resolved
    let pageNumber: Int
    let pageCount: Int

    // Print palette. Deliberately literal rather than `Theme`: `Theme` adapts to the viewer's
    // appearance, and a page does not have one.
    private static let ink = Color(red: 0.08, green: 0.08, blue: 0.12)
    private static let inkSoft = Color(red: 0.42, green: 0.42, blue: 0.48)
    private static let accent = Color(red: 0.29, green: 0.31, blue: 0.75)   // darkened for paper
    private static let paper = Color.white
    private static let rule = Color(red: 0.86, green: 0.86, blue: 0.89)

    var body: some View {
        ZStack {
            Self.paper
            VStack(alignment: .leading, spacing: 0) {
                content
                Spacer(minLength: 0)
                footer
            }
            .padding(StoryPDFRenderer.margin)
        }
        .frame(width: StoryPDFRenderer.pageSize.width, height: StoryPDFRenderer.pageSize.height)
    }

    @ViewBuilder
    private var content: some View {
        switch page {
        case let .cover(cover):          coverPage(cover)
        case let .dayOpening(day):       dayPage(day)
        case let .photos(day, ids):      photoGrid(dayNumber: day, ids: ids)
        case .map:                       mapPage
        case let .colophon(colophon):    colophonPage(colophon)
        }
    }

    // MARK: Cover

    private func coverPage(_ cover: StoryCover) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Spacer(minLength: 0)
            if let id = cover.heroPhotoID, let image = resolved.images[id] {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(height: 320)
                    .clipped()
            }
            Text(cover.title)
                .font(.system(size: 40, weight: .bold, design: .serif))
                .foregroundStyle(Self.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !cover.subtitle.isEmpty {
                Text(cover.subtitle)
                    .font(.system(size: 19, design: .serif))
                    .foregroundStyle(Self.inkSoft)
            }
            if !cover.dateRange.isEmpty {
                Text(cover.dateRange)
                    .font(.system(size: 13, weight: .medium))
                    .tracking(1.4)
                    .textCase(.uppercase)
                    .foregroundStyle(Self.accent)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: Day opening

    private func dayPage(_ day: StoryDay) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("\(day.dayNumber)")
                    .font(.system(size: 46, weight: .bold, design: .serif))
                    .foregroundStyle(Self.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(day.name)
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                        .foregroundStyle(Self.ink)
                    if let date = day.dateLabel {
                        Text(date).font(.system(size: 12)).foregroundStyle(Self.inkSoft)
                    }
                }
            }

            if !day.stats.isEmpty {
                HStack(spacing: 22) {
                    ForEach(Array(day.stats.enumerated()), id: \.offset) { _, stat in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(stat.label)
                                .font(.system(size: 8, weight: .semibold))
                                .tracking(0.9).textCase(.uppercase)
                                .foregroundStyle(Self.inkSoft)
                            Text(stat.value)
                                .font(.system(size: 15, weight: .medium))
                                .monospacedDigit()
                                .foregroundStyle(Self.ink)
                        }
                    }
                }
                Rectangle().fill(Self.rule).frame(height: 1)
            }

            // The user's own words are the point of the book, so they get the most room and the
            // most readable face on the page.
            if !day.notes.isEmpty {
                Text(day.notes)
                    .font(.system(size: 13, design: .serif))
                    .lineSpacing(4)
                    .foregroundStyle(Self.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if !day.highlights.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(day.highlights.enumerated()), id: \.offset) { _, highlight in
                        HStack(alignment: .top, spacing: 6) {
                            Text("—").foregroundStyle(Self.accent)
                            Text(highlight)
                                .font(.system(size: 12, design: .serif))
                                .foregroundStyle(Self.ink)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }

            if !day.photoIDs.isEmpty {
                HStack(spacing: 8) {
                    ForEach(day.photoIDs, id: \.self) { id in
                        if let image = resolved.images[id] {
                            Image(uiImage: image)
                                .resizable().aspectRatio(contentMode: .fill)
                                .frame(height: 150).clipped()
                        }
                    }
                }
            }
        }
    }

    // MARK: Photo grid

    private func photoGrid(dayNumber: Int, ids: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Day \(dayNumber)")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.1).textCase(.uppercase)
                .foregroundStyle(Self.inkSoft)
            // Fixed three columns rather than adaptive: a page is a known width, and an adaptive
            // grid would silently reflow between pages and make the book look assembled by accident.
            LazyVGrid(columns: Array(repeating: GridItem(spacing: 8), count: 3), spacing: 8) {
                ForEach(ids, id: \.self) { id in
                    if let image = resolved.images[id] {
                        Image(uiImage: image)
                            .resizable().aspectRatio(1, contentMode: .fill)
                            .clipped()
                    }
                }
            }
        }
    }

    // MARK: Map

    @ViewBuilder
    private var mapPage: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("The route")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.1).textCase(.uppercase)
                .foregroundStyle(Self.inkSoft)
            if let snapshot = resolved.routeSnapshot {
                Image(uiImage: snapshot).resizable().aspectRatio(contentMode: .fit)
            } else {
                // A route with fewer than two points, or a snapshotter failure. Says so rather than
                // printing an empty rectangle a reader would take for a broken export.
                Text("No route was recorded for this journey.")
                    .font(.system(size: 12, design: .serif))
                    .foregroundStyle(Self.inkSoft)
            }
        }
    }

    // MARK: Colophon

    private func colophonPage(_ colophon: StoryColophon) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer(minLength: 0)
            ForEach(Array(colophon.totals.enumerated()), id: \.offset) { _, total in
                HStack {
                    Text(total.label)
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.0).textCase(.uppercase)
                        .foregroundStyle(Self.inkSoft)
                    Spacer()
                    Text(total.value)
                        .font(.system(size: 17, weight: .medium, design: .serif))
                        .monospacedDigit()
                        .foregroundStyle(Self.ink)
                }
                Rectangle().fill(Self.rule).frame(height: 1)
            }
            Spacer(minLength: 0)
            Text(colophon.madeWith)
                .font(.system(size: 11))
                .foregroundStyle(Self.accent)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        // The cover carries no page number: numbering a title page reads as a printout rather than
        // as a book.
        if case .cover = page {
            EmptyView()
        } else {
            Text("\(pageNumber) / \(pageCount)")
                .font(.system(size: 8))
                .monospacedDigit()
                .foregroundStyle(Self.inkSoft)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}
