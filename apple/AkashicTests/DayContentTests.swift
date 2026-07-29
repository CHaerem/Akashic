import XCTest
import CoreData
@testable import Akashic

/// Tests for the day-content layer: decoding the waypoint JSONB payloads (weather,
/// fun facts, points of interest, historical sites) from a REAL exported waypoint, the
/// Core Data round-trip that surfaces them, the weather-symbol helper, and photo→day
/// grouping (incl. "unassigned"). The waypoint blob below is a compacted copy of the real
/// Kilimanjaro summit (Uhuru Peak) row from the family export.
@MainActor
final class DayContentTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func inMemoryContext() -> NSManagedObjectContext {
        PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
            .container.viewContext
    }

    /// Real Kilimanjaro summit waypoint (trimmed) — snake_case, exactly as exported.
    private let summitWaypointJSON = #"""
    [{
      "id": "d2347d69-0439-4336-8e89-0c3683692f96",
      "journey_id": "e27c89f6-8d7f-4b30-a0c9-54fe44e01a9b",
      "name": "Uhuru Peak (Summit)",
      "day_number": 6,
      "coordinates": [37.35404313764825, -3.0764431376482513],
      "elevation": 5874,
      "weather": {
        "fetched_at": "2025-12-17T07:45:29.977Z",
        "weather_code": 75, "wind_speed_max": 10.5,
        "temperature_max": -6.1, "temperature_min": -9.5, "precipitation_sum": 13.6
      },
      "fun_facts": [
        {"id": "kili-6-1", "content": "Uhuru Peak means \"Freedom Peak\" in Swahili.", "category": "history"},
        {"id": "kili-6-2", "content": "At the summit there is ~50% less oxygen than at sea level.", "category": "science"}
      ],
      "points_of_interest": [
        {"id": "kili-poi-6-1", "name": "Stella Point", "category": "summit", "elevation": 5756,
         "coordinates": [37.3512, -3.0789], "description": "Crater-rim point reached at sunrise."},
        {"id": "kili-poi-6-2", "name": "Furtwängler Glacier", "category": "landmark", "elevation": 5800,
         "coordinates": [37.3534, -3.0756], "description": "One of the last glaciers near the summit."}
      ],
      "historical_sites": [
        {"id": "kili-hist-6-1", "name": "Uhuru Peak",
         "tags": ["summit", "independence", "first ascent"],
         "links": [{"url": "https://en.wikipedia.org/wiki/Mount_Kilimanjaro", "label": "Wikipedia"}],
         "period": "1889 - Present",
         "summary": "The highest point in Africa at 5,895m.",
         "coordinates": [37.3556, -3.0758],
         "description": "First climbed by Meyer and Purtscheller in 1889; renamed at independence.",
         "significance": "major"}
      ]
    }]
    """#

    private func summitWaypointRow() throws -> WaypointRow {
        let rows = try ExportBundle.decodeRows([WaypointRow].self,
                                               from: summitWaypointJSON.data(using: .utf8)!)
        return try XCTUnwrap(rows.first)
    }

    // MARK: - Decoding the export JSONB payloads

    func testWaypointRowDecodesFunFacts() throws {
        let facts = try XCTUnwrap(summitWaypointRow().funFacts)
        XCTAssertEqual(facts.count, 2)
        XCTAssertEqual(facts[0].id, "kili-6-1")
        XCTAssertEqual(facts[0].category, "history")
        XCTAssertTrue(facts[0].content.contains("Freedom Peak"))
        XCTAssertEqual(facts[1].category, "science")
    }

    func testWaypointRowDecodesPointsOfInterest() throws {
        let pois = try XCTUnwrap(summitWaypointRow().pointsOfInterest)
        XCTAssertEqual(pois.count, 2)
        XCTAssertEqual(pois[0].name, "Stella Point")
        XCTAssertEqual(pois[0].category, "summit")
        XCTAssertEqual(pois[0].elevation, 5756)
        XCTAssertEqual(pois[0].coordinates ?? [], [37.3512, -3.0789])
        XCTAssertEqual(pois[1].category, "landmark")
    }

    func testWaypointRowDecodesHistoricalSites() throws {
        let sites = try XCTUnwrap(summitWaypointRow().historicalSites)
        XCTAssertEqual(sites.count, 1)
        let site = sites[0]
        XCTAssertEqual(site.name, "Uhuru Peak")
        XCTAssertEqual(site.significance, "major")
        XCTAssertEqual(site.period, "1889 - Present")
        XCTAssertEqual(site.tags ?? [], ["summit", "independence", "first ascent"])
        XCTAssertEqual(site.links?.count, 1)
        XCTAssertEqual(site.links?.first?.label, "Wikipedia")
        XCTAssertTrue(site.summary.contains("highest point in Africa"))
    }

    func testExportMapperCarriesContentOntoCamp() throws {
        let camp = ExportMapper.camp(from: try summitWaypointRow())
        XCTAssertEqual(camp.funFacts?.count, 2)
        XCTAssertEqual(camp.pointsOfInterest?.count, 2)
        XCTAssertEqual(camp.historicalSites?.count, 1)
        XCTAssertEqual(camp.weather?.weatherCode, 75)
    }

    // MARK: - Core Data round-trip (the crux: content must survive read-back)

    func testDayContentSurvivesCoreDataRoundTrip() throws {
        let context = inMemoryContext()
        let camp = ExportMapper.camp(from: try summitWaypointRow())
        let journey = Journey(
            id: "e27c89f6-8d7f-4b30-a0c9-54fe44e01a9b", slug: "kilimanjaro", name: "Kilimanjaro",
            country: "Tanzania", description: "", heroImageURL: nil,
            dateStarted: "2022-09-30", dateEnded: nil, isPublic: false,
            summitElevation: 5895, totalDistance: nil, totalDays: nil,
            centerCoordinates: nil, preferredBearing: nil, preferredPitch: nil,
            stats: TrekStats(duration: 6, totalDistance: 0, totalElevationGain: 0,
                             totalElevationLoss: nil, highestPoint: nil),
            route: .empty, camps: [camp])

        CoreDataMapping.upsertJourney(journey, into: context)
        try context.save()

        let loaded = try XCTUnwrap(context.registeredObjects.compactMap { $0 as? CDJourney }.first)
        let round = try XCTUnwrap(CoreDataMapping.journey(from: loaded).camps.first)

        XCTAssertEqual(round.funFacts?.count, 2)
        XCTAssertEqual(round.funFacts?.first?.category, "history")
        XCTAssertEqual(round.pointsOfInterest?.count, 2)
        XCTAssertEqual(round.pointsOfInterest?.first?.name, "Stella Point")
        XCTAssertEqual(round.historicalSites?.first?.significance, "major")
        XCTAssertEqual(round.historicalSites?.first?.links?.first?.url,
                       "https://en.wikipedia.org/wiki/Mount_Kilimanjaro")
        XCTAssertEqual(round.weather?.weatherCode, 75)
    }

    func testAbsentContentRoundTripsAsNil() throws {
        let context = inMemoryContext()
        let camp = Camp(id: "w", name: "Barren Camp", dayNumber: 1, elevation: 100,
                        coordinates: [10, 60], notes: "", highlights: [])
        let journey = Journey(
            id: "j", slug: "j", name: "J", country: "", description: "", heroImageURL: nil,
            dateStarted: nil, dateEnded: nil, isPublic: false, summitElevation: nil,
            totalDistance: nil, totalDays: nil, centerCoordinates: nil,
            preferredBearing: nil, preferredPitch: nil,
            stats: TrekStats(duration: 1, totalDistance: 0, totalElevationGain: 0,
                             totalElevationLoss: nil, highestPoint: nil),
            route: .empty, camps: [camp])
        CoreDataMapping.upsertJourney(journey, into: context)
        try context.save()

        let loaded = try XCTUnwrap(context.registeredObjects.compactMap { $0 as? CDJourney }.first)
        let round = try XCTUnwrap(CoreDataMapping.journey(from: loaded).camps.first)
        XCTAssertNil(round.funFacts)
        XCTAssertNil(round.pointsOfInterest)
        XCTAssertNil(round.historicalSites)
    }

    // MARK: - Weather symbol mapping (pure helper)

    func testWeatherSymbolMapping() {
        XCTAssertEqual(WeatherPresentation.symbol(for: 0), "sun.max.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 3), "cloud.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 53), "cloud.drizzle.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 63), "cloud.rain.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 75), "cloud.snow.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 95), "cloud.bolt.rain.fill")
        // Unknown / nil fall back to a neutral cloud.
        XCTAssertEqual(WeatherPresentation.symbol(for: nil), "cloud.fill")
        XCTAssertEqual(WeatherPresentation.symbol(for: 12345), "cloud.fill")
    }

    func testWeatherLabelMapping() {
        XCTAssertEqual(WeatherPresentation.label(for: 75), "Heavy snow")
        XCTAssertEqual(WeatherPresentation.label(for: 0), "Clear sky")
        XCTAssertEqual(WeatherPresentation.label(for: 3), "Overcast")
        XCTAssertEqual(WeatherPresentation.label(for: nil), "Weather")
    }

    // MARK: - Category style lookups degrade gracefully

    func testCategoryStylesHaveDefaults() {
        XCTAssertEqual(FunFactStyle.config(for: "history").label, "History")
        XCTAssertEqual(FunFactStyle.config(for: "totally-unknown").icon, "🗺️")
        XCTAssertEqual(POIStyle.config(for: "summit").icon, "⛰️")
        XCTAssertEqual(HistoricalSignificance.label(for: "major"), "Major")
        XCTAssertEqual(HistoricalSignificance.label(for: nil), "Minor")
    }

    // MARK: - photosByDay grouping (incl. unassigned)

    func testGroupByDayIncludesUnassigned() {
        let camps = [
            Camp(id: "W1", name: "Day 1 Camp", dayNumber: 1, elevation: 0,
                 coordinates: [10, 60], notes: "", highlights: []),
            Camp(id: "W2", name: "Day 2 Camp", dayNumber: 2, elevation: 0,
                 coordinates: [10.1, 60.1], notes: "", highlights: [])
        ]
        let journey = Journey(
            id: "J", slug: "j", name: "J", country: "", description: "", heroImageURL: nil,
            dateStarted: nil, dateEnded: nil, isPublic: false, summitElevation: nil,
            totalDistance: nil, totalDays: nil, centerCoordinates: nil,
            preferredBearing: nil, preferredPitch: nil,
            stats: TrekStats(duration: 2, totalDistance: 0, totalElevationGain: 0,
                             totalElevationLoss: nil, highestPoint: nil),
            route: .empty, camps: camps)
        let matcher = PhotoDayMatcher(journey: journey)

        func photo(_ id: String, waypoint: String?) -> Photo {
            Photo(id: id, journeyId: "J", waypointId: waypoint, url: "u", thumbnailURL: nil,
                  caption: nil, coordinates: nil, takenAt: nil, isHero: false, sortOrder: 0,
                  rotation: 0, mediaType: "image", duration: nil, locationSource: nil,
                  localOriginalPath: nil, localThumbPath: nil)
        }
        let grouped = matcher.groupByDay([
            photo("a", waypoint: "W1"),
            photo("b", waypoint: "W2"),
            photo("c", waypoint: "W2"),
            photo("d", waypoint: nil)   // no signal → unassigned
        ])
        XCTAssertEqual(grouped.byDay[1]?.count, 1)
        XCTAssertEqual(grouped.byDay[2]?.count, 2)
        XCTAssertEqual(grouped.unassigned.count, 1)
    }
}

/// QUA-67: the story strip's tap → lightbox index resolves by IDENTITY. The shipped mapping was
/// `hero != nil ? index + 1 : index`, correct only when the cover photo is the day's first —
/// 'Set as cover' on a mid-day photo made every strip tap before it open the WRONG photo.
final class StoryPhotoIndexingTests: XCTestCase {

    private func photo(_ id: String, hero: Bool = false, order: Int) -> Photo {
        Photo(id: id, journeyId: "j", waypointId: nil, url: "u/\(id).jpg",
              thumbnailURL: nil, caption: nil, coordinates: nil, takenAt: nil,
              isHero: hero, sortOrder: order)
    }

    func testMidDayCoverPhotoNoLongerShiftsEveryEarlierTap() {
        // Day [A, B, C(hero), D] → strip [A, B, D]. Tapping A must open A (index 0) —
        // the old +1 mapping opened B.
        let all = [photo("A", order: 0), photo("B", order: 1),
                   photo("C", hero: true, order: 2), photo("D", order: 3)]
        let strip = all.filter { $0.id != "C" }

        XCTAssertEqual(StoryPhotoIndexing.lightboxIndex(forStripIndex: 0, strip: strip, all: all), 0,
                       "tapping A opens A — the old mapping opened B")
        XCTAssertEqual(StoryPhotoIndexing.lightboxIndex(forStripIndex: 1, strip: strip, all: all), 1)
        XCTAssertEqual(StoryPhotoIndexing.lightboxIndex(forStripIndex: 2, strip: strip, all: all), 3,
                       "D sits after the hero in the full list")
    }

    func testFirstPhotoAsCoverKeepsTheOldHappyPath() {
        let all = [photo("A", hero: true, order: 0), photo("B", order: 1), photo("C", order: 2)]
        let strip = Array(all.dropFirst())
        XCTAssertEqual(StoryPhotoIndexing.lightboxIndex(forStripIndex: 0, strip: strip, all: all), 1)
        XCTAssertEqual(StoryPhotoIndexing.lightboxIndex(forStripIndex: 1, strip: strip, all: all), 2)
    }

    func testOutOfBoundsAndUnknownAreNil() {
        let all = [photo("A", order: 0)]
        XCTAssertNil(StoryPhotoIndexing.lightboxIndex(forStripIndex: 5, strip: all, all: all))
        XCTAssertNil(StoryPhotoIndexing.lightboxIndex(forStripIndex: 0, strip: all, all: []))
    }
}
