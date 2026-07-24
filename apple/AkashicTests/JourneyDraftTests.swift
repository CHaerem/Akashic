import XCTest
@testable import Akashic

/// The journey-creation model (§4.1): day proposal (from GPX waypoints and from photo-date
/// clusters), auto-computed stats against the Kilimanjaro fixture, slug uniquification, and the
/// photos-only (no route, no days) validity rule.
final class JourneyDraftTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    // MARK: - Day proposal from GPX waypoints

    func testDaysFromWaypointsPreserveOrderNameElevationAndCoordinates() {
        let waypoints = [
            GPXWaypoint(name: "Machame Gate", coordinates: [37.25, -3.10, 1800],
                        elevation: 1800, desc: "Trailhead",
                        time: ISO8601DateFormatter().date(from: "2023-09-29T06:00:00Z")),
            GPXWaypoint(name: nil, coordinates: [37.30, -3.09], elevation: nil, desc: nil, time: nil)
        ]
        let days = JourneyDraft.days(fromWaypoints: waypoints)

        XCTAssertEqual(days.count, 2)
        XCTAssertEqual(days[0].name, "Machame Gate")
        XCTAssertEqual(days[0].elevation, 1800)
        XCTAssertEqual(days[0].coordinates, [37.25, -3.10], "coordinates kept in [lng, lat] order")
        XCTAssertNotNil(days[0].dateLabel)
        XCTAssertEqual(days[0].source, .gpxWaypoint)
        XCTAssertEqual(days[1].name, "Day 2", "unnamed waypoint gets a positional name")
        XCTAssertEqual(days[1].elevation, 0)
    }

    // MARK: - Day proposal from photo-date clusters (PhotoDayMatcher in reverse)

    func testDaysFromPhotosClusterByCalendarDayInChronologicalOrder() {
        let photos = [
            makePhoto(takenAt: "2023-09-30T09:00:00Z", coordinates: [37.0, -3.0]),
            makePhoto(takenAt: "2023-09-30T18:00:00Z", coordinates: [37.2, -3.2]),   // same day
            makePhoto(takenAt: "2023-09-29T08:00:00Z", coordinates: [36.9, -2.9]),   // earlier day
            makePhoto(takenAt: "2023-10-01T12:00:00Z", coordinates: nil),            // no GPS
            makePhoto(takenAt: nil, coordinates: [1, 1])                             // no date → ignored
        ]
        let days = JourneyDraft.days(fromPhotos: photos)

        XCTAssertEqual(days.count, 3, "three distinct calendar days (dateless photo ignored)")
        XCTAssertEqual(days.map(\.name), ["Day 1", "Day 2", "Day 3"])
        XCTAssertEqual(days.map(\.source), [.photoCluster, .photoCluster, .photoCluster])
        // Day 1 = 2023-09-29 (chronological), single photo → its own coordinate.
        XCTAssertEqual(days[0].coordinates, [36.9, -2.9])
        // Day 2 = 2023-09-30, two photos → per-axis median.
        XCTAssertEqual(days[1].coordinates[0], 37.1, accuracy: 1e-9)
        XCTAssertEqual(days[1].coordinates[1], -3.1, accuracy: 1e-9)
        // Day 3 = 2023-10-01, no GPS → empty coordinate, still a day.
        XCTAssertTrue(days[2].coordinates.isEmpty)
    }

    // MARK: - Stats from the route (Kilimanjaro fixture)

    func testComputeStatsAgainstKilimanjaroRoute() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let stats = JourneyDraft.computeStats(
            route: journey.route, days: [],
            dateStarted: DateOnly.date(from: journey.dateStarted),
            dateEnded: DateOnly.date(from: journey.dateEnded),
            name: journey.name)

        // Elevation gain and highest point land within the spec's ±10% of the stored figures
        // (stored gain 4800 m; stored summit 5895 m).
        XCTAssertEqual(Double(stats.totalElevationGain), 4800, accuracy: 480,
                       "gain within ±10% of the stored 4800 m")
        let summit = try XCTUnwrap(stats.highestPoint)
        XCTAssertEqual(Double(summit.elevation), 5895, accuracy: 120, "summit within ~2% of 5895 m")
        XCTAssertEqual(summit.coordinates?.count, 2)

        // Distance and loss are derived from the coarse 188-point stored polyline, which
        // undersamples the real trail — so they sit a bit further from the rounded human figures
        // (distance ≈ 60 km vs a stored 70; loss ≈ 5350 m vs a stored 4800). Pin the geometry
        // result rather than pretend ±10% is achievable on this sampling.
        XCTAssertEqual(stats.totalDistance, 60.1, accuracy: 2.0, "haversine over the stored polyline")
        let loss = try XCTUnwrap(stats.totalElevationLoss)
        XCTAssertGreaterThan(loss, 4000)
        XCTAssertLessThan(loss, 6000)
    }

    func testElevationSmoothingIgnoresSubThresholdJitter() {
        // Net climb of 20 m delivered as noisy ±2 m steps on top of clean 10 m gains.
        let route: [[Double]] = [
            [0, 0, 100], [0, 0, 101], [0, 0, 110], [0, 0, 109], [0, 0, 120]
        ]
        let (gain, loss) = JourneyDraft.elevationGainLoss(route: route, smoothing: 3.0)
        XCTAssertEqual(gain, 20, "sub-3m wiggles are ignored; only the real 100→110→120 climb counts")
        XCTAssertEqual(loss, 0)
    }

    // MARK: - Slug generation + uniquification

    func testSlugifyKebabCases() {
        XCTAssertEqual(JourneyDraft.slugify("Kilimanjaro — Lemosho Route!"), "kilimanjaro-lemosho-route")
        XCTAssertEqual(JourneyDraft.slugify("  Mount   Kenya  "), "mount-kenya")
        XCTAssertEqual(JourneyDraft.slugify("Besseggen: Gjendesheim → Memurubu"), "besseggen-gjendesheim-memurubu")
        XCTAssertEqual(JourneyDraft.slugify(""), "journey", "empty name falls back")
    }

    func testUniqueSlugSuffixesOnCollision() {
        XCTAssertEqual(JourneyDraft.uniqueSlug(from: "Kilimanjaro", existing: ["kilimanjaro"]),
                       "kilimanjaro-2")
        XCTAssertEqual(JourneyDraft.uniqueSlug(from: "A", existing: ["a", "a-2"]), "a-3")
        XCTAssertEqual(JourneyDraft.uniqueSlug(from: "Fresh", existing: ["kilimanjaro"]), "fresh")
    }

    // MARK: - Photos-only journey is valid (no route, no days)

    func testPhotosOnlyDraftIsValidAndBuildsEmptyRouteJourney() {
        var draft = JourneyDraft()
        XCTAssertFalse(draft.isValid, "a nameless draft is invalid")
        draft.name = "Family Safari"
        draft.country = "Kenya"
        XCTAssertTrue(draft.isValid, "name alone makes it valid — no route, no days required")

        let journey = draft.makeJourney()
        XCTAssertEqual(journey.route.coordinates.count, 0)
        XCTAssertTrue(journey.camps.isEmpty)
        XCTAssertEqual(journey.slug, "family-safari")
        XCTAssertEqual(journey.country, "Kenya")
        XCTAssertFalse(journey.isPublic, "new journeys start private")
    }

    func testMakeJourneyNumbersDaysSequentiallyAndKeepsIDs() {
        var draft = JourneyDraft(name: "Test Trek")
        draft.days = [
            DraftDay(name: "Camp A", elevation: 100, source: .manual),
            DraftDay(name: "Camp B", elevation: 200, source: .manual)
        ]
        let journey = draft.makeJourney()
        XCTAssertEqual(journey.id, draft.id, "draft identity is preserved")
        XCTAssertEqual(journey.camps.map(\.dayNumber), [1, 2])
        XCTAssertEqual(journey.camps.map(\.name), ["Camp A", "Camp B"])
        XCTAssertEqual(journey.camps.map(\.id), draft.days.map(\.id), "day ids carry to camps")
        XCTAssertEqual(journey.totalDays, 2, "duration derives from the day count")
    }

    // MARK: - Replace-route: only untouched auto-seeds may be reseeded (quality gate)

    func testDaysAreAllAutoSeededDistinguishesUntouchedFromEdited() {
        // All GPX-seeded, unedited → safe to replace on a "Replace route".
        XCTAssertTrue(JourneyDraft.daysAreAllAutoSeeded([
            DraftDay(name: "Machame Gate", source: .gpxWaypoint),
            DraftDay(name: "Shira Camp", source: .gpxWaypoint),
        ]))
        // Photo-seeded placeholders, unedited → safe.
        XCTAssertTrue(JourneyDraft.daysAreAllAutoSeeded([
            DraftDay(name: "Day 1", source: .photoCluster),
            DraftDay(name: "Day 2", source: .photoCluster),
        ]))
        // A hand-added manual day means the user has started building → NOT safe to clobber.
        XCTAssertFalse(JourneyDraft.daysAreAllAutoSeeded([
            DraftDay(name: "Day 1", source: .photoCluster),
            DraftDay(name: "My rest day", source: .manual),
        ]))
        // A renamed photo-cluster day (no longer the "Day N" placeholder) → NOT safe.
        XCTAssertFalse(JourneyDraft.daysAreAllAutoSeeded([
            DraftDay(name: "Summit push", source: .photoCluster),
        ]))
        // An empty list is not "all auto-seeded" (there is nothing seeded).
        XCTAssertFalse(JourneyDraft.daysAreAllAutoSeeded([]))
    }

    // MARK: - Helpers

    private func makePhoto(takenAt: String?, coordinates: [Double]?) -> Photo {
        Photo(id: UUID().uuidString, journeyId: "J", waypointId: nil,
              url: "", thumbnailURL: nil, caption: nil,
              coordinates: coordinates, takenAt: takenAt)
    }
}
