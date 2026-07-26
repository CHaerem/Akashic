import XCTest
import PDFKit
@testable import Akashic

/// DIFF-07 — pagination is pure, so it is tested without a renderer; the PDF itself is then
/// produced for real and opened with PDFKit, because "it compiled" proves nothing about a document.
final class StoryPaginationTests: XCTestCase {

    private func camp(_ day: Int, notes: String = "", highlights: [String] = []) -> Camp {
        Camp(id: "W\(day)", name: "Camp \(day)", dayNumber: day, elevation: 3000 + day * 100,
             coordinates: [37.4, -3.1], notes: notes, highlights: highlights)
    }

    private func photo(_ id: String, order: Int) -> Photo {
        Photo(id: id, journeyId: "J", waypointId: nil, url: "", thumbnailURL: nil, caption: nil,
              coordinates: nil, takenAt: nil, isHero: false, sortOrder: order)
    }

    private func journey(days: Int) -> Journey {
        Journey(id: "J", slug: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania",
                description: "", heroImageURL: nil, dateStarted: "2024-01-01",
                dateEnded: "2024-01-07", isPublic: false, summitElevation: 5895,
                totalDistance: 62, totalDays: days, centerCoordinates: [37.4, -3.1],
                preferredBearing: 0, preferredPitch: 0,
                stats: TrekStats(duration: 3, totalDistance: 62, totalElevationGain: 4200,
                                totalElevationLoss: 4200,
                                highestPoint: HighestPoint(name: "Uhuru", elevation: 5895,
                                                           coordinates: [37.4, -3.1])),
                route: Route(type: "LineString", coordinates: [[37.3, -3.0], [37.5, -3.2]]),
                camps: (1 ... days).map { camp($0) })
    }

    // MARK: Structure

    func testABookAlwaysHasACoverAndAColophon() {
        let pages = StoryPagination.pages(journey: journey(days: 1), photosByDay: [:],
                                          heroPhotoID: nil, includeMap: false)
        guard case .cover = pages.first, case .colophon = pages.last else {
            return XCTFail("expected cover first and colophon last, got \(pages)")
        }
    }

    func testEachDayGetsExactlyOneOpeningPage() {
        let pages = StoryPagination.pages(journey: journey(days: 5), photosByDay: [:],
                                          heroPhotoID: nil, includeMap: false)
        let openings = pages.compactMap { page -> Int? in
            if case let .dayOpening(day) = page { return day.dayNumber } else { return nil }
        }
        XCTAssertEqual(openings, [1, 2, 3, 4, 5], "one opening per day, in order")
    }

    func testTheMapPageIsOptional() {
        let with = StoryPagination.pages(journey: journey(days: 1), photosByDay: [:],
                                         heroPhotoID: nil, includeMap: true)
        let without = StoryPagination.pages(journey: journey(days: 1), photosByDay: [:],
                                            heroPhotoID: nil, includeMap: false)
        XCTAssertTrue(with.contains(.map))
        XCTAssertFalse(without.contains(.map))
    }

    // MARK: Photo distribution

    /// A day with only opening-page photos must not produce an empty continuation page.
    func testNoContinuationPageWhenEverythingFitsTheOpening() {
        let photos = (0 ..< StoryPagination.photosOnOpeningPage).map { photo("p\($0)", order: $0) }
        let pages = StoryPagination.pages(journey: journey(days: 1), photosByDay: [1: photos],
                                          heroPhotoID: nil, includeMap: false)
        XCTAssertFalse(pages.contains { if case .photos = $0 { return true } else { return false } })
    }

    func testOverflowPhotosContinueOnCappedPages() {
        // 2 on the opening + 13 remaining = 6 + 6 + 1 across three continuation pages.
        let photos = (0 ..< 15).map { photo("p\($0)", order: $0) }
        let pages = StoryPagination.pages(journey: journey(days: 1), photosByDay: [1: photos],
                                          heroPhotoID: nil, includeMap: false)
        let counts = pages.compactMap { page -> Int? in
            if case let .photos(_, ids) = page { return ids.count } else { return nil }
        }
        XCTAssertEqual(counts, [6, 6, 1])
    }

    /// Every photograph handed in must appear exactly once — a book that silently drops photos is
    /// worse than one that runs long.
    func testEveryPhotoAppearsExactlyOnce() {
        let photos = (0 ..< 20).map { photo("p\($0)", order: $0) }
        let pages = StoryPagination.pages(journey: journey(days: 2),
                                          photosByDay: [1: Array(photos.prefix(11)),
                                                        2: Array(photos.suffix(9))],
                                          heroPhotoID: nil, includeMap: false)
        let drawn = StoryPagination.referencedPhotoIDs(pages)
        XCTAssertEqual(Set(drawn), Set(photos.map(\.id)))
        XCTAssertEqual(drawn.count, photos.count, "no photo drawn twice")
    }

    /// The hero appears on the cover, and being the hero must not remove it from its day.
    func testHeroIsReferencedEvenWhenItIsAlsoADayPhoto() {
        let photos = [photo("hero", order: 0)]
        let pages = StoryPagination.pages(journey: journey(days: 1), photosByDay: [1: photos],
                                          heroPhotoID: "hero", includeMap: false)
        XCTAssertEqual(StoryPagination.referencedPhotoIDs(pages), ["hero"],
                       "referenced once for decoding, though it is drawn on two pages")
    }

    func testPhotosAreOrderedBySortOrderNotDictionaryOrder() {
        let photos = [photo("c", order: 2), photo("a", order: 0), photo("b", order: 1)]
        let pages = StoryPagination.pages(journey: journey(days: 1), photosByDay: [1: photos],
                                          heroPhotoID: nil, includeMap: false)
        guard case let .dayOpening(day) = pages[1] else { return XCTFail("expected a day page") }
        XCTAssertEqual(day.photoIDs, ["a", "b"], "sortOrder decides, so curated picks lead")
    }

    /// A day with no photographs still gets its page — the writing is the point, not the pictures.
    func testADayWithNoPhotosStillGetsItsPage() {
        let pages = StoryPagination.pages(journey: journey(days: 3), photosByDay: [2: []],
                                          heroPhotoID: nil, includeMap: false)
        let openings = pages.filter { if case .dayOpening = $0 { return true } else { return false } }
        XCTAssertEqual(openings.count, 3)
    }

    func testPaginationIsDeterministic() {
        let photos = (0 ..< 17).map { photo("p\($0)", order: $0) }
        let first = StoryPagination.pages(journey: journey(days: 3),
                                          photosByDay: [1: photos, 2: [], 3: photos],
                                          heroPhotoID: "p0", includeMap: true)
        for _ in 0 ..< 10 {
            XCTAssertEqual(StoryPagination.pages(journey: journey(days: 3),
                                                 photosByDay: [1: photos, 2: [], 3: photos],
                                                 heroPhotoID: "p0", includeMap: true), first)
        }
    }
}

/// The renderer, exercised for real. These need UIKit and a run loop, so they are `@MainActor`.
final class StoryPDFRendererTests: XCTestCase {

    private func journey() -> Journey {
        Journey(id: "J", slug: "kilimanjaro", name: "Kilimanjaro", country: "Tanzania",
                description: "", heroImageURL: nil, dateStarted: "2024-01-01",
                dateEnded: "2024-01-07", isPublic: false, summitElevation: 5895,
                totalDistance: 62, totalDays: 3, centerCoordinates: [37.4, -3.1],
                preferredBearing: 0, preferredPitch: 0,
                stats: TrekStats(duration: 3, totalDistance: 62, totalElevationGain: 4200,
                                totalElevationLoss: 4200,
                                highestPoint: HighestPoint(name: "Uhuru", elevation: 5895,
                                                           coordinates: [37.4, -3.1])),
                route: Route(type: "LineString", coordinates: [[37.3, -3.0], [37.5, -3.2]]),
                camps: (1 ... 3).map {
                    Camp(id: "W\($0)", name: "Camp \($0)", dayNumber: $0, elevation: 3000,
                         coordinates: [37.4, -3.1], notes: "We walked a long way on day \($0).",
                         highlights: ["A view"])
                })
    }

    /// The end-to-end proof: a real PDF, opened by PDFKit, with the page count pagination promised.
    /// Without this, "it compiles" would be the only evidence the book exists at all.
    @MainActor
    func testRendersARealPDFWithThePaginatedPageCount() async throws {
        let pages = StoryPagination.pages(journey: journey(), photosByDay: [:],
                                          heroPhotoID: nil, includeMap: false)
        let data = StoryPDFRenderer.draw(pages: pages, resolved: .init())
        let pdfData = try XCTUnwrap(data, "the renderer must produce data")

        let document = try XCTUnwrap(PDFDocument(data: pdfData), "PDFKit must be able to open it")
        XCTAssertEqual(document.pageCount, pages.count)
        XCTAssertGreaterThan(pdfData.count, 1_000, "a document with content, not an empty shell")
    }

    /// The day's own words must actually reach the page — the single most important thing the book
    /// carries, and the easiest to lose to a layout mistake that still renders.
    @MainActor
    func testTheUsersOwnNotesAppearInTheRenderedText() async throws {
        let pages = StoryPagination.pages(journey: journey(), photosByDay: [:],
                                          heroPhotoID: nil, includeMap: false)
        let data = try XCTUnwrap(StoryPDFRenderer.draw(pages: pages, resolved: .init()))
        let document = try XCTUnwrap(PDFDocument(data: data))
        let text = (0 ..< document.pageCount)
            .compactMap { document.page(at: $0)?.string }
            .joined(separator: "\n")
        XCTAssertTrue(text.contains("We walked a long way on day 2"),
                      "the notes are the point of the book; extracted text was: \(text.prefix(400))")
        XCTAssertTrue(text.contains("Kilimanjaro"), "the cover title must be real text, not an image")
    }

    @MainActor
    func testAnEmptyPageListRendersNothingRatherThanABlankDocument() {
        XCTAssertNil(StoryPDFRenderer.draw(pages: [], resolved: .init()))
    }

    /// A4 at 72 dpi. Pinned because a silent page-size change would make every future book
    /// inconsistent with the ones already handed over.
    @MainActor
    func testPageSizeIsA4() throws {
        let pages = StoryPagination.pages(journey: journey(), photosByDay: [:],
                                          heroPhotoID: nil, includeMap: false)
        let data = try XCTUnwrap(StoryPDFRenderer.draw(pages: pages, resolved: .init()))
        let page = try XCTUnwrap(PDFDocument(data: data)?.page(at: 0))
        let bounds = page.bounds(for: .mediaBox)
        XCTAssertEqual(bounds.width, 595, accuracy: 1)
        XCTAssertEqual(bounds.height, 842, accuracy: 1)
    }

    /// A route of fewer than two points cannot be snapshotted, and must degrade to a sentence
    /// rather than an empty rectangle a reader would take for a broken export.
    @MainActor
    func testAMapPageWithNoSnapshotStillRenders() throws {
        let data = try XCTUnwrap(StoryPDFRenderer.draw(pages: [.map], resolved: .init()))
        let document = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertEqual(document.pageCount, 1)
        let text = document.page(at: 0)?.string ?? ""
        XCTAssertTrue(text.contains("No route"), "got: \(text)")
    }
}
