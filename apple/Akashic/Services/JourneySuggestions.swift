import Foundation

/// Assisted journey creation — the coherent "Suggestions" layer over `JourneyDraft`.
///
/// As data becomes available (a route drafted from photos, a country, camp names, weather, POIs,
/// grounded facts) each result appears as a row the user can **Accept** or **dismiss**, plus a
/// batch **Accept all**. Accepted values land in the draft exactly as if typed; dismissed ones
/// vanish. Nothing is applied silently and nothing runs before the user has provided photos or a
/// route (no ambient network calls) — the view calls `run(...)` only after photos/GPX land.
///
/// This file splits cleanly into:
///   * `SuggestionModel` — a **pure** state machine (register / accept / dismiss / accept-all with
///     idempotence), unit-tested in isolation; and
///   * `JourneySuggestionCoordinator` — the `@MainActor` orchestrator that runs the providers
///     (RouteInference + PlaceEnrichment + WeatherEnrichment + FactDrafter), stores their payloads,
///     and applies an accepted key onto an `inout JourneyDraft`.

// MARK: - Keys & status

/// Stable identity of one suggestion. Per-day suggestions key on the day's id so they apply by
/// identity, never by list position (the same discipline `DayNamer` uses).
enum SuggestionKey: Hashable {
    case routeFromPhotos
    case country
    case campName(dayID: String)
    case weather(dayID: String)
    case pois(dayID: String)
    case facts(dayID: String)
}

/// A suggestion's lifecycle. `pending` until the user acts; then terminal.
enum SuggestionStatus: Equatable { case pending, accepted, dismissed }

// MARK: - Pure state machine

/// Tracks which suggestions exist and their status, preserving discovery order. Deliberately holds
/// no payloads — the coordinator owns those — so this is trivially testable.
struct SuggestionModel: Equatable {
    private(set) var order: [SuggestionKey] = []
    private(set) var status: [SuggestionKey: SuggestionStatus] = [:]

    /// Register a newly available suggestion as pending. Idempotent: a key already known (in any
    /// status) is left untouched, so a re-run never resurrects a dismissed row.
    mutating func register(_ key: SuggestionKey) {
        guard status[key] == nil else { return }
        status[key] = .pending
        order.append(key)
    }

    func statusOf(_ key: SuggestionKey) -> SuggestionStatus? { status[key] }
    func isPending(_ key: SuggestionKey) -> Bool { status[key] == .pending }

    /// Pending keys in discovery order.
    var pending: [SuggestionKey] { order.filter { status[$0] == .pending } }
    var hasPending: Bool { !pending.isEmpty }

    /// Accept a pending suggestion. Returns true only on the pending→accepted transition, so calling
    /// twice (or on an already-dismissed key) is a no-op — accept idempotence.
    @discardableResult
    mutating func accept(_ key: SuggestionKey) -> Bool {
        guard status[key] == .pending else { return false }
        status[key] = .accepted
        return true
    }

    /// Dismiss a pending suggestion. Symmetric to `accept` — dismiss idempotence.
    @discardableResult
    mutating func dismiss(_ key: SuggestionKey) -> Bool {
        guard status[key] == .pending else { return false }
        status[key] = .dismissed
        return true
    }

    /// Accept every currently pending suggestion; returns the keys that transitioned, in order.
    /// After this, `pending` is empty and a second call returns [].
    @discardableResult
    mutating func acceptAllPending() -> [SuggestionKey] {
        let keys = pending
        for key in keys { status[key] = .accepted }
        return keys
    }
}

// MARK: - Coordinator

/// Runs the suggestion providers and applies accepted results to the draft. `@MainActor` because it
/// is bound to the SwiftUI creation sheet; the heavy work is `await`ed off the main actor inside the
/// injected providers.
@MainActor
final class JourneySuggestionCoordinator: ObservableObject {

    /// The pure state machine the UI renders from — ENRICHMENT suggestions only (camp names,
    /// weather, POIs, facts, and the "just a name"/GPX country case handled below): each stays a
    /// visible Accept/dismiss row, per the policy in `apple/Docs/DESIGN-PLAN.md`'s C-series intro.
    @Published private(set) var model = SuggestionModel()
    /// C3: route-from-photos is a STRUCTURAL fact (derived from the user's OWN photo locations), so
    /// it is applied to the draft directly rather than offered as a row in `model` — but "Remove"
    /// still needs somewhere to pin "never come back", and `SuggestionModel` already has exactly
    /// that idempotence (register once; dismiss is a one-way pending→dismissed transition; a later
    /// `register` on an already-dismissed key is a no-op). A SEPARATE instance, not a case inside
    /// `model`, so the enrichment panel's "Accept all" can never sweep this hidden key up as a side
    /// effect of accepting the other rows.
    @Published private(set) var routeFromPhotosState = SuggestionModel()
    /// True while providers are in flight (drives the header spinner).
    @Published private(set) var isRunning = false

    // Payloads, keyed for application on accept.
    private(set) var routeResult: RouteInferenceResult?
    private var countryName: String?
    private var campNameByDay: [String: String] = [:]
    private var weatherByDay: [String: WeatherData] = [:]
    private var poisByDay: [String: [PointOfInterest]] = [:]
    private var factsByDay: [String: DraftedFacts] = [:]

    private let place: PlaceEnrichment
    private let weather: WeatherEnrichment
    /// Whether grounded-fact drafting is permitted (Intelligence available + Complete entitlement).
    /// Settable so the SwiftUI layer can create the coordinator up front and configure the gate once
    /// its environment objects resolve.
    var factsEnabled: Bool

    init(place: PlaceEnrichment, weather: WeatherEnrichment, factsEnabled: Bool) {
        self.place = place
        self.weather = weather
        self.factsEnabled = factsEnabled
    }

    /// Convenience for the app: live Apple providers.
    static func live(factsEnabled: Bool) -> JourneySuggestionCoordinator {
        JourneySuggestionCoordinator(place: .live(), weather: .live(), factsEnabled: factsEnabled)
    }

    // MARK: Run

    /// Run all providers for a draft snapshot. Independent providers run concurrently; per-provider
    /// calls stay serial (rate-limit friendly). Safe to call again as the draft grows — already
    /// known keys are not re-registered, so dismissed rows stay dismissed.
    ///
    /// `fixes` are the geotagged photo observations (for route inference); pass `[]` when a GPX
    /// route was imported.
    func run(fixes: [PhotoFix], draft: JourneyDraft) async {
        isRunning = true
        defer { isRunning = false }

        // 1. Route from photos — only when there is no route yet and we have photo locations.
        // Registered into `routeFromPhotosState`, NOT `model` (see the property's doc comment):
        // C3 applies this directly rather than waiting for an Accept tap.
        if !draft.hasRoute, !fixes.isEmpty {
            let result = RouteInference.infer(from: fixes)
            if !result.isEmpty {
                routeResult = result
                routeFromPhotosState.register(.routeFromPhotos)
            }
        }

        // The coordinate basis for country: the route if present, else the accepted route draft,
        // else the day medians.
        let dayCoords = draft.days.map(\.coordinates).filter { $0.count >= 2 }
        let routeCoords = draft.route?.coordinates ?? routeResult?.route.coordinates ?? []
        let basis = routeCoords.isEmpty ? dayCoords : routeCoords.map { Array($0.prefix(2)) }

        // 2. Weather runs concurrently with the place providers (independent services).
        async let weatherDone: Void = runWeather(draft: draft)

        // 3. Country + camp names + POIs (all via CLGeocoder/MKLocalSearch; serial within place).
        if draft.country.trimmingCharacters(in: .whitespaces).isEmpty,
           let centroid = PlaceEnrichment.centroid(of: basis),
           let country = await place.suggestCountry(lng: centroid[0], lat: centroid[1]) {
            countryName = country
            model.register(.country)
        }

        let dayInputs = draft.days.map {
            DayEnrichmentInput(dayID: $0.id, name: $0.name, coordinate: $0.coordinates)
        }
        for suggestion in await place.suggestCampNames(for: dayInputs) {
            campNameByDay[suggestion.dayID] = suggestion.name
            model.register(.campName(dayID: suggestion.dayID))
        }
        // POIs only for days that DON'T already have some — so enriching an existing journey never
        // re-offers points of interest a day already carries (harmless for creation, where days are
        // fresh and carry none). Keyed by identity against the draft's current day content.
        let daysWithPOIs = Set(draft.days.filter { ($0.pointsOfInterest?.isEmpty == false) }.map(\.id))
        for input in dayInputs where input.hasCoordinate && !daysWithPOIs.contains(input.dayID) {
            let result = await place.suggestPOIs(for: input)
            if !result.pois.isEmpty {
                poisByDay[result.dayID] = result.pois
                model.register(.pois(dayID: result.dayID))
            }
        }

        await weatherDone

        // 4. Grounded facts, last, because they read the place/POI names discovered above.
        if factsEnabled {
            await runFacts(draft: draft)
        }
    }

    /// Historical weather per day (needs a real date + coordinate). Days that ALREADY carry weather
    /// are skipped — so enriching an existing journey only fills the gaps and never re-offers weather
    /// a day already has (harmless for creation, where days start empty).
    private func runWeather(draft: JourneyDraft) async {
        var inputs: [WeatherDayInput] = []
        for (index, day) in draft.days.enumerated() where day.coordinates.count >= 2 && day.weather == nil {
            guard let date = JourneyDraft.weatherDate(dayIndex: index, dateLabel: day.dateLabel,
                                                      dateStarted: draft.dateStarted) else { continue }
            inputs.append(WeatherDayInput(dayID: day.id, coordinate: day.coordinates, date: date))
        }
        for suggestion in await weather.suggestWeather(for: inputs) {
            weatherByDay[suggestion.dayID] = suggestion.weather
            model.register(.weather(dayID: suggestion.dayID))
        }
    }

    /// Grounded facts per day, using the names discovered by the place/POI providers. Only for days
    /// with at least one real name to ground on. Gated by availability at the call site (`generate`
    /// is iOS-26 only), so on other builds this simply produces nothing.
    private func runFacts(draft: JourneyDraft) async {
        for (index, day) in draft.days.enumerated() {
            let placeNames = campNameByDay[day.id].map { [$0] } ?? []
            let poiNames = (poisByDay[day.id] ?? []).map(\.name)
            let campName = DayNamer.isAutoGenerated(name: day.name)
                ? (campNameByDay[day.id] ?? day.name) : day.name
            let input = DayFactInput(journeyName: draft.name, country: draft.country,
                                     dayNumber: index + 1, campName: campName,
                                     placeNames: placeNames, poiNames: poiNames,
                                     dateLabel: day.dateLabel, elevation: day.elevation)
            guard input.hasGrounding else { continue }
            #if canImport(FoundationModels)
            if #available(iOS 26.0, *) {
                if let drafted = try? await FactDrafter.generate(for: input), !drafted.isEmpty {
                    factsByDay[day.id] = drafted
                    model.register(.facts(dayID: day.id))
                }
            }
            #endif
        }
    }

    // MARK: C3 — route from photos (applied directly, not an Accept row)

    /// Apply the drafted route directly to `draft.route` — no Accept tap required, since a route
    /// inferred from the user's OWN photo locations is a structural fact, not enrichment (the C-series
    /// policy in `apple/Docs/DESIGN-PLAN.md`). Safe to call after every `run()`: a no-op once nothing
    /// is pending (either it was already applied — `routeFromPhotosState` only ever REGISTERS once —
    /// or it was removed, which is exactly what must stay a no-op forever), and guarded against
    /// clobbering a route that arrived some other way since (GPX import, hand-drawn) by only writing
    /// when the draft doesn't already have one. Returns whether it actually applied, so the caller can
    /// show the confidence line only once there is something to show.
    @discardableResult
    func applyRouteFromPhotos(into draft: inout JourneyDraft) -> Bool {
        guard draft.route == nil || draft.route!.coordinates.isEmpty else { return false }
        guard routeFromPhotosState.isPending(.routeFromPhotos), let result = routeResult else { return false }
        draft.route = result.route
        return true
    }

    /// "Remove": clear the applied route and pin the removal via `SuggestionModel`'s dismiss
    /// idempotence (dismiss only ever transitions pending → dismissed; a later `register` for an
    /// already-dismissed key is a no-op) — so a later suggestion re-run, e.g. after picking more
    /// photos, can never bring it back.
    func removeRouteFromPhotos(from draft: inout JourneyDraft) {
        draft.route = nil
        routeFromPhotosState.dismiss(.routeFromPhotos)
    }

    // MARK: Accept / dismiss

    /// Accept a suggestion: mutate the draft with its payload, then mark it accepted (idempotent).
    func accept(_ key: SuggestionKey, into draft: inout JourneyDraft) {
        guard model.isPending(key) else { return }
        apply(key, into: &draft)
        model.accept(key)
    }

    func dismiss(_ key: SuggestionKey) {
        model.dismiss(key)
    }

    /// Accept every pending suggestion, applying each payload in discovery order.
    func acceptAll(into draft: inout JourneyDraft) {
        for key in model.acceptAllPending() {
            apply(key, into: &draft)
        }
    }

    /// Apply one payload onto the draft. Kept separate from status changes so both `accept` and
    /// `acceptAll` share it.
    private func apply(_ key: SuggestionKey, into draft: inout JourneyDraft) {
        switch key {
        case .routeFromPhotos:
            // Unreachable via `model` since C3 (`routeFromPhotosState` above is where this key
            // actually lives now) — kept only so this switch stays exhaustive over `SuggestionKey`.
            if let route = routeResult?.route { draft.route = route }
        case .country:
            if let countryName, draft.country.trimmingCharacters(in: .whitespaces).isEmpty {
                draft.country = countryName
            }
        case let .campName(dayID):
            guard let name = campNameByDay[dayID],
                  let index = draft.days.firstIndex(where: { $0.id == dayID }),
                  DayNamer.isAutoGenerated(name: draft.days[index].name) else { return }
            draft.days[index].name = name
        case let .weather(dayID):
            guard let weather = weatherByDay[dayID],
                  let index = draft.days.firstIndex(where: { $0.id == dayID }) else { return }
            draft.days[index].weather = weather
        case let .pois(dayID):
            guard let pois = poisByDay[dayID],
                  let index = draft.days.firstIndex(where: { $0.id == dayID }) else { return }
            draft.days[index].pointsOfInterest = pois
        case let .facts(dayID):
            guard let facts = factsByDay[dayID],
                  let index = draft.days.firstIndex(where: { $0.id == dayID }) else { return }
            draft.days[index].funFacts = facts.funFacts
            draft.days[index].historicalSites = facts.historicalSites
        }
    }

    // MARK: Display

    /// A short day reference ("Day 3") for per-day rows, resolved against the current draft.
    private func dayLabel(_ dayID: String, in draft: JourneyDraft) -> String {
        if let index = draft.days.firstIndex(where: { $0.id == dayID }) {
            return String(localized: "Day \(index + 1)",
                          comment: "Short day reference used inside suggestion row titles, e.g. \"Day 3\".")
        }
        return String(localized: "Day",
                      comment: "Short day reference with no number, used when the day has left the draft.")
    }

    /// Row title for a suggestion key.
    ///
    /// Localised here (QUA-26) because the suggestion panel renders these with `Text(_:)` over a
    /// `String`, which is the verbatim overload — a literal would never reach the catalogue.
    func title(for key: SuggestionKey, in draft: JourneyDraft) -> String {
        switch key {
        case .routeFromPhotos:
            return String(localized: "Draft route from your photos",
                          comment: "Suggestion row title: infer the journey's route from the GPS in the user's own photos.")
        case .country:
            return String(localized: "Set country",
                          comment: "Suggestion row title: fill in the journey's country.")
        case let .campName(dayID):
            return String(localized: "Name \(dayLabel(dayID, in: draft))",
                          comment: "Suggestion row title: propose a name for one day. The placeholder is a day reference, e.g. \"Day 3\".")
        case let .weather(dayID):
            return String(localized: "Add weather · \(dayLabel(dayID, in: draft))",
                          comment: "Suggestion row title: add weather to one day. The placeholder is a day reference, e.g. \"Day 3\".")
        case let .pois(dayID):
            return String(localized: "Add points of interest · \(dayLabel(dayID, in: draft))",
                          comment: "Suggestion row title: add nearby places to one day. The placeholder is a day reference, e.g. \"Day 3\".")
        case let .facts(dayID):
            return String(localized: "Draft facts · \(dayLabel(dayID, in: draft))",
                          comment: "Suggestion row title: draft fun facts and historical notes for one day. The placeholder is a day reference, e.g. \"Day 3\".")
        }
    }

    /// Row subtitle — the concrete value being offered, so the user knows what Accept does.
    func subtitle(for key: SuggestionKey, in draft: JourneyDraft) -> String? {
        switch key {
        case .routeFromPhotos:
            return routeResult?.confidence.summary
        case .country:
            return countryName
        case let .campName(dayID):
            return campNameByDay[dayID]
        case let .weather(dayID):
            guard let w = weatherByDay[dayID] else { return nil }
            return DayNoteDrafter.weatherLine(w)
        case let .pois(dayID):
            return (poisByDay[dayID] ?? []).map(\.name).joined(separator: ", ")
        case let .facts(dayID):
            guard let facts = factsByDay[dayID] else { return nil }
            let f = facts.funFacts.count, h = facts.historicalSites.count
            var parts: [String] = []
            // Real plural keys rather than an English "s" ternary — Norwegian pluralises otherwise.
            if f > 0 {
                parts.append(String(localized: "\(f) facts",
                                    comment: "Suggestion row subtitle: how many fun facts were drafted for the day."))
            }
            if h > 0 {
                parts.append(String(localized: "\(h) notes",
                                    comment: "Suggestion row subtitle: how many historical notes were drafted for the day."))
            }
            return parts.joined(separator: ", ")
        }
    }
}
