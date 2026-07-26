import Foundation

/// **Wikipedia/Wikivoyage-grounded knowledge retrieval** — the retrieval half of the
/// retrieval-augmented drafting pipeline (COMMERCIALIZATION-PLAN §10, "the Whiskey Route gap").
///
/// The on-device model cannot *know* that the Lemosho route is nicknamed the "Whiskey Route" or that
/// Machu Picchu is a 15th-century Inca citadel — that knowledge isn't reliably in a ~3B model, and
/// asking it to invent produces confident nonsense. So instead of asking the model to *recall*, we
/// **retrieve** real reference text from Wikipedia and Wikivoyage's public REST APIs and hand it to
/// the model as source material it may only paraphrase (see `FactDrafter` / `DayNoteDrafter`).
///
/// ## What leaves the device
/// Only **place-name queries** ("Machu Picchu", "Barafu Camp", "Kilimanjaro") — no coordinates, no
/// photos, no user text — reach Wikimedia's public endpoints. No key, no account, no server of ours.
/// A polite `User-Agent` per Wikimedia's API etiquette identifies the app. Calls are tiny (a few KB
/// of article summary) so they are allowed on cellular, unlike the multi-GB photo sync.
///
/// ## The quality lynchpin: GEO-VERIFICATION
/// Search for "Santa Teresa" and Wikipedia offers a dozen towns on three continents. Grounding a
/// Peruvian trek day in "Santa Teresa, Costa Rica" would poison the facts *confidently*. So every
/// candidate article's summary carries `coordinates`, and we **reject any article whose coordinates
/// are farther than ~50 km from the day's own coordinate** (`maxKmFromCoordinate`). An article with
/// no coordinates is rejected too — UNLESS its title near-exactly matches one of the supplied names
/// (a route/topic like "Inca Trail" is legitimately place-less; a random "Santa Teresa" is not).
/// See `geoVerdict(...)`, which is pure and exhaustively unit-tested.
///
/// ## Never an error
/// Every failure — no network, a 404, a decode error, a timeout — degrades to an **empty context**,
/// never a thrown error. The drafters then fall back to their existing ungrounded-but-fact-
/// constrained behaviour. Retrieval only ever *improves* a draft; it never blocks one.
///
/// The HTTP client sits behind the `WikimediaClient` seam so the whole orchestration (query building,
/// candidate collection, geo-verification, context capping) is unit-tested with an in-memory fake;
/// the real `URLSession` adapter is `LiveWikimediaClient` at the bottom of the file.

// MARK: - Projects

/// The two Wikimedia projects we draw on. Same REST API family, different prose: Wikipedia for
/// encyclopaedic facts/history, Wikivoyage for travel-focused description (route nicknames, what a
/// place is *like* to visit).
enum WikimediaProject: String, CaseIterable, Equatable {
    case wikipedia
    case wikivoyage

    /// English-language host. (We only query the English projects — the app's reference prose is
    /// English, and the on-device model is prompted in English.)
    var host: String {
        switch self {
        case .wikipedia: return "en.wikipedia.org"
        case .wikivoyage: return "en.wikivoyage.org"
        }
    }

    /// Human label used for provenance / the reference-text header.
    var label: String {
        switch self {
        case .wikipedia: return "Wikipedia"
        case .wikivoyage: return "Wikivoyage"
        }
    }
}

// MARK: - Value types (no URLSession in the seam)

/// One search hit: the title (display) and key (URL form), flattened so tests never touch JSON.
struct WikimediaSearchHit: Equatable {
    var title: String
    /// URL/path form of the title (spaces → underscores), used to fetch the summary. Falls back to
    /// `title` when a project doesn't return one.
    var key: String
    /// Short one-line description from the search index, if any ("15th-century Inca citadel").
    var description: String?
}

/// One page summary: the extract prose plus the coordinates that power geo-verification.
struct WikimediaSummary: Equatable {
    var title: String
    var extract: String
    /// `[lng, lat]` if the article carries coordinates, else nil.
    var coordinate: [Double]?
    /// REST `type` — "standard", "disambiguation", … Disambiguation pages are never grounding.
    var type: String?
    /// Canonical article URL, for provenance.
    var url: String?

    init(title: String, extract: String, coordinate: [Double]? = nil,
         type: String? = nil, url: String? = nil) {
        self.title = title
        self.extract = extract
        self.coordinate = coordinate
        self.type = type
        self.url = url
    }
}

/// A geo-verified article accepted as grounding, with its source project for provenance.
struct RetrievedArticle: Equatable {
    var title: String
    var extract: String
    var project: WikimediaProject
    var coordinate: [Double]?
    var url: String?

    /// Provenance label the drafters log ("Machu Picchu — Wikipedia").
    var sourceTitle: String { "\(title) — \(project.label)" }
}

/// The assembled grounding for one drafting request: the accepted articles, the capped reference
/// text handed to the model, and the source titles (logged as provenance).
struct KnowledgeContext: Equatable {
    var articles: [RetrievedArticle]
    /// The reference block spliced into the prompt (already capped to `maxContextBytes`).
    var referenceText: String
    /// One provenance string per grounding article, in acceptance order.
    var sourceTitles: [String]

    var isEmpty: Bool { articles.isEmpty }

    static let empty = KnowledgeContext(articles: [], referenceText: "", sourceTitles: [])
}

/// What a retrieval run is grounded in. `placeNames` are ordered most-specific first (camp / POIs
/// before locality); `coordinate` is the day (or journey) `[lng, lat]` used for geo-verification —
/// nil disables the *distance* check and falls back to name-match acceptance.
struct RetrievalRequest: Equatable {
    var placeNames: [String]
    var coordinate: [Double]?
    /// Extra disambiguating context appended to searches (e.g. country) — never grounding itself.
    var regionHint: String?

    // Budgets (documented defaults; overridable in tests).
    var maxQueries: Int
    var searchLimitPerQuery: Int
    var maxSummaryFetches: Int
    var maxArticles: Int
    var maxContextBytes: Int
    var maxKmFromCoordinate: Double

    init(placeNames: [String], coordinate: [Double]? = nil, regionHint: String? = nil,
         maxQueries: Int = 4, searchLimitPerQuery: Int = 3, maxSummaryFetches: Int = 8,
         maxArticles: Int = 4, maxContextBytes: Int = 5_000, maxKmFromCoordinate: Double = 50) {
        self.placeNames = placeNames
        self.coordinate = coordinate
        self.regionHint = regionHint
        self.maxQueries = maxQueries
        self.searchLimitPerQuery = searchLimitPerQuery
        self.maxSummaryFetches = maxSummaryFetches
        self.maxArticles = maxArticles
        self.maxContextBytes = maxContextBytes
        self.maxKmFromCoordinate = maxKmFromCoordinate
    }

    /// Distinct, non-empty search queries in priority order, capped to `maxQueries`.
    var queries: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for name in placeNames {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            let key = trimmed.lowercased()
            guard !trimmed.isEmpty, !seen.contains(key) else { continue }
            seen.insert(key)
            out.append(trimmed)
            if out.count >= maxQueries { break }
        }
        return out
    }
}

// MARK: - Seam

/// The minimal Wikimedia surface the orchestrator depends on. Both calls throw on transport/decoding
/// failure; the orchestrator swallows every throw into an empty result, so a flaky network never
/// surfaces as an error to the user.
protocol WikimediaClient {
    /// Full-text search for candidate article titles on a project.
    func search(query: String, project: WikimediaProject, limit: Int) async throws -> [WikimediaSearchHit]
    /// The page summary (extract + coordinates) for a title on a project, or nil when absent.
    func summary(title: String, project: WikimediaProject) async throws -> WikimediaSummary?
}

// MARK: - Geo-verification (pure)

/// The outcome of geo-verifying one candidate article against the day's coordinate. `.reject`
/// carries a human reason so the DEBUG eval harness can show *why* the wrong "Santa Teresa" was
/// refused.
enum GeoVerdict: Equatable {
    case accept
    case reject(reason: String)

    var isAccepted: Bool { if case .accept = self { return true } else { return false } }
}

extension KnowledgeRetrieval {

    /// Decide whether an article may ground a day, from its coordinates and title alone. **This is
    /// the quality lynchpin.** The rules, in order:
    ///
    /// 1. **Disambiguation pages** never ground (they are lists of links, not prose).
    /// 2. **Article has coordinates + we have a day coordinate:** accept iff within
    ///    `maxKm`; otherwise reject (this is what refuses "Santa Teresa, Costa Rica" for a Peru day).
    /// 3. **Article has coordinates but we have NO day coordinate:** we cannot check distance, so
    ///    accept only when the title near-exactly matches a supplied name; otherwise reject.
    /// 4. **Article has NO coordinates:** reject UNLESS the title near-exactly matches a supplied
    ///    name — a legitimately place-less topic (a route/trail like "Inca Trail") is allowed, a
    ///    stray coordinate-less "Santa Teresa" is not.
    static func geoVerdict(articleCoordinate: [Double]?, dayCoordinate: [Double]?,
                           title: String, suppliedNames: [String], type: String?,
                           maxKm: Double) -> GeoVerdict {
        if let type, type.lowercased() == "disambiguation" {
            return .reject(reason: "disambiguation page")
        }
        let nameMatches = suppliedNames.contains { isNearExactMatch(title: title, name: $0) }

        if let article = usableCoordinate(articleCoordinate) {
            guard let day = usableCoordinate(dayCoordinate) else {
                return nameMatches
                    ? .accept
                    : .reject(reason: "no day coordinate to verify against and title is not a near-exact match")
            }
            let km = PhotoDayMatcher.distanceKm(day[1], day[0], article[1], article[0])
            if km <= maxKm {
                return .accept
            }
            return .reject(reason: String(format: "%.0f km away (> %.0f km)", km, maxKm))
        }

        // No usable coordinates on the article.
        return nameMatches
            ? .accept
            : .reject(reason: "no coordinates and title is not a near-exact match of a supplied name")
    }

    /// A coordinate we can actually do distance arithmetic with: present, at least `[lng, lat]`, and
    /// **finite**. Anything else is treated as *absent*, which routes the decision to the name-match
    /// rule instead of the distance rule.
    ///
    /// The count part matters because a **hand-added day carries empty `coordinates`** — the one path
    /// where the name-match heuristic actually governs rather than the distance branch, so it must be
    /// reached rather than crashed past. The finiteness part matters because `distanceKm` over a NaN
    /// coordinate returns NaN, and `NaN <= maxKm` is `false`: a single garbage fix would have silently
    /// rejected *every* coordinate-bearing article and turned grounding off altogether, with a
    /// distance in the reject reason ("nan km away") rather than an honest "can't verify".
    static func usableCoordinate(_ coordinate: [Double]?) -> [Double]? {
        guard let coordinate, coordinate.count >= 2,
              coordinate[0].isFinite, coordinate[1].isFinite else { return nil }
        return coordinate
    }

    /// Whether an article title near-exactly matches a supplied place name. Both are normalised
    /// (lower-cased, diacritics folded, punctuation stripped) and a trailing parenthetical
    /// disambiguator on the title ("Santa Teresa (Peru)") is dropped before comparison. A supplied
    /// name that merely *contains* the title (or vice-versa) as its whole leading token also counts,
    /// so "Kilimanjaro" matches the article "Mount Kilimanjaro".
    ///
    /// **Containment requires a distinctive title.** Without that rule, the whole-phrase containment
    /// below accepted a bare generic article for any name ending in that word: the article "Camp"
    /// matched "Barafu Camp", "Trail" matched "Inca Trail", "Pass" matched "Karanga Pass". Since a
    /// coordinate-less article is admitted *solely* on a name match, that is the one path where a
    /// generic hit becomes grounding — the model would then be handed an encyclopaedia entry on the
    /// concept of camping as source material for a day on Kilimanjaro. Exact equality still passes
    /// (a supplied name that really is just "Camp" is degenerate, not a mismatch); only the
    /// containment shortcut is closed.
    static func isNearExactMatch(title: String, name: String) -> Bool {
        let t = normalize(stripParenthetical(title))
        let n = normalize(name)
        guard !t.isEmpty, !n.isEmpty else { return false }
        if t == n { return true }
        guard !isGenericPlaceTerm(t) else { return false }
        // Whole-phrase containment either direction (guards against "Mount X" vs "X").
        if t.hasSuffix(" " + n) || t.hasPrefix(n + " ") { return true }
        if n.hasSuffix(" " + t) || n.hasPrefix(t + " ") { return true }
        return false
    }

    /// Whether an already-normalised title is *only* generic geographic vocabulary — the feature-type
    /// words that appear in thousands of place names and identify nothing on their own. Kept
    /// deliberately small and literal: every entry is a word that has actually shown up as a bare
    /// Wikipedia/Wikivoyage article title. A multi-word title counts as generic only when **every**
    /// word does ("base camp"), so "Machame Camp" and "Mount Kilimanjaro" are unaffected.
    static func isGenericPlaceTerm(_ normalized: String) -> Bool {
        let words = normalized.split(separator: " ")
        guard !words.isEmpty else { return false }
        return words.allSatisfy { genericPlaceTerms.contains(String($0)) }
    }

    private static let genericPlaceTerms: Set<String> = [
        "camp", "camps", "campsite", "base", "hut", "huts", "lodge", "shelter", "refuge",
        "trail", "trails", "track", "path", "route", "trek", "trekking", "hike", "hiking",
        "mount", "mountain", "mountains", "hill", "peak", "peaks", "summit", "ridge", "crater",
        "glacier", "pass", "gap", "col", "saddle", "valley", "gorge", "canyon", "cave",
        "lake", "lakes", "river", "stream", "waterfall", "falls", "spring", "springs",
        "gate", "gates", "bridge", "point", "viewpoint", "junction", "crossing",
        "park", "national", "reserve", "forest", "village", "town", "city", "island",
        "north", "south", "east", "west", "upper", "lower", "old", "new",
    ]

    /// Drop a trailing "(...)" disambiguator from a title.
    static func stripParenthetical(_ title: String) -> String {
        guard let open = title.firstIndex(of: "(") else { return title }
        return String(title[title.startIndex..<open])
    }

    /// Lower-case, fold diacritics, collapse punctuation to spaces, squeeze whitespace.
    static func normalize(_ s: String) -> String {
        let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
        let mapped = folded.map { ch -> Character in
            (ch.isLetter || ch.isNumber) ? ch : " "
        }
        return String(mapped).split(separator: " ").joined(separator: " ")
    }
}

// MARK: - Orchestrator

/// Composes the `WikimediaClient` seam into a geo-verified `KnowledgeContext`. Stateless apart from
/// the injected client and the serial courtesy delay.
struct KnowledgeRetrieval {
    let client: WikimediaClient
    /// Which projects to draw on, in order. Wikipedia first (facts/history), then Wikivoyage
    /// (travel prose). Overridable in tests.
    let projects: [WikimediaProject]
    /// Serial courtesy delay between network calls (nanoseconds) — Wikimedia asks for polite,
    /// non-parallel access. 0 in tests.
    let interCallDelayNanos: UInt64

    init(client: WikimediaClient,
         projects: [WikimediaProject] = [.wikipedia, .wikivoyage],
         interCallDelayNanos: UInt64 = 150_000_000) {
        self.client = client
        self.projects = projects
        self.interCallDelayNanos = interCallDelayNanos
    }

    /// Retrieve geo-verified grounding for a request. **Never throws** — any failure yields
    /// `.empty`. Flow: build queries from the place names → search each project for candidate titles
    /// → fetch each candidate's summary serially → geo-verify → accept until the article/byte caps
    /// are hit → assemble the capped reference text.
    func retrieve(_ request: RetrievalRequest) async -> KnowledgeContext {
        let queries = request.queries
        guard !queries.isEmpty else { return .empty }

        // 1. Collect candidate (project, hit) pairs, de-duplicated by normalised title, preserving
        //    discovery order (specific place names first, Wikipedia before Wikivoyage).
        //
        //    De-dup is keyed **per project**, not globally. A global key defeated the entire point of
        //    consulting two projects: Wikipedia is searched first, so every title it returned blocked
        //    the *same* title on Wikivoyage — and the same title is exactly the case that matters.
        //    "Lemosho Route" exists on both; only Wikivoyage's article calls it the Whiskey Route,
        //    which is the gap this file was written to close (COMMERCIALIZATION-PLAN §10). Within one
        //    project a repeated title is still a genuine duplicate and still skipped.
        var candidates: [(project: WikimediaProject, hit: WikimediaSearchHit)] = []
        var seenTitles: [WikimediaProject: Set<String>] = [:]
        for query in queries {
            let searchQuery = searchTerm(query, regionHint: request.regionHint)
            for project in projects {
                await throttle()
                let hits = (try? await client.search(query: searchQuery, project: project,
                                                     limit: request.searchLimitPerQuery)) ?? []
                for hit in hits {
                    let key = Self.normalize(hit.title)
                    guard !key.isEmpty, seenTitles[project]?.contains(key) != true else { continue }
                    seenTitles[project, default: []].insert(key)
                    candidates.append((project, hit))
                }
            }
        }
        guard !candidates.isEmpty else { return .empty }

        // 2. Fetch summaries serially and geo-verify. Stop once we hit the fetch or article caps.
        var accepted: [RetrievedArticle] = []
        var fetches = 0
        for candidate in candidates {
            if fetches >= request.maxSummaryFetches || accepted.count >= request.maxArticles { break }
            fetches += 1
            await throttle()
            guard let summary = (try? await client.summary(title: candidate.hit.key,
                                                          project: candidate.project)) ?? nil else { continue }
            let extract = summary.extract.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !extract.isEmpty else { continue }
            let verdict = Self.geoVerdict(
                articleCoordinate: summary.coordinate,
                dayCoordinate: request.coordinate,
                title: summary.title.isEmpty ? candidate.hit.title : summary.title,
                suppliedNames: request.placeNames,
                type: summary.type,
                maxKm: request.maxKmFromCoordinate)
            guard verdict.isAccepted else { continue }
            accepted.append(RetrievedArticle(
                title: summary.title.isEmpty ? candidate.hit.title : summary.title,
                extract: extract,
                project: candidate.project,
                coordinate: summary.coordinate,
                url: summary.url))
        }
        guard !accepted.isEmpty else { return .empty }

        // 3. Assemble the capped reference text.
        return Self.assembleContext(from: accepted, maxBytes: request.maxContextBytes)
    }

    /// Assemble the prompt reference block from accepted articles, capped to `maxBytes` UTF-8 bytes.
    /// Each article contributes a titled paragraph; articles are added whole until the next one
    /// would overflow the budget (a partial article is truncated at a sentence-ish boundary rather
    /// than dropped, so at least the first article always contributes). Pure + tested.
    static func assembleContext(from articles: [RetrievedArticle], maxBytes: Int) -> KnowledgeContext {
        var blocks: [String] = []
        var usedArticles: [RetrievedArticle] = []
        var budget = maxBytes
        for article in articles {
            let header = "[\(article.title) — \(article.project.label)]\n"
            let separatorCost = blocks.isEmpty ? 0 : 2  // "\n\n" between blocks
            let headerBytes = header.utf8.count
            let available = budget - separatorCost - headerBytes
            guard available > 0 else { break }
            let body = truncated(article.extract, toBytes: available)
            guard !body.isEmpty else { break }
            blocks.append(header + body)
            usedArticles.append(article)
            budget -= separatorCost + headerBytes + body.utf8.count
            if budget <= 0 { break }
        }
        return KnowledgeContext(
            articles: usedArticles,
            referenceText: blocks.joined(separator: "\n\n"),
            sourceTitles: usedArticles.map(\.sourceTitle))
    }

    /// Truncate a string to at most `maxBytes` UTF-8 bytes, preferring to cut at the last sentence
    /// end (". ") and otherwise at the last word boundary within budget, so the model never sees a
    /// word sliced mid-character.
    static func truncated(_ text: String, toBytes maxBytes: Int) -> String {
        guard maxBytes > 0 else { return "" }
        if text.utf8.count <= maxBytes { return text }
        // Walk back from the byte budget to a Character boundary.
        var end = text.startIndex
        var count = 0
        for idx in text.indices {
            let next = text.index(after: idx)
            let charBytes = String(text[idx..<next]).utf8.count
            if count + charBytes > maxBytes { break }
            count += charBytes
            end = next
        }
        var slice = String(text[text.startIndex..<end])
        // Prefer a sentence boundary, then a word boundary, within what we kept.
        if let dot = slice.range(of: ". ", options: .backwards) {
            return String(slice[slice.startIndex...dot.lowerBound])
        }
        if let space = slice.lastIndex(of: " ") {
            slice = String(slice[slice.startIndex..<space])
        }
        return slice.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The full-text query for a place name, optionally sharpened with a region hint (country) so
    /// the search index itself surfaces the right "Santa Teresa" ahead of geo-verification. The hint
    /// is only appended when it isn't already part of the name.
    private func searchTerm(_ name: String, regionHint: String?) -> String {
        guard let hint = regionHint?.trimmingCharacters(in: .whitespacesAndNewlines), !hint.isEmpty,
              !name.lowercased().contains(hint.lowercased())
        else { return name }
        return "\(name) \(hint)"
    }

    private func throttle() async {
        if interCallDelayNanos > 0 { try? await Task.sleep(nanoseconds: interCallDelayNanos) }
    }

    /// Convenience: the live URLSession-backed retrieval, with a Wikimedia-polite User-Agent built
    /// from the app version.
    static func live() -> KnowledgeRetrieval {
        KnowledgeRetrieval(client: LiveWikimediaClient(userAgent: AppInfo.wikimediaUserAgent))
    }
}

// MARK: - Live client (URLSession)

/// `URLSession`-backed Wikimedia REST client.
///   * Search:  `https://{host}/w/rest.php/v1/search/page?q={q}&limit={n}`
///   * Summary: `https://{host}/api/rest_v1/page/summary/{title}`
///
/// Every request carries the polite `User-Agent` Wikimedia's API policy asks for. Timeouts are short
/// (these are tiny fetches feeding an interactive tap); anything slower is treated as "no grounding".
struct LiveWikimediaClient: WikimediaClient {
    let userAgent: String
    var session: URLSession = .shared
    var timeout: TimeInterval = 8

    func search(query: String, project: WikimediaProject, limit: Int) async throws -> [WikimediaSearchHit] {
        var components = URLComponents()
        components.scheme = "https"
        components.host = project.host
        components.path = "/w/rest.php/v1/search/page"
        components.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(max(1, limit))),
        ]
        guard let url = components.url else { return [] }
        let data = try await get(url)
        let decoded = try JSONDecoder().decode(SearchResponse.self, from: data)
        return decoded.pages.map {
            WikimediaSearchHit(title: $0.title, key: $0.key ?? $0.title, description: $0.description)
        }
    }

    func summary(title: String, project: WikimediaProject) async throws -> WikimediaSummary? {
        // Path segment: spaces → underscores, then percent-encode everything path-unsafe.
        let underscored = title.replacingOccurrences(of: " ", with: "_")
        guard let encoded = underscored.addingPercentEncoding(withAllowedCharacters: Self.titleAllowed),
              let url = URL(string: "https://\(project.host)/api/rest_v1/page/summary/\(encoded)")
        else { return nil }
        let data = try await get(url)
        let decoded = try JSONDecoder().decode(SummaryResponse.self, from: data)
        let coordinate: [Double]? = decoded.coordinates.map { [$0.lon, $0.lat] }
        return WikimediaSummary(
            title: decoded.title ?? title,
            extract: decoded.extract ?? "",
            coordinate: coordinate,
            type: decoded.type,
            url: decoded.content_urls?.desktop?.page)
    }

    // MARK: HTTP

    private func get(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return data
    }

    /// Characters allowed unescaped in a summary title path segment. `/` is deliberately excluded so
    /// a title with a slash is fully escaped.
    private static let titleAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove("/")
        return set
    }()

    // MARK: Decoding shapes (private to the live client)

    private struct SearchResponse: Decodable { var pages: [Page] }
    private struct Page: Decodable {
        var title: String
        var key: String?
        var description: String?
    }
    private struct SummaryResponse: Decodable {
        var title: String?
        var extract: String?
        var type: String?
        var coordinates: Coordinates?
        var content_urls: ContentURLs?
    }
    private struct Coordinates: Decodable { var lat: Double; var lon: Double }
    private struct ContentURLs: Decodable { var desktop: Page? ; struct Page: Decodable { var page: String? } }
}
