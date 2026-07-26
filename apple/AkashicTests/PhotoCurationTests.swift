import XCTest
@testable import Akashic

/// DIFF-04 — the curation policy. Pure input, pure output: no Vision, no files, no device, so these
/// run on any host including CI. What Vision itself measures is not testable here by design; what
/// matters is that the *policy* is right whatever it measures, including when it measures nothing.
final class PhotoCurationTests: XCTestCase {

    private func score(_ id: String,
                       day: Int? = 1,
                       aesthetics: Double? = nil,
                       utility: Bool = false,
                       group: Int? = nil,
                       order: Int = 0,
                       video: Bool = false) -> PhotoScore {
        PhotoScore(id: id, dayNumber: day, aesthetics: aesthetics, isUtility: utility,
                   duplicateGroup: group, sortOrder: order, isVideo: video)
    }

    // MARK: - Ranking

    func testHigherAestheticsWins() {
        XCTAssertTrue(PhotoCuration.isBetter(score("a", aesthetics: 0.8),
                                             score("b", aesthetics: 0.2)))
    }

    /// An unscored photo is unknown, not bad — but a scored one is still the safer proposal.
    func testScoredBeatsUnscored() {
        XCTAssertTrue(PhotoCuration.isBetter(score("a", aesthetics: -0.9), score("b")))
        XCTAssertFalse(PhotoCuration.isBetter(score("b"), score("a", aesthetics: -0.9)))
    }

    /// With no scores at all — every device below iOS 18 — the order must be exactly today's
    /// behaviour, so the feature degrades rather than randomising the gallery.
    func testWithoutAnyScoresOrderIsSortOrder() {
        let scores = [score("c", order: 2), score("a", order: 0), score("b", order: 1)]
        XCTAssertEqual(PhotoCuration.curate(scores).bestOfByDay[1], ["a", "b", "c"])
        XCTAssertEqual(PhotoCuration.curate(scores).hero, "a")
    }

    /// `sorted(by:)` requires a strict weak ordering; an inconsistent comparator can crash or
    /// produce garbage, so pin that equal photos are mutually not-better.
    func testRankingIsAStrictWeakOrdering() {
        let a = score("a", aesthetics: 0.5, order: 3)
        let b = score("b", aesthetics: 0.5, order: 3)
        XCTAssertFalse(PhotoCuration.isBetter(a, b))
        XCTAssertFalse(PhotoCuration.isBetter(b, a))
    }

    // MARK: - Exclusions

    func testVideosAreNeverProposed() {
        let result = PhotoCuration.curate([score("v", aesthetics: 0.99, video: true),
                                           score("p", aesthetics: 0.1)])
        XCTAssertEqual(result.hero, "p", "a video must not become the hero however high it scores")
        XCTAssertEqual(result.bestOfByDay[1], ["p"])
    }

    func testUtilityImagesAreNeverProposed() {
        let result = PhotoCuration.curate([score("screenshot", aesthetics: 0.99, utility: true),
                                           score("real", aesthetics: 0.1)])
        XCTAssertEqual(result.hero, "real")
        XCTAssertEqual(result.bestOfByDay[1], ["real"])
    }

    func testAllCandidatesExcludedYieldsNoProposal() {
        let result = PhotoCuration.curate([score("v", video: true), score("u", utility: true)])
        XCTAssertNil(result.hero)
        XCTAssertTrue(result.bestOfByDay.isEmpty)
        XCTAssertTrue(result.isEmpty)
    }

    // MARK: - Duplicates

    func testOnlyTheBestMemberOfADuplicateGroupIsProposed() {
        let result = PhotoCuration.curate([score("burst1", aesthetics: 0.2, group: 0, order: 0),
                                           score("burst2", aesthetics: 0.9, group: 0, order: 1),
                                           score("burst3", aesthetics: 0.4, group: 0, order: 2)])
        XCTAssertEqual(result.bestOfByDay[1], ["burst2"])
        XCTAssertEqual(result.hero, "burst2")
    }

    /// The regression that matters most: a nil group means "no near-match found", so treating all
    /// ungrouped photos as one group would collapse the whole journey to a single photo.
    func testUngroupedPhotosAreNeverCollapsedTogether() {
        let scores = (0 ..< 5).map { score("p\($0)", order: $0) }
        XCTAssertEqual(PhotoCuration.deduplicated(scores).count, 5)
    }

    /// Duplicates are reported rather than silently dropped, so the UI can say what it is hiding.
    func testDuplicateGroupsAreReportedIncludingExcludedKinds() {
        let result = PhotoCuration.curate([score("a", group: 0, order: 0),
                                           score("b", group: 0, order: 1),
                                           score("clip", group: 1, order: 2, video: true),
                                           score("clip2", group: 1, order: 3, video: true),
                                           score("lonely", group: 2, order: 4)])
        XCTAssertEqual(result.duplicateGroups[0], ["a", "b"])
        XCTAssertEqual(result.duplicateGroups[1], ["clip", "clip2"],
                       "a burst of near-identical videos is still worth telling the user about")
        XCTAssertNil(result.duplicateGroups[2], "a group of one is not a duplicate")
        XCTAssertEqual(result.redundantCount, 2)
    }

    // MARK: - Per-day selection

    func testEachDayIsCappedIndependently() {
        var scores: [PhotoScore] = []
        for day in 1 ... 3 {
            for i in 0 ..< 10 {
                scores.append(score("d\(day)p\(i)", day: day,
                                    aesthetics: Double(i) / 10, order: day * 100 + i))
            }
        }
        let result = PhotoCuration.curate(scores, perDayLimit: 4)
        for day in 1 ... 3 {
            XCTAssertEqual(result.bestOfByDay[day]?.count, 4, "day \(day)")
        }
    }

    /// A weak day still gets its best photos: the day view and the story need something per day.
    func testAWeakDayStillGetsAProposal() {
        let result = PhotoCuration.curate([score("strong", day: 1, aesthetics: 0.95, order: 0),
                                           score("weak", day: 2, aesthetics: -0.8, order: 1)])
        XCTAssertEqual(result.bestOfByDay[2], ["weak"])
        XCTAssertEqual(result.hero, "strong", "the hero is still the best across the journey")
    }

    /// Selection is by score, presentation is chronological — a day reads in order, not ranked.
    func testSelectionIsByScoreButPresentationIsChronological() {
        let result = PhotoCuration.curate([score("first", aesthetics: 0.3, order: 0),
                                           score("second", aesthetics: 0.9, order: 1),
                                           score("third", aesthetics: 0.6, order: 2),
                                           score("weakest", aesthetics: 0.05, order: 3)],
                                          perDayLimit: 3)
        XCTAssertEqual(result.bestOfByDay[1], ["first", "second", "third"])
    }

    func testPhotosWithNoDayStillProduceAHeroButNoBestOf() {
        let result = PhotoCuration.curate([score("orphan", day: nil, aesthetics: 0.7)])
        XCTAssertEqual(result.hero, "orphan")
        XCTAssertTrue(result.bestOfByDay.isEmpty)
    }

    // MARK: - Determinism

    /// The UI must not reshuffle between runs, and dictionary iteration order is not stable across
    /// launches — so curate() has to impose its own ordering everywhere.
    func testResultIsDeterministicAcrossRepeatedRuns() {
        let scores = (0 ..< 40).map {
            score("p\($0)", day: $0 % 4, aesthetics: Double(($0 * 37) % 100) / 100,
                  group: $0 % 7 == 0 ? $0 / 7 : nil, order: $0)
        }
        let first = PhotoCuration.curate(scores)
        for _ in 0 ..< 20 {
            XCTAssertEqual(PhotoCuration.curate(scores), first)
        }
    }

    /// Input order must not change the outcome — the caller's fetch order is not meaningful.
    func testResultIsIndependentOfInputOrder() {
        let scores = (0 ..< 25).map {
            score("p\($0)", day: $0 % 3, aesthetics: Double(($0 * 17) % 50) / 50, order: $0)
        }
        XCTAssertEqual(PhotoCuration.curate(scores.shuffled()),
                       PhotoCuration.curate(scores.shuffled()))
    }

    func testEmptyInput() {
        XCTAssertTrue(PhotoCuration.curate([]).isEmpty)
    }
}

/// DIFF-05 — the discarded-parameter defect, and that Vision subjects reach the prompt.
///
/// The prompt-building side is testable without Vision or a language model, which is the half that
/// matters: what the model is *told* is the thing a reviewer would judge.
final class DayNoteInputTests: XCTestCase {

    private func input(subjects: [String] = [], reference: String? = nil) -> DayNoteInput {
        DayNoteInput(journeyName: "Kilimanjaro", country: "Tanzania", dayNumber: 3,
                     campName: "Barranco Camp", elevation: 3960, dayDistanceKm: 5.5,
                     elevationGain: 600, elevationLoss: 200, dateLabel: "1 Oct 2023",
                     highlights: ["Barranco Wall"], weather: nil, photoCount: 4,
                     photoCaptions: ["Morning light"],
                     photoSubjects: subjects, referenceText: reference)
    }

    /// The defect: the memberwise init accepted `referenceText` and dropped it on the floor, so every
    /// caller that passed reference text — tests included — was silently exercising the *ungrounded*
    /// path while appearing to test the grounded one.
    func testMemberwiseInitNoLongerDiscardsReferenceText() {
        XCTAssertEqual(input(reference: "Barranco Wall is a cliff.").referenceText,
                       "Barranco Wall is a cliff.")
    }

    func testMemberwiseInitCarriesPhotoSubjects() {
        XCTAssertEqual(input(subjects: ["glacier", "tent"]).photoSubjects, ["glacier", "tent"])
    }

    /// Assembling from the domain must not invent subjects: Vision has not run at that point, so an
    /// empty list is the honest value.
    func testDomainInitStartsWithNoSubjects() {
        let camp = Camp(id: "W3", name: "Barranco", dayNumber: 3, elevation: 3960,
                        coordinates: [37.4, -3.1], notes: "", highlights: [])
        let journey = Journey(id: "J", slug: "k", name: "Kilimanjaro", country: "Tanzania",
                             description: "", heroImageURL: nil, dateStarted: nil, dateEnded: nil,
                             isPublic: false, summitElevation: nil, totalDistance: nil,
                             totalDays: nil, centerCoordinates: nil, preferredBearing: nil,
                             preferredPitch: nil,
                             stats: TrekStats(duration: 1, totalDistance: 0, totalElevationGain: 0,
                                              totalElevationLoss: 0,
                                              highestPoint: HighestPoint(name: "", elevation: 0,
                                                                         coordinates: [])),
                             route: Route(type: "LineString", coordinates: []),
                             camps: [camp])
        XCTAssertTrue(DayNoteInput(journey: journey, camp: camp, photos: []).photoSubjects.isEmpty)
    }
}

/// DIFF-08 — what the UI is allowed to say when drafting fails, and whether it may offer a retry.
///
/// Testable on any toolchain because `DayNoteDraftFailure` lives outside
/// `#if canImport(FoundationModels)` — the same reason `ModelAvailability` does.
final class DayNoteDraftFailureTests: XCTestCase {

    /// The distinction the whole type exists for: telling someone to retry when retrying cannot
    /// work is worse than saying nothing, and it is how a feature earns distrust.
    func testOnlyRecoverableFailuresOfferARetry() {
        XCTAssertFalse(DayNoteDraftFailure.declined.isWorthRetrying,
                       "a guardrail refusal will refuse the same input again")
        XCTAssertFalse(DayNoteDraftFailure.tooMuchInput.isWorthRetrying,
                       "an oversized day will overflow the context window again")
        XCTAssertTrue(DayNoteDraftFailure.modelNotReady.isWorthRetrying,
                      "assets still downloading will succeed later with no user action")
        XCTAssertTrue(DayNoteDraftFailure.unknown(nil).isWorthRetrying,
                      "an unrecognised failure is the one case where a retry is honest")
    }

    /// Each message has to say what to do, not merely that something went wrong — and the two
    /// unrecoverable cases must not suggest retrying, because that is precisely what will not help.
    func testMessagesAreDistinctAndActionable() {
        let messages = [DayNoteDraftFailure.declined,
                        .tooMuchInput,
                        .modelNotReady,
                        .unknown(nil)].map(\.message)
        XCTAssertEqual(Set(messages).count, 4, "a shared message would defeat the point of the type")
        XCTAssertTrue(DayNoteDraftFailure.tooMuchInput.message.lowercased().contains("shorten"))
        XCTAssertFalse(DayNoteDraftFailure.declined.message.lowercased().contains("try again"),
                       "an unrecoverable failure must not advise the one thing that cannot work")
        XCTAssertFalse(DayNoteDraftFailure.tooMuchInput.message.lowercased().contains("try again"))
    }

    /// The underlying description must not change identity: two unknowns with different details are
    /// still both unknown, so a view can switch on the case without unwrapping.
    func testUnknownCarriesDetailWithoutChangingItsMeaning() {
        XCTAssertTrue(DayNoteDraftFailure.unknown("some CK error").isWorthRetrying)
        XCTAssertEqual(DayNoteDraftFailure.unknown("a").message,
                       DayNoteDraftFailure.unknown("b").message)
        XCTAssertNotEqual(DayNoteDraftFailure.unknown("a"), DayNoteDraftFailure.unknown("b"),
                          "but the detail is still preserved for logging")
    }
}
