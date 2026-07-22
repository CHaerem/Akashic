import XCTest
import CoreLocation
import CloudKit
@testable import Akashic

/// Round-trip + field-fidelity coverage for `RecordCoder` (domain <-> CKRecord), authored to
/// `CloudKit/schema.ckdb` + `MAPPING.md`. Heavy: exercises all three real fixture journeys plus
/// the documented edge cases (null-coordinate photos, safari camp `routeDistanceKm == 0`).
final class SyncRecordCoderTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }
    private let zone = RecordCoder.zoneID(forJourneyID: "j-test")

    // MARK: - Zone id mapping

    func testZoneIDMapping() {
        let zoneID = RecordCoder.zoneID(forJourneyID: "abc-123")
        XCTAssertEqual(zoneID.zoneName, "journey-abc-123")
        XCTAssertEqual(RecordCoder.journeyID(fromZoneID: zoneID), "abc-123")

        let other = CKRecordZone.ID(zoneName: "com.apple.coredata.cloudkit.zone",
                                    ownerName: CKCurrentUserDefaultName)
        XCTAssertNil(RecordCoder.journeyID(fromZoneID: other), "non-journey zone -> nil")
    }

    // MARK: - Coordinate swap ([lng,lat] domain <-> (lat,lng) CLLocation)

    func testCoordinateSwapIsApplied() {
        let camp = makeCamp(id: "w1", coordinates: [10.5, -3.2])  // [lng, lat]
        let record = RecordCoder.record(forWaypoint: camp, journeyID: "j1", sortOrder: 0, in: zone)

        let loc = record["coordinates"] as? CLLocation
        XCTAssertEqual(loc?.coordinate.latitude ?? .nan, -3.2, accuracy: 1e-9, "lat = coords[1]")
        XCTAssertEqual(loc?.coordinate.longitude ?? .nan, 10.5, accuracy: 1e-9, "lng = coords[0]")

        let back = RecordCoder.waypoint(from: record)
        XCTAssertEqual(back?.coordinates, [10.5, -3.2], "decode restores [lng, lat] order")
    }

    // MARK: - Record identity + types + field encodings

    func testRecordNamesAreOriginalUUIDsAndZoneScoped() {
        let camp = makeCamp(id: "waypoint-uuid", coordinates: [1, 2])
        let record = RecordCoder.record(forWaypoint: camp, journeyID: "journey-uuid", sortOrder: 3, in: zone)
        XCTAssertEqual(record.recordID.recordName, "waypoint-uuid")
        XCTAssertEqual(record.recordID.zoneID, zone)
        XCTAssertEqual(record.recordType, "Waypoint")
    }

    func testJourneyFieldEncodings() {
        let journey = try! FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let record = RecordCoder.record(for: journey, in: zone)

        XCTAssertEqual(record.recordType, "Journey")
        XCTAssertEqual(record["slug"] as? String, journey.slug)
        XCTAssertEqual(record["journeyType"] as? String, "trek")
        XCTAssertEqual(record["isPublic"] as? Int, 1, "Bool -> INT64 0/1")
        XCTAssertTrue(record["routeJSON"] is CKAsset, "route is an ASSET (temp-file JSON)")
        XCTAssertTrue(record["statsJSON"] is String, "stats is an inline STRING")
        XCTAssertTrue(record["centerLocation"] is CLLocation)
    }

    func testWaypointJSONStringAndListFields() {
        // Kilimanjaro camps carry weather/fun-facts/etc. + highlights.
        let journey = try! FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let camp = journey.camps.first { !$0.highlights.isEmpty } ?? journey.camps[0]
        let record = RecordCoder.record(forWaypoint: camp, journeyID: journey.id, sortOrder: 0, in: zone)

        XCTAssertEqual(record["highlights"] as? [String], camp.highlights, "highlights = native LIST<STRING>")
        if camp.weather != nil { XCTAssertTrue(record["weatherJSON"] is String) }
        XCTAssertEqual((record["journeyRef"] as? CKRecord.Reference)?.recordID.recordName, journey.id)
    }

    // MARK: - Reference delete actions (MAPPING §9)

    func testReferenceActions() {
        let camp = makeCamp(id: "w1", coordinates: [1, 2])
        let waypointRecord = RecordCoder.record(forWaypoint: camp, journeyID: "j1", sortOrder: 0, in: zone)
        // journeyRef is deliberately NOT an owning reference: the journey's zone is the
        // cascade boundary, and CloudKit caps owning references to a single record at
        // ~750 — the real archive has 939 photos on one journey and the first import
        // failed 197 of them with "Limit exceeded for number of owning references".
        XCTAssertEqual((waypointRecord["journeyRef"] as? CKRecord.Reference)?.action,
                       CKRecord.ReferenceAction.none,
                       "Waypoint.journeyRef must not own — the zone cascades")

        let photo = makePhoto(id: "p1", waypointId: "w1", coordinates: [1, 2])
        let photoRecord = RecordCoder.record(for: photo, in: zone)
        XCTAssertEqual((photoRecord["journeyRef"] as? CKRecord.Reference)?.action,
                       CKRecord.ReferenceAction.none,
                       "Photo.journeyRef must not own — hits the ~750 cap on big journeys")
        XCTAssertEqual((photoRecord["waypointRef"] as? CKRecord.Reference)?.action, CKRecord.ReferenceAction.none,
                       "Photo.waypointRef orphans (SET NULL -> .none)")

        let comment = makeComment(id: "c1")
        let commentRecord = RecordCoder.record(for: comment, in: zone)
        XCTAssertEqual((commentRecord["journeyRef"] as? CKRecord.Reference)?.action,
                       CKRecord.ReferenceAction.none,
                       "DayComment.journeyRef must not own — the zone cascades")
        XCTAssertEqual((commentRecord["waypointRef"] as? CKRecord.Reference)?.action, .deleteSelf,
                       "Deleting one waypoint should still take its comments; fan-out stays tiny")
    }

    // MARK: - Heavy round-trips over the real fixtures

    func testJourneyAndWaypointRoundTripAllFixtures() throws {
        for name in FixtureLoader.fixtureNames {
            let journey = try FixtureLoader.load(named: name, bundle: bundle)
            let jZone = RecordCoder.zoneID(forJourneyID: journey.id)

            // Journey record: everything the schema carries survives (children + heroImageURL
            // are intentionally not on the journey record — see RecordCoder docs).
            let journeyRecord = RecordCoder.record(for: journey, in: jZone)
            let decodedJourney = try XCTUnwrap(RecordCoder.journey(from: journeyRecord))
            XCTAssertEqual(normalizedJourney(decodedJourney), normalizedJourney(journey),
                           "\(name): Journey did not survive the CKRecord round-trip")

            // Each waypoint.
            for (index, camp) in journey.camps.enumerated() {
                let record = RecordCoder.record(forWaypoint: camp, journeyID: journey.id,
                                                sortOrder: index, in: jZone)
                let decoded = try XCTUnwrap(RecordCoder.waypoint(from: record))
                XCTAssertEqual(normalizedCamp(decoded), normalizedCamp(camp),
                               "\(name) camp #\(index) (\(camp.name)) did not round-trip")
            }
        }
    }

    /// Mount Kenya's safari camp has a legitimate `routeDistanceKm == 0` — it must survive as
    /// 0.0, not collapse to nil (the classic sentinel bug).
    func testZeroRouteDistanceSurvivesRoundTrip() throws {
        let journey = try FixtureLoader.load(named: "mountKenya", bundle: bundle)
        let zeroCamp = try XCTUnwrap(journey.camps.first { $0.routeDistanceKm == 0 },
                                     "fixture precondition: a camp with routeDistanceKm == 0")
        let record = RecordCoder.record(forWaypoint: zeroCamp, journeyID: journey.id, sortOrder: 0, in: zone)
        let decoded = try XCTUnwrap(RecordCoder.waypoint(from: record))
        XCTAssertEqual(decoded.routeDistanceKm, 0.0, "0.0 must not collapse to nil")
    }

    // MARK: - Photo round-trips incl. null coordinates

    func testPhotoRoundTrip() throws {
        let photo = makePhoto(id: "p1", waypointId: "w1", coordinates: [10.0, -3.0],
                              caption: "Summit push", isHero: true, sortOrder: 2, rotation: 90,
                              takenAt: "2024-01-15T08:30:00Z", locationSource: "exif")
        let decoded = try XCTUnwrap(RecordCoder.photo(from: RecordCoder.record(for: photo, in: zone)))
        XCTAssertEqual(decoded, photo, "photo (with coords + waypoint) round-trip")
    }

    func testNullCoordinatePhotoRoundTrip() throws {
        let photo = makePhoto(id: "p2", waypointId: nil, coordinates: nil,
                              caption: nil, takenAt: nil)
        let record = RecordCoder.record(for: photo, in: zone)
        XCTAssertNil(record["coordinates"], "nil coordinates -> field absent")
        XCTAssertNil(record["waypointRef"], "nil waypoint -> reference absent")
        let decoded = try XCTUnwrap(RecordCoder.photo(from: record))
        XCTAssertNil(decoded.coordinates)
        XCTAssertNil(decoded.waypointId)
        XCTAssertEqual(decoded, photo)
    }

    // MARK: - DayComment round-trip (explicit timestamps + authorDisplayName)

    func testDayCommentRoundTrip() throws {
        let created = Date(timeIntervalSince1970: 1_700_000_000)
        let comment = DayComment(id: "c1", waypointId: "w1", journeyId: "j1",
                                 authorName: "Christopher", content: "Great day.",
                                 createdAt: created, updatedAt: created.addingTimeInterval(120),
                                 isMine: true)
        let record = RecordCoder.record(for: comment, in: zone)
        XCTAssertEqual(record["createdAt"] as? Date, created, "createdAt is the explicit field, not system ts")
        XCTAssertEqual(record["authorDisplayName"] as? String, "Christopher")

        let decoded = try XCTUnwrap(RecordCoder.dayComment(from: record))
        // isMine is not derivable from the record alone; everything else round-trips.
        XCTAssertEqual(decoded.id, comment.id)
        XCTAssertEqual(decoded.waypointId, comment.waypointId)
        XCTAssertEqual(decoded.journeyId, comment.journeyId)
        XCTAssertEqual(decoded.authorName, comment.authorName)
        XCTAssertEqual(decoded.content, comment.content)
        XCTAssertEqual(decoded.createdAt, comment.createdAt)
        XCTAssertEqual(decoded.updatedAt, comment.updatedAt)
        XCTAssertFalse(decoded.isMine, "isMine resolved by the caller, false here")
    }

    // MARK: - Type guards

    func testDecodersRejectWrongRecordType() {
        let journeyRecord = RecordCoder.record(for: try! FixtureLoader.load(named: "incaTrail", bundle: bundle),
                                               in: zone)
        XCTAssertNil(RecordCoder.waypoint(from: journeyRecord))
        XCTAssertNil(RecordCoder.photo(from: journeyRecord))
        XCTAssertNil(RecordCoder.dayComment(from: journeyRecord))
        XCTAssertNotNil(RecordCoder.journey(from: journeyRecord))
    }

    // MARK: - Normalization (strip intentionally-dropped / recomputed fields)

    /// Journey record does not carry children or the R2 hero path (schema-faithful).
    private func normalizedJourney(_ journey: Journey) -> Journey {
        var n = journey
        n.heroImageURL = nil
        n.camps = []
        return n
    }

    /// Waypoint record drops display-only extras and never stores the per-day computed stats.
    private func normalizedCamp(_ camp: Camp) -> Camp {
        var n = camp
        n.terrain = nil
        n.timeFromPrevious = nil
        n.dateLabel = nil
        n.dayDistance = 0
        n.elevationGainFromPrevious = 0
        n.elevationLossFromPrevious = 0
        return n
    }

    // MARK: - Asset fields are never nil-assigned (nil DELETES the field server-side)

    /// The whole data-loss chain started here: a photo whose local bytes are momentarily
    /// unreadable used to encode `record["original"] = nil`, which deletes the uploaded asset.
    func testEncodingPhotoWithMissingBytesLeavesServerAssetsUntouched() throws {
        let existing = CKRecord(recordType: RecordCoder.RecordType.photo,
                                recordID: CKRecord.ID(recordName: "p1", zoneID: zone))
        let uploaded = FileManager.default.temporaryDirectory
            .appendingPathComponent("already-uploaded-\(UUID().uuidString).jpg")
        try Data("server-bytes".utf8).write(to: uploaded)
        defer { try? FileManager.default.removeItem(at: uploaded) }
        existing["original"] = CKAsset(fileURL: uploaded)
        existing["thumb"] = CKAsset(fileURL: uploaded)

        // Local bytes gone (purged CloudKit cache / moved file) — a plain caption edit.
        var photo = makePhoto(id: "p1", waypointId: nil, coordinates: nil, caption: "new caption")
        photo.localOriginalPath = "/nonexistent/\(UUID().uuidString).jpg"
        photo.localThumbPath = nil

        let record = RecordCoder.record(for: photo, in: zone, existing: existing)

        XCTAssertEqual(record["caption"] as? String, "new caption")
        XCTAssertNotNil(record["original"] as? CKAsset, "must NOT nil out the uploaded original")
        XCTAssertNotNil(record["thumb"] as? CKAsset, "must NOT nil out the uploaded thumbnail")
    }

    // MARK: - Route asset decoding (unreadable != empty)

    func testRouteDecodeDistinguishesAbsentFromUnreadable() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let good = RecordCoder.record(for: journey, in: zone)
        XCTAssertEqual(RecordCoder.route(from: good)?.coordinates.count,
                       journey.route.coordinates.count, "readable asset -> decoded route")

        let absent = CKRecord(recordType: RecordCoder.RecordType.journey,
                              recordID: CKRecord.ID(recordName: "j-none", zoneID: zone))
        XCTAssertEqual(RecordCoder.route(from: absent), Route.empty,
                       "field genuinely absent -> empty route")

        let unreadable = CKRecord(recordType: RecordCoder.RecordType.journey,
                                  recordID: CKRecord.ID(recordName: "j-bad", zoneID: zone))
        unreadable["routeJSON"] = CKAsset(fileURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("gone-\(UUID().uuidString).json"))
        XCTAssertNil(RecordCoder.route(from: unreadable),
                     "present but unreadable -> nil, so callers keep the local route")

        let corrupt = CKRecord(recordType: RecordCoder.RecordType.journey,
                               recordID: CKRecord.ID(recordName: "j-corrupt", zoneID: zone))
        let corruptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("corrupt-\(UUID().uuidString).json")
        try Data("not json".utf8).write(to: corruptURL)
        defer { try? FileManager.default.removeItem(at: corruptURL) }
        corrupt["routeJSON"] = CKAsset(fileURL: corruptURL)
        XCTAssertNil(RecordCoder.route(from: corrupt), "corrupt JSON -> nil, not an empty route")
    }

    /// Route temp files land in a sweepable subdirectory instead of accumulating in tmp root.
    func testRouteAssetsAreWrittenToAPurgeableDirectory() throws {
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        let record = RecordCoder.record(for: journey, in: zone)
        let url = try XCTUnwrap((record["routeJSON"] as? CKAsset)?.fileURL)
        XCTAssertEqual(url.deletingLastPathComponent().standardizedFileURL,
                       RecordCoder.routeAssetDirectory.standardizedFileURL)

        RecordCoder.purgeRouteAssetDirectory()
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path), "scratch files are sweepable")
    }

    // MARK: - Encoded system fields (server change tag persistence)

    /// The archive→rehydrate round-trip must preserve the record's identity (recordID + zone +
    /// type). That identity is what lets a re-encoded record be sent as an update against the
    /// server's copy instead of a fresh insert.
    func testSystemFieldsArchiveRoundTripPreservesIdentity() throws {
        let owned = CKRecordZone.ID(zoneName: "journey-sf", ownerName: "family-owner-123")
        let original = CKRecord(recordType: RecordCoder.RecordType.photo,
                                recordID: CKRecord.ID(recordName: "photo-sf", zoneID: owned))

        let data = RecordCoder.archivedSystemFields(of: original)
        let rehydrated = try XCTUnwrap(RecordCoder.recordFromSystemFields(data))

        XCTAssertEqual(rehydrated.recordID, original.recordID)
        XCTAssertEqual(rehydrated.recordID.zoneID, owned, "zone (incl. owner) survives the round-trip")
        XCTAssertEqual(rehydrated.recordType, RecordCoder.RecordType.photo)
    }

    /// System-field archiving carries ONLY the system fields — never user values. A later edit
    /// re-applies field values from the current domain row onto this bare base.
    func testArchivedSystemFieldsDropUserValues() throws {
        let record = CKRecord(recordType: RecordCoder.RecordType.journey,
                              recordID: CKRecord.ID(recordName: "j-sf", zoneID: zone))
        record["name"] = "Local Only"
        let rehydrated = try XCTUnwrap(RecordCoder.recordFromSystemFields(
            RecordCoder.archivedSystemFields(of: record)))
        XCTAssertNil(rehydrated["name"], "user fields are not part of the system-field archive")
    }

    /// Corrupt/foreign bytes decode to nil so a stale meta row degrades to the safe fresh-insert
    /// behavior rather than crashing.
    func testRecordFromSystemFieldsRejectsGarbage() {
        XCTAssertNil(RecordCoder.recordFromSystemFields(Data("not a keyed archive".utf8)))
        XCTAssertNil(RecordCoder.recordFromSystemFields(Data()))
    }

    // MARK: - Builders

    private func makeCamp(id: String, coordinates: [Double]) -> Camp {
        Camp(id: id, name: "Camp \(id)", dayNumber: 1, elevation: 1000,
             coordinates: coordinates, notes: "", highlights: [])
    }

    private func makePhoto(id: String, waypointId: String?, coordinates: [Double]?,
                           caption: String? = "c", isHero: Bool = false, sortOrder: Int = 0,
                           rotation: Int = 0, takenAt: String? = "2024-01-15T08:30:00Z",
                           locationSource: String? = "exif") -> Photo {
        Photo(id: id, journeyId: "j1", waypointId: waypointId, url: "", thumbnailURL: nil,
              caption: caption, coordinates: coordinates, takenAt: takenAt, isHero: isHero,
              sortOrder: sortOrder, rotation: rotation, mediaType: "image", duration: nil,
              locationSource: locationSource, localOriginalPath: nil, localThumbPath: nil)
    }

    private func makeComment(id: String) -> DayComment {
        DayComment(id: id, waypointId: "w1", journeyId: "j1", authorName: "A", content: "x",
                   createdAt: Date(timeIntervalSince1970: 1_700_000_000),
                   updatedAt: Date(timeIntervalSince1970: 1_700_000_000), isMine: false)
    }
}
