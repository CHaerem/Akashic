import XCTest
@testable import Akashic

/// Golden encode/decode tests pinning the wire shapes to the MCP JSON (exact keys, casing,
/// and the string-typed `ExtendedStats` fields).
final class IntentModelTests: XCTestCase {

    private func encoded<T: Encodable>(_ value: T) -> String { IntentJSON.string(value) }

    // MARK: - snake_case keys (JourneyListItem)

    func testJourneyListItemUsesSnakeCaseKeys() {
        let item = JourneyListItem(
            id: "kilimanjaro", slug: "kilimanjaro", name: "Kilimanjaro - Lemosho Route",
            country: "Tanzania", totalDays: 7, totalDistance: 70,
            summitElevation: 5895, dateStarted: "2023-09-29")
        let json = encoded(item)

        for key in ["\"total_days\"", "\"total_distance\"", "\"summit_elevation\"", "\"date_started\""] {
            XCTAssertTrue(json.contains(key), "missing wire key \(key) in \(json)")
        }
        XCTAssertFalse(json.contains("totalDays"), "should not leak camelCase keys: \(json)")
        XCTAssertFalse(json.contains("summitElevation"))
    }

    // MARK: - snake_case keys (Photo)

    func testMCPPhotoUsesSnakeCaseKeys() {
        let photo = MCPPhoto(
            id: "p1", journeyId: "j1", waypointId: "w1",
            url: "journeys/j1/photos/p1.jpg", thumbnailURL: "journeys/j1/photos/p1_thumb.jpg",
            caption: "Summit", coordinates: [37.35, -3.07], takenAt: "2023-10-06T05:00:00Z",
            isHero: true, sortOrder: 1)
        let json = encoded(photo)

        for key in ["\"journey_id\"", "\"waypoint_id\"", "\"thumbnail_url\"",
                    "\"taken_at\"", "\"is_hero\"", "\"sort_order\""] {
            XCTAssertTrue(json.contains(key), "missing wire key \(key) in \(json)")
        }
        // Slashes must not be escaped (matches MCP JSON.stringify output).
        XCTAssertTrue(json.contains("journeys/j1/photos/p1.jpg"))
        XCTAssertFalse(json.contains("journeys\\/j1"))
    }

    // MARK: - camelCase keys + omitted empty highlights (Camp)

    func testMCPCampUsesCamelCaseKeysAndOmitsEmptyHighlights() {
        let withHighlights = MCPCamp(
            id: "c1", name: "Camp 1", dayNumber: 2, elevation: 3846,
            coordinates: [37.27, -3.04], notes: "n", highlights: ["Plateau"],
            routeDistanceKm: 24, routePointIndex: 51)
        let json = encoded(withHighlights)
        for key in ["\"dayNumber\"", "\"routeDistanceKm\"", "\"routePointIndex\""] {
            XCTAssertTrue(json.contains(key), "missing camelCase key \(key) in \(json)")
        }
        XCTAssertTrue(json.contains("\"highlights\""))

        // Empty highlights → mapped to nil → omitted entirely (MCP `highlights || undefined`).
        let empty = JourneyQuery.mcpCamp(from: Camp(
            id: "c2", name: "Camp 2", dayNumber: 1, elevation: 100,
            coordinates: [0, 0], notes: "", highlights: []))
        XCTAssertNil(empty.highlights)
        XCTAssertFalse(encoded(empty).contains("highlights"))
    }

    // MARK: - empty photos shape

    func testEmptyPhotosResultExactShape() {
        let result = JourneyPhotosResult(photos: [], total: 0)
        XCTAssertEqual(encoded(result), #"{"photos":[],"total":0}"#)
    }

    // MARK: - list result hasMore key

    func testListResultHasMoreCamelCaseKey() {
        // Deterministic, alphabetical key order (see IntentJSON.encoder).
        let result = JourneyListResult(journeys: [], total: 0, hasMore: false)
        XCTAssertEqual(encoded(result), #"{"hasMore":false,"journeys":[],"total":0}"#)
    }

    // MARK: - decode golden MCP payloads

    func testDecodesGoldenDetailsPayload() throws {
        let json = #"""
        {
          "id": "abc", "slug": "test-trek", "name": "Test Trek",
          "country": "Norway", "description": "d", "date_started": "2024-01-01",
          "stats": { "duration": 2, "totalDistance": 12, "totalElevationGain": 300,
                     "totalElevationLoss": 100, "highestPoint": { "name": "Top", "elevation": 1500 } },
          "camps": [ { "id": "c1", "name": "Camp 1", "dayNumber": 1, "elevation": 1200,
                       "coordinates": [10.0, 60.0], "notes": "n", "highlights": ["View"],
                       "routeDistanceKm": 5, "routePointIndex": 3 } ],
          "route": { "type": "LineString", "coordinates": [[10.0,60.0,100],[10.01,60.01,400]] }
        }
        """#
        let details = try JSONDecoder().decode(JourneyDetailsResult.self, from: Data(json.utf8))

        XCTAssertEqual(details.id, "abc")
        XCTAssertEqual(details.dateStarted, "2024-01-01")
        XCTAssertEqual(details.stats?.duration, 2)
        XCTAssertEqual(details.stats?.highestPoint?.elevation, 1500)
        XCTAssertEqual(details.camps.count, 1)
        XCTAssertEqual(details.camps.first?.dayNumber, 1)
        XCTAssertEqual(details.camps.first?.routePointIndex, 3)
        XCTAssertEqual(details.route?.type, "LineString")
        XCTAssertEqual(details.route?.coordinates.count, 2)
    }

    func testDecodesGoldenStatsPayloadWithStringTypedFields() throws {
        let json = #"""
        {
          "journeyName": "Test",
          "basicStats": { "duration": 2, "totalDistance": 12, "totalElevationGain": 300,
                          "highestPoint": { "name": "T", "elevation": 100 } },
          "extendedStats": { "avgDailyDistance": "6.0", "maxDailyGain": 300, "maxDailyLoss": 100,
                             "totalElevationGain": 300, "totalElevationLoss": 100, "difficulty": "Easy",
                             "startElevation": 100, "endElevation": 400, "avgAltitude": 250,
                             "longestDayDistance": 12.0, "longestDayNumber": 1,
                             "estimatedTotalTime": "2h 30min", "steepestDayGradient": 33,
                             "steepestDayNumber": 1 }
        }
        """#
        let stats = try JSONDecoder().decode(JourneyStatsResult.self, from: Data(json.utf8))

        // The two string-typed fields must survive as Strings (not numbers).
        XCTAssertEqual(stats.extendedStats.avgDailyDistance, "6.0")
        XCTAssertEqual(stats.extendedStats.estimatedTotalTime, "2h 30min")
        XCTAssertEqual(stats.basicStats.duration, 2)
        XCTAssertEqual(stats.extendedStats.difficulty, "Easy")
    }
}
