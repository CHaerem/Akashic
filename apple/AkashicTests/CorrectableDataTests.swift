import XCTest
import CoreData
@testable import Akashic

/// "Everything is correctable" — the corrections that unfreeze an existing journey:
/// route replace/recompute (through the edit path, never silently re-seeding days), day
/// add/delete/reorder (delete UNASSIGNS photos+comments, renumber stays consistent, reorder keeps
/// photo linkage by waypointId), photo day-moves, editable day content, and enrichment reuse of the
/// SHARED suggestion coordinator against an EXISTING journey (gap-only weather/POIs, auto-named-day
/// rename detection). All writes flow through `PersistenceController` — the same seam sync drives.
@MainActor
final class CorrectableDataTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func controller(_ journey: Journey) -> PersistenceController {
        let pc = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: pc.viewContext)
        try? pc.viewContext.save()
        return pc
    }

    // MARK: - Route correction

    func testRecomputedStatsFromRouteMatchesEngine() {
        // A three-point climb: 0 → 100 → 250 m elevation.
        let route = Route(type: "LineString", coordinates: [[10, 60, 0], [10.1, 60, 100], [10.2, 60, 250]])
        let stats = RouteCorrection.recomputedStats(route: route, currentDuration: 7, dayCount: 3,
                                                    dateStarted: nil, dateEnded: nil, name: "Test")
        XCTAssertEqual(stats.totalElevationGain, 250)
        XCTAssertEqual(stats.highestPoint?.elevation, 250)
        XCTAssertGreaterThan(stats.totalDistance, 0)
    }

    /// A route correction must not redefine how long the trek took. Deriving duration from
    /// `camps.count` reported and persisted "Days 7 → 8" for Kilimanjaro, whose eight camps include
    /// a summit and a finish gate that are waypoints rather than days.
    func testRecomputedStatsCarriesDurationOverInsteadOfCountingCamps() {
        let route = Route(type: "LineString", coordinates: [[10, 60, 0], [10.2, 60, 250]])
        let stats = RouteCorrection.recomputedStats(route: route, currentDuration: 7, dayCount: 8,
                                                    dateStarted: "2023-09-29", dateEnded: "2023-10-09",
                                                    name: "Kilimanjaro")
        XCTAssertEqual(stats.duration, 7, "the authored duration survives a route replacement")
    }

    /// With no duration on record, deriving one is a heal rather than an overwrite.
    func testRecomputedStatsDerivesDurationOnlyWhenThereIsNone() {
        let route = Route(type: "LineString", coordinates: [[10, 60, 0], [10.2, 60, 250]])
        let stats = RouteCorrection.recomputedStats(route: route, currentDuration: 0, dayCount: 4,
                                                    dateStarted: nil, dateEnded: nil, name: "New")
        XCTAssertEqual(stats.duration, 4)
    }

    func testRouteDiffMarksOnlyChangedFields() {
        let old = TrekStats(duration: 5, totalDistance: 61, totalElevationGain: 4412,
                            totalElevationLoss: 4000, highestPoint: HighestPoint(name: "x", elevation: 5895, coordinates: nil))
        let new = TrekStats(duration: 5, totalDistance: 70, totalElevationGain: 4800,
                            totalElevationLoss: 4000, highestPoint: HighestPoint(name: "x", elevation: 5895, coordinates: nil))
        let diff = RouteCorrection.diff(old: old, new: new)
        let distance = try! XCTUnwrap(diff.first { $0.label == "Distance" })
        XCTAssertTrue(distance.changed)
        XCTAssertEqual(distance.before, "61 km")
        XCTAssertEqual(distance.after, "70 km")
        XCTAssertTrue(diff.first { $0.label == "Ascent" }!.changed)
        XCTAssertFalse(diff.first { $0.label == "Descent" }!.changed, "unchanged fields aren't emphasised")
        XCTAssertFalse(diff.first { $0.label == "Days" }!.changed)
    }

    func testReplaceRouteWritesThroughEditPathWithoutReseedingDays() throws {
        let pc = controller(Self.journey(dayCount: 3))
        let newRoute = Route(type: "LineString", coordinates: [[10, 60, 0], [10.5, 60.5, 900]])
        let stats = RouteCorrection.recomputedStats(route: newRoute, currentDuration: 3, dayCount: 3,
                                                    dateStarted: nil, dateEnded: nil, name: "J")
        XCTAssertTrue(pc.updateJourneyRoute(id: "J1", route: newRoute, stats: stats))

        let reloaded = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" })
        XCTAssertEqual(reloaded.route.coordinates.count, 2, "new route persisted")
        XCTAssertEqual(reloaded.summitElevation, 900, "stats mirrored to scalar column")
        XCTAssertEqual(reloaded.camps.count, 3, "days are NEVER silently re-seeded by a route replace")
        XCTAssertEqual(reloaded.camps.map(\.name), ["Day 1", "Camp Two", "Day 3"], "day names untouched")
    }

    func testUpdateDayPositionsIsOptInAndPositional() throws {
        let pc = controller(Self.journey(dayCount: 3))
        XCTAssertTrue(pc.updateWaypointPositions(journeyID: "J1",
                                                 coordinates: [[20, 50], [21, 51]],
                                                 elevations: [1234, 0]))
        let camps = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }).camps
        XCTAssertEqual(camps[0].coordinates, [20, 50])
        XCTAssertEqual(camps[0].elevation, 1234)
        XCTAssertEqual(camps[1].coordinates, [21, 51])
        XCTAssertEqual(camps[1].elevation, 1100, "elevation 0 sentinel leaves the original value untouched")
        // Third day had no matching waypoint in the input — untouched.
        XCTAssertEqual(camps[2].name, "Day 3")
    }

    func testFixesFromPhotosNeedsCoordinateAndTime() {
        let withBoth = Photo(id: "a", journeyId: "J1", waypointId: nil, url: "", thumbnailURL: nil,
                             caption: nil, coordinates: [10, 60], takenAt: "2023-09-29T06:00:00Z")
        let noCoord = Photo(id: "b", journeyId: "J1", waypointId: nil, url: "", thumbnailURL: nil,
                            caption: nil, coordinates: nil, takenAt: "2023-09-29T06:00:00Z")
        let noTime = Photo(id: "c", journeyId: "J1", waypointId: nil, url: "", thumbnailURL: nil,
                           caption: nil, coordinates: [10, 60], takenAt: nil)
        let fixes = RouteCorrection.fixes(from: [withBoth, noCoord, noTime])
        XCTAssertEqual(fixes.count, 1)
        XCTAssertEqual(fixes.first?.coordinate, [10, 60])
    }

    // MARK: - Day renumbering (pure)

    func testRenumberingIsContiguousAndConsistent() {
        let a = DayRenumbering.assignments(orderedIDs: ["c", "a", "b"])
        XCTAssertEqual(a.map(\.dayNumber), [1, 2, 3])
        XCTAssertEqual(a.map(\.sortOrder), [0, 1, 2])
        XCTAssertEqual(a.map(\.id), ["c", "a", "b"], "order is exactly as given")
    }

    // MARK: - Day management (add / delete / reorder)

    func testDeleteDayUnassignsPhotosAndComments() throws {
        let pc = controller(Self.journey(dayCount: 3))
        pc.insertPhoto(Self.photo(id: "P1", waypointId: "W2"))
        _ = pc.createComment(id: "C1", waypointID: "W2", journeyID: "J1",
                             userID: "u", authorName: "Chris", content: "Beautiful camp")

        XCTAssertTrue(pc.deleteWaypoint(id: "W2"))

        // The photo survives, now unassigned.
        let photo = try XCTUnwrap(pc.loadPhotos(forJourneyID: "J1").first { $0.id == "P1" })
        XCTAssertNil(photo.waypointId, "photo is UNASSIGNED, never deleted")
        // The comment survives (unassigned), never deleted.
        XCTAssertEqual(pc.commentCount(), 1, "comment is preserved, not deleted")
        XCTAssertTrue(pc.loadComments(forWaypointID: "W2", currentUserId: "u").isEmpty,
                      "comment no longer hangs off the deleted day")
        // Survivors renumber 1…2.
        let camps = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }).camps
        XCTAssertEqual(camps.map(\.id), ["W1", "W3"])
        XCTAssertEqual(camps.map(\.dayNumber), [1, 2], "renumbered consistently after delete")
    }

    func testAddDayAppendsAndInsertsAfter() throws {
        let pc = controller(Self.journey(dayCount: 2))
        let appended = try XCTUnwrap(pc.addWaypoint(journeyID: "J1", name: "New End", afterDayNumber: nil))
        var camps = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }).camps
        XCTAssertEqual(camps.map(\.name), ["Day 1", "Camp Two", "New End"])
        XCTAssertEqual(camps.first { $0.id == appended }?.dayNumber, 3)

        // Insert after day 1 → lands at position 2, everything renumbers.
        let inserted = try XCTUnwrap(pc.addWaypoint(journeyID: "J1", name: "Middle", afterDayNumber: 1))
        camps = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }).camps
        XCTAssertEqual(camps.map(\.name), ["Day 1", "Middle", "Camp Two", "New End"])
        XCTAssertEqual(camps.first { $0.id == inserted }?.dayNumber, 2)
        XCTAssertEqual(camps.map(\.dayNumber), [1, 2, 3, 4])
    }

    func testReorderKeepsPhotoLinkageByWaypointID() throws {
        let pc = controller(Self.journey(dayCount: 3))
        pc.insertPhoto(Self.photo(id: "P1", waypointId: "W3"))   // photo pinned to the LAST day

        XCTAssertTrue(pc.reorderWaypoints(journeyID: "J1", orderedIDs: ["W3", "W1", "W2"]))
        let journey = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" })
        XCTAssertEqual(journey.camps.map(\.id), ["W3", "W1", "W2"], "order applied")
        XCTAssertEqual(journey.camps.map(\.dayNumber), [1, 2, 3], "renumbered by new order")

        // The photo still belongs to W3 (now day 1) — linkage is by stable id, not position.
        let photo = try XCTUnwrap(pc.loadPhotos(forJourneyID: "J1").first { $0.id == "P1" })
        XCTAssertEqual(photo.waypointId, "W3")
    }

    // MARK: - Photo day-move (edit path)

    func testMovePhotoBetweenDaysWritesWaypointID() throws {
        let pc = controller(Self.journey(dayCount: 3))
        pc.insertPhoto(Self.photo(id: "P1", waypointId: "W1"))

        XCTAssertEqual(pc.assignPhoto(id: "P1", toWaypointID: "W3")?.waypointId, "W3")
        XCTAssertEqual(pc.loadPhotos(forJourneyID: "J1").first?.waypointId, "W3")
        // …and back to Unassigned.
        XCTAssertNil(pc.assignPhoto(id: "P1", toWaypointID: nil)?.waypointId)
    }

    // MARK: - Editable day content (round-trip)

    func testDayContentEditDeleteAddRoundTrips() throws {
        let pc = controller(Self.journey(dayCount: 2))
        // Seed two facts, one POI.
        XCTAssertTrue(pc.setDayContent(
            waypointID: "W1",
            funFacts: [FunFact(id: "f1", content: "First", category: "general", source: nil, learnMoreUrl: nil, icon: nil),
                       FunFact(id: "f2", content: "Second", category: "general", source: nil, learnMoreUrl: nil, icon: nil)],
            pointsOfInterest: [PointOfInterest(id: "p1", name: "Lake", category: "water", coordinates: nil, elevation: nil,
                                               description: nil, routeDistanceKm: nil, tips: nil, timeFromPrevious: nil, icon: nil)],
            historicalSites: [],
            weather: nil))
        var camp = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }?.camps.first { $0.id == "W1" })
        XCTAssertEqual(camp.funFacts?.count, 2)
        XCTAssertEqual(camp.pointsOfInterest?.count, 1)

        // Edit the first fact's text, DELETE the second, ADD a historical site — authoritative SET.
        XCTAssertTrue(pc.setDayContent(
            waypointID: "W1",
            funFacts: [FunFact(id: "f1", content: "First (edited)", category: "general", source: nil, learnMoreUrl: nil, icon: nil)],
            pointsOfInterest: [PointOfInterest(id: "p1", name: "Lake", category: "water", coordinates: nil, elevation: nil,
                                               description: nil, routeDistanceKm: nil, tips: nil, timeFromPrevious: nil, icon: nil)],
            historicalSites: [HistoricalSite(id: "h1", name: "Old Fort", coordinates: nil, elevation: nil,
                                             routeDistanceKm: nil, summary: "A fort", description: nil, period: nil,
                                             significance: nil, imageUrls: nil, links: nil, tags: nil, dayNumber: nil)],
            weather: nil))
        camp = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }?.camps.first { $0.id == "W1" })
        XCTAssertEqual(camp.funFacts?.map(\.content), ["First (edited)"], "edit + delete round-trip")
        XCTAssertEqual(camp.historicalSites?.first?.name, "Old Fort", "add round-trips")
    }

    func testWeatherSetAndClearRoundTrips() throws {
        let pc = controller(Self.journey(dayCount: 1))
        let weather = WeatherData(temperatureMax: 12, temperatureMin: -3, precipitationSum: 4, windSpeedMax: 20, weatherCode: 2)
        XCTAssertTrue(pc.setDayContent(waypointID: "W1", funFacts: [], pointsOfInterest: [],
                                       historicalSites: [], weather: weather))
        var camp = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }?.camps.first)
        XCTAssertEqual(camp.weather?.temperatureMax, 12)

        // Clear it.
        XCTAssertTrue(pc.setDayContent(waypointID: "W1", funFacts: [], pointsOfInterest: [],
                                       historicalSites: [], weather: nil))
        camp = try XCTUnwrap(pc.loadJourneys().first { $0.id == "J1" }?.camps.first)
        XCTAssertNil(camp.weather, "weather cleared")
    }

    // MARK: - Enrich existing journey (shared coordinator reuse)

    /// A journey whose day 1 is a REAL named camp with weather + POIs already, and day 2 is a bare
    /// "Day 4" placeholder with a coordinate + date but no weather / POIs.
    private static func enrichableJourney() -> Journey {
        let named = Camp(id: "D1", name: "Mti Mkubwa (Big Tree Camp)", dayNumber: 1, elevation: 2650,
                         coordinates: [37.30, -3.10], notes: "", highlights: [],
                         weather: WeatherData(temperatureMax: 8, temperatureMin: 2, precipitationSum: 0, windSpeedMax: 10, weatherCode: 1),
                         pointsOfInterest: [PointOfInterest(id: "poi", name: "Big Tree", category: "landmark",
                                                            coordinates: nil, elevation: nil, description: nil,
                                                            routeDistanceKm: nil, tips: nil, timeFromPrevious: nil, icon: nil)])
        let bare = Camp(id: "D2", name: "Day 4", dayNumber: 2, elevation: 3900,
                        coordinates: [37.32, -3.12], notes: "", highlights: [])
        return Journey(id: "K1", slug: "kili", name: "Kilimanjaro — Lemosho", country: "Tanzania",
                       description: "", heroImageURL: nil, dateStarted: "2023-09-29", dateEnded: "2023-10-05",
                       isPublic: false, summitElevation: 5895, totalDistance: 61, totalDays: 7,
                       centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
                       stats: TrekStats(duration: 7, totalDistance: 61, totalElevationGain: 4400,
                                        totalElevationLoss: nil, highestPoint: nil),
                       route: Route(type: "LineString", coordinates: [[37.30, -3.10], [37.32, -3.12]]),
                       camps: [named, bare])
    }

    private struct StubGeocoder: ReverseGeocoding {
        func reverseGeocode(lng: Double, lat: Double) async throws -> GeocodedPlace? {
            GeocodedPlace(countryName: "Tanzania", areaOfInterest: "Shira Camp")
        }
    }
    private struct StubSearch: LocalPOISearching {
        func search(query: String, lng: Double, lat: Double, radiusMeters: Double) async throws -> [LocalSearchResult] {
            [LocalSearchResult(name: "Shira Cathedral", category: "summit", coordinate: [37.32, -3.12])]
        }
    }
    private struct StubWeather: HistoricalWeatherProviding {
        func dailyWeather(lng: Double, lat: Double, date: Date) async throws -> WeatherData? {
            WeatherData(temperatureMax: -6, temperatureMin: -9, precipitationSum: 13, windSpeedMax: 10, weatherCode: 75)
        }
    }

    @MainActor
    private func enrichCoordinator() -> JourneySuggestionCoordinator {
        JourneySuggestionCoordinator(
            place: PlaceEnrichment(geocoder: StubGeocoder(), search: StubSearch(), interCallDelayNanos: 0),
            weather: WeatherEnrichment(provider: StubWeather(), interCallDelayNanos: 0),
            factsEnabled: false)
    }

    @MainActor
    func testEnrichExistingOffersGapsOnlyAndRespectsRealNames() async {
        let journey = Self.enrichableJourney()
        let draft = EnrichJourneySheet.makeDraft(from: journey)
        let coord = enrichCoordinator()
        await coord.run(fixes: [], draft: draft)   // fixes: [] → no route suggestion

        // Country already set → no country suggestion.
        XCTAssertNil(coord.model.statusOf(.country))
        // Route is never suggested in enrich.
        XCTAssertNil(coord.model.statusOf(.routeFromPhotos))

        // 'Mti Mkubwa (Big Tree Camp)' is a real name → NOT offered a rename.
        XCTAssertNil(coord.model.statusOf(.campName(dayID: "D1")))
        // A day literally named 'Day 4' → offered a rename.
        XCTAssertTrue(coord.model.isPending(.campName(dayID: "D2")))

        // Day 1 already has weather + POIs → gaps only, so nothing offered for it.
        XCTAssertNil(coord.model.statusOf(.weather(dayID: "D1")))
        XCTAssertNil(coord.model.statusOf(.pois(dayID: "D1")))
        // Day 2 lacks both, has a date + coordinate → both offered (Kilimanjaro finally gets weather).
        XCTAssertTrue(coord.model.isPending(.weather(dayID: "D2")))
        XCTAssertTrue(coord.model.isPending(.pois(dayID: "D2")))
    }

    @MainActor
    func testEnrichAppliesWeatherOntoDraftDayByIdentity() async {
        let journey = Self.enrichableJourney()
        var draft = EnrichJourneySheet.makeDraft(from: journey)
        let coord = enrichCoordinator()
        await coord.run(fixes: [], draft: draft)

        coord.accept(.weather(dayID: "D2"), into: &draft)
        let day2 = draft.days.first { $0.id == "D2" }
        XCTAssertEqual(day2?.weather?.weatherCode, 75, "accepted weather lands on the right day")
        // Day 1's pre-existing weather is untouched.
        XCTAssertEqual(draft.days.first { $0.id == "D1" }?.weather?.weatherCode, 1)
    }

    func testMakeDraftCarriesExistingContentAndOmitsEmptyRoute() {
        let journey = Self.enrichableJourney()
        let draft = EnrichJourneySheet.makeDraft(from: journey)
        XCTAssertEqual(draft.country, "Tanzania")
        XCTAssertNotNil(draft.route)
        XCTAssertEqual(draft.days.first { $0.id == "D1" }?.pointsOfInterest?.count, 1,
                       "existing content is carried so the coordinator's gap-only guards can see it")
        XCTAssertEqual(draft.days.map(\.id), ["D1", "D2"], "day identities preserved")
    }

    @MainActor
    func testEnrichPOIAndCampNameApplyOntoDraft() async {
        let journey = Self.enrichableJourney()
        var draft = EnrichJourneySheet.makeDraft(from: journey)
        let coord = enrichCoordinator()
        await coord.run(fixes: [], draft: draft)

        coord.accept(.pois(dayID: "D2"), into: &draft)
        coord.accept(.campName(dayID: "D2"), into: &draft)
        let day2 = draft.days.first { $0.id == "D2" }
        XCTAssertEqual(day2?.pointsOfInterest?.first?.name, "Shira Cathedral")
        XCTAssertEqual(day2?.name, "Shira Camp", "auto-named day is renamed on accept")
    }

    // MARK: - Store-level (MainActor) corrections reload the published journeys

    @MainActor
    func testStoreReplaceRouteRecomputesStatsAndKeepsDays() throws {
        let pc = controller(Self.journey(dayCount: 3))
        let store = JourneyStore(persistence: pc)
        let newRoute = Route(type: "LineString", coordinates: [[10, 60, 0], [10.2, 60.2, 1800]])

        XCTAssertTrue(store.replaceRoute(journeyID: "J1", route: newRoute))
        let journey = try XCTUnwrap(store.journey(withID: "J1"))
        XCTAssertEqual(journey.summitElevation, 1800, "stats recomputed from the new route")
        XCTAssertEqual(journey.camps.count, 3, "days preserved through a store route replace")
    }

    @MainActor
    func testStoreDeleteDayReloadsAndRenumbers() throws {
        let pc = controller(Self.journey(dayCount: 3))
        let store = JourneyStore(persistence: pc)
        XCTAssertTrue(store.deleteDay("W1"))
        let journey = try XCTUnwrap(store.journey(withID: "J1"))
        XCTAssertEqual(journey.camps.map(\.id), ["W2", "W3"])
        XCTAssertEqual(journey.camps.map(\.dayNumber), [1, 2])
    }

    @MainActor
    func testStoreRecomputeStatsUsesCurrentRoute() throws {
        let pc = controller(Self.journey(dayCount: 2))
        let store = JourneyStore(persistence: pc)
        // The fixture's route climbs 0 → 500 m; stats should reflect that after a recompute.
        XCTAssertTrue(store.recomputeStats(journeyID: "J1"))
        let journey = try XCTUnwrap(store.journey(withID: "J1"))
        XCTAssertEqual(journey.stats.totalElevationGain, 500)
    }

    // MARK: - Fixtures

    /// A journey with `dayCount` days: W1="Day 1", W2="Camp Two", W3="Day 3", … and a small route.
    private static func journey(dayCount: Int) -> Journey {
        let names = ["Day 1", "Camp Two", "Day 3", "Day 4", "Day 5"]
        let camps = (0..<dayCount).map { i in
            Camp(id: "W\(i + 1)", name: names[i], dayNumber: i + 1, elevation: 1000 + i * 100,
                 coordinates: [10.0 + Double(i) / 10, 60.0], notes: "", highlights: [])
        }
        return Journey(id: "J1", slug: "j1", name: "Test Journey", country: "",
                       description: "", heroImageURL: nil, dateStarted: nil, dateEnded: nil,
                       isPublic: false, summitElevation: 1500, totalDistance: 10, totalDays: dayCount,
                       centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
                       stats: TrekStats(duration: dayCount, totalDistance: 10, totalElevationGain: 500,
                                        totalElevationLoss: nil,
                                        highestPoint: HighestPoint(name: "Top", elevation: 1500, coordinates: nil)),
                       route: Route(type: "LineString", coordinates: [[10, 60, 0], [10.1, 60, 500]]),
                       camps: camps)
    }

    private static func photo(id: String, waypointId: String?) -> Photo {
        Photo(id: id, journeyId: "J1", waypointId: waypointId,
              url: "journeys/J1/photos/\(id).jpg", thumbnailURL: nil, caption: nil,
              coordinates: [10, 60], takenAt: "2023-09-29T06:00:00Z", isHero: false,
              sortOrder: 0, rotation: 0, mediaType: "image", duration: nil,
              locationSource: "exif", localOriginalPath: nil, localThumbPath: nil)
    }
}
