import Foundation
import CoreLocation
import CloudKit

/// Bidirectional mapping between the app's domain value types (`Journey` / `Camp` /
/// `Photo` / `DayComment`) and CloudKit `CKRecord`s, authored **exactly** to the
/// hand-written schema in `apple/CloudKit/schema.ckdb` + `MAPPING.md` (verified against
/// the live `iCloud.no.akashic` Development schema).
///
/// This is the single (de)serialization contract shared by two callers:
///   * `AkashicSyncEngine` (this module) — send/receive record-zone changes, and
///   * `CloudKitImportSink` (the sibling importer, `Import/`) — bulk-write the migration.
/// Keep it dependency-light: it touches only Foundation / CoreLocation / CloudKit and the
/// in-module domain models + `JSONCoding` — **no Core Data, no engine state**.
///
/// ## Contract (agreed with the importer)
/// ```
/// // Domain -> CKRecord (pass `existing` to update a fetched record in place, preserving
/// // its change tag + any asset fields this coder does not own, e.g. heroImage bytes)
/// RecordCoder.record(for: Journey,  in: CKRecordZone.ID, existing: CKRecord?) -> CKRecord
/// RecordCoder.record(forWaypoint: Camp, journeyID: String, sortOrder: Int,
///                    in: CKRecordZone.ID, existing: CKRecord?) -> CKRecord
/// RecordCoder.record(for: Photo,    in: CKRecordZone.ID, existing: CKRecord?) -> CKRecord
/// RecordCoder.record(for: DayComment, in: CKRecordZone.ID, existing: CKRecord?) -> CKRecord
///
/// // CKRecord -> Domain (nil when the record type does not match)
/// RecordCoder.journey(from: CKRecord)    -> Journey?
/// RecordCoder.waypoint(from: CKRecord)   -> Camp?
/// RecordCoder.photo(from: CKRecord)      -> Photo?
/// RecordCoder.dayComment(from: CKRecord) -> DayComment?
///
/// // Zone routing
/// RecordCoder.zoneID(forJourneyID:) -> CKRecordZone.ID     // "journey-<uuid>"
/// RecordCoder.journeyID(fromZoneID:) -> String?
/// ```
///
/// ## Deliberate lossy edges (schema-faithful, documented for the round-trip tests)
/// * `Journey.heroImageURL` — the R2 path is **dropped** by the schema (bytes live in the
///   `heroImage` / `heroThumb` ASSET fields, attached by the importer from R2). This coder
///   never fabricates those assets from a URL string and leaves them untouched on update.
/// * `Photo.url` / `Photo.thumbnailURL` — R2 paths are **dropped**; bytes live in the
///   `original` / `thumb` ASSET fields (attached from local bytes when present).
/// * `Camp.terrain` / `.timeFromPrevious` / `.dateLabel` — display-only extras with no
///   schema field; dropped.
/// * Per-day computed stats (`Camp.dayDistance` / `elevationGainFromPrevious` /
///   `elevationLossFromPrevious`) — never stored; recomputed on read via `DayStats`.
/// * `Journey.camps` — children are **separate `Waypoint` records**, so `journey(from:)`
///   yields `camps: []`; the engine reassembles a journey from its zone's records.
enum RecordCoder {

    // MARK: - Record type names (match schema.ckdb / live schema)

    enum RecordType {
        static let journey = "Journey"
        static let waypoint = "Waypoint"
        static let photo = "Photo"
        static let dayComment = "DayComment"
    }

    /// Zone name prefix — one custom zone per journey: `journey-<journey.id>` (MAPPING §1).
    static let journeyZonePrefix = "journey-"

    // MARK: - Zone routing

    /// Custom zone id for a journey: `journey-<journeyID>` in the current user's DB.
    static func zoneID(forJourneyID journeyID: String,
                       ownerName: String = CKCurrentUserDefaultName) -> CKRecordZone.ID {
        CKRecordZone.ID(zoneName: journeyZonePrefix + journeyID, ownerName: ownerName)
    }

    /// Recover the journey UUID from a `journey-<uuid>` zone id (nil for other zones).
    static func journeyID(fromZoneID zoneID: CKRecordZone.ID) -> String? {
        guard zoneID.zoneName.hasPrefix(journeyZonePrefix) else { return nil }
        return String(zoneID.zoneName.dropFirst(journeyZonePrefix.count))
    }

    // MARK: - Journey  <->  Journey record (zone root)

    static func record(for journey: Journey,
                       in zoneID: CKRecordZone.ID,
                       existing: CKRecord? = nil) -> CKRecord {
        let record = existing ?? CKRecord(recordType: RecordType.journey,
                                          recordID: CKRecord.ID(recordName: journey.id, zoneID: zoneID))
        record["name"] = journey.name
        record["slug"] = journey.slug
        record["description"] = journey.description
        record["country"] = journey.country
        record["journeyType"] = "trek"
        record["isPublic"] = journey.isPublic ? 1 : 0
        record["summitElevation"] = journey.summitElevation
        record["totalDistance"] = journey.totalDistance
        record["totalDays"] = journey.totalDays
        record["preferredBearing"] = journey.preferredBearing
        record["preferredPitch"] = journey.preferredPitch
        record["dateStarted"] = DateOnly.date(from: journey.dateStarted)
        record["dateEnded"] = DateOnly.date(from: journey.dateEnded)
        record["centerLocation"] = location(from: journey.centerCoordinates)
        record["statsJSON"] = jsonString(journey.stats)
        // NEVER assign nil here: assigning nil to a CKRecord key DELETES the field server-side,
        // so a transient temp-write failure would strip a good route off an existing record.
        if let route = routeAsset(for: journey.route) { record["routeJSON"] = route }
        // heroImage / heroThumb ASSETs are owned by the importer (R2 bytes) — untouched here.
        return record
    }

    static func journey(from record: CKRecord) -> Journey? {
        guard record.recordType == RecordType.journey else { return nil }
        let totalDays = record["totalDays"] as? Int
        let totalDistance = record["totalDistance"] as? Double
        let stats = jsonValue(TrekStats.self, from: record["statsJSON"] as? String)
            ?? TrekStats(duration: totalDays ?? 0, totalDistance: totalDistance ?? 0,
                         totalElevationGain: 0, totalElevationLoss: nil, highestPoint: nil)
        return Journey(
            id: record.recordID.recordName,
            slug: record["slug"] as? String ?? "",
            name: record["name"] as? String ?? "",
            country: record["country"] as? String ?? "",
            description: record["description"] as? String ?? "",
            heroImageURL: nil,                       // R2 path dropped (bytes -> heroImage asset)
            dateStarted: DateOnly.string(from: record["dateStarted"] as? Date),
            dateEnded: DateOnly.string(from: record["dateEnded"] as? Date),
            isPublic: (record["isPublic"] as? Int ?? 0) == 1,
            summitElevation: record["summitElevation"] as? Int,
            totalDistance: totalDistance,
            totalDays: totalDays,
            centerCoordinates: coordinatePair(from: record["centerLocation"] as? CLLocation),
            preferredBearing: record["preferredBearing"] as? Double,
            preferredPitch: record["preferredPitch"] as? Double,
            stats: stats,
            // `.empty` here is a *placeholder* for the value type. Callers that persist must
            // consult `route(from: record)` and skip the write when it returns nil (unreadable).
            route: route(from: record) ?? .empty,
            camps: []                                // children are separate Waypoint records
        )
    }

    // MARK: - Camp  <->  Waypoint record

    static func record(forWaypoint camp: Camp,
                       journeyID: String,
                       sortOrder: Int,
                       in zoneID: CKRecordZone.ID,
                       existing: CKRecord? = nil) -> CKRecord {
        let record = existing ?? CKRecord(recordType: RecordType.waypoint,
                                          recordID: CKRecord.ID(recordName: camp.id, zoneID: zoneID))
        // journeyRef: plain `.none`. Deleting a journey means deleting its zone, which removes
        // every record inside it — the zone IS the cascade (D3). An owning `.deleteSelf` ref
        // would be redundant AND capped: CloudKit allows only ~750 owning references to a
        // single record, which the real archive blows past (Kilimanjaro has 939 photos).
        record["journeyRef"] = reference(toRecordName: journeyID, in: zoneID, action: .none)
        record["name"] = camp.name
        record["waypointType"] = "camp"
        record["dayNumber"] = camp.dayNumber
        record["elevation"] = camp.elevation
        record["coordinates"] = location(from: camp.coordinates)
        record["description"] = camp.notes
        record["highlights"] = camp.highlights.isEmpty ? nil : camp.highlights   // native LIST<STRING>
        record["sortOrder"] = sortOrder
        record["routeDistanceKm"] = camp.routeDistanceKm     // 0.0 is a legitimate value -> kept
        record["routePointIndex"] = camp.routePointIndex
        record["weatherJSON"] = jsonString(camp.weather)
        record["funFactsJSON"] = jsonString(camp.funFacts)
        record["pointsOfInterestJSON"] = jsonString(camp.pointsOfInterest)
        record["historicalSitesJSON"] = jsonString(camp.historicalSites)
        // arrivalTime / departureTime / dateVisited: no domain source; left unset by design.
        return record
    }

    static func waypoint(from record: CKRecord) -> Camp? {
        guard record.recordType == RecordType.waypoint else { return nil }
        return Camp(
            id: record.recordID.recordName,
            name: record["name"] as? String ?? "",
            dayNumber: record["dayNumber"] as? Int ?? 0,
            elevation: record["elevation"] as? Int ?? 0,
            coordinates: coordinatePair(from: record["coordinates"] as? CLLocation) ?? [],
            notes: record["description"] as? String ?? "",
            highlights: record["highlights"] as? [String] ?? [],
            terrain: nil, timeFromPrevious: nil, dateLabel: nil,   // display extras, not in schema
            routePointIndex: record["routePointIndex"] as? Int,
            routeDistanceKm: record["routeDistanceKm"] as? Double,
            weather: jsonValue(WeatherData.self, from: record["weatherJSON"] as? String),
            funFacts: jsonValue([FunFact].self, from: record["funFactsJSON"] as? String),
            pointsOfInterest: jsonValue([PointOfInterest].self, from: record["pointsOfInterestJSON"] as? String),
            historicalSites: jsonValue([HistoricalSite].self, from: record["historicalSitesJSON"] as? String)
        )
    }

    // MARK: - Photo  <->  Photo record

    static func record(for photo: Photo,
                       in zoneID: CKRecordZone.ID,
                       existing: CKRecord? = nil) -> CKRecord {
        let record = existing ?? CKRecord(recordType: RecordType.photo,
                                          recordID: CKRecord.ID(recordName: photo.id, zoneID: zoneID))
        // journeyRef: `.none` — the journey's zone is the cascade boundary (see `record(forWaypoint:)`).
        // waypointRef: SET NULL -> .none (photo is orphaned, not deleted, when its waypoint goes).
        record["journeyRef"] = reference(toRecordName: photo.journeyId, in: zoneID, action: .none)
        record["waypointRef"] = photo.waypointId.map { reference(toRecordName: $0, in: zoneID, action: .none) }
        record["caption"] = photo.caption
        record["coordinates"] = location(from: photo.coordinates)
        record["takenAt"] = isoDate(from: photo.takenAt)
        record["isHero"] = photo.isHero ? 1 : 0
        record["sortOrder"] = photo.sortOrder
        record["rotation"] = photo.rotation
        record["mediaType"] = photo.mediaType
        record["duration"] = photo.duration.map(Double.init)
        record["locationSource"] = photo.locationSource
        // DATA SAFETY: only ever *set* the asset fields. Assigning nil to a CKRecord key
        // deletes the field server-side, so if the local bytes are momentarily unreadable
        // (purged cache, moved file) a routine caption edit would otherwise destroy the
        // uploaded photo — the only remaining copy once R2 is decommissioned. Leaving the
        // key untouched keeps the server's asset.
        if let original = asset(forLocalPath: photo.localOriginalPath) { record["original"] = original }
        if let thumb = asset(forLocalPath: photo.localThumbPath) { record["thumb"] = thumb }
        return record
    }

    static func photo(from record: CKRecord) -> Photo? {
        guard record.recordType == RecordType.photo else { return nil }
        return Photo(
            id: record.recordID.recordName,
            journeyId: (record["journeyRef"] as? CKRecord.Reference)?.recordID.recordName ?? "",
            waypointId: (record["waypointRef"] as? CKRecord.Reference)?.recordID.recordName,
            url: "",                                 // R2 path dropped; bytes -> original asset
            thumbnailURL: nil,
            caption: record["caption"] as? String,
            coordinates: coordinatePair(from: record["coordinates"] as? CLLocation),
            takenAt: isoString(from: record["takenAt"] as? Date),
            isHero: (record["isHero"] as? Int ?? 0) == 1,
            sortOrder: record["sortOrder"] as? Int ?? 0,
            rotation: record["rotation"] as? Int ?? 0,
            mediaType: record["mediaType"] as? String ?? "image",
            duration: (record["duration"] as? Double).map { Int($0) },
            locationSource: record["locationSource"] as? String,
            // CloudKit STAGING paths — temporary, owned by CloudKit, purgeable at any moment.
            // They must NEVER be persisted as-is; the apply path copies the bytes into the
            // media root first (see `SyncMediaStaging`) and stores that stable path instead.
            localOriginalPath: (record["original"] as? CKAsset)?.fileURL?.path,
            localThumbPath: (record["thumb"] as? CKAsset)?.fileURL?.path
        )
    }

    /// Staging file URLs for a Photo record's asset fields (nil when the field is absent or
    /// CloudKit has not materialized the bytes).
    static func assetFileURLs(from record: CKRecord) -> (original: URL?, thumb: URL?) {
        ((record["original"] as? CKAsset)?.fileURL, (record["thumb"] as? CKAsset)?.fileURL)
    }

    // MARK: - DayComment  <->  DayComment record

    static func record(for comment: DayComment,
                       in zoneID: CKRecordZone.ID,
                       existing: CKRecord? = nil) -> CKRecord {
        let record = existing ?? CKRecord(recordType: RecordType.dayComment,
                                          recordID: CKRecord.ID(recordName: comment.id, zoneID: zoneID))
        // journeyRef: `.none` — the zone is the cascade boundary (see `record(forWaypoint:)`).
        // waypointRef: `.deleteSelf` — deleting a single waypoint really should take its comments
        // with it, and comments-per-waypoint stays far below the ~750 owning-reference cap.
        record["journeyRef"] = reference(toRecordName: comment.journeyId, in: zoneID, action: .none)
        record["waypointRef"] = reference(toRecordName: comment.waypointId, in: zoneID, action: .deleteSelf)
        record["content"] = comment.content
        record["createdAt"] = comment.createdAt          // explicit field (order-preserving), not system ts
        record["modifiedAt"] = comment.updatedAt
        record["authorDisplayName"] = comment.authorName
        return record
    }

    /// Note: `isMine` cannot be derived from the record alone (it depends on the current
    /// user's `creatorUserRecordID`); the caller resolves it. Here it is `false`.
    static func dayComment(from record: CKRecord) -> DayComment? {
        guard record.recordType == RecordType.dayComment else { return nil }
        let created = record["createdAt"] as? Date ?? Date()
        return DayComment(
            id: record.recordID.recordName,
            waypointId: (record["waypointRef"] as? CKRecord.Reference)?.recordID.recordName ?? "",
            journeyId: (record["journeyRef"] as? CKRecord.Reference)?.recordID.recordName ?? "",
            authorName: record["authorDisplayName"] as? String ?? "",
            content: record["content"] as? String ?? "",
            createdAt: created,
            updatedAt: record["modifiedAt"] as? Date ?? created,
            isMine: false
        )
    }

    // MARK: - Field helpers

    private static func reference(toRecordName name: String,
                                  in zoneID: CKRecordZone.ID,
                                  action: CKRecord.ReferenceAction) -> CKRecord.Reference {
        CKRecord.Reference(recordID: CKRecord.ID(recordName: name, zoneID: zoneID), action: action)
    }

    /// `[lng, lat]` (domain / GeoJSON order) -> `CLLocation(latitude: lat, longitude: lng)`.
    /// The SWAP is the critical bit — see MAPPING §5. Returns nil for absent/short input.
    private static func location(from coordinates: [Double]?) -> CLLocation? {
        guard let c = coordinates, c.count >= 2 else { return nil }
        return CLLocation(latitude: c[1], longitude: c[0])
    }

    /// `CLLocation` -> `[lng, lat]` (domain order). Inverse of `location(from:)`.
    private static func coordinatePair(from location: CLLocation?) -> [Double]? {
        guard let location else { return nil }
        return [location.coordinate.longitude, location.coordinate.latitude]
    }

    private static func jsonString<T: Encodable>(_ value: T?) -> String? {
        guard let value, let data = JSONCoding.encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func jsonValue<T: Decodable>(_ type: T.Type, from string: String?) -> T? {
        guard let data = string?.data(using: .utf8) else { return nil }
        return JSONCoding.decode(type, from: data)
    }

    /// Scratch directory for route ASSET temp files. A dedicated subdirectory (rather than the
    /// tmp root) so the accumulated files can be swept without touching anyone else's scratch.
    static var routeAssetDirectory: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("akashic-route-assets", isDirectory: true)
    }

    /// Delete every previously written route ASSET temp file.
    ///
    /// MUST only be called at a quiescent point (app launch before the sync engine starts,
    /// or after an import's uploads have all completed): `CKAsset` reads its file lazily, so
    /// removing one while a modify operation is in flight would corrupt the upload.
    static func purgeRouteAssetDirectory(fileManager: FileManager = .default) {
        let dir = routeAssetDirectory
        guard let entries = try? fileManager.contentsOfDirectory(at: dir,
                                                                 includingPropertiesForKeys: nil)
        else { return }
        for entry in entries { try? fileManager.removeItem(at: entry) }
    }

    /// Route LineString -> a small temp-file JSON ASSET (MAPPING §6: keeps `Journey`
    /// records tiny so the list/globe query never drags every route blob).
    /// Filenames stay per-call unique on purpose — overwriting a fixed name could swap the
    /// bytes out from under an in-flight upload.
    private static func routeAsset(for route: Route) -> CKAsset? {
        guard let data = JSONCoding.encode(route) else { return nil }
        let dir = routeAssetDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("akashic-route-\(UUID().uuidString).json")
        do { try data.write(to: url) } catch { return nil }
        return CKAsset(fileURL: url)
    }

    /// Decode a Journey record's route, distinguishing "no route on the record" from
    /// "the route asset could not be read".
    ///
    /// * `.empty` — the `routeJSON` field is genuinely absent.
    /// * `nil`    — the field is present but unreadable/undecodable (asset not materialized,
    ///              file gone, corrupt JSON). Callers MUST leave the local route alone; the
    ///              old `?? .empty` collapse silently wiped good routes and then re-uploaded
    ///              the empty one on the next native edit.
    static func route(from record: CKRecord) -> Route? {
        guard let value = record["routeJSON"] else { return .empty }
        guard let asset = value as? CKAsset,
              let url = asset.fileURL,
              let data = try? Data(contentsOf: url),
              let decoded = JSONCoding.decode(Route.self, from: data)
        else { return nil }
        return decoded
    }

    /// A `CKAsset` for an on-disk file, if the bytes exist. When absent, the field is left
    /// unset (the importer attaches R2 bytes; a native edit re-attaches from the media root).
    private static func asset(forLocalPath path: String?) -> CKAsset? {
        guard let path, FileManager.default.fileExists(atPath: path) else { return nil }
        return CKAsset(fileURL: URL(fileURLWithPath: path))
    }

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    /// Tolerant ISO-8601 parse (with or without fractional seconds).
    private static func isoDate(from string: String?) -> Date? {
        guard let string, !string.isEmpty else { return nil }
        if let date = isoFormatter.date(from: string) { return date }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return withFraction.date(from: string)
    }

    private static func isoString(from date: Date?) -> String? {
        guard let date else { return nil }
        return isoFormatter.string(from: date)
    }
}
