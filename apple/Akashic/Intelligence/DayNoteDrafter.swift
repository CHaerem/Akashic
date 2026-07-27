import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// M6 v1.1 flagship — draft a day note from data we already store (COMMERCIALIZATION-PLAN §10).
///
/// The model is handed **only text metadata** we already hold for a day: the camp's name, elevation,
/// per-day distance/ascent/descent, weather, highlights; the journey's name/country; and the day's
/// photo *count* plus any captions. Photo bytes and file paths are NEVER sent — captions are text the
/// user already wrote, nothing more.
///
/// The prompt building is a **pure, testable** function (`promptComponents(for:)`) with no
/// FoundationModels dependency; only the thin `generate(...)` driver touches the session, and it is
/// gated behind `#if canImport(FoundationModels)` + `@available(iOS 26.0, *)`.

// MARK: - Input (pure value type)

/// The facts a day note is drafted from. Deliberately a plain value type so prompt building is
/// deterministic and unit-testable, and so the view layer can assemble it from `Camp` + `Photo`
/// without pulling FoundationModels into scope.
struct DayNoteInput: Equatable {
    var journeyName: String
    var country: String
    var dayNumber: Int
    var campName: String
    var elevation: Int
    var dayDistanceKm: Double
    var elevationGain: Int
    var elevationLoss: Int
    var dateLabel: String?
    var highlights: [String]
    var weather: WeatherData?
    /// Number of photos attached to this day (a count only — no paths, no bytes).
    var photoCount: Int
    /// Captions the user wrote on this day's photos (text only; empty captions omitted).
    var photoCaptions: [String]
    /// What Vision saw in this day's photographs (DIFF-05) — e.g. "glacier", "tent", "summit sign".
    ///
    /// This closes the gap between the plan and the code: §10 describes day-note drafting as working
    /// from "the day's photos (Vision labels)", and until now the drafter received a photo *count*
    /// and wrote about the day from stats and weather while the photographs sat untouched.
    ///
    /// Labels, never pixels and never paths. The images are classified on-device by
    /// `VisionPhotoScorer` and only the resulting words reach the language model, so the privacy
    /// claim the whole AI story rests on is unchanged — nothing here could leave the device even if
    /// the model ran elsewhere.
    var photoSubjects: [String] = []
    /// **Retrieved reference text** (Wikipedia/Wikivoyage) for the day's places, if a geo-verified
    /// retrieval ran (see `KnowledgeRetrieval`). When present the note is grounded strictly in it
    /// plus the day's own facts; otherwise the existing facts-only behaviour applies.
    var referenceText: String?

    /// Assemble the input from a day's `Camp`, the journey it belongs to, and the day's photos.
    /// Only photo *counts* and non-empty captions are read — the `Photo` values' paths/URLs never
    /// leave this function.
    init(journey: Journey, camp: Camp, photos: [Photo]) {
        self.journeyName = journey.shortName
        self.country = journey.country
        self.dayNumber = camp.dayNumber
        self.campName = camp.name
        self.elevation = camp.elevation
        self.dayDistanceKm = camp.dayDistance
        self.elevationGain = camp.elevationGainFromPrevious
        self.elevationLoss = camp.elevationLossFromPrevious
        self.dateLabel = camp.dateLabel
        self.highlights = camp.highlights
        self.weather = camp.weather
        self.photoCount = photos.count
        self.photoCaptions = photos.compactMap { caption in
            let trimmed = caption.caption?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (trimmed?.isEmpty == false) ? trimmed : nil
        }
        self.referenceText = nil
    }

    /// Memberwise init for tests / non-domain callers.
    init(journeyName: String, country: String, dayNumber: Int, campName: String, elevation: Int,
         dayDistanceKm: Double, elevationGain: Int, elevationLoss: Int, dateLabel: String?,
         highlights: [String], weather: WeatherData?, photoCount: Int, photoCaptions: [String],
         photoSubjects: [String] = [], referenceText: String? = nil) {
        self.journeyName = journeyName
        self.country = country
        self.dayNumber = dayNumber
        self.campName = campName
        self.elevation = elevation
        self.dayDistanceKm = dayDistanceKm
        self.elevationGain = elevationGain
        self.elevationLoss = elevationLoss
        self.dateLabel = dateLabel
        self.highlights = highlights
        self.weather = weather
        self.photoCount = photoCount
        self.photoCaptions = photoCaptions
        // Was missing: the parameter was accepted and discarded, so every caller — including tests
        // — that passed reference text silently got the ungrounded path instead.
        self.referenceText = referenceText
        self.photoSubjects = photoSubjects
    }
}

// MARK: - Why a draft failed (DIFF-08)

/// Why a drafting attempt did not produce text.
///
/// Every failure used to collapse to "Couldn't draft — try again", which is wrong three ways: a
/// guardrail refusal will refuse again, an oversized day will overflow again, and a model still
/// downloading will succeed later without the user doing anything. Telling someone to retry when
/// retrying cannot work is worse than saying nothing.
///
/// Defined outside `#if canImport(FoundationModels)` deliberately, so the UI and these tests compile
/// and reason about it on a toolchain without the framework — the same reason `ModelAvailability`
/// lives outside it.
enum DayNoteDraftFailure: Equatable {
    /// The model declined on safety grounds. Retrying the same input will decline again.
    case declined
    /// The day carried more text than the context window holds — usually very long notes plus
    /// retrieved reference text. Actionable: shorten, or draft without the reference.
    case tooMuchInput
    /// Model assets are still downloading. Genuinely worth trying later, and the only case where
    /// "try again" is honest advice.
    case modelNotReady
    /// Anything else, including a genuine transient.
    case unknown(String?)

    /// Whether retrying the *same* request could plausibly succeed. Drives whether the UI offers a
    /// retry button at all — offering one that cannot work is how a feature earns distrust.
    var isWorthRetrying: Bool {
        switch self {
        case .modelNotReady, .unknown: return true
        case .declined, .tooMuchInput: return false
        }
    }

    var message: String {
        switch self {
        case .declined:
            return String(localized: "The model declined to write about this day. Editing the notes or highlights and trying again usually helps.",
                          comment: "Day-note drafting failed because the on-device model refused on safety grounds.")
        case .tooMuchInput:
            return String(localized: "There is too much text on this day for the model to read at once. Shortening the notes will let it through.",
                          comment: "Day-note drafting failed because the day's text exceeded the model's context window.")
        case .modelNotReady:
            return String(localized: "Apple Intelligence is still preparing on this device. This will work shortly.",
                          comment: "Day-note drafting failed because on-device model assets are still downloading.")
        case .unknown:
            return String(localized: "Couldn't draft a note just now. Please try again.",
                          comment: "Day-note drafting failed for an unrecognised reason.")
        }
    }
}

// MARK: - Clobber-guard decision (pure)

/// What to do with a freshly generated day-note draft, given the notes field's state. Enforces the
/// project's "never clobber the user's work" rule (the same rule `DayNamer` applies to day names).
/// (quality gate: AI draft silently replaces existing notes / clobbers mid-flight typing.)
enum DayNoteDraftDecision: Equatable {
    /// The field was empty at request time and is unchanged — place the draft directly.
    case apply
    /// The field held user text at request time (and is unchanged) — confirm before replacing.
    case confirmReplace
    /// The field CHANGED while the model was running (the user typed) — discard the stale draft.
    case discardStale
}

// MARK: - Prompt building (pure)

/// Namespace for the day-note prompt. No FoundationModels dependency — everything here is a pure
/// function over `DayNoteInput`, so the exact text handed to the model is deterministic and tested.
enum DayNoteDrafter {

    /// Decide what to do with a generated draft. `fieldAtRequest` is the notes field captured when
    /// generation started; `fieldNow` is its value when the result landed. If they differ the user
    /// typed during the multi-second generation and the draft is discarded (never overwrite live
    /// typing). Otherwise: fill an empty field directly, or ask before replacing existing text.
    static func decision(fieldAtRequest: String, fieldNow: String) -> DayNoteDraftDecision {
        if fieldNow != fieldAtRequest { return .discardStale }
        if fieldNow.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .apply }
        return .confirmReplace
    }

    /// The system instructions — a hard anti-invention contract. Kept as a constant so it is shared
    /// between the live session and the tests.
    static let instructions = """
    You write short journal entries for a travel journaling app. Write ONLY from the facts you are \
    given — never invent places, events, people, feelings, or details that are not in the data. \
    Write 2 to 4 sentences in the first person plural ("we"). Warm but plain; no superlatives that \
    the facts do not support, no clichés, no marketing tone. Do not restate numbers mechanically — \
    weave the day into a few natural sentences. Output only the entry text.
    """

    /// Grounded variant, used when geo-verified reference text (Wikipedia/Wikivoyage) accompanies
    /// the day's facts — the note may then also draw on the reference, and nothing else.
    static let groundedInstructions = """
    You write short journal entries for a travel journaling app. You are given the day's facts \
    plus REFERENCE TEXT retrieved from Wikipedia and Wikivoyage about the day's places. Write ONLY \
    from those two sources — never invent places, events, people, feelings, or details that appear \
    in neither. The reference may lend a place's real name, nickname, or one piece of history; \
    never copy its sentences verbatim. Write 2 to 4 sentences in the first person plural ("we"). \
    Warm but plain; no superlatives the inputs do not support. Output only the entry text.
    """

    /// The instructions for a given input — grounded when a reference block is present.
    static func instructions(for input: DayNoteInput) -> String {
        let hasReference = !(input.referenceText?
            .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        return hasReference ? groundedInstructions : instructions
    }

    /// The compact, structured prompt for one day. Deterministic: the same input always yields the
    /// same string, in a fixed field order, containing the facts and NEVER any photo path or byte.
    static func promptComponents(for input: DayNoteInput) -> String {
        var lines: [String] = []
        lines.append("Write a day note from these facts:")
        lines.append("Journey: \(input.journeyName)" + (input.country.isEmpty ? "" : ", \(input.country)"))
        lines.append("Day \(input.dayNumber): \(input.campName)")
        if let dateLabel = input.dateLabel, !dateLabel.isEmpty {
            lines.append("Date: \(dateLabel)")
        }
        lines.append("Elevation: \(input.elevation) m")
        if input.dayDistanceKm > 0 {
            lines.append("Distance walked: \(distance(input.dayDistanceKm)) km")
        }
        if input.elevationGain > 0 || input.elevationLoss > 0 {
            lines.append("Ascent: \(input.elevationGain) m, descent: \(input.elevationLoss) m")
        }
        if let weather = weatherLine(input.weather) {
            lines.append("Weather: \(weather)")
        }
        if !input.highlights.isEmpty {
            lines.append("Highlights: \(input.highlights.joined(separator: "; "))")
        }
        if input.photoCount > 0 {
            lines.append("Photos taken: \(input.photoCount)")
        }
        if !input.photoSubjects.isEmpty {
            // Phrased as "appear to show" deliberately: a Vision label is an observation with a
            // confidence, not a fact, and the anti-invention contract elsewhere in this prompt would
            // be undermined by handing the model a guess dressed as ground truth.
            lines.append("The photos appear to show: \(input.photoSubjects.joined(separator: ", "))")
        }
        if !input.photoCaptions.isEmpty {
            lines.append("Photo captions: \(input.photoCaptions.joined(separator: "; "))")
        }
        if let reference = input.referenceText?.trimmingCharacters(in: .whitespacesAndNewlines),
           !reference.isEmpty {
            lines.append("")
            lines.append("REFERENCE TEXT (from Wikipedia/Wikivoyage — you may draw on this and the facts above, nothing else; never copy sentences verbatim):")
            lines.append(reference)
        }
        return lines.joined(separator: "\n")
    }

    // MARK: Formatting helpers (pure, locale-stable)

    /// One-decimal km, POSIX-formatted so the prompt is byte-stable regardless of device locale.
    static func distance(_ km: Double) -> String {
        String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), km)
    }

    /// A compact weather clause, or nil when there's nothing meaningful to say.
    static func weatherLine(_ weather: WeatherData?) -> String? {
        guard let weather else { return nil }
        var parts: [String] = []
        if let high = weather.temperatureMax {
            let low = weather.temperatureMin
            if let low {
                parts.append("\(temp(low)) to \(temp(high))°C")
            } else {
                parts.append("up to \(temp(high))°C")
            }
        } else if let low = weather.temperatureMin {
            parts.append("from \(temp(low))°C")
        }
        if let precipitation = weather.precipitationSum, precipitation > 0 {
            parts.append("\(distance(precipitation)) mm precipitation")
        }
        if let wind = weather.windSpeedMax, wind > 0 {
            parts.append("wind up to \(Int(wind.rounded())) km/h")
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    private static func temp(_ value: Double) -> String {
        String(Int(value.rounded()))
    }
}

// MARK: - Live generation (gated)

#if canImport(FoundationModels)

/// The `@Generable` output shape for a day note. Guided generation constrains the model to return a
/// single `note` string. iOS 26+ only.
@available(iOS 26.0, *)
@Generable
struct DayNoteDraft {
    @Guide(description: "A 2 to 4 sentence day-journal entry in the first person plural, written only from the given facts.")
    var note: String
}

@available(iOS 26.0, *)
extension DayNoteDrafter {
    /// Draft a day note on-device. Thin by design: builds the pure prompt, runs one guided
    /// generation, returns the text. Callers must have confirmed `Intelligence.isAvailable` first —
    /// this never checks the gate itself (it can't see the env kill switch).
    static func generate(for input: DayNoteInput) async throws -> String {
        let session = LanguageModelSession(instructions: instructions(for: input))
        session.prewarm()
        let response = try await session.respond(
            to: promptComponents(for: input),
            generating: DayNoteDraft.self)
        return response.content.note.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Stream a draft, reporting partial text as it arrives (DIFF-08).
    ///
    /// **`onPartial` must not write into the notes field.** The clobber guard compares the field now
    /// against the field at request time, so streaming into it would make the view see staleness it
    /// caused itself and discard its own draft. Partial text belongs in a separate buffer the UI
    /// displays; the final value goes through `decision(fieldAtRequest:fieldNow:)` exactly once, the
    /// same as the non-streaming path. That is the whole reason this is a separate method rather than
    /// a flag on `generate`.
    static func generateStreaming(for input: DayNoteInput,
                                 onPartial: @escaping (String) -> Void) async throws -> String {
        let session = LanguageModelSession(instructions: instructions(for: input))
        session.prewarm()
        var latest = ""
        let stream = session.streamResponse(to: promptComponents(for: input),
                                            generating: DayNoteDraft.self)
        for try await partial in stream {
            if let note = partial.content.note {
                latest = note
                onPartial(note)
            }
        }
        return latest.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Warm the model ahead of a likely request, so the first tap is not the slowest one.
    ///
    /// Costs nothing when the feature is never used: `prewarm` is a hint, and a session that is never
    /// asked for a response never generates. Call it when a drafting entry point becomes visible,
    /// not at launch — warming for a screen the user may not open is how a battery gets spent.
    static func prewarm(for input: DayNoteInput) {
        LanguageModelSession(instructions: instructions(for: input)).prewarm()
    }

    /// Map a framework error to the domain failure, so the UI can say something true about it.
    ///
    /// The `default` is deliberate rather than exhaustive: `GenerationError` can gain cases in a
    /// point release, and a compile break there would be a worse outcome than one unmapped error
    /// falling back to a generic message.
    static func failure(from error: Error) -> DayNoteDraftFailure {
        if let generation = error as? LanguageModelSession.GenerationError {
            switch generation {
            case .exceededContextWindowSize:            return .tooMuchInput
            case .guardrailViolation:                   return .declined
            case .assetsUnavailable:                    return .modelNotReady
            default:                                    return .unknown(generation.localizedDescription)
            }
        }
        return .unknown(error.localizedDescription)
    }
}

#endif
