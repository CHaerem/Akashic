import Foundation

/// DIFF-07 — the paginated model of a journey's printable story, resolved before any drawing.
///
/// ## Why a value model at all
/// The obvious implementation is "render `JourneyStoryView` with `ImageRenderer`", and it does not
/// work. Two reasons, both structural rather than fixable in passing:
///   * `AsyncImage` never resolves inside `ImageRenderer` — it needs a run loop the renderer does not
///     give it, so every photograph comes out blank.
///   * SwiftUI's `Map` renders empty for the same class of reason; a map page needs
///     `MKMapSnapshotter` and an image.
///
/// So the printable story is a **separate value-in/pixels-out tree**: everything it needs is decoded
/// and measured up front into this model, and the page views then take plain values and `UIImage`s.
/// That also makes pagination — the only part with real logic in it — pure and testable without a
/// renderer, a device, or a single byte of image data.
///
/// ## Why this is not just a nicety
/// The project's own thesis is "the photo book nobody gets around to making", and until now there
/// were zero lines of book code in 75k. A PDF is the honest version of that promise: it hands the
/// family something finished without this becoming a company that does paper, binding and shipping.

// MARK: - Page model

/// One page of the story. Deliberately an enum: the renderer must handle every kind exhaustively,
/// so adding a page type cannot silently produce a blank page.
enum StoryPage: Equatable {
    /// Title page: journey name, country, date range, and the hero photograph if there is one.
    case cover(StoryCover)
    /// A day's opening page: the day badge, its name, stats and the user's own notes.
    case dayOpening(StoryDay)
    /// A grid of photographs continuing a day. `dayNumber` repeats so the footer can stay oriented.
    case photos(dayNumber: Int, photoIDs: [String])
    /// The route, drawn from an `MKMapSnapshotter` image rather than a live map.
    case map
    /// Closing page: totals, and the "made with Akashic" line that is also the funnel.
    case colophon(StoryColophon)
}

struct StoryCover: Equatable {
    var title: String
    var subtitle: String
    var dateRange: String
    var heroPhotoID: String?
}

struct StoryDay: Equatable {
    var dayNumber: Int
    var name: String
    var dateLabel: String?
    var notes: String
    var highlights: [String]
    /// Pre-formatted so the page view does no locale work — and so the same strings the app shows
    /// are the strings the book shows.
    var stats: [(label: String, value: String)]
    var photoIDs: [String]

    static func == (a: StoryDay, b: StoryDay) -> Bool {
        a.dayNumber == b.dayNumber && a.name == b.name && a.dateLabel == b.dateLabel
            && a.notes == b.notes && a.highlights == b.highlights && a.photoIDs == b.photoIDs
            && a.stats.map(\.label) == b.stats.map(\.label)
            && a.stats.map(\.value) == b.stats.map(\.value)
    }
}

struct StoryColophon: Equatable {
    var totals: [(label: String, value: String)]
    var madeWith: String

    static func == (a: StoryColophon, b: StoryColophon) -> Bool {
        a.madeWith == b.madeWith
            && a.totals.map(\.label) == b.totals.map(\.label)
            && a.totals.map(\.value) == b.totals.map(\.value)
    }
}

// MARK: - Pagination

/// Turns a journey into pages. Pure, deterministic, and the only part of the book with decisions in
/// it — which is why it lives apart from the drawing.
enum StoryPagination {

    /// Photographs on a day's opening page, alongside the notes. Kept small: the opening page is
    /// carried by the writing, and a wall of thumbnails beside it reads as a contact sheet.
    static let photosOnOpeningPage = 2

    /// Photographs per continuation page. Six is two rows of three at a readable size on A4 — more
    /// and the book stops being something you look at and becomes something you scroll.
    static let photosPerPhotoPage = 6

    /// Paginate a journey. `photosByDay` is supplied rather than derived so the caller can pass a
    /// *curated* selection — DIFF-04's best-of is exactly the input this wants, and a 939-photo
    /// journey with 449 unique images produces a book nobody wants without it.
    static func pages(journey: Journey,
                      photosByDay: [Int: [Photo]],
                      heroPhotoID: String?,
                      includeMap: Bool,
                      formatter: StoryFormatting = StoryFormatting()) -> [StoryPage] {
        var pages: [StoryPage] = []

        pages.append(.cover(StoryCover(
            title: journey.name,
            subtitle: journey.country,
            dateRange: formatter.dateRange(journey),
            heroPhotoID: heroPhotoID)))

        if includeMap { pages.append(.map) }

        for camp in journey.camps.sorted(by: { $0.dayNumber < $1.dayNumber }) {
            let dayPhotos = (photosByDay[camp.dayNumber] ?? []).sorted { $0.sortOrder < $1.sortOrder }
            let opening = Array(dayPhotos.prefix(photosOnOpeningPage))
            pages.append(.dayOpening(StoryDay(
                dayNumber: camp.dayNumber,
                name: camp.name,
                dateLabel: camp.dateLabel,
                notes: camp.notes,
                highlights: camp.highlights,
                stats: formatter.dayStats(camp),
                photoIDs: opening.map(\.id))))

            // Only the photographs that did not fit the opening page continue.
            let remaining = Array(dayPhotos.dropFirst(photosOnOpeningPage))
            for chunk in stride(from: 0, to: remaining.count, by: photosPerPhotoPage) {
                let slice = remaining[chunk ..< min(chunk + photosPerPhotoPage, remaining.count)]
                pages.append(.photos(dayNumber: camp.dayNumber, photoIDs: slice.map(\.id)))
            }
        }

        pages.append(.colophon(StoryColophon(totals: formatter.journeyTotals(journey),
                                             madeWith: formatter.madeWith)))
        return pages
    }

    /// Every photo id the paginated book will draw, in page order — so the caller knows exactly
    /// which images to decode and never decodes one it will not use. Decoding a 939-photo journey's
    /// worth of full-size images to draw sixty of them is the difference between a book and a jetsam.
    static func referencedPhotoIDs(_ pages: [StoryPage]) -> [String] {
        var seen = Set<String>()
        var ordered: [String] = []
        func add(_ id: String) {
            if seen.insert(id).inserted { ordered.append(id) }
        }
        for page in pages {
            switch page {
            case let .cover(cover): if let id = cover.heroPhotoID { add(id) }
            case let .dayOpening(day): day.photoIDs.forEach(add)
            case let .photos(_, ids): ids.forEach(add)
            case .map, .colophon: break
            }
        }
        return ordered
    }
}

// MARK: - Formatting

/// The strings the book prints. Separated so pagination is testable without a locale, and so the
/// book and the app cannot drift into describing the same day differently.
struct StoryFormatting {
    var madeWith = String(localized: "Made with Akashic",
                          comment: "Story book colophon: the attribution line on the closing page.")

    func dateRange(_ journey: Journey) -> String {
        Formatters.dateRange(journey.dateStarted, journey.dateEnded) ?? ""
    }

    func dayStats(_ camp: Camp) -> [(label: String, value: String)] {
        var stats: [(String, String)] = []
        if camp.dayDistance > 0 {
            stats.append((String(localized: "Distance",
                                 comment: "Story book day stats: distance walked that day."),
                          Formatters.distanceKm(camp.dayDistance)))
        }
        if camp.elevationGainFromPrevious > 0 {
            stats.append((String(localized: "Ascent",
                                 comment: "Story book day stats: metres climbed that day."),
                          Formatters.meters(camp.elevationGainFromPrevious)))
        }
        if camp.elevationLossFromPrevious > 0 {
            stats.append((String(localized: "Descent",
                                 comment: "Story book day stats: metres descended that day."),
                          Formatters.meters(camp.elevationLossFromPrevious)))
        }
        stats.append((String(localized: "Altitude",
                             comment: "Story book day stats: the camp's elevation."),
                      Formatters.meters(camp.elevation)))
        return stats
    }

    func journeyTotals(_ journey: Journey) -> [(label: String, value: String)] {
        var totals: [(String, String)] = []
        // Every one of these is optional on `Journey`, and a book that prints "0 km" for a journey
        // whose distance was never computed is worse than one that omits the row.
        if let days = journey.totalDays, days > 0 {
            totals.append((String(localized: "Days",
                                  comment: "Story book totals: how many days the journey lasted."),
                           "\(days)"))
        }
        if let distance = journey.totalDistance, distance > 0 {
            totals.append((String(localized: "Distance",
                                  comment: "Story book totals: total distance for the journey."),
                           Formatters.distanceKm(distance)))
        }
        if let summit = journey.summitElevation, summit > 0 {
            totals.append((String(localized: "Highest point",
                                  comment: "Story book totals: the journey's highest elevation."),
                           Formatters.meters(summit)))
        }
        return totals
    }
}
