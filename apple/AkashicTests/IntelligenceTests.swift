import XCTest
@testable import Akashic

/// M6 — the Akashic Intelligence groundwork (COMMERCIALIZATION-PLAN §10).
///
/// Covers the availability gate (env kill-switch precedence, the below-iOS-26 path and the
/// model-unavailable path via the pure `resolve`/`probe` seam), deterministic prompt building for
/// both features (facts present, photo paths/bytes ABSENT), the DayNamer only-rename-unedited merge,
/// and the entitlement gating of the entry points. The on-device session calls themselves are not
/// tested here — they depend on real hardware and are kept deliberately thin.
final class IntelligenceTests: XCTestCase {

    // MARK: - Availability gate semantics

    @MainActor
    func testResolveEnvKillSwitchWinsOverEverything() {
        // Even with the framework present and the model ready, the env kill switch forces off.
        let resolved = Intelligence.resolve(disabledByEnv: true, frameworkAvailable: true, modelReady: true)
        XCTAssertEqual(resolved, .disabledByEnv)
        XCTAssertFalse(resolved.isAvailable)
    }

    @MainActor
    func testResolveBelowIOS26IsUnavailable() {
        // The "old device" tier: FoundationModels framework not present at runtime.
        let resolved = Intelligence.resolve(disabledByEnv: false, frameworkAvailable: false, modelReady: false)
        XCTAssertEqual(resolved, .unavailableOSTooOld)
        XCTAssertFalse(resolved.isAvailable)
    }

    @MainActor
    func testResolveNewDeviceWithoutIntelligenceIsUnavailable() {
        // The "new device, no Apple Intelligence" tier: iOS 26 present, model not ready.
        let resolved = Intelligence.resolve(disabledByEnv: false, frameworkAvailable: true, modelReady: false)
        XCTAssertEqual(resolved, .unavailableNoIntelligence)
        XCTAssertFalse(resolved.isAvailable)
    }

    @MainActor
    func testResolveAvailableTierIsAvailable() {
        let resolved = Intelligence.resolve(disabledByEnv: false, frameworkAvailable: true, modelReady: true)
        XCTAssertEqual(resolved, .available)
        XCTAssertTrue(resolved.isAvailable)
    }

    @MainActor
    func testProbeHonorsEnvKillSwitch() {
        // The env kill switch is honored regardless of the host OS, so this is deterministic on CI.
        XCTAssertEqual(Intelligence.probe(environment: ["AKASHIC_DISABLE_AI": "1"]), .disabledByEnv)
    }

    @MainActor
    func testGateReflectsInjectedAvailability() {
        XCTAssertTrue(Intelligence(availability: .available).isAvailable)
        XCTAssertFalse(Intelligence(availability: .unavailableOSTooOld).isAvailable)
        XCTAssertFalse(Intelligence(availability: .unavailableNoIntelligence).isAvailable)
        XCTAssertFalse(Intelligence(availability: .disabledByEnv).isAvailable)
    }

    @MainActor
    func testGateFromEnvironmentKillSwitchIsUnavailable() {
        XCTAssertFalse(Intelligence(environment: ["AKASHIC_DISABLE_AI": "1"]).isAvailable)
    }

    /// `refresh()` must actually re-probe — it was previously dead code with no caller, so the gate
    /// went stale mid-session. Now the app calls it on scenePhase == .active. This pins that a
    /// refresh re-evaluates availability rather than keeping the launch-time value.
    /// (quality gate: Intelligence availability probed once at launch; refresh() dead code.)
    @MainActor
    func testRefreshReProbesAvailability() {
        let ai = Intelligence(environment: ["AKASHIC_DISABLE_AI": "1"])
        XCTAssertEqual(ai.availability, .disabledByEnv)
        ai.refresh(environment: [:])   // kill switch cleared → must re-probe, not stay disabledByEnv
        XCTAssertNotEqual(ai.availability, .disabledByEnv,
                          "refresh() re-evaluated availability instead of keeping the stale value")
    }

    // MARK: - Entry-point gating (Intelligence AND Akashic Complete)

    /// The entry points render only when the model is available AND the user has Complete — free
    /// users never see the buttons (plan §10). This is the exact boolean both sheets compute.
    private func entryPointVisible(_ availability: ModelAvailability, _ entitlement: Entitlement) -> Bool {
        availability.isAvailable && EntitlementPolicy(entitlement: entitlement).isComplete
    }

    func testEntryPointVisibleOnlyWhenAvailableAndComplete() {
        XCTAssertTrue(entryPointVisible(.available, .complete))
        XCTAssertFalse(entryPointVisible(.available, .free), "Complete required")
        XCTAssertFalse(entryPointVisible(.unavailableNoIntelligence, .complete), "model required")
        XCTAssertFalse(entryPointVisible(.disabledByEnv, .complete))
        XCTAssertFalse(entryPointVisible(.unavailableOSTooOld, .free))
    }

    // MARK: - DayNoteDrafter prompt (deterministic; no photo bytes/paths)

    private func sampleJourney() -> Journey {
        Journey(id: "j1", slug: "kilimanjaro", name: "Kilimanjaro - Lemosho Route",
                country: "Tanzania", description: "",
                stats: TrekStats(duration: 7, totalDistance: 60, totalElevationGain: 4000,
                                 totalElevationLoss: nil, highestPoint: nil),
                route: .empty, camps: [])
    }

    private func sampleCamp() -> Camp {
        var camp = Camp(id: "c3", name: "High Camp", dayNumber: 3, elevation: 4600,
                        coordinates: [37.35, -3.07], notes: "",
                        highlights: ["Reached the crater rim", "First view of the glaciers"])
        camp.dayDistance = 5.4
        camp.elevationGainFromPrevious = 900
        camp.elevationLossFromPrevious = 120
        camp.dateLabel = "3 Oct 2023"
        camp.weather = WeatherData(temperatureMax: -2, temperatureMin: -12,
                                   precipitationSum: 0, windSpeedMax: 35, weatherCode: 71)
        return camp
    }

    /// A photo whose R2 path / on-disk path must NEVER reach the prompt — only its caption + the count.
    private func sampleCaptionedPhoto() -> Photo {
        var photo = Photo(id: "p1", journeyId: "j1", waypointId: "c3",
                          url: "journeys/j1/photos/p1.jpg", thumbnailURL: nil,
                          caption: "Sunrise over Kibo")
        photo.localOriginalPath = "/var/mobile/Containers/Data/Application/ABC/photos/p1.jpg"
        return photo
    }

    func testDayNoteInputFactoryReadsCountAndCaptionsOnly() {
        let captioned = sampleCaptionedPhoto()
        var blank = captioned
        blank.id = "p2"
        blank.caption = "   "   // whitespace-only caption is dropped
        let input = DayNoteInput(journey: sampleJourney(), camp: sampleCamp(), photos: [captioned, blank])

        XCTAssertEqual(input.photoCount, 2, "count includes every photo")
        XCTAssertEqual(input.photoCaptions, ["Sunrise over Kibo"], "empty captions omitted")
        XCTAssertEqual(input.journeyName, "Kilimanjaro", "shortName, not the full route name")
        XCTAssertEqual(input.country, "Tanzania")
    }

    func testDayNoteReferenceTextSwitchesInstructionsAndEntersPrompt() {
        var input = DayNoteInput(journey: sampleJourney(), camp: sampleCamp(),
                                 photos: [sampleCaptionedPhoto()])
        XCTAssertEqual(DayNoteDrafter.instructions(for: input), DayNoteDrafter.instructions,
                       "no reference -> facts-only instructions")
        XCTAssertFalse(DayNoteDrafter.promptComponents(for: input).contains("REFERENCE TEXT"))

        input.referenceText = "Barafu Camp is the final camp before the summit push."
        XCTAssertEqual(DayNoteDrafter.instructions(for: input), DayNoteDrafter.groundedInstructions)
        let prompt = DayNoteDrafter.promptComponents(for: input)
        XCTAssertTrue(prompt.contains("REFERENCE TEXT"))
        XCTAssertTrue(prompt.contains("final camp before the summit push"))

        // Whitespace-only reference must NOT flip to grounded mode — that would claim a
        // grounding that does not exist.
        input.referenceText = "   \n  "
        XCTAssertEqual(DayNoteDrafter.instructions(for: input), DayNoteDrafter.instructions)
        XCTAssertFalse(DayNoteDrafter.promptComponents(for: input).contains("REFERENCE TEXT"))
    }

    func testDayNotePromptContainsFactsAndIsDeterministic() {
        let input = DayNoteInput(journey: sampleJourney(), camp: sampleCamp(), photos: [sampleCaptionedPhoto()])
        let prompt = DayNoteDrafter.promptComponents(for: input)

        XCTAssertTrue(prompt.contains("Kilimanjaro"))
        XCTAssertTrue(prompt.contains("Tanzania"))
        XCTAssertTrue(prompt.contains("Day 3: High Camp"))
        XCTAssertTrue(prompt.contains("4600 m"))
        XCTAssertTrue(prompt.contains("5.4 km"))
        XCTAssertTrue(prompt.contains("Ascent: 900 m, descent: 120 m"))
        XCTAssertTrue(prompt.contains("Reached the crater rim"))
        XCTAssertTrue(prompt.contains("Sunrise over Kibo"))
        XCTAssertTrue(prompt.contains("Photos taken: 1"))
        // Determinism.
        XCTAssertEqual(prompt, DayNoteDrafter.promptComponents(for: input))
    }

    func testDayNotePromptNeverLeaksPhotoPathsOrBytes() {
        let input = DayNoteInput(journey: sampleJourney(), camp: sampleCamp(), photos: [sampleCaptionedPhoto()])
        let prompt = DayNoteDrafter.promptComponents(for: input)

        XCTAssertFalse(prompt.contains("journeys/j1/photos"), "R2 object path must not appear")
        XCTAssertFalse(prompt.contains(".jpg"), "no file extension / path leaks")
        XCTAssertFalse(prompt.contains("/var/mobile"), "no absolute on-disk path leaks")
    }

    func testDayNotePromptOmitsEmptySections() {
        // A bare day: no distance, no weather, no highlights, no photos.
        let input = DayNoteInput(journeyName: "Rondane", country: "Norway", dayNumber: 1,
                                 campName: "Trailhead", elevation: 900, dayDistanceKm: 0,
                                 elevationGain: 0, elevationLoss: 0, dateLabel: nil,
                                 highlights: [], weather: nil, photoCount: 0, photoCaptions: [])
        let prompt = DayNoteDrafter.promptComponents(for: input)

        XCTAssertTrue(prompt.contains("Day 1: Trailhead"))
        XCTAssertFalse(prompt.contains("Distance walked"))
        XCTAssertFalse(prompt.contains("Ascent"))
        XCTAssertFalse(prompt.contains("Weather"))
        XCTAssertFalse(prompt.contains("Highlights"))
        XCTAssertFalse(prompt.contains("Photos taken"))
    }

    // MARK: - DayNamer prompt (deterministic)

    func testDayNamerPromptContainsFactsAndIsDeterministic() {
        let facts = [
            DayNameFacts(dayNumber: 1, dateLabel: "29 Sep 2023", elevation: 1800,
                         coordinates: [37.25, -3.10], photoCount: 12),
            DayNameFacts(dayNumber: 2, dateLabel: nil, elevation: 0, coordinates: [], photoCount: 0)
        ]
        let prompt = DayNamer.promptComponents(for: facts)

        XCTAssertTrue(prompt.contains("Name each of these 2 day(s)"))
        XCTAssertTrue(prompt.contains("Day 1"))
        XCTAssertTrue(prompt.contains("29 Sep 2023"))
        XCTAssertTrue(prompt.contains("1800 m elevation"))
        XCTAssertTrue(prompt.contains("12 photo(s)"))
        XCTAssertTrue(prompt.contains("near -3.1000, 37.2500"), "median GPS as lat, lng")
        XCTAssertEqual(prompt, DayNamer.promptComponents(for: facts), "deterministic")
    }

    // MARK: - DayNamer only-rename-unedited merge

    func testIsAutoGeneratedRecognizesPlaceholderNamesOnly() {
        XCTAssertTrue(DayNamer.isAutoGenerated(name: "Day 1"))
        XCTAssertTrue(DayNamer.isAutoGenerated(name: "Day 42"))
        XCTAssertTrue(DayNamer.isAutoGenerated(name: "  Day 3  "))
        XCTAssertFalse(DayNamer.isAutoGenerated(name: "Summit night"))
        XCTAssertFalse(DayNamer.isAutoGenerated(name: "Day"))
        XCTAssertFalse(DayNamer.isAutoGenerated(name: "Day one"))
        XCTAssertFalse(DayNamer.isAutoGenerated(name: "Day 1a"))
        XCTAssertFalse(DayNamer.isAutoGenerated(name: "Machame Gate"))
    }

    func testApplyingRenamesOnlyAutoGeneratedDays() {
        let days = [
            DraftDay(name: "Day 1", source: .photoCluster),
            DraftDay(name: "Rest by the river", source: .manual),   // hand-edited
            DraftDay(name: "Machame Gate", source: .gpxWaypoint),   // GPX name, not a placeholder
            DraftDay(name: "Day 4", source: .photoCluster)
        ]
        let suggestions = ["Summit push", "Lazy afternoon", "Trailhead start", "Glacier camp"]
        let renamed = DayNamer.applying(suggestions: suggestions, to: days)

        XCTAssertEqual(renamed[0].name, "Summit push", "auto-named day renamed")
        XCTAssertEqual(renamed[1].name, "Rest by the river", "hand-edited day preserved")
        XCTAssertEqual(renamed[2].name, "Machame Gate", "GPX-named day preserved")
        XCTAssertEqual(renamed[3].name, "Glacier camp", "auto-named day renamed")
        // Identity and order preserved.
        XCTAssertEqual(renamed.map(\.id), days.map(\.id))
    }

    func testApplyingIgnoresBlankSuggestionsAndOverflow() {
        let days = [DraftDay(name: "Day 1", source: .photoCluster),
                    DraftDay(name: "Day 2", source: .photoCluster)]
        // A blank suggestion for day 1, and no suggestion at all for day 2.
        let renamed = DayNamer.applying(suggestions: ["   "], to: days)

        XCTAssertEqual(renamed[0].name, "Day 1", "blank suggestion leaves the name unchanged")
        XCTAssertEqual(renamed[1].name, "Day 2", "missing suggestion leaves the name unchanged")
    }

    func testRenamableIndicesSkipsEditedDays() {
        let days = [DraftDay(name: "Day 1", source: .photoCluster),
                    DraftDay(name: "Summit", source: .manual),
                    DraftDay(name: "Day 3", source: .photoCluster)]
        XCTAssertEqual(DayNamer.renamableIndices(in: days), [0, 2])
    }

    // MARK: - DayNamer applies by day IDENTITY, not list position (quality gate)

    /// The mid-generation mutation race: the user deletes day 1 while the model runs. Suggestions
    /// were generated for the ORIGINAL list; applying by id means each surviving day still gets the
    /// name from its own facts — never day 1's name landing on day 2.
    func testApplyingByDayIDSurvivesDeletionMidGeneration() {
        let d1 = DraftDay(name: "Day 1", source: .photoCluster)
        let d2 = DraftDay(name: "Day 2", source: .photoCluster)
        let d3 = DraftDay(name: "Day 3", source: .photoCluster)
        let capturedIDs = [d1.id, d2.id, d3.id]
        let suggestions = ["Summit push", "River camp", "Glacier crossing"]

        // The user deleted d1 before the result landed — the current list is [d2, d3].
        let renamed = DayNamer.applying(suggestions: suggestions, forDayIDs: capturedIDs, to: [d2, d3])

        XCTAssertEqual(renamed[0].name, "River camp", "d2 keeps ITS suggestion, not d1's 'Summit push'")
        XCTAssertEqual(renamed[1].name, "Glacier crossing")
    }

    func testApplyingByDayIDIgnoresDaysAddedAfterTheRequest() {
        let d1 = DraftDay(name: "Day 1", source: .photoCluster)
        let capturedIDs = [d1.id]
        let added = DraftDay(name: "Day 2", source: .manual)   // added mid-generation

        let renamed = DayNamer.applying(suggestions: ["Trailhead"], forDayIDs: capturedIDs, to: [d1, added])
        XCTAssertEqual(renamed[0].name, "Trailhead")
        XCTAssertEqual(renamed[1].name, "Day 2", "a day added since the request receives no suggestion")
    }

    func testApplyingByDayIDStillSkipsHandEditedDays() {
        let d1 = DraftDay(name: "Day 1", source: .photoCluster)
        var d2 = DraftDay(name: "Day 2", source: .photoCluster)
        let ids = [d1.id, d2.id]
        d2.name = "My own name"   // hand-edited after the request was captured

        let renamed = DayNamer.applying(suggestions: ["A", "B"], forDayIDs: ids, to: [d1, d2])
        XCTAssertEqual(renamed[0].name, "A")
        XCTAssertEqual(renamed[1].name, "My own name", "hand-edited day is never overwritten")
    }

    // MARK: - DayNoteDrafter clobber guard (quality gate)

    func testDayNoteDecisionNeverClobbersUserWork() {
        // Empty field, unchanged → fill directly.
        XCTAssertEqual(DayNoteDrafter.decision(fieldAtRequest: "", fieldNow: ""), .apply)
        XCTAssertEqual(DayNoteDrafter.decision(fieldAtRequest: "  ", fieldNow: "  "), .apply)
        // Non-empty field, unchanged → confirm before replacing.
        XCTAssertEqual(DayNoteDrafter.decision(fieldAtRequest: "my notes", fieldNow: "my notes"),
                       .confirmReplace)
        // Field CHANGED during generation (user typed) → discard the stale draft.
        XCTAssertEqual(DayNoteDrafter.decision(fieldAtRequest: "", fieldNow: "typed while waiting"),
                       .discardStale)
        XCTAssertEqual(DayNoteDrafter.decision(fieldAtRequest: "old", fieldNow: "old plus more"),
                       .discardStale)
    }
}
