import XCTest
@testable import Akashic

/// DIFF-04 — the service half: running curation through the seam, and applying an accepted
/// proposal to real `Photo` values without destroying anything.
final class PhotoCurationServiceTests: XCTestCase {

    /// Fixed scores, no Vision, no files — so these tests exercise the wiring and the appliers
    /// rather than Apple's models.
    private struct FakeScorer: PhotoScoring {
        var scores: [PhotoScore]
        var sawPhotoCount = 0
        func score(_ photos: [Photo], dayOf: (Photo) -> Int?) async -> [PhotoScore] { scores }
    }

    private func photo(_ id: String, day: Int? = nil, order: Int = 0, hero: Bool = false) -> Photo {
        Photo(id: id, journeyId: "J", waypointId: day.map { "w\($0)" }, url: "u/\(id)",
              thumbnailURL: nil, caption: nil, coordinates: nil, takenAt: nil,
              isHero: hero, sortOrder: order)
    }

    private func dayOf(_ byID: [String: Int]) -> (Photo) -> Int? { { byID[$0.id] } }

    // MARK: Running

    func testEmptyInputSkipsTheScorerEntirely() async {
        let service = PhotoCurationService(scorer: FakeScorer(scores: [
            PhotoScore(id: "should-not-appear")
        ]))
        let result = await service.curate(photos: []) { _ in nil }
        XCTAssertTrue(result.isEmpty, "no photos means no proposal, and no reason to run Vision")
    }

    func testCurateReturnsTheProposalForTheScoresItIsGiven() async {
        let service = PhotoCurationService(scorer: FakeScorer(scores: [
            PhotoScore(id: "a", dayNumber: 1, aesthetics: 0.2, sortOrder: 0),
            PhotoScore(id: "b", dayNumber: 1, aesthetics: 0.9, sortOrder: 1),
        ]))
        let result = await service.curate(photos: [photo("a"), photo("b")]) { _ in 1 }
        XCTAssertEqual(result.hero, "b")
        XCTAssertEqual(result.bestOfByDay[1], ["a", "b"])
    }

    // MARK: Hero

    func testAcceptingHeroFlagsItAndClearsAnyPrevious() {
        let photos = [photo("old", order: 0, hero: true), photo("new", order: 1)]
        var result = CurationResult(); result.hero = "new"
        let applied = PhotoCurationService.applyingHero(result, to: photos)
        XCTAssertEqual(applied.filter(\.isHero).map(\.id), ["new"],
                       "the single-hero invariant must hold for unsaved photos too")
    }

    func testNoHeroProposalLeavesPhotosUntouched() {
        let photos = [photo("a", hero: true), photo("b")]
        XCTAssertEqual(PhotoCurationService.applyingHero(CurationResult(), to: photos), photos)
    }

    /// A stale proposal must not clear the existing hero and leave the journey with none.
    func testAHeroProposalForAMissingPhotoIsIgnored() {
        let photos = [photo("a", hero: true), photo("b")]
        var result = CurationResult(); result.hero = "deleted-since"
        XCTAssertEqual(PhotoCurationService.applyingHero(result, to: photos), photos)
    }

    // MARK: Best-of

    func testAcceptingBestOfPromotesTheSelectionWithinTheDay() {
        let days = ["p0": 1, "p1": 1, "p2": 1, "p3": 1]
        let photos = (0 ..< 4).map { photo("p\($0)", order: $0 * 10) }
        var result = CurationResult(); result.bestOfByDay[1] = ["p2", "p3"]

        let applied = PhotoCurationService.applyingBestOf(day: 1, result, to: photos,
                                                         dayOf: dayOf(days))
        XCTAssertEqual(applied.sorted { $0.sortOrder < $1.sortOrder }.map(\.id),
                       ["p2", "p3", "p0", "p1"],
                       "the chosen photos lead; the rest keep their relative order behind them")
    }

    /// The day's own slots are reused, so curating one day cannot reshuffle another.
    func testPromotionReusesTheDaysExistingSlotsAndTouchesNoOtherDay() {
        let days = ["a0": 1, "a1": 1, "b0": 2, "b1": 2]
        let photos = [photo("a0", order: 0), photo("a1", order: 1),
                      photo("b0", order: 2), photo("b1", order: 3)]
        var result = CurationResult(); result.bestOfByDay[1] = ["a1"]

        let applied = PhotoCurationService.applyingBestOf(day: 1, result, to: photos,
                                                         dayOf: dayOf(days))
        let byID = Dictionary(uniqueKeysWithValues: applied.map { ($0.id, $0.sortOrder) })
        XCTAssertEqual(Set([byID["a0"], byID["a1"]]), Set([0, 1]), "day 1 reuses only its own slots")
        XCTAssertEqual(byID["b0"], 2, "day 2 is untouched")
        XCTAssertEqual(byID["b1"], 3)
        XCTAssertEqual(byID["a1"], 0, "the selected photo leads its day")
    }

    /// Nothing is deleted or hidden — curation only ever reorders and flags.
    func testAcceptingBestOfNeverRemovesAPhoto() {
        let days = Dictionary(uniqueKeysWithValues: (0 ..< 10).map { ("p\($0)", 1) })
        let photos = (0 ..< 10).map { photo("p\($0)", order: $0) }
        var result = CurationResult(); result.bestOfByDay[1] = ["p7"]
        let applied = PhotoCurationService.applyingBestOf(day: 1, result, to: photos,
                                                         dayOf: dayOf(days))
        XCTAssertEqual(applied.count, 10)
        XCTAssertEqual(Set(applied.map(\.id)), Set(photos.map(\.id)))
    }

    /// A selection naming photos from another day would corrupt both days' ordering, so it is
    /// refused wholesale rather than partly applied.
    func testASelectionThatDoesNotBelongToTheDayIsRefused() {
        let days = ["a": 1, "b": 2]
        let photos = [photo("a", order: 0), photo("b", order: 1)]
        var result = CurationResult(); result.bestOfByDay[1] = ["a", "b"]
        XCTAssertEqual(PhotoCurationService.applyingBestOf(day: 1, result, to: photos,
                                                          dayOf: dayOf(days)),
                       photos)
    }

    func testNoSelectionForTheDayLeavesPhotosUntouched() {
        let days = ["a": 1]
        let photos = [photo("a", order: 5)]
        XCTAssertEqual(PhotoCurationService.applyingBestOf(day: 1, CurationResult(), to: photos,
                                                          dayOf: dayOf(days)),
                       photos)
    }

    /// Accepting the same proposal twice must be a no-op, because the UI cannot guarantee one tap.
    func testApplyingTheSameProposalTwiceIsIdempotent() {
        let days = Dictionary(uniqueKeysWithValues: (0 ..< 5).map { ("p\($0)", 1) })
        let photos = (0 ..< 5).map { photo("p\($0)", order: $0) }
        var result = CurationResult(); result.bestOfByDay[1] = ["p3", "p4"]
        let once = PhotoCurationService.applyingBestOf(day: 1, result, to: photos, dayOf: dayOf(days))
        let twice = PhotoCurationService.applyingBestOf(day: 1, result, to: once, dayOf: dayOf(days))
        XCTAssertEqual(once, twice)
    }
}

/// DIFF-13 — the batched reorder that accepting a day's curation performs.
///
/// Batched rather than one save per photograph, because accepting renumbers up to six at once and six
/// saves would publish six change notifications: the gallery would visibly reshuffle step by step
/// instead of settling once.
final class PhotoSortOrderBatchTests: XCTestCase {

    private var controller: PersistenceController!

    override func setUp() {
        super.setUp()
        controller = PersistenceController(mode: .fixtures)
    }

    private func insertPhoto(_ id: String, journey: String, order: Int) {
        let cd = CDPhoto(context: controller.viewContext)
        cd.id = id
        cd.journeyId = journey
        cd.sortOrder = Int64(order)
        try? controller.viewContext.save()
    }

    func testAppliesEveryOrderInOneSave() {
        for i in 0 ..< 4 { insertPhoto("p\(i)", journey: "J", order: i) }
        let changed = controller.updatePhotoSortOrders(["p0": 3, "p1": 2, "p2": 1, "p3": 0])
        XCTAssertEqual(changed, 4)
        let orders = Dictionary(uniqueKeysWithValues:
            controller.loadPhotos(forJourneyID: "J").map { ($0.id, $0.sortOrder) })
        XCTAssertEqual(orders, ["p0": 3, "p1": 2, "p2": 1, "p3": 0])
    }

    /// "Nothing matched" and "nothing needed changing" must be distinguishable, so a caller can tell
    /// a stale proposal from a no-op.
    func testReportsZeroWhenNothingNeedsChanging() {
        insertPhoto("p0", journey: "J", order: 5)
        XCTAssertEqual(controller.updatePhotoSortOrders(["p0": 5]), 0,
                       "already at that order — no write, no notification")
    }

    func testIgnoresIDsThatDoNotExist() {
        insertPhoto("real", journey: "J", order: 0)
        XCTAssertEqual(controller.updatePhotoSortOrders(["real": 1, "ghost": 9]), 1)
    }

    func testEmptyInputIsANoOp() {
        XCTAssertEqual(controller.updatePhotoSortOrders([:]), 0)
    }
}
