import Foundation
import CoreLocation
import CloudKit

/// Publishes one journey to the **public** showcase mirror (T3.3 / MAPPING §8).
///
/// The public mirror is a thumbnail-and-metadata copy of a journey, written to
/// `CKContainer.publicCloudDatabase` so the signed-out web showcase can read it (D6/D9). It is
/// deliberately *not* part of the private-DB sync path: `CKSyncEngine` only drives the private
/// (and shared) databases, so publishing goes through a plain `CKModifyRecordsOperation` here.
///
/// ## Design notes shared with the sync engine / importer
/// * **Record building is pure and compiles in plain Debug.** Only `CKRecord`/`CKAsset`/
///   `CLLocation` are touched by `PublicMirrorBuilder`, none of which trap without the iCloud
///   entitlement — so field mapping is unit-tested with no container. The *container* is built
///   only inside `#if AKASHIC_CLOUDKIT_BUILD` by the view model, exactly like
///   `AkashicSyncEngine.buildRealEngine()` and `CloudKitImportSink`.
/// * **Last-writer-wins, single writer.** Only the owner writes the mirror
///   (`GRANT WRITE TO "_creator"`), so saves use `savePolicy = .allKeys` — no change-tag dance,
///   no existence fetch. Re-publishing is an upsert keyed by a stable `recordName`.
/// * **The public DB has no custom zones.** Both record types live in the default zone; identity
///   is the `recordName` alone — `journey.slug` for `PublicJourney`, `photo.id` for `PublicPhoto`.
/// * **Assets are heavy, so operations are chunked** at 50 records/op (CloudKit hard-caps 400,
///   and asset-bearing requests are large — Kilimanjaro alone is 939 photos).

// MARK: - Public-DB seam
//
// The publisher talks to CloudKit only through this protocol so the whole chunking / diffing /
// cursor-following machine is exercised by unit tests against a mock — no container, no account
// (none exists in any simulator yet). The real `CKDatabase` conforms via the extension below.
// Method names are prefixed `ck…` to avoid overload ambiguity with `CKDatabase`'s own members.

/// Opaque paging token for a public-DB query.
///
/// CloudKit's own `CKQueryOperation.Cursor` cannot be constructed in a unit test, which would
/// make the publisher's "follow the cursor to the last page" loop untestable. Wrapping it lets
/// the real database hand back the real cursor while the test mock hands back a page index — the
/// publisher's paging loop is identical for both.
struct PublicMirrorCursor {
    let underlying: Any
}

/// The subset of `CKDatabase` the public-mirror publisher needs, in async form.
protocol PublicMirrorDatabase {
    /// Save/delete a batch of public records. Non-atomic: a per-record failure must not roll
    /// back the records that saved, so a re-publish only has to overwrite what already landed.
    func ckModifyRecords(
        saving recordsToSave: [CKRecord],
        deleting recordIDsToDelete: [CKRecord.ID],
        savePolicy: CKModifyRecordsOperation.RecordSavePolicy
    ) async throws -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>],
                       deleteResults: [CKRecord.ID: Result<Void, Error>])

    /// One page of `PublicPhoto` record IDs whose `journeySlug` equals `slug`. Pass the previous
    /// page's cursor to continue; a nil return cursor means the last page was reached.
    func ckQueryPublicPhotoIDs(
        journeySlug slug: String,
        cursor: PublicMirrorCursor?,
        resultsLimit: Int
    ) async throws -> (ids: [CKRecord.ID], cursor: PublicMirrorCursor?)

    /// The `creatorUserRecordID.recordName` of an existing `PublicJourney` whose recordName equals
    /// `slug`, or nil when no such record exists. Used to detect a cross-user slug collision in the
    /// global public keyspace before publishing. (quality gate: locally-minted slugs collide in the
    /// global public showcase keyspace.)
    func ckExistingPublicJourneyCreator(slug: String) async throws -> String?
}

// `CKDatabase` already satisfies `ckModifyRecords(...)` through the importer's
// `CKDatabaseProtocol` conformance (non-atomic, so a per-record failure never rolls back the
// batch) — that same method fulfils this protocol's requirement, so only the query is added here.
extension CKDatabase: PublicMirrorDatabase {
    func ckQueryPublicPhotoIDs(
        journeySlug slug: String,
        cursor: PublicMirrorCursor?,
        resultsLimit: Int
    ) async throws -> (ids: [CKRecord.ID], cursor: PublicMirrorCursor?) {
        let results: (matchResults: [(CKRecord.ID, Result<CKRecord, Error>)],
                      queryCursor: CKQueryOperation.Cursor?)
        if let cursor, let ckCursor = cursor.underlying as? CKQueryOperation.Cursor {
            results = try await records(continuingMatchFrom: ckCursor,
                                        desiredKeys: [], resultsLimit: resultsLimit)
        } else {
            let query = CKQuery(recordType: PublicMirrorBuilder.photoType,
                                predicate: NSPredicate(format: "journeySlug == %@", slug))
            results = try await records(matching: query, inZoneWith: nil,
                                        desiredKeys: [], resultsLimit: resultsLimit)
        }
        // We only need the IDs (for a delete diff); a per-record fetch error still yields the ID.
        let ids = results.matchResults.map(\.0)
        let next = results.queryCursor.map { PublicMirrorCursor(underlying: $0) }
        return (ids, next)
    }

    func ckExistingPublicJourneyCreator(slug: String) async throws -> String? {
        do {
            let record = try await record(for: PublicMirrorBuilder.journeyRecordID(slug: slug))
            return record.creatorUserRecordID?.recordName
        } catch let error as CKError where error.code == .unknownItem {
            return nil   // no PublicJourney under this slug yet — the keyspace is free
        }
    }
}

// MARK: - Record building (pure — no container, unit-tested in plain Debug)

/// Builds the two public record types from domain values, authored to `schema.ckdb`
/// (`PublicJourney` / `PublicPhoto`) + `MAPPING.md §8`.
enum PublicMirrorBuilder {

    static let journeyType = "PublicJourney"
    static let photoType = "PublicPhoto"

    // MARK: PublicJourney

    /// The `PublicJourney` record for a journey. `recordName = journey.slug` (stable upsert key,
    /// default zone). `photos` are used only to pick the hero thumbnail.
    ///
    /// Pass `existing` to update a fetched record in place; the asset fields are only ever *set*
    /// (never assigned nil), so a transient missing-bytes read cannot strip a good asset — same
    /// rule as `RecordCoder`.
    static func journeyRecord(for journey: Journey,
                              photos: [Photo],
                              existing: CKRecord? = nil) -> CKRecord {
        let record = existing ?? CKRecord(recordType: journeyType,
                                          recordID: CKRecord.ID(recordName: journey.slug))
        record["slug"] = journey.slug
        record["name"] = journey.name
        record["description"] = journey.description
        record["country"] = journey.country
        // S2: mirror the owner's own value rather than stamping "trek" — this record is also
        // QUERYABLE and world-readable, so it deserves the same honesty as the private one.
        record["journeyType"] = journey.journeyType
        record["summitElevation"] = journey.summitElevation
        record["totalDistance"] = journey.totalDistance
        record["totalDays"] = journey.totalDays
        record["preferredBearing"] = journey.preferredBearing
        record["preferredPitch"] = journey.preferredPitch
        record["dateStarted"] = DateOnly.date(from: journey.dateStarted)
        record["dateEnded"] = DateOnly.date(from: journey.dateEnded)
        record["centerLocation"] = location(from: journey.centerCoordinates)
        record["statsJSON"] = jsonString(journey.stats)
        // NEVER assign nil to a CKRecord key — it deletes the field server-side. Only set assets
        // when the bytes/JSON are actually available (see RecordCoder for the full rationale).
        if let route = jsonAsset(journey.route, prefix: "route") { record["routeJSON"] = route }
        if let waypoints = jsonAsset(journey.camps, prefix: "waypoints") { record["waypointsJSON"] = waypoints }
        if let heroURL = heroThumbURL(photos: photos) { record["heroThumb"] = CKAsset(fileURL: heroURL) }
        return record
    }

    /// Thumbnail bytes ONLY — no fallback. `Photo.thumbnailFileURL` deliberately falls back to
    /// the original bytes for display, but the public mirror must never ship an original
    /// (MAPPING §8 / D9): a "thumb" that is secretly a 12 MP file is exactly the leak the
    /// design forbids. A photo without real thumb bytes is skipped and counted instead.
    static func strictThumbURL(for photo: Photo) -> URL? {
        Photo.resolveMedia(absolutePath: photo.localThumbPath, relativeKey: photo.thumbnailURL)
    }

    /// The hero thumbnail's on-disk URL: the journey's hero photo, else the first photo by
    /// `sortOrder`; nil when neither has thumbnail bytes on disk (then the field is skipped).
    static func heroThumbURL(photos: [Photo]) -> URL? {
        let ordered = photos.sorted { $0.sortOrder < $1.sortOrder }
        let hero = photos.first(where: { $0.isHero }) ?? ordered.first
        // Prefer the chosen hero, but a journey whose hero lacks thumb bytes still
        // deserves a cover — fall through to the first photo that HAS them.
        return hero.flatMap(strictThumbURL(for:))
            ?? ordered.lazy.compactMap(strictThumbURL(for:)).first
    }

    // MARK: PublicPhoto

    /// The `PublicPhoto` record for a photo, or **nil** when its thumbnail bytes are not on disk
    /// (the caller skips it and counts it — a missing thumb never fails the whole publish).
    ///
    /// `recordName = photo.id` (default zone). `dayNumber` is omitted when the matcher can't
    /// resolve one. Only the `thumb` asset ever leaves the device — never the original.
    static func photoRecord(for photo: Photo,
                            journeySlug slug: String,
                            dayNumber: Int?,
                            existing: CKRecord? = nil) -> CKRecord? {
        guard let thumbURL = strictThumbURL(for: photo) else { return nil }
        let record = existing ?? CKRecord(recordType: photoType,
                                          recordID: CKRecord.ID(recordName: photo.id))
        record["journeySlug"] = slug
        record["thumb"] = CKAsset(fileURL: thumbURL)
        record["caption"] = photo.caption
        record["takenAt"] = isoDate(from: photo.takenAt)
        record["coordinates"] = location(from: photo.coordinates)
        // dayNumber is optional: omit the field entirely when unmatched (never write a sentinel).
        if let dayNumber { record["dayNumber"] = dayNumber }
        record["sortOrder"] = photo.sortOrder
        return record
    }

    /// The default-zone record ID for a `PublicJourney` (recordName == slug).
    static func journeyRecordID(slug: String) -> CKRecord.ID {
        CKRecord.ID(recordName: slug)
    }

    /// A collision-free public slug for an owner, formed by appending a short stable owner-scoped
    /// hash: `kilimanjaro` → `kilimanjaro-a1b2c3`. Deterministic for a given (slug, owner) pair so
    /// re-publishing keeps the same recordName; different owners of the same pretty slug get
    /// different suffixes. (quality gate: locally-minted slugs collide in the global public
    /// keyspace.)
    static func disambiguatedSlug(_ slug: String, ownerRecordName: String) -> String {
        "\(slug)-\(stableHash6("\(slug)|\(ownerRecordName)"))"
    }

    /// A stable, process-independent 6-character lowercase hex hash. Uses FNV-1a (not `Hasher`,
    /// whose seed is randomized per launch) so the suffix is identical across runs and devices.
    static func stableHash6(_ string: String) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in string.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return String(format: "%06x", hash & 0xffffff)
    }

    // MARK: Field helpers

    /// `[lng, lat]` (domain / GeoJSON order) → `CLLocation(latitude: lat, longitude: lng)`.
    /// The SWAP is the critical bit (MAPPING §5): Postgres/GeoJSON store `[lng, lat]` but
    /// `CLLocation` takes latitude first. Getting it wrong silently places every point in the
    /// wrong hemisphere. Returns nil for absent/short input.
    static func location(from coordinates: [Double]?) -> CLLocation? {
        guard let c = coordinates, c.count >= 2 else { return nil }
        return CLLocation(latitude: c[1], longitude: c[0])
    }

    private static func jsonString<T: Encodable>(_ value: T?) -> String? {
        guard let value, let data = JSONCoding.encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Scratch directory for the public-mirror JSON ASSET temp files (route + waypoints). A
    /// dedicated subdirectory — separate from `RecordCoder`'s route scratch — so a sweep here
    /// never touches an asset the sync engine is mid-upload.
    static var assetScratchDirectory: URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("akashic-public-mirror-assets", isDirectory: true)
    }

    /// Encode a value to a small temp-file JSON ASSET. Filenames stay per-call unique so a
    /// fixed name can never be swapped out from under an in-flight upload.
    private static func jsonAsset<T: Encodable>(_ value: T, prefix: String) -> CKAsset? {
        guard let data = JSONCoding.encode(value) else { return nil }
        let dir = assetScratchDirectory
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("akashic-public-\(prefix)-\(UUID().uuidString).json")
        do { try data.write(to: url) } catch { return nil }
        return CKAsset(fileURL: url)
    }

    /// Delete every previously written public-mirror ASSET temp file. Call only at a quiescent
    /// point (after a publish's saves have all completed) — `CKAsset` reads its file lazily.
    static func purgeAssetScratch(fileManager: FileManager = .default) {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: assetScratchDirectory, includingPropertiesForKeys: nil) else { return }
        for entry in entries { try? fileManager.removeItem(at: entry) }
    }

    // QUA-08: was a private static ISO8601DateFormatter. See ISO8601Shared for why these are
    // serialised centrally rather than annotated nonisolated(unsafe) at each site.

    /// Tolerant ISO-8601 parse (with or without fractional seconds), then bare `yyyy-MM-dd`.
    ///
    /// QUA-08: `ISO8601Shared.date(from:)` covers both ISO shapes, so the fractional formatter this
    /// built per call is gone. The `DateOnly` fallback stays — that is a different format, not a
    /// different formatter.
    private static func isoDate(from string: String?) -> Date? {
        ISO8601Shared.date(from: string) ?? DateOnly.date(from: string)
    }
}

// MARK: - Config / progress / report

struct PublicMirrorConfig: Equatable {
    /// Records per `CKModifyRecordsOperation`. 50 keeps asset-heavy requests well under
    /// CloudKit's 400-record hard cap.
    var maxRecordsPerBatch = 50
    /// Page size when querying existing `PublicPhoto` IDs for the stale diff / unpublish.
    var queryPageSize = 200

    /// Most `PublicPhoto` thumbnails one journey may put on the world-readable showcase (QUA-25).
    ///
    /// **Why a bound exists at all.** The public database is billed to *us*, not to the customer
    /// (COMMERCIALIZATION-PLAN §2): a signed-out visitor scrolling a showcase spends our egress,
    /// and nothing else in the model works that way. Uploads are bounded — `EntitlementPolicy`
    /// caps a free account at one journey of 100 photos — but reads were bounded by nothing, and a
    /// paid account published unlimited journeys of unlimited size. The success mode and the
    /// cost-blow-up mode are the same event, so the bound has to exist before the traffic does.
    ///
    /// **Why 200.** A published thumbnail budgets ~60 KB, so 200 is ~12 MB per fully-scrolled
    /// journey view. Kilimanjaro — a real journey, 939 photos — is ~56 MB uncapped, so this cuts
    /// the worst real case to about 21 % of its egress and turns "~45 full views a day at 1 000
    /// customers before overage" into roughly 210. The two inputs that fix the number:
    ///   * It must be **at least 100**, the free tier's per-journey photo cap, or a free account
    ///     could not publish its one journey whole — and publishing is deliberately free (§5).
    ///   * Doubling it to **200** keeps the paid tier meaningfully better at the thing the
    ///     showcase is selling, while the saving curve has already flattened: 400 would only be a
    ///     2.3× reduction against 200's 4.7×, so most of the benefit is in the first cut.
    ///
    /// Raising this is a cost decision, not a product one — check the CloudKit Console usage panel
    /// first (see `docs/store/launch-checklist.md`).
    var maxPublishedPhotos = 200

    static let `default` = PublicMirrorConfig()
}

/// Live progress for the UI: a 0…1 fraction and a short phase label.
struct PublicMirrorProgress: Equatable {
    var fraction: Double
    var phase: String
}

/// Outcome of a publish or unpublish. Partial per-record failures are collected, not thrown.
struct PublicMirrorReport: Equatable {
    /// True once the `PublicJourney` metadata record saved (always false for unpublish).
    var journeyPublished = false
    /// `PublicPhoto` records saved.
    var photosPublished = 0
    /// Photos skipped because their thumbnail bytes were not on disk (never a hard failure).
    var skippedNoThumb = 0
    /// Photos the per-journey cap held back (QUA-25). Zero for every journey under the cap, which
    /// is nearly all of them. Non-zero is not a failure: the publish succeeded and this many
    /// photos are simply not on the showcase, which the UI has to say out loud rather than let the
    /// owner believe the mirror is complete.
    var photosHeldBack = 0
    /// `PublicPhoto` records deleted — stale ones on update, or all of them on unpublish.
    var deleted = 0
    /// Per-record save/delete failures (surfaced, not thrown).
    var failures: [RecordFailure] = []
    var wasCancelled = false

    /// The slug the mirror was actually written under — the only reliable basis for a share link.
    ///
    /// `publish` resolves this at publish time and it is **not** always `journey.slug`: a
    /// cross-owner collision moves the mirror to `kilimanjaro-a1b2c3` while the local journey keeps
    /// the pretty slug. A link built from `journey.slug` would therefore 404 in precisely the case
    /// the disambiguation exists to handle, so the resolved value has to travel back to the caller
    /// rather than be guessed at the UI. Nil for unpublish, and nil when nothing was published.
    var publishedSlug: String?

    /// Total records written (journey metadata + photos).
    var published: Int { photosPublished + (journeyPublished ? 1 : 0) }
    var failed: Int { failures.count }
    var succeeded: Bool { failures.isEmpty && !wasCancelled }

    var summary: String {
        let head = wasCancelled ? "CANCELLED" : (succeeded ? "OK" : "COMPLETED WITH FAILURES")
        return "\(head) — published \(published), skipped (no thumb) \(skippedNoThumb), "
             + "held back (cap) \(photosHeldBack), deleted \(deleted), failed \(failed)"
    }
}

// MARK: - Publisher

/// The publish / unpublish surface the Showcase view model drives. A protocol so `ShowcaseViewModel`
/// can be unit-tested against a fake that fails on demand — the concrete `PublicMirrorPublisher`
/// talks to a real (or mock) `PublicMirrorDatabase`, but the view model's ordering + failure
/// handling (flip the `isPublic` flag only AFTER the network op succeeds) is what needs coverage.
protocol PublicMirrorPublishing {
    func publish(journey: Journey, photos: [Photo],
                 progress: (@Sendable (PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport
    func unpublish(slug: String,
                   progress: (@Sendable (PublicMirrorProgress) -> Void)?) async -> PublicMirrorReport
}

/// Executes publish / unpublish against a `PublicMirrorDatabase`. Not main-actor: pure record
/// building + async DB calls. The caller (a `@MainActor` view model) marshals `progress`.
///
/// ## `@unchecked Sendable` (QUA-08) — and its removal condition
///
/// `JourneyShowcaseSheet`'s `@MainActor` view model hands this instance into its own async work, so
/// the type has to be `Sendable`. The facts behind the promise are checkable: all three stored
/// properties are `let`; `PublicMirrorConfig` is three `Int`s; and `database` is a `CKDatabase` in
/// every shipping path, which CloudKit declares `NS_SWIFT_SENDABLE`.
///
/// It is `@unchecked` rather than checked only because `PublicMirrorDatabase` — the seam that exists
/// so tests can inject a mock — is not itself `Sendable`. **Removal condition:** declare
/// `protocol PublicMirrorDatabase: Sendable` and this becomes a plain checked conformance.
/// That is deliberately not done here: `CKDatabase` satisfies it for free, but the test double
/// `MockPublicDatabase` has seven mutable stored properties and would have to become an `actor`,
/// which adds `await` to ~30 assertions. Worth doing, not worth doing inside this commit.
final class PublicMirrorPublisher: PublicMirrorPublishing, @unchecked Sendable {

    private let database: PublicMirrorDatabase
    private let config: PublicMirrorConfig
    /// The current user's CloudKit record name, used to detect a cross-user slug collision before
    /// publishing. Nil (the default, and in dev/test paths) skips the collision check.
    private let ownerRecordName: String?

    init(database: PublicMirrorDatabase, config: PublicMirrorConfig = .default,
         ownerRecordName: String? = nil) {
        self.database = database
        self.config = config
        self.ownerRecordName = ownerRecordName
    }

    /// Resolve the slug to publish under. If a `PublicJourney` already exists under `journey.slug`
    /// owned by SOMEONE ELSE (the global public keyspace is shared across all iCloud users), publish
    /// under an owner-scoped disambiguated slug so the second family's showcase never collides with —
    /// or overwrites — the first family's. The local journey keeps its pretty slug; only the mirror's
    /// recordName/slug field change. With no owner identity (dev/test), the pretty slug is used as-is.
    func resolveEffectiveSlug(for journey: Journey) async -> String {
        guard let ownerRecordName else { return journey.slug }
        guard let existingCreator = try? await database.ckExistingPublicJourneyCreator(slug: journey.slug),
              existingCreator != ownerRecordName else {
            return journey.slug   // no record, or it is already ours — the pretty slug is free
        }
        return PublicMirrorBuilder.disambiguatedSlug(journey.slug, ownerRecordName: ownerRecordName)
    }

    // MARK: Chunking

    /// Split into fixed-size chunks (e.g. 120 photos, size 50 → [50, 50, 20]). Pure + static so
    /// the boundary is unit-tested directly.
    static func chunked<T>(_ items: [T], size: Int) -> [[T]] {
        guard size > 0 else { return items.isEmpty ? [] : [items] }
        return stride(from: 0, to: items.count, by: size).map {
            Array(items[$0 ..< min($0 + size, items.count)])
        }
    }

    // MARK: The published-photo cap (QUA-25)

    /// Choose at most `limit` photos to publish, spread across the journey's days, and report how
    /// many were held back. Pure + static so the boundary behaviour is unit-tested directly.
    ///
    /// ## Why not simply `prefix(limit)`
    /// `sortOrder` is journey-global and chronological, so a flat prefix on a 7-day trek publishes
    /// days 1–3 and nothing after. A visitor scrolling to day 6 would find an *empty* day rather
    /// than a smaller one — the showcase would look broken instead of abridged. So this round-robins
    /// one rank at a time across days: every day contributes its best photo before any day
    /// contributes its second.
    ///
    /// ## Why `sortOrder` is the right ranking, and why `PhotoCuration` is not called here
    /// The task is to prefer the *best* photos, and `PhotoCuration` (DIFF-04) is exactly the layer
    /// that ranks them — but it does not fit at this seam, for three reasons:
    ///   * It consumes `[PhotoScore]`, which only `VisionPhotoScorer` produces. That is an async
    ///     Vision pass over every photo, and putting one on the critical path of a user-initiated
    ///     network operation would mean scoring 939 images before the first byte uploads.
    ///   * It caps **per day** (six, a screenful in the day gallery), not per journey. A 7-day trek
    ///     would publish 42 photos regardless of this cap and a 1-day trek 6 — the wrong shape for
    ///     an egress budget, which has to be a whole-journey number.
    ///   * Its `hero` and `duplicateGroups` outputs are *proposals* for the user to accept. The
    ///     publisher must not silently act on curation decisions nobody was shown.
    ///
    /// It does not need to. When the user *has* accepted a best-of proposal,
    /// `PhotoCurationService.applyingBestOf` reorders `sortOrder` **within the day** so the chosen
    /// photos lead — so "lowest `sortOrder` first, within each day" already *is* "curated-best
    /// first", at no cost and with no second pass. On an uncurated journey it degrades to
    /// chronological, which is the app's default order everywhere else.
    static func capped(_ photos: [Photo], limit: Int,
                       dayOf: (Photo) -> Int?) -> (kept: [Photo], heldBack: Int) {
        guard limit > 0 else { return ([], photos.count) }
        guard photos.count > limit else { return (photos, 0) }

        // Unassigned photos share one bucket keyed `Int.max`, so they compete with each other for a
        // single round-robin slot and sort *after* every real day — a day-assigned photo is the
        // more useful thing to put on a showcase.
        let unassignedKey = Int.max
        var byDay: [Int: [Photo]] = [:]
        for photo in photos { byDay[dayOf(photo) ?? unassignedKey, default: []].append(photo) }
        for key in byDay.keys { byDay[key]?.sort { $0.sortOrder < $1.sortOrder } }

        // Ascending day order so a tie at the cap boundary always resolves to the earlier day.
        // Never iterate the dictionary directly: its order is not stable across runs.
        let days = byDay.keys.sorted()
        let deepest = byDay.values.map(\.count).max() ?? 0
        var kept: [Photo] = []
        kept.reserveCapacity(limit)
        var rank = 0
        while kept.count < limit && rank < deepest {
            for day in days {
                guard kept.count < limit else { break }
                guard let dayPhotos = byDay[day], rank < dayPhotos.count else { continue }
                kept.append(dayPhotos[rank])
            }
            rank += 1
        }

        // Publish in journey order, so the mirror reads chronologically like every other surface.
        return (kept.sorted { $0.sortOrder < $1.sortOrder }, photos.count - kept.count)
    }

    // MARK: Publish (upsert + stale-photo reconciliation)

    /// Publish (or re-publish) a journey to the mirror.
    ///
    /// Upserts the `PublicJourney` record and one `PublicPhoto` per photo with thumbnail bytes,
    /// then reconciles: any `PublicPhoto` still in the mirror for this slug that is **not** in the
    /// freshly-built set is deleted (a photo removed locally must leave the showcase).
    @discardableResult
    func publish(journey: Journey,
                 photos: [Photo],
                 progress: (@Sendable (PublicMirrorProgress) -> Void)? = nil) async -> PublicMirrorReport {
        var report = PublicMirrorReport()
        defer { PublicMirrorBuilder.purgeAssetScratch() }

        // Resolve a collision-free slug in the shared public keyspace, then publish the whole
        // journey (metadata + photos + reconcile) under it. The domain journey keeps its pretty slug.
        let effectiveSlug = await resolveEffectiveSlug(for: journey)
        var journey = journey
        journey.slug = effectiveSlug

        let matcher = PhotoDayMatcher(journey: journey)

        // Thumbless photos can never be published, so they are excluded BEFORE the cap — otherwise a
        // journey with missing bytes would spend cap slots on photos that get skipped anyway and
        // publish fewer than the cap allows. `photoRecord` returns nil for exactly this reason and
        // nothing else, so the two agree by construction.
        let publishable = photos.filter { PublicMirrorBuilder.strictThumbURL(for: $0) != nil }
        report.skippedNoThumb = photos.count - publishable.count

        // QUA-25: bound what one journey can put on the world-readable showcase. Held-back photos
        // are reported, never fatal — a capped publish is a successful publish.
        let capped = Self.capped(publishable, limit: config.maxPublishedPhotos,
                                 dayOf: { matcher.day(for: $0) })
        report.photosHeldBack = capped.heldBack

        // Build the desired PublicPhoto set, tracking their IDs for the stale diff. Anything the cap
        // held back is therefore absent from `desiredPhotoNames`, so the reconciliation pass below
        // also *removes* it from the mirror if a previous, uncapped publish had put it there.
        var photoRecords: [CKRecord] = []
        var desiredPhotoNames: Set<String> = []
        for photo in capped.kept {
            guard let record = PublicMirrorBuilder.photoRecord(for: photo,
                                                              journeySlug: effectiveSlug,
                                                              dayNumber: matcher.day(for: photo))
            else { continue }
            photoRecords.append(record)
            desiredPhotoNames.insert(photo.id)
        }

        let totalToSave = 1 + photoRecords.count
        var savedUnits = 0
        func reportSave(_ phase: String) {
            let frac = totalToSave == 0 ? 0 : Double(savedUnits) / Double(totalToSave) * 0.9
            progress?(PublicMirrorProgress(fraction: frac, phase: phase))
        }

        reportSave(String(localized: "Publishing metadata",
                          comment: "Showcase publish progress phase: writing the journey's route, notes and hero images."))

        // 1. The metadata record (its own op — it carries the heavy route/waypoints/hero assets).
        if Task.isCancelled { report.wasCancelled = true; return report }
        let journeyRecord = PublicMirrorBuilder.journeyRecord(for: journey, photos: photos)
        let metaOutcome = await save([journeyRecord])
        if metaOutcome.saved.contains(journey.slug) {
            report.journeyPublished = true
            // `journey.slug` is the effective slug here — reassigned at the top of this method —
            // so this is the value a share link must use, not the domain journey's pretty slug.
            report.publishedSlug = journey.slug
        }
        report.failures.append(contentsOf: metaOutcome.failures)
        savedUnits += 1
        reportSave(String(localized: "Publishing metadata",
                          comment: "Showcase publish progress phase: writing the journey's route, notes and hero images."))

        // 2. Photo thumbnails, chunked.
        for chunk in Self.chunked(photoRecords, size: config.maxRecordsPerBatch) {
            if Task.isCancelled { report.wasCancelled = true; return report }
            let outcome = await save(chunk)
            report.photosPublished += outcome.saved.count
            report.failures.append(contentsOf: outcome.failures)
            savedUnits += chunk.count
            reportSave(String(localized: "Publishing photos (\(report.photosPublished)/\(photoRecords.count))",
                              comment: "Showcase publish progress phase: uploading photo thumbnails. Placeholders are photos done / total."))
        }

        // 3. Reconcile: delete PublicPhotos that no longer exist locally.
        if Task.isCancelled { report.wasCancelled = true; return report }
        progress?(PublicMirrorProgress(fraction: 0.92,
                                       phase: String(localized: "Cleaning up removed photos",
                                                     comment: "Showcase publish progress phase: deleting showcase photos that no longer exist on this device.")))
        do {
            let existing = try await allExistingPhotoIDs(slug: journey.slug)
            let stale = existing.filter { !desiredPhotoNames.contains($0.recordName) }
            let deleteOutcome = await delete(stale)
            report.deleted += deleteOutcome.deleted
            report.failures.append(contentsOf: deleteOutcome.failures)
        } catch is CancellationError {
            report.wasCancelled = true
            return report
        } catch {
            // A failed reconciliation query does not undo a successful publish — surface it and
            // finish. The stale photos simply linger until the next publish.
            report.failures.append(RecordFailure(recordName: journey.slug, recordType: PublicMirrorBuilder.photoType,
                                                 zoneName: "_defaultZone", code: Self.code(of: error),
                                                 message: "stale-photo query failed: \(error)"))
        }

        progress?(PublicMirrorProgress(fraction: 1.0,
                                       phase: String(localized: "Done",
                                                     comment: "Showcase publish progress phase: finished.")))
        return report
    }

    // MARK: Unpublish

    /// Every slug under which this owner could have published `slug`.
    ///
    /// `publish` does not necessarily write under the journey's pretty slug: `resolveEffectiveSlug`
    /// moves the mirror to an owner-scoped `kilimanjaro-a1b2c3` when another family already holds
    /// `kilimanjaro` in the shared public keyspace, and the local journey deliberately keeps the
    /// pretty one. Unpublishing only the pretty slug therefore found nothing, and because `delete`
    /// treats an already-absent record as success, it reported OK — so the caller flipped `isPublic`
    /// to false and the Remove button disappeared while the real records stayed world-readable,
    /// GPS and timestamps included, with no UI left to remove them.
    ///
    /// Sweeping both is enough and needs no persisted state: `disambiguatedSlug` is deterministic
    /// for a given (slug, owner) pair, so the variant can always be recomputed. It is also the
    /// robust choice over re-running `resolveEffectiveSlug` at unpublish time — that asks "is the
    /// pretty slug taken by someone else *now*", which can answer differently than it did at
    /// publish time and would send the sweep to the wrong slug again.
    func candidateSlugs(for slug: String) -> [String] {
        guard let ownerRecordName else { return [slug] }
        let disambiguated = PublicMirrorBuilder.disambiguatedSlug(slug, ownerRecordName: ownerRecordName)
        return disambiguated == slug ? [slug] : [slug, disambiguated]
    }

    /// Remove a journey from the mirror entirely: delete every `PublicPhoto` for the slug
    /// (following query cursors), then the `PublicJourney` record — for every slug this owner
    /// could have published under (see `candidateSlugs`).
    @discardableResult
    func unpublish(slug: String,
                   progress: (@Sendable (PublicMirrorProgress) -> Void)? = nil) async -> PublicMirrorReport {
        var report = PublicMirrorReport()
        progress?(PublicMirrorProgress(fraction: 0.0,
                                       phase: String(localized: "Finding published photos",
                                                     comment: "Showcase removal progress phase: querying which photos are currently on the showcase.")))

        let slugs = candidateSlugs(for: slug)

        // Collect across every candidate slug before deleting anything, so the progress
        // denominator is the true total and a cursor failure on one slug does not leave the
        // other half-swept.
        var existing: [CKRecord.ID] = []
        for candidate in slugs {
            do {
                existing.append(contentsOf: try await allExistingPhotoIDs(slug: candidate))
            } catch is CancellationError {
                report.wasCancelled = true
                return report
            } catch {
                report.failures.append(RecordFailure(recordName: candidate, recordType: PublicMirrorBuilder.photoType,
                                                     zoneName: "_defaultZone", code: Self.code(of: error),
                                                     message: "photo query failed: \(error)"))
                return report
            }
        }

        let chunks = Self.chunked(existing, size: config.maxRecordsPerBatch)
        var done = 0
        for chunk in chunks {
            if Task.isCancelled { report.wasCancelled = true; return report }
            let outcome = await delete(chunk)
            report.deleted += outcome.deleted
            report.failures.append(contentsOf: outcome.failures)
            done += chunk.count
            let frac = existing.isEmpty ? 0.9 : Double(done) / Double(existing.count) * 0.9
            progress?(PublicMirrorProgress(fraction: frac,
                                           phase: String(localized: "Removing photos (\(done)/\(existing.count))",
                                                         comment: "Showcase removal progress phase: deleting photo thumbnails. Placeholders are photos done / total.")))
        }

        // Finally the metadata records — one per candidate slug. An absent one is a no-op, which
        // is why sweeping both is safe rather than merely thorough.
        if Task.isCancelled { report.wasCancelled = true; return report }
        progress?(PublicMirrorProgress(fraction: 0.95,
                                       phase: String(localized: "Removing metadata",
                                                     comment: "Showcase removal progress phase: deleting the journey record itself.")))
        let metaOutcome = await delete(slugs.map { PublicMirrorBuilder.journeyRecordID(slug: $0) })
        report.deleted += metaOutcome.deleted
        report.failures.append(contentsOf: metaOutcome.failures)

        progress?(PublicMirrorProgress(fraction: 1.0,
                                       phase: String(localized: "Done",
                                                     comment: "Showcase publish progress phase: finished.")))
        return report
    }

    // MARK: Best-effort targeted photo removal (finding #7)

    /// Delete specific `PublicPhoto` records by id, without touching the journey metadata.
    ///
    /// Used when a photo is deleted locally from a still-published journey: its world-readable
    /// thumbnail (with GPS + timestamp) must not linger in the mirror until the next manual
    /// "Update showcase". Fire-and-forget — per-record failures are reported, never thrown; the
    /// next full publish still reconciles anything this missed.
    @discardableResult
    func deletePublicPhotos(ids: [String]) async -> PublicMirrorReport {
        var report = PublicMirrorReport()
        let recordIDs = ids.map { CKRecord.ID(recordName: $0) }
        for chunk in Self.chunked(recordIDs, size: config.maxRecordsPerBatch) {
            let outcome = await delete(chunk)
            report.deleted += outcome.deleted
            report.failures.append(contentsOf: outcome.failures)
        }
        return report
    }

    // MARK: Query (cursor-following — one page is never the answer)

    /// Every `PublicPhoto` record ID for a slug, following the query cursor to the last page.
    private func allExistingPhotoIDs(slug: String) async throws -> [CKRecord.ID] {
        var ids: [CKRecord.ID] = []
        var cursor: PublicMirrorCursor?
        repeat {
            if Task.isCancelled { throw CancellationError() }
            let page = try await database.ckQueryPublicPhotoIDs(
                journeySlug: slug, cursor: cursor, resultsLimit: config.queryPageSize)
            ids.append(contentsOf: page.ids)
            cursor = page.cursor
        } while cursor != nil
        return ids
    }

    // MARK: Save / delete one op (partial-failure collecting)

    private struct SaveOutcome { var saved: Set<String> = []; var failures: [RecordFailure] = [] }
    private struct DeleteOutcome { var deleted = 0; var failures: [RecordFailure] = [] }

    private func save(_ records: [CKRecord]) async -> SaveOutcome {
        guard !records.isEmpty else { return SaveOutcome() }
        var outcome = SaveOutcome()
        do {
            let (saveResults, _) = try await database.ckModifyRecords(
                saving: records, deleting: [], savePolicy: .allKeys)
            for record in records {
                switch saveResults[record.recordID] {
                case .success:
                    outcome.saved.insert(record.recordID.recordName)
                case .failure(let error):
                    outcome.failures.append(Self.failure(record.recordID, type: record.recordType, error: error))
                case .none:
                    outcome.failures.append(RecordFailure(recordName: record.recordID.recordName,
                                                          recordType: record.recordType, zoneName: "_defaultZone",
                                                          code: -1, message: "no result returned"))
                }
            }
        } catch {
            // Whole-op failure: record each item and keep going (never throw away the batch).
            for record in records {
                outcome.failures.append(Self.failure(record.recordID, type: record.recordType, error: error))
            }
        }
        return outcome
    }

    private func delete(_ ids: [CKRecord.ID]) async -> DeleteOutcome {
        guard !ids.isEmpty else { return DeleteOutcome() }
        var outcome = DeleteOutcome()
        do {
            let (_, deleteResults) = try await database.ckModifyRecords(
                saving: [], deleting: ids, savePolicy: .allKeys)
            for id in ids {
                switch deleteResults[id] {
                case .success, .none:
                    // A delete whose target is already gone reports no failure — treat absence as
                    // success (the desired end state is "not present").
                    outcome.deleted += 1
                case .failure(let error):
                    outcome.failures.append(Self.failure(id, type: PublicMirrorBuilder.photoType, error: error))
                }
            }
        } catch {
            for id in ids {
                outcome.failures.append(Self.failure(id, type: PublicMirrorBuilder.photoType, error: error))
            }
        }
        return outcome
    }

    private static func failure(_ id: CKRecord.ID, type: String, error: Error) -> RecordFailure {
        RecordFailure(recordName: id.recordName, recordType: type, zoneName: "_defaultZone",
                      code: code(of: error), message: "\(error)")
    }

    private static func code(of error: Error) -> Int {
        (error as? CKError)?.errorCode ?? (error as NSError).code
    }
}
