import XCTest
@testable import Akashic

/// QUA-12 — `KnowledgeRetrieval`, the Wikipedia/Wikivoyage grounding path (COMMERCIALIZATION-PLAN
/// §10, "the Whiskey Route gap"). 506 lines on a **networked** path that had no tests at all.
///
/// Nothing here touches the network: the `WikimediaClient` seam is filled with an in-memory fake that
/// also records every call, so query building, candidate collection, geo-verification, the byte
/// budget and the never-throw contract are all pinned from plain values.
final class KnowledgeRetrievalTests: XCTestCase {

    // MARK: - Fake client

    /// Records every call and answers from tables. A class, not a struct, so the recording survives
    /// being captured by the orchestrator.
    private final class FakeWikimedia: WikimediaClient {
        var hitsByProject: [WikimediaProject: [WikimediaSearchHit]] = [:]
        /// Keyed `"<project.rawValue>|<title-or-key>"`.
        var summariesByKey: [String: WikimediaSummary] = [:]
        var searchThrows = false
        var summaryThrows = false

        private(set) var searchCalls: [(query: String, project: WikimediaProject, limit: Int)] = []
        private(set) var summaryCalls: [(title: String, project: WikimediaProject)] = []

        static func key(_ project: WikimediaProject, _ title: String) -> String {
            "\(project.rawValue)|\(title)"
        }

        func search(query: String, project: WikimediaProject,
                    limit: Int) async throws -> [WikimediaSearchHit] {
            searchCalls.append((query, project, limit))
            if searchThrows { throw URLError(.notConnectedToInternet) }
            return hitsByProject[project] ?? []
        }

        func summary(title: String, project: WikimediaProject) async throws -> WikimediaSummary? {
            summaryCalls.append((title, project))
            if summaryThrows { throw URLError(.timedOut) }
            return summariesByKey[Self.key(project, title)]
        }
    }

    private func hit(_ title: String, key: String? = nil) -> WikimediaSearchHit {
        WikimediaSearchHit(title: title, key: key ?? title, description: nil)
    }

    /// No courtesy delay, so the suite stays fast.
    private func retrieval(_ client: WikimediaClient,
                           projects: [WikimediaProject] = [.wikipedia, .wikivoyage]) -> KnowledgeRetrieval {
        KnowledgeRetrieval(client: client, projects: projects, interCallDelayNanos: 0)
    }

    // MARK: - Query building

    func testQueriesAreTrimmedDeDupedCaseInsensitivelyAndCapped() {
        let request = RetrievalRequest(
            placeNames: ["  Barafu Camp ", "barafu camp", "", "   ", "Uhuru Peak", "Stella Point",
                         "Kibo Hut", "Machame Gate"],
            maxQueries: 3)
        XCTAssertEqual(request.queries, ["Barafu Camp", "Uhuru Peak", "Stella Point"],
                       "trimmed, first-wins de-dup, blanks dropped, capped to maxQueries")
    }

    func testNoQueriesMeansNoNetworkCallAtAllAndAnEmptyContext() async {
        let client = FakeWikimedia()
        let context = await retrieval(client).retrieve(RetrievalRequest(placeNames: ["", "  "]))
        XCTAssertTrue(context.isEmpty)
        XCTAssertTrue(client.searchCalls.isEmpty, "nothing to search for, so nothing leaves the device")
    }

    func testRegionHintSharpensTheSearchTermButIsNotRepeatedWhenAlreadyPresent() async {
        let client = FakeWikimedia()
        _ = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Santa Teresa", "Cusco Peru"], regionHint: "Peru"))

        XCTAssertEqual(client.searchCalls.map(\.query), ["Santa Teresa Peru", "Cusco Peru"],
                       "the hint is appended once, and never doubled up")
    }

    func testSearchLimitPerQueryIsPassedThroughToTheClient() async {
        let client = FakeWikimedia()
        _ = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Machu Picchu"], searchLimitPerQuery: 7))
        XCTAssertEqual(client.searchCalls.first?.limit, 7)
    }

    // MARK: - Candidate collection / de-dup (DEFECT 1)

    /// The fix: de-dup is per project. Wikipedia is searched first, so a global `seenTitles` meant
    /// Wikivoyage was **never** fetched for a title Wikipedia had already returned — defeating the
    /// exact case the file exists for, since the route nickname lives on Wikivoyage under the *same*
    /// title.
    func testSameTitleIsFetchedFromBothProjectsNotJustTheFirst() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("Lemosho Route")],
                                .wikivoyage: [hit("Lemosho Route")]]
        client.summariesByKey = [
            FakeWikimedia.key(.wikipedia, "Lemosho Route"):
                WikimediaSummary(title: "Lemosho Route", extract: "A route on Kilimanjaro.",
                                 coordinate: [37.20, -3.05]),
            FakeWikimedia.key(.wikivoyage, "Lemosho Route"):
                WikimediaSummary(title: "Lemosho Route", extract: "Also known as the Whiskey Route.",
                                 coordinate: [37.20, -3.05]),
        ]

        let context = await retrieval(client).retrieve(
            RetrievalRequest(placeNames: ["Lemosho Route"], coordinate: [37.25, -3.10]))

        XCTAssertEqual(context.articles.map(\.project), [.wikipedia, .wikivoyage])
        XCTAssertEqual(context.sourceTitles,
                       ["Lemosho Route — Wikipedia", "Lemosho Route — Wikivoyage"])
        XCTAssertTrue(context.referenceText.contains("Whiskey Route"),
                      "the Wikivoyage prose is the whole point of consulting a second project")
    }

    func testARepeatedTitleWithinOneProjectIsStillDeDuped() async {
        let client = FakeWikimedia()
        // Two queries, same project, same hit each time.
        client.hitsByProject = [.wikipedia: [hit("Machu Picchu")]]
        client.summariesByKey = [
            FakeWikimedia.key(.wikipedia, "Machu Picchu"):
                WikimediaSummary(title: "Machu Picchu", extract: "15th-century Inca citadel.",
                                 coordinate: [-72.545, -13.163]),
        ]

        let context = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Machu Picchu", "Aguas Calientes"],
                             coordinate: [-72.54, -13.16]))

        XCTAssertEqual(client.searchCalls.count, 2, "both names are searched")
        XCTAssertEqual(client.summaryCalls.count, 1, "but the duplicate title is fetched once")
        XCTAssertEqual(context.articles.count, 1)
    }

    func testCandidateOrderIsSpecificNameFirstAndWikipediaBeforeWikivoyage() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("W1")], .wikivoyage: [hit("V1")]]
        _ = await retrieval(client).retrieve(RetrievalRequest(placeNames: ["A", "B"]))

        XCTAssertEqual(client.searchCalls.map { "\($0.query)/\($0.project.rawValue)" },
                       ["A/wikipedia", "A/wikivoyage", "B/wikipedia", "B/wikivoyage"])
    }

    // MARK: - Geo-verification: the ~50 km rule

    func testArticleWithinFiftyKilometresIsAccepted() {
        // ~11 km north of the day.
        let verdict = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [37.25, -3.00], dayCoordinate: [37.25, -3.10],
            title: "Shira Plateau", suppliedNames: ["Shira Camp"], type: "standard", maxKm: 50)
        XCTAssertTrue(verdict.isAccepted)
    }

    /// The documented poisoning case: "Santa Teresa, Costa Rica" for a Peruvian trek day.
    func testArticleBeyondFiftyKilometresIsRejectedWithADistanceReason() {
        let verdict = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [-85.17, 9.65],      // Santa Teresa, Costa Rica
            dayCoordinate: [-72.54, -13.16],        // the Inca Trail
            title: "Santa Teresa", suppliedNames: ["Santa Teresa"], type: "standard", maxKm: 50)
        XCTAssertFalse(verdict.isAccepted)
        guard case let .reject(reason) = verdict else { return XCTFail("expected a rejection") }
        XCTAssertTrue(reason.contains("km away"), "the eval harness shows why: \(reason)")
        XCTAssertFalse(reason.contains("nan"))
    }

    /// Distance beats the name: a same-named article in the wrong hemisphere is still refused.
    func testDistanceRuleOverridesAnExactNameMatchWhenBothCoordinatesExist() {
        let verdict = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [-85.17, 9.65], dayCoordinate: [-72.54, -13.16],
            title: "Santa Teresa", suppliedNames: ["Santa Teresa"], type: "standard", maxKm: 50)
        XCTAssertFalse(verdict.isAccepted)
    }

    func testTheFiftyKilometreThresholdIsInclusiveAndConfigurable() {
        // 1° of latitude ≈ 111 km, so 0.2° ≈ 22 km: inside 50, outside 10.
        let near = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [37.25, -2.90], dayCoordinate: [37.25, -3.10],
            title: "X", suppliedNames: [], type: nil, maxKm: 50)
        let far = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [37.25, -2.90], dayCoordinate: [37.25, -3.10],
            title: "X", suppliedNames: [], type: nil, maxKm: 10)
        XCTAssertTrue(near.isAccepted)
        XCTAssertFalse(far.isAccepted)
    }

    func testDisambiguationPagesNeverGroundEvenAtTheExactCoordinate() {
        let verdict = KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [37.25, -3.10], dayCoordinate: [37.25, -3.10],
            title: "Kilimanjaro", suppliedNames: ["Kilimanjaro"], type: "Disambiguation", maxKm: 50)
        XCTAssertFalse(verdict.isAccepted, "a list of links is not prose")
    }

    // MARK: - The name-match exemption for place-less topics

    func testCoordinatelessArticleIsAcceptedOnlyWhenItsTitleNearlyMatchesASuppliedName() {
        // "Inca Trail" is legitimately place-less — the case the exemption exists for.
        XCTAssertTrue(KnowledgeRetrieval.geoVerdict(
            articleCoordinate: nil, dayCoordinate: [-72.54, -13.16],
            title: "Inca Trail", suppliedNames: ["Inca Trail"], type: nil, maxKm: 50).isAccepted)
        // A stray coordinate-less "Santa Teresa" is not.
        XCTAssertFalse(KnowledgeRetrieval.geoVerdict(
            articleCoordinate: nil, dayCoordinate: [-72.54, -13.16],
            title: "Santa Teresa", suppliedNames: ["Inca Trail"], type: nil, maxKm: 50).isAccepted)
    }

    func testNearExactMatchFoldsCaseDiacriticsPunctuationAndAParentheticalDisambiguator() {
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Machu Picchu", name: "machu picchu"))
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Santa Teresa (Peru)",
                                                          name: "Santa Teresa"))
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Barranco-Camp", name: "Barranco Camp"))
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Mount Kilimanjaro",
                                                          name: "Kilimanjaro"),
                      "the 'Mount X' vs 'X' case the containment rule exists for")
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Barafu", name: "Barafu Camp"))
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "Cusco", name: "Machu Picchu"))
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "", name: "Barafu Camp"))
    }

    /// The known over-accept, now closed: a bare generic article title must not match by containment.
    func testBareGenericArticleTitlesNoLongerMatchByContainment() {
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "Camp", name: "Barafu Camp"))
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "Trail", name: "Inca Trail"))
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "Base Camp", name: "Barafu Base Camp"))
        XCTAssertFalse(KnowledgeRetrieval.isNearExactMatch(title: "National Park",
                                                           name: "Kilimanjaro National Park"))
        // …while a distinctive word, and an exactly-equal degenerate name, still match.
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Barafu", name: "Barafu Camp"))
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Camp", name: "Camp"))
        XCTAssertTrue(KnowledgeRetrieval.isNearExactMatch(title: "Kilimanjaro National Park",
                                                          name: "Kilimanjaro"))
    }

    func testIsGenericPlaceTermRequiresEveryWordToBeGeneric() {
        XCTAssertTrue(KnowledgeRetrieval.isGenericPlaceTerm("camp"))
        XCTAssertTrue(KnowledgeRetrieval.isGenericPlaceTerm("base camp"))
        XCTAssertFalse(KnowledgeRetrieval.isGenericPlaceTerm("machame camp"))
        XCTAssertFalse(KnowledgeRetrieval.isGenericPlaceTerm("mount kilimanjaro"))
        XCTAssertFalse(KnowledgeRetrieval.isGenericPlaceTerm(""))
    }

    // MARK: - The coordinate guard (DEFECT 2)

    /// A hand-added day carries **empty** `coordinates` — the one path where the name-match rule
    /// actually governs rather than the distance branch, so it has to be reached, not indexed into.
    func testHandAddedDayWithNoCoordinateFallsBackToTheNameRuleInsteadOfDistance() {
        for dayCoordinate in [[], [37.25]] as [[Double]] {
            XCTAssertTrue(KnowledgeRetrieval.geoVerdict(
                articleCoordinate: [37.25, -3.10], dayCoordinate: dayCoordinate,
                title: "Barafu Camp", suppliedNames: ["Barafu Camp"], type: nil, maxKm: 50).isAccepted,
                "a named match still grounds a day we cannot place (\(dayCoordinate))")
            XCTAssertFalse(KnowledgeRetrieval.geoVerdict(
                articleCoordinate: [37.25, -3.10], dayCoordinate: dayCoordinate,
                title: "Santa Teresa", suppliedNames: ["Barafu Camp"], type: nil, maxKm: 50).isAccepted,
                "…but an unrelated article is not admitted just because we cannot measure it")
        }
    }

    /// A non-finite coordinate used to make `distanceKm` return NaN, and `NaN <= maxKm` is false — so
    /// one garbage fix silently rejected *every* coordinate-bearing article instead of degrading to
    /// the name rule.
    func testNonFiniteCoordinatesAreTreatedAsAbsentRatherThanInfinitelyFarAway() {
        XCTAssertNil(KnowledgeRetrieval.usableCoordinate([Double.nan, -3.10]))
        XCTAssertNil(KnowledgeRetrieval.usableCoordinate([37.25, .infinity]))
        XCTAssertNil(KnowledgeRetrieval.usableCoordinate([]))
        XCTAssertNil(KnowledgeRetrieval.usableCoordinate(nil))
        XCTAssertEqual(KnowledgeRetrieval.usableCoordinate([37.25, -3.10]), [37.25, -3.10])

        XCTAssertTrue(KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [37.25, -3.10], dayCoordinate: [.nan, .nan],
            title: "Barafu Camp", suppliedNames: ["Barafu Camp"], type: nil, maxKm: 50).isAccepted)
        XCTAssertTrue(KnowledgeRetrieval.geoVerdict(
            articleCoordinate: [.nan, .nan], dayCoordinate: [37.25, -3.10],
            title: "Barafu Camp", suppliedNames: ["Barafu Camp"], type: nil, maxKm: 50).isAccepted,
            "an unusable article coordinate means 'no coordinate', not 'wrong place'")
    }

    // MARK: - Context assembly & the UTF-8 byte budget

    func testAssembleContextAddsWholeArticlesUntilTheByteBudgetIsSpent() {
        let articles = (1...4).map {
            RetrievedArticle(title: "T\($0)", extract: String(repeating: "a", count: 100),
                             project: .wikipedia, coordinate: nil, url: nil)
        }
        let context = KnowledgeRetrieval.assembleContext(from: articles, maxBytes: 260)

        XCTAssertEqual(context.articles.count, 2, "two whole articles fit; the rest are dropped")
        XCTAssertLessThanOrEqual(context.referenceText.utf8.count, 260)
        XCTAssertTrue(context.referenceText.contains("[T1 — Wikipedia]"), "each block is titled")
        XCTAssertTrue(context.referenceText.contains("\n\n"), "blocks are blank-line separated")
        XCTAssertEqual(context.sourceTitles, ["T1 — Wikipedia", "T2 — Wikipedia"])
    }

    func testTheBudgetIsCountedInUTF8BytesNotCharacters() {
        // Each "é" is 2 UTF-8 bytes, so 60 characters are 120 bytes.
        let article = RetrievedArticle(title: "T", extract: String(repeating: "é", count: 60),
                                       project: .wikipedia, coordinate: nil, url: nil)
        let context = KnowledgeRetrieval.assembleContext(from: [article], maxBytes: 60)

        XCTAssertLessThanOrEqual(context.referenceText.utf8.count, 60)
        XCTAssertFalse(context.referenceText.isEmpty, "the first article is truncated, never dropped")
    }

    func testTruncationPrefersASentenceThenAWordBoundaryAndNeverSplitsACharacter() {
        let text = "First sentence here. Second sentence follows on."
        XCTAssertEqual(KnowledgeRetrieval.truncated(text, toBytes: 1000), text, "under budget: untouched")
        let atSentence = KnowledgeRetrieval.truncated(text, toBytes: 30)
        XCTAssertEqual(atSentence, "First sentence here.", "cut at the sentence end")

        let noSentence = KnowledgeRetrieval.truncated("aaa bbb ccc ddd", toBytes: 9)
        XCTAssertEqual(noSentence, "aaa bbb", "no sentence end in budget → last word boundary")

        // A multi-byte string cut mid-character would be invalid UTF-8 or a replacement char.
        let accented = KnowledgeRetrieval.truncated(String(repeating: "é", count: 20), toBytes: 7)
        XCTAssertLessThanOrEqual(accented.utf8.count, 7)
        XCTAssertFalse(accented.contains("\u{FFFD}"))
        XCTAssertEqual(KnowledgeRetrieval.truncated("anything", toBytes: 0), "")
    }

    func testMaxArticlesAndMaxSummaryFetchesBothCapTheWork() async {
        let client = FakeWikimedia()
        let titles = (1...6).map { "Place \($0)" }
        client.hitsByProject = [.wikipedia: titles.map { hit($0) }]
        for title in titles {
            client.summariesByKey[FakeWikimedia.key(.wikipedia, title)] =
                WikimediaSummary(title: title, extract: "Prose about \(title).",
                                 coordinate: [37.25, -3.10])
        }

        let capped = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Kilimanjaro"], coordinate: [37.25, -3.10],
                             searchLimitPerQuery: 6, maxArticles: 2))
        XCTAssertEqual(capped.articles.count, 2, "stops accepting at maxArticles")

        let fetchCapped = FakeWikimedia()
        fetchCapped.hitsByProject = client.hitsByProject
        // No summaries registered → every fetch misses, so the fetch cap is what stops the loop.
        _ = await retrieval(fetchCapped, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Kilimanjaro"], coordinate: [37.25, -3.10],
                             searchLimitPerQuery: 6, maxSummaryFetches: 3))
        XCTAssertEqual(fetchCapped.summaryCalls.count, 3, "stops fetching at maxSummaryFetches")
    }

    func testSummariesAreFetchedByTheSearchHitsURLKeyNotItsDisplayTitle() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("Machu Picchu", key: "Machu_Picchu")]]
        _ = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Machu Picchu"]))
        XCTAssertEqual(client.summaryCalls.map(\.title), ["Machu_Picchu"])
    }

    // MARK: - Never an error: every failure degrades to an empty context

    func testAThrowingSearchDegradesToAnEmptyContext() async {
        let client = FakeWikimedia()
        client.searchThrows = true
        let context = await retrieval(client).retrieve(
            RetrievalRequest(placeNames: ["Machu Picchu"], coordinate: [-72.54, -13.16]))
        XCTAssertTrue(context.isEmpty)
        XCTAssertEqual(context.referenceText, "")
        XCTAssertTrue(context.sourceTitles.isEmpty)
    }

    func testAThrowingSummaryFetchDegradesToAnEmptyContext() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("Machu Picchu")]]
        client.summaryThrows = true
        let context = await retrieval(client).retrieve(RetrievalRequest(placeNames: ["Machu Picchu"]))
        XCTAssertTrue(context.isEmpty)
    }

    func testNoSearchHitsAndMissingSummariesBothDegradeToEmpty() async {
        let noHits = FakeWikimedia()
        let withoutHits = await retrieval(noHits).retrieve(RetrievalRequest(placeNames: ["Nowhere"]))
        XCTAssertTrue(withoutHits.isEmpty)

        let noSummaries = FakeWikimedia()
        noSummaries.hitsByProject = [.wikipedia: [hit("Nowhere")]]
        let withoutSummaries = await retrieval(noSummaries).retrieve(
            RetrievalRequest(placeNames: ["Nowhere"]))
        XCTAssertTrue(withoutSummaries.isEmpty)
    }

    func testAnArticleWithABlankExtractIsSkippedRatherThanGroundingWithNothing() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("Blank"), hit("Real")]]
        client.summariesByKey = [
            FakeWikimedia.key(.wikipedia, "Blank"):
                WikimediaSummary(title: "Blank", extract: "   \n ", coordinate: [37.25, -3.10]),
            FakeWikimedia.key(.wikipedia, "Real"):
                WikimediaSummary(title: "Real", extract: "Actual prose.", coordinate: [37.25, -3.10]),
        ]

        let context = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Kilimanjaro"], coordinate: [37.25, -3.10]))

        XCTAssertEqual(context.articles.map(\.title), ["Real"])
    }

    func testEveryRejectedCandidateYieldsAnEmptyContextNotAPartialOne() async {
        let client = FakeWikimedia()
        client.hitsByProject = [.wikipedia: [hit("Santa Teresa")]]
        client.summariesByKey = [
            FakeWikimedia.key(.wikipedia, "Santa Teresa"):
                WikimediaSummary(title: "Santa Teresa", extract: "A town in Costa Rica.",
                                 coordinate: [-85.17, 9.65]),
        ]
        let context = await retrieval(client, projects: [.wikipedia]).retrieve(
            RetrievalRequest(placeNames: ["Santa Teresa"], coordinate: [-72.54, -13.16],
                             regionHint: "Peru"))
        XCTAssertTrue(context.isEmpty, "grounding is all-or-nothing per run; wrong prose is worse than none")
    }

    // MARK: - End to end

    func testAFullRunGroundsTheDayAndCarriesProvenance() async {
        let client = FakeWikimedia()
        client.hitsByProject = [
            .wikipedia: [hit("Machu Picchu"), hit("Santa Teresa")],
            .wikivoyage: [hit("Inca Trail")],
        ]
        client.summariesByKey = [
            FakeWikimedia.key(.wikipedia, "Machu Picchu"):
                WikimediaSummary(title: "Machu Picchu", extract: "A 15th-century Inca citadel.",
                                 coordinate: [-72.545, -13.163], type: "standard",
                                 url: "https://en.wikipedia.org/wiki/Machu_Picchu"),
            // Rejected: 6000 km away.
            FakeWikimedia.key(.wikipedia, "Santa Teresa"):
                WikimediaSummary(title: "Santa Teresa", extract: "A town in Costa Rica.",
                                 coordinate: [-85.17, 9.65], type: "standard"),
            // Accepted on the name exemption: a place-less topic with no coordinates.
            FakeWikimedia.key(.wikivoyage, "Inca Trail"):
                WikimediaSummary(title: "Inca Trail", extract: "The classic four-day trek.",
                                 coordinate: nil, type: "standard"),
        ]

        let context = await retrieval(client).retrieve(
            RetrievalRequest(placeNames: ["Machu Picchu", "Inca Trail"],
                             coordinate: [-72.54, -13.16], regionHint: "Peru"))

        XCTAssertEqual(context.articles.map(\.title), ["Machu Picchu", "Inca Trail"])
        XCTAssertEqual(context.sourceTitles,
                       ["Machu Picchu — Wikipedia", "Inca Trail — Wikivoyage"])
        XCTAssertTrue(context.referenceText.contains("15th-century Inca citadel"))
        XCTAssertFalse(context.referenceText.contains("Costa Rica"),
                       "the geo-rejected article never reaches the model")
        XCTAssertEqual(context.articles.first?.url, "https://en.wikipedia.org/wiki/Machu_Picchu")
        XCTAssertFalse(context.isEmpty)
    }

    func testEmptyContextConstantIsTrulyEmpty() {
        XCTAssertTrue(KnowledgeContext.empty.isEmpty)
        XCTAssertEqual(KnowledgeContext.empty.referenceText, "")
        XCTAssertTrue(KnowledgeContext.empty.sourceTitles.isEmpty)
    }

    func testProjectHostsAndLabelsAreTheEnglishWikimediaEndpoints() {
        XCTAssertEqual(WikimediaProject.wikipedia.host, "en.wikipedia.org")
        XCTAssertEqual(WikimediaProject.wikivoyage.host, "en.wikivoyage.org")
        XCTAssertEqual(WikimediaProject.wikipedia.label, "Wikipedia")
        XCTAssertEqual(WikimediaProject.wikivoyage.label, "Wikivoyage")
        XCTAssertEqual(RetrievedArticle(title: "X", extract: "", project: .wikivoyage,
                                        coordinate: nil, url: nil).sourceTitle, "X — Wikivoyage")
    }
}
