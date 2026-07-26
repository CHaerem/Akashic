import Foundation

/// DIFF-04 — runs curation and applies an accepted proposal. The half that touches real photos.
///
/// `PhotoCuration` decides *what* to propose and `VisionPhotoScorer` measures the pixels; this joins
/// them to the app's own types and turns an accepted suggestion into changed `Photo` values.
///
/// ## Why this is a service and not a `SuggestionKey`
/// The first plan was to add `.heroPhoto` and `.bestOf(dayID:)` to `JourneySuggestionCoordinator`
/// alongside `.facts` and the rest. That does not work: the coordinator applies suggestions to a
/// `JourneyDraft`, and a draft carries days but **no photos** — during creation they live in the
/// view's `stagedPhotos`, and afterwards in the store. Every other suggestion mutates the draft;
/// these mutate photos, so they need a different seam rather than a forced fit.
///
/// ## Why nothing here is destructive
/// Accepting a proposal never deletes or hides a photo:
///   * **hero** sets `isHero`, which is an existing field with an existing single-hero invariant.
///   * **best-of** reorders `sortOrder` *within the day*, so the chosen photos lead. Every surface
///     already reads photos in `sortOrder`, so a curated day looks curated in the grid, the story
///     and any future book with no new field and no Core Data migration on an
///     additive-forever production container.
/// Duplicate groups are reported, never actioned automatically — collapsing them is the user's call,
/// and a false positive from a distance heuristic must not cost anyone a photograph.
// QUA-08: `Sendable` so `@MainActor JourneyStore.curationProposal` can await it off the main
// actor. Genuinely immutable — one injected `PhotoScoring` seam and no mutable storage.
struct PhotoCurationService: Sendable {

    /// Injectable so tests drive the policy with fixed scores and no Vision. Production uses the
    /// Vision-backed scorer, which is what links the framework and makes this code live at all.
    var scorer: PhotoScoring = VisionPhotoScorer()

    // MARK: Run

    /// Curate a set of photos, resolving each one's day with the supplied closure.
    ///
    /// The closure form is the primitive because the two callers resolve days differently: a saved
    /// journey has a `PhotoDayMatcher`, while the creation sheet is still assembling draft days when
    /// the photos land.
    func curate(photos: [Photo], dayOf: @Sendable (Photo) -> Int?) async -> CurationResult {
        guard !photos.isEmpty else { return CurationResult() }
        let scores = await scorer.score(photos, dayOf: dayOf)
        return PhotoCuration.curate(scores)
    }

    /// Convenience for a saved journey: days come from the existing four-tier matcher.
    func curate(photos: [Photo], journey: Journey) async -> CurationResult {
        let matcher = PhotoDayMatcher(journey: journey)
        return await curate(photos: photos) { matcher.day(for: $0) }
    }

    // MARK: Apply — pure, so both the staged and the saved path share one definition

    /// Accept the hero proposal: flag it, and clear any other hero so the single-hero invariant
    /// `PersistenceController.setPhotoHero` enforces on disk also holds for unsaved photos.
    static func applyingHero(_ result: CurationResult, to photos: [Photo]) -> [Photo] {
        guard let hero = result.hero else { return photos }
        guard photos.contains(where: { $0.id == hero }) else { return photos }
        return photos.map { photo in
            var copy = photo
            copy.isHero = (photo.id == hero)
            return copy
        }
    }

    /// Accept a day's best-of: the chosen photos lead the day, everything else keeps its order
    /// behind them.
    ///
    /// The day's existing `sortOrder` values are redistributed rather than replaced, so the change
    /// cannot reach into another day or open a gap — `sortOrder` is journey-wide, and rewriting it
    /// freely would silently reshuffle days the user did not curate.
    static func applyingBestOf(day: Int,
                               _ result: CurationResult,
                               to photos: [Photo],
                               dayOf: (Photo) -> Int?) -> [Photo] {
        guard let selection = result.bestOfByDay[day], !selection.isEmpty else { return photos }
        let selected = Set(selection)

        let dayPhotoIDs = photos.filter { dayOf($0) == day }.map(\.id)
        guard !dayPhotoIDs.isEmpty else { return photos }
        // Only reorder if the selection actually belongs to this day.
        guard selected.isSubset(of: Set(dayPhotoIDs)) else { return photos }

        let dayPhotos = photos.filter { dayOf($0) == day }
        let slots = dayPhotos.map(\.sortOrder).sorted()
        let leading = dayPhotos.filter { selected.contains($0.id) }.sorted { $0.sortOrder < $1.sortOrder }
        let trailing = dayPhotos.filter { !selected.contains($0.id) }.sorted { $0.sortOrder < $1.sortOrder }

        var newOrder: [String: Int] = [:]
        for (photo, slot) in zip(leading + trailing, slots) { newOrder[photo.id] = slot }

        return photos.map { photo in
            guard let slot = newOrder[photo.id] else { return photo }
            var copy = photo
            copy.sortOrder = slot
            return copy
        }
    }
}
