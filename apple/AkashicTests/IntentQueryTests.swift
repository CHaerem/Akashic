import XCTest
@testable import Akashic

/// Behavioural tests for the pure `JourneyQuery` engine: clamps, defaults, UUID-or-slug
/// resolution, filtering, and the MCP plain-text error messages.
final class IntentQueryTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func fixtures() throws -> [Journey] {
        try FixtureLoader.loadAll(bundle: bundle)
    }

    /// A base journey cloned into `count` distinct copies for pagination/clamp tests.
    private func syntheticJourneys(count: Int) throws -> [Journey] {
        let base = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        return (0..<count).map { i in
            var j = base
            j.id = String(format: "j-%03d", i)
            j.slug = String(format: "trek-%03d", i)
            j.name = String(format: "Trek %03d", i)
            return j
        }
    }

    // MARK: - clamp helper

    func testClampedLimit() {
        // list: default 20, max 100
        XCTAssertEqual(JourneyQuery.clampedLimit(500, default: 20, max: 100), 100)
        XCTAssertEqual(JourneyQuery.clampedLimit(nil, default: 20, max: 100), 20)
        XCTAssertEqual(JourneyQuery.clampedLimit(0, default: 20, max: 100), 20)
        XCTAssertEqual(JourneyQuery.clampedLimit(30, default: 20, max: 100), 30)
        // search: default 10, max 50
        XCTAssertEqual(JourneyQuery.clampedLimit(500, default: 10, max: 50), 50)
        // photos: default 50, max 200
        XCTAssertEqual(JourneyQuery.clampedLimit(1000, default: 50, max: 200), 200)
    }

    // MARK: - list clamps + pagination

    func testListClampsLimitTo100() throws {
        let journeys = try syntheticJourneys(count: 150)
        let result = JourneyQuery.list(journeys, limit: 500, offset: 0, country: nil)
        XCTAssertEqual(result.journeys.count, 100, "limit 500 must clamp to 100")
        XCTAssertEqual(result.total, 150, "total counts all accessible journeys")
        XCTAssertTrue(result.hasMore)
    }

    func testListDefaultLimitAndOffset() throws {
        let journeys = try syntheticJourneys(count: 150)
        let firstPage = JourneyQuery.list(journeys, limit: nil, offset: nil, country: nil)
        XCTAssertEqual(firstPage.journeys.count, 20, "default limit is 20")
        XCTAssertEqual(firstPage.journeys.first?.name, "Trek 000", "ordered by name")

        let secondPage = JourneyQuery.list(journeys, limit: 20, offset: 20, country: nil)
        XCTAssertEqual(secondPage.journeys.first?.name, "Trek 020")
        XCTAssertEqual(secondPage.total, 150)
    }

    func testListCountryFilterDoesNotAffectTotal() throws {
        let result = JourneyQuery.list(try fixtures(), limit: 20, offset: 0, country: "tanzania")
        XCTAssertEqual(result.journeys.count, 1, "only Kilimanjaro is in Tanzania")
        XCTAssertEqual(result.journeys.first?.slug, "kilimanjaro")
        XCTAssertEqual(result.total, 3, "total mirrors MCP: ignores the country filter")
    }

    // MARK: - search

    func testSearchClampsLimitTo50() throws {
        let journeys = try syntheticJourneys(count: 60) // all names contain "Trek"
        guard case .success(let result) = JourneyQuery.search(journeys, query: "Trek", limit: 500) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(result.journeys.count, 50, "search limit clamps to 50")
        XCTAssertEqual(result.total, 50, "search total is the returned count")
    }

    func testSearchRequiresQuery() throws {
        XCTAssertEqual(JourneyQuery.search(try fixtures(), query: "", limit: 10),
                       .failure("query is required"))
    }

    func testSearchMatchesNameCountryAndDescription() throws {
        let journeys = try fixtures()
        // country match
        guard case .success(let byCountry) = JourneyQuery.search(journeys, query: "peru", limit: 10) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(byCountry.journeys.first?.slug, "inca-trail")
        // name match
        guard case .success(let byName) = JourneyQuery.search(journeys, query: "kilimanjaro", limit: 10) else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(byName.journeys.count, 1)
    }

    // MARK: - UUID-or-slug resolution

    func testResolvesByUuidAndSlug() throws {
        let uuid = "11111111-2222-3333-4444-555555555555"
        var journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        journey.id = uuid
        let journeys = [journey]

        XCTAssertEqual(JourneyResolver.resolve(uuid, in: journeys)?.id, uuid, "resolves by UUID")
        XCTAssertEqual(JourneyResolver.resolve(uuid.uppercased(), in: journeys)?.id, uuid,
                       "UUID match is case-insensitive")
        XCTAssertEqual(JourneyResolver.resolve("kilimanjaro", in: journeys)?.id, uuid,
                       "resolves by slug")
        XCTAssertNil(JourneyResolver.resolve("does-not-exist", in: journeys))
        XCTAssertNil(JourneyResolver.resolve("99999999-9999-9999-9999-999999999999", in: journeys),
                     "unknown UUID does not resolve")
    }

    // MARK: - details / stats / photos error paths

    func testDetailsErrors() throws {
        let journeys = try fixtures()
        XCTAssertEqual(JourneyQuery.details(journeys, idOrSlug: ""), .failure("journey_id is required"))
        XCTAssertEqual(JourneyQuery.details(journeys, idOrSlug: "nope"),
                       .failure("Journey not found: nope"))
    }

    func testDetailsSuccessShape() throws {
        let journeys = try fixtures()
        guard case .success(let details) = JourneyQuery.details(journeys, idOrSlug: "kilimanjaro") else {
            return XCTFail("expected success")
        }
        XCTAssertEqual(details.slug, "kilimanjaro")
        XCTAssertEqual(details.camps.count, 8)
        XCTAssertGreaterThan(details.route?.coordinates.count ?? 0, 100)
        XCTAssertEqual(details.stats?.highestPoint?.name, "Uhuru Peak")
        // Each camp carries a resolved route index.
        XCTAssertTrue(details.camps.allSatisfy { $0.routePointIndex != nil })
    }

    func testPhotosEmptyAndNotFound() throws {
        let journeys = try fixtures()
        // Fixtures carry no photos → correct empty shape.
        XCTAssertEqual(JourneyQuery.photos(journeys, idOrSlug: "kilimanjaro", waypointId: nil, limit: 50),
                       .success(JourneyPhotosResult(photos: [], total: 0)))
        // Bad id still resolves to the MCP not-found message.
        XCTAssertEqual(JourneyQuery.photos(journeys, idOrSlug: "nope", waypointId: nil, limit: 50),
                       .failure("Journey not found: nope"))
    }
}
