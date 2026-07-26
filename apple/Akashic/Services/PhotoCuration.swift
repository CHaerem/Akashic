import Foundation

/// DIFF-04 — on-device photo curation: pick the day's best photos and the journey's hero.
///
/// ## Why this exists
/// Choosing among hundreds of photos is the actual painful job in making something out of a trip.
/// Kilimanjaro alone is 939 photo rows, and only ~449 of those images are unique. Until now nothing
/// in the app looked at a single pixel: `DayNoteDrafter` writes about a day from stats and weather
/// while the photos sit untouched, and the hero is simply "the flagged one, else the first by sort
/// order". This is the layer that looks.
///
/// ## Why Vision rather than the language model
/// Two reasons, and the second is the strategic one:
///   * **Reach.** Vision's aesthetics request needs iOS 18; the feature-print request goes back to
///     iOS 13. Foundation Models needs iOS 26 *and* Apple-Intelligence-capable hardware — roughly a
///     third of the installed base. Curation is the feature most people would actually use, so it
///     should not sit behind the narrowest gate in the app.
///   * **Cost.** A cloud vision model would run about USD 0.70–2.05 per journey at these photo
///     counts, which is a meaningful slice of a one-time kr 149 against a customer who imports
///     several trips. On-device is USD 0.00 and cannot leak a photo. That asymmetry is the whole
///     argument for staying on-device, and it is the one claim competitors structurally cannot match.
///
/// ## Shape
/// This file is the **pure** half: given already-computed per-photo scores it decides what to
/// propose, and it is unit-tested with no Vision, no files and no device. `VisionPhotoScorer`
/// supplies the scores behind the `PhotoScoring` seam. Same split as
/// `SuggestionModel` / `JourneySuggestionCoordinator`, and for the same reason — the interesting
/// logic is the selection policy, not the framework call.

// MARK: - Inputs

/// One photo's measured qualities. Deliberately framework-free so the whole policy is testable.
struct PhotoScore: Equatable, Identifiable {
    var id: String
    /// Day number this photo belongs to, from the existing `PhotoDayMatcher`. Nil = unassigned.
    var dayNumber: Int?
    /// Vision's overall aesthetics score, roughly −1…1, higher is better. Nil when unavailable
    /// (iOS 17, or the request failed) — the policy must still work without it.
    var aesthetics: Double?
    /// True when Vision classified the image as "utility": a screenshot, receipt, document or
    /// similar. These are never good candidates however sharp they are.
    var isUtility: Bool = false
    /// Group id shared by near-identical images (from feature-print distance). Photos in the same
    /// group are burst frames or re-encodes of one moment; at most one should be proposed.
    var duplicateGroup: Int?
    /// Existing sort order — the tiebreaker, so an unscored journey degrades to today's behaviour
    /// rather than to something arbitrary.
    var sortOrder: Int = 0
    /// Videos are excluded from best-of and hero: a still frame misrepresents them, and the hero is
    /// rendered as an image everywhere it appears.
    var isVideo: Bool = false
}

/// What curation proposes. Every field is a *suggestion* — nothing here is applied without the user
/// accepting it, which is the same contract every other suggestion in the app honours.
struct CurationResult: Equatable {
    /// Photo id proposed as the journey hero, if any candidate qualified.
    var hero: String?
    /// Per day number, the proposed best-of selection in presentation order.
    var bestOfByDay: [Int: [String]] = [:]
    /// Duplicate groups with more than one member, keyed by group id — surfaced so the UI can offer
    /// "N near-identical photos" rather than silently hiding them. Ordering is stable.
    var duplicateGroups: [Int: [String]] = [:]

    var isEmpty: Bool { hero == nil && bestOfByDay.isEmpty }
    /// Total photos the app would hide if every duplicate proposal were accepted.
    var redundantCount: Int { duplicateGroups.values.reduce(0) { $0 + max(0, $1.count - 1) } }
}

// MARK: - Policy

/// Decides what to propose from a set of scores. Pure and deterministic: the same input always
/// yields the same output, which is what makes it testable and what keeps the UI from flickering
/// between runs.
enum PhotoCuration {

    /// How many photos a day proposes at most. Six is a screenful in the day gallery and about what
    /// a page of a printed story can carry, so it is the number the downstream features want.
    static let perDayLimit = 6

    /// Rank two candidates. Aesthetics first when both have it; a photo *with* a score always beats
    /// one without (an unscored photo is unknown, not bad); `sortOrder` breaks every remaining tie
    /// so the result is total and stable.
    static func isBetter(_ a: PhotoScore, _ b: PhotoScore) -> Bool {
        switch (a.aesthetics, b.aesthetics) {
        case let (x?, y?) where x != y: return x > y
        case (.some, .none): return true
        case (.none, .some): return false
        default: return a.sortOrder < b.sortOrder
        }
    }

    /// Photos that may be proposed at all: not a video, not utility imagery.
    private static func isCandidate(_ s: PhotoScore) -> Bool { !s.isVideo && !s.isUtility }

    /// Collapse duplicate groups to their best member, keeping every ungrouped photo.
    ///
    /// Ungrouped photos are never collapsed together: a nil `duplicateGroup` means "no near-match
    /// found", and treating all of them as one group would throw away most of the journey.
    static func deduplicated(_ scores: [PhotoScore]) -> [PhotoScore] {
        var bestPerGroup: [Int: PhotoScore] = [:]
        var ungrouped: [PhotoScore] = []
        for s in scores {
            guard let group = s.duplicateGroup else { ungrouped.append(s); continue }
            if let held = bestPerGroup[group] {
                if isBetter(s, held) { bestPerGroup[group] = s }
            } else {
                bestPerGroup[group] = s
            }
        }
        // Sort by sortOrder so the output order does not depend on dictionary iteration.
        return (ungrouped + Array(bestPerGroup.values)).sorted { $0.sortOrder < $1.sortOrder }
    }

    /// The full proposal.
    static func curate(_ scores: [PhotoScore], perDayLimit: Int = perDayLimit) -> CurationResult {
        var result = CurationResult()

        // Duplicate groups are reported over ALL photos, including videos and utility shots: the
        // user still wants to know a burst of twelve near-identical frames exists.
        var groups: [Int: [PhotoScore]] = [:]
        for s in scores { if let g = s.duplicateGroup { groups[g, default: []].append(s) } }
        for (g, members) in groups where members.count > 1 {
            result.duplicateGroups[g] = members.sorted { $0.sortOrder < $1.sortOrder }.map(\.id)
        }

        let candidates = deduplicated(scores).filter(isCandidate)
        guard !candidates.isEmpty else { return result }

        // Best-of per day. Days are independent: a weak day still gets its best photos, because the
        // day view and the story both need something to show for every day.
        var byDay: [Int: [PhotoScore]] = [:]
        for c in candidates { if let day = c.dayNumber { byDay[day, default: []].append(c) } }
        for (day, dayPhotos) in byDay {
            let picked = dayPhotos.sorted(by: isBetter).prefix(perDayLimit)
            // Present in journey order, not score order — a day reads chronologically.
            result.bestOfByDay[day] = picked.sorted { $0.sortOrder < $1.sortOrder }.map(\.id)
        }

        // The hero is the single best candidate across the whole journey, day-assigned or not.
        // `isBetter` orders best-first, so the head of the sort is the winner — spelled this way
        // rather than with `max(by:)`, whose inverted-predicate convention is easy to misread.
        result.hero = candidates.sorted(by: isBetter).first?.id

        return result
    }
}
