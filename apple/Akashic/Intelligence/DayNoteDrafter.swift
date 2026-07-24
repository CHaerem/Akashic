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
    }

    /// Memberwise init for tests / non-domain callers.
    init(journeyName: String, country: String, dayNumber: Int, campName: String, elevation: Int,
         dayDistanceKm: Double, elevationGain: Int, elevationLoss: Int, dateLabel: String?,
         highlights: [String], weather: WeatherData?, photoCount: Int, photoCaptions: [String]) {
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
        if !input.photoCaptions.isEmpty {
            lines.append("Photo captions: \(input.photoCaptions.joined(separator: "; "))")
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
        let session = LanguageModelSession(instructions: instructions)
        let response = try await session.respond(
            to: promptComponents(for: input),
            generating: DayNoteDraft.self)
        return response.content.note.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

#endif
