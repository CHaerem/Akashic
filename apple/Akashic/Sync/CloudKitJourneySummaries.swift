import Foundation
import CloudKit

/// The CloudKit half of the DIFF-15 journey-summary pre-fetch: what is waiting in iCloud, by name,
/// before any of it has been downloaded.
///
/// ## Why this exists
///
/// `NetworkPolicy` defers the whole first fetch on a metered connection (the right default — it is
/// a ~97 MB thumbnail pull), which leaves the local store empty and `JourneyListView` showing the
/// "Start your first journey" hero to a family member whose three journeys are sitting in iCloud
/// waiting. This query is the cheap thing that was missing: one `Journey` record per zone with
/// `desiredKeys`, plus a `recordName`-only count of that zone's `Photo` records. No assets, no
/// route geometry, no thumbnails — kilobytes, which is why it runs ungated.
///
/// ## Both databases
///
/// Deliberately private **and** shared, unlike `CloudKitRemotePhotoCounter` (private only). The
/// person this feature is for is usually a PARTICIPANT — a family member the owner shared journeys
/// with — and a participant's journeys live in the shared database. Querying only the private one
/// would have left exactly the reported case seeing nothing.
///
/// ## Best-effort, always
///
/// Every failure path returns `nil`. This paragraph used to continue "and
/// `FirstSyncDownloadDecision.emptyListContent` renders the first-run hero for `nil` … the honest
/// response is the ordinary front door" — and build 101 on a real phone proved that reasoning
/// WRONG (DIFF-16): showing a family "Start your first journey" because a query failed is a false
/// statement, not a safe default. `nil` while a deferral is active now renders `.couldNotCheck` —
/// honest copy, a retry, never the hero. The hero remains only for POSITIVE evidence of a new
/// family (an empty result), which is a claim this query can actually support.
///
/// `CKContainer` is constructed ONLY inside `#if AKASHIC_CLOUDKIT_BUILD` — it traps (SIGTRAP) in a
/// binary without the `com.apple.developer.icloud-services` entitlement. Outside that build every
/// method returns `nil` without touching CloudKit, which is also what makes it safe as the sync
/// engine's default summarizer in Debug and under test.
struct CloudKitRemoteJourneySummarizer: RemoteJourneySummarizing {
    let containerIdentifier: String

    /// Guard against a pathological account making the pre-fetch expensive: this is a "show me a
    /// handful of rows" query, not an enumeration. Twenty zones is far beyond any real family
    /// archive (the owner's is three) and keeps the worst case bounded.
    static let maxZonesToSummarize = 20

    func remoteJourneySummaries() async -> [RemoteJourneySummary]? {
        #if AKASHIC_CLOUDKIT_BUILD
        let container = CKContainer(identifier: containerIdentifier)
        var found: [RemoteJourneySummary] = []
        var anyDatabaseSucceeded = false

        for database in [container.privateCloudDatabase, container.sharedCloudDatabase] {
            do {
                found += try await summaries(in: database)
                anyDatabaseSucceeded = true
            } catch {
                // One database failing is not fatal — a participant with no private zones, or an
                // owner with no shares, is entirely normal. Only *both* failing is "no answer".
                SyncLog.error("remoteJourneySummaries: \(database.databaseScope) scope failed — \(error)")
            }
        }

        guard anyDatabaseSucceeded else { return nil }
        // Newest first, matching how a family thinks about their trips. Journeys with no start date
        // sort last rather than being dropped.
        let sorted = found.sorted { ($0.dateStarted ?? "") > ($1.dateStarted ?? "") }
        SyncLog.log("remoteJourneySummaries: \(sorted.count) journey(s) waiting to download")
        return sorted
        #else
        return nil
        #endif
    }

    #if AKASHIC_CLOUDKIT_BUILD
    private func summaries(in database: CKDatabase) async throws -> [RemoteJourneySummary] {
        let zones = try await database.allRecordZones()
        // Media zones hold the originals and no `Journey` record at all (MAPPING §13), so skip them
        // rather than paying a failed query per journey.
        let journeyZones = zones.map(\.zoneID)
            .filter { !RecordCoder.isMediaZone($0) }
            .filter { RecordCoder.journeyID(fromZoneID: $0) != nil }
            .prefix(Self.maxZonesToSummarize)

        var result: [RemoteJourneySummary] = []
        for zoneID in journeyZones {
            // A single zone failing is skipped, not propagated: one unreadable journey must not cost
            // the user the other two.
            do {
                if let summary = try await summary(inZone: zoneID, database: database) {
                    result.append(summary)
                }
            } catch {
                SyncLog.error("remoteJourneySummaries: zone \(zoneID.zoneName) skipped — \(error)")
            }
        }
        return result
    }

    /// The one `Journey` record in a journey zone, plus that zone's photo count.
    private func summary(inZone zoneID: CKRecordZone.ID,
                         database: CKDatabase) async throws -> RemoteJourneySummary? {
        let query = CKQuery(recordType: RecordCoder.RecordType.journey,
                            predicate: NSPredicate(value: true))
        // Exactly the fields a row needs. `heroImage`, `heroThumb` and `routeJSON` are ASSETs and
        // are the whole reason for naming keys instead of taking the record: omitted here, they are
        // never materialized, so this stays a metadata request.
        let page = try await database.records(matching: query,
                                              inZoneWith: zoneID,
                                              desiredKeys: ["name", "country", "dateStarted", "dateEnded"],
                                              resultsLimit: 1)
        guard let (recordID, result) = page.matchResults.first,
              let record = try? result.get(),
              let name = record["name"] as? String
        else { return nil }

        return RemoteJourneySummary(
            id: recordID.recordName,
            name: name,
            country: record["country"] as? String ?? "",
            dateStarted: DateOnly.string(from: record["dateStarted"] as? Date),
            dateEnded: DateOnly.string(from: record["dateEnded"] as? Date),
            photoCount: try await photoCount(inZone: zoneID, database: database))
    }

    /// Count this zone's `Photo` records without fetching a single asset byte (`desiredKeys: []`),
    /// paging until the cursor runs out — the same technique as `CloudKitRemotePhotoCounter`, scoped
    /// to one journey so the count can be shown per row.
    private func photoCount(inZone zoneID: CKRecordZone.ID, database: CKDatabase) async throws -> Int {
        let query = CKQuery(recordType: RecordCoder.RecordType.photo, predicate: NSPredicate(value: true))
        var count = 0
        var cursor: CKQueryOperation.Cursor?
        repeat {
            let matches: [(CKRecord.ID, Result<CKRecord, Error>)]
            if let current = cursor {
                let page = try await database.records(continuingMatchFrom: current,
                                                      desiredKeys: [],
                                                      resultsLimit: CKQueryOperation.maximumResults)
                matches = page.matchResults; cursor = page.queryCursor
            } else {
                let page = try await database.records(matching: query, inZoneWith: zoneID,
                                                      desiredKeys: [],
                                                      resultsLimit: CKQueryOperation.maximumResults)
                matches = page.matchResults; cursor = page.queryCursor
            }
            count += matches.count
        } while cursor != nil
        return count
    }
    #endif
}
