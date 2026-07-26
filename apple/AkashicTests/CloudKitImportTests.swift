import XCTest
import CloudKit
@testable import Akashic

/// Tests for the CloudKit importer (`CloudKitImportSink`): zone/record planning, batch chunking
/// by count AND bytes, partial-failure collection + retry, limitExceeded batch-splitting,
/// transient backoff, missing-media skip, idempotent re-run, dry-run purity, cooperative
/// cancellation, and a filesystem-gated plan against the REAL family export.
///
/// Everything runs against a mock `CKDatabaseProtocol` — no container, no iCloud account (none
/// exists in any simulator yet). Backoff delays are injected as no-ops so the suite is fast.
final class CloudKitImportTests: XCTestCase {

    // MARK: - Mock database

    /// Records everything written and can be scripted to fail per call (whole-op throw or
    /// per-record failures) to exercise the retry/collect paths.
    final class MockDatabase: CKDatabaseProtocol {
        enum Response { case ok; case throwError(Error); case perRecordFailures([String: Error]) }

        private(set) var savedRecords: [CKRecord.ID: CKRecord] = [:]
        private(set) var savedZones: [CKRecordZone.ID: CKRecordZone] = [:]
        private(set) var modifyRecordsCallCount = 0
        private(set) var modifyZonesCallCount = 0
        private(set) var lastSavePolicy: CKModifyRecordsOperation.RecordSavePolicy?

        /// One-shot whole-op errors for the zone op, consumed in order (empty ⇒ succeed).
        var zoneErrors: [Error] = []
        /// Zone names that come back as a per-zone `.failure` in `saveResults` (not a throw).
        var zoneSaveFailures: [String: Error] = [:]
        /// Per modifyRecords call: `(callIndex, records) -> Response`.
        var responder: ((Int, [CKRecord]) -> Response)?
        /// Optional async gate opened by the test (used by the cancellation test).
        var onModifyRecords: (() async -> Void)?

        func ckModifyRecordZones(saving zonesToSave: [CKRecordZone], deleting: [CKRecordZone.ID]) async throws
            -> (saveResults: [CKRecordZone.ID: Result<CKRecordZone, Error>], deleteResults: [CKRecordZone.ID: Result<Void, Error>]) {
            let index = modifyZonesCallCount
            modifyZonesCallCount += 1
            if index < zoneErrors.count { throw zoneErrors[index] }
            var results: [CKRecordZone.ID: Result<CKRecordZone, Error>] = [:]
            for zone in zonesToSave {
                if let error = zoneSaveFailures[zone.zoneID.zoneName] {
                    results[zone.zoneID] = .failure(error)
                } else {
                    savedZones[zone.zoneID] = zone
                    results[zone.zoneID] = .success(zone)
                }
            }
            return (results, [:])
        }

        func ckModifyRecords(saving recordsToSave: [CKRecord], deleting: [CKRecord.ID],
                             savePolicy: CKModifyRecordsOperation.RecordSavePolicy) async throws
            -> (saveResults: [CKRecord.ID: Result<CKRecord, Error>], deleteResults: [CKRecord.ID: Result<Void, Error>]) {
            let index = modifyRecordsCallCount
            modifyRecordsCallCount += 1
            lastSavePolicy = savePolicy
            if let hook = onModifyRecords { await hook() }

            let response = responder?(index, recordsToSave) ?? .ok
            switch response {
            case .throwError(let error):
                throw error
            case .ok:
                var results: [CKRecord.ID: Result<CKRecord, Error>] = [:]
                for r in recordsToSave { savedRecords[r.recordID] = r; results[r.recordID] = .success(r) }
                return (results, [:])
            case .perRecordFailures(let failures):
                var results: [CKRecord.ID: Result<CKRecord, Error>] = [:]
                for r in recordsToSave {
                    if let err = failures[r.recordID.recordName] {
                        results[r.recordID] = .failure(err)
                    } else {
                        savedRecords[r.recordID] = r
                        results[r.recordID] = .success(r)
                    }
                }
                return (results, [:])
            }
        }

        func ckRecord(for recordID: CKRecord.ID) async throws -> CKRecord {
            if let r = savedRecords[recordID] { return r }
            throw CKError(.unknownItem)
        }
    }

    private func ckError(_ code: CKError.Code, retryAfter: Double? = nil) -> Error {
        var info: [String: Any] = [:]
        if let retryAfter { info[CKErrorRetryAfterKey] = retryAfter }
        return NSError(domain: CKErrorDomain, code: code.rawValue, userInfo: info)
    }

    // MARK: - Fixtures

    /// One journey (J1, 3-point route), two waypoints, and four photos:
    ///   P1 original+thumb · P2 original only (thumb missing) · P3 no bytes (missing-media)
    ///   · P4 orphan journey. Plus a temp media root with P1/P1_thumb/P2 present.
    private func makeBundle() throws -> ExportBundle {
        let journeys = #"""
        [{"id":"J1","slug":"j1-slug","name":"Test Journey","country":"Norway","description":"d",
          "hero_image_url":"/hero-images/j1-hero.png",
          "date_started":"2024-01-01","is_public":true,"total_days":2,"total_distance":10,
          "center_coordinates":[10.0,60.0],
          "route":{"type":"LineString","coordinates":[[10.0,60.0,100],[10.01,60.0,200],[10.02,60.0,150]]},
          "stats":{"duration":2,"totalDistance":10,"totalElevationGain":100,"totalElevationLoss":50,
                   "highestPoint":{"name":"Top","elevation":200,"coordinates":[10.01,60.0]}}}]
        """#.data(using: .utf8)!
        let waypoints = #"""
        [{"id":"W1","journey_id":"J1","name":"Camp 1","day_number":1,"coordinates":[10.0,60.0],
          "elevation":100,"sort_order":0,"route_point_index":0,"route_distance_km":0.0,"highlights":["View"],
          "date_visited":"2024-01-01"},
         {"id":"W2","journey_id":"J1","name":"Camp 2","day_number":2,"coordinates":[10.02,60.0],
          "elevation":150,"sort_order":1,"route_point_index":2,"route_distance_km":1.5}]
        """#.data(using: .utf8)!
        let photos = #"""
        [{"id":"P1","journey_id":"J1","waypoint_id":"W1","url":"journeys/J1/photos/P1.jpg",
          "thumbnail_url":"journeys/J1/photos/P1_thumb.jpg",
          "coordinates":{"type":"Point","coordinates":[10.0,60.0]},
          "taken_at":"2024-01-01T10:00:00Z","sort_order":0,"rotation":90,"media_type":"image"},
         {"id":"P2","journey_id":"J1","url":"journeys/J1/photos/P2.jpg",
          "thumbnail_url":"journeys/J1/photos/P2_thumb.jpg","coordinates":[10.01,60.0],
          "sort_order":1,"media_type":"video","duration":12},
         {"id":"P3","journey_id":"J1","url":"journeys/J1/photos/P3.jpg",
          "thumbnail_url":"journeys/J1/photos/P3_thumb.jpg","sort_order":2},
         {"id":"P4","journey_id":"ORPHAN","url":"journeys/ORPHAN/photos/P4.jpg","sort_order":0}]
        """#.data(using: .utf8)!
        return ExportBundle(
            journeys: try ExportBundle.decodeRows([JourneyRow].self, from: journeys),
            waypoints: try ExportBundle.decodeRows([WaypointRow].self, from: waypoints),
            photos: try ExportBundle.decodeRows([PhotoRow].self, from: photos))
    }

    /// Media root with P1 original+thumb and P2 original present (P3 absent entirely).
    ///
    /// Mirrors the REAL export layout for the hero image: the DB path is a Next.js `public/`
    /// path (`/hero-images/<slug>-hero.png`) that does NOT exist under the media root, while the
    /// bytes live at `journeys/<slug>/hero.png`. `hero: false` reproduces a genuinely absent hero.
    private func makeMediaRoot(hero: Bool = true) throws -> URL {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("akashic-ckmedia-\(UUID().uuidString)")
        let dir = root.appendingPathComponent("journeys/J1/photos")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let bytes = Data("jpeg-bytes".utf8)
        try bytes.write(to: dir.appendingPathComponent("P1.jpg"))
        try bytes.write(to: dir.appendingPathComponent("P1_thumb.jpg"))
        try bytes.write(to: dir.appendingPathComponent("P2.jpg"))
        if hero {
            let heroDir = root.appendingPathComponent("journeys/j1-slug")
            try FileManager.default.createDirectory(at: heroDir, withIntermediateDirectories: true)
            try Data("hero-png-bytes".utf8).write(to: heroDir.appendingPathComponent("hero.png"))
        }
        return root
    }

    private func makeSink(_ mock: CKDatabaseProtocol,
                          config: CloudKitImportConfig = .default,
                          hero: Bool = true) throws -> CloudKitImportSink {
        CloudKitImportSink.fromBundle(
            database: mock, bundle: try makeBundle(),
            mediaResolver: MediaResolver(root: try makeMediaRoot(hero: hero)),
            config: config, sleep: { _ in })
    }

    // MARK: - Plan

    func testZonePlanCorrectness() throws {
        let plan = try makeSink(MockDatabase()).makePlan()
        XCTAssertEqual(plan.zoneNames, ["journey-J1"])
        XCTAssertEqual(plan.zoneCount, 1)
        XCTAssertEqual(plan.environment, .development)
        XCTAssertEqual(plan.containerID, "iCloud.no.akashic")
    }

    func testPlanRecordAndAssetCounts() throws {
        let plan = try makeSink(MockDatabase()).makePlan()
        XCTAssertEqual(plan.journeyCount, 1)
        XCTAssertEqual(plan.waypointCount, 2)
        XCTAssertEqual(plan.photoCount, 2)             // P1, P2 (P3 missing-media, P4 orphan)
        XCTAssertEqual(plan.commentCount, 0)
        XCTAssertEqual(plan.recordCount, 5)
        XCTAssertEqual(plan.originalAssetCount, 2)     // P1, P2
        XCTAssertEqual(plan.thumbAssetCount, 1)        // P1
        XCTAssertEqual(plan.thumbsMissing, 1)          // P2 uploaded without a thumb
        XCTAssertEqual(plan.routeAssetCount, 1)        // J1 route
        XCTAssertEqual(plan.missingMedia.map(\.photoID), ["P3"])
        XCTAssertGreaterThan(plan.totalAssetBytes, 0)
    }

    // MARK: - Hero images (DB path vs R2 layout)

    /// The export's `hero_image_url` is a Next.js `public/` path that never resolves under the
    /// media root; the bytes are at `journeys/<slug>/hero.png`. Regression: all three family
    /// journeys silently lost their hero image because only the DB path was tried.
    func testHeroImageResolvesFromJourneySlugLayout() async throws {
        let mock = MockDatabase()
        let sink = try makeSink(mock)
        let plan = sink.makePlan()
        XCTAssertEqual(plan.heroAssetCount, 1, "hero bytes exist at journeys/<slug>/hero.png")
        XCTAssertEqual(plan.heroMissing, 0)

        _ = await sink.execute(dryRun: false)
        let journeyRecord = mock.savedRecords.first { $0.key.recordName == "J1" }?.value
        XCTAssertNotNil(journeyRecord?["heroImage"] as? CKAsset, "hero asset must be attached to the Journey record")
    }

    /// A genuinely absent hero is reported, never silently skipped.
    func testMissingHeroIsCountedNotSilentlySkipped() throws {
        let plan = try makeSink(MockDatabase(), hero: false).makePlan()
        XCTAssertEqual(plan.heroAssetCount, 0)
        XCTAssertEqual(plan.heroMissing, 1)
        XCTAssertTrue(plan.summary.contains("Heroes missing: 1"))
    }

    func testBatchChunkingByCount() throws {
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 2
        config.maxBatchBytes = .max                    // isolate the count rule
        let plan = try makeSink(MockDatabase(), config: config).makePlan()
        // 5 records, ≤2 per batch, single zone ⇒ 3 batches (2,2,1).
        XCTAssertEqual(plan.batchCount, 3)
        XCTAssertTrue(plan.batches.allSatisfy { $0.recordCount <= 2 })
        XCTAssertEqual(plan.batches.map(\.recordCount).reduce(0, +), 5)
    }

    func testBatchChunkingByBytesAndOversizedRecord() throws {
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000               // isolate the byte rule
        config.maxBatchBytes = 5                        // "jpeg-bytes" = 10 bytes > cap
        let plan = try makeSink(MockDatabase(), config: config).makePlan()
        // Every asset-bearing record exceeds the 5-byte cap ⇒ each forms its own batch, and
        // zero-byte records coalesce until an asset record forces a split. No batch exceeds the
        // cap unless it is a single record.
        for batch in plan.batches where batch.recordCount > 1 {
            XCTAssertLessThanOrEqual(batch.assetBytes, config.maxBatchBytes,
                                     "multi-record batches must respect the byte cap")
        }
        XCTAssertEqual(plan.batches.map(\.recordCount).reduce(0, +), plan.recordCount)
    }

    // MARK: - Execute (happy path + idempotency)

    func testDryRunPerformsNoDatabaseWork() async throws {
        // NullDatabase throws on any call; a dry-run must never call it.
        let sink = CloudKitImportSink.fromBundle(
            database: NullDatabase(), bundle: try makeBundle(),
            mediaResolver: MediaResolver(root: try makeMediaRoot()), sleep: { _ in })
        let report = await sink.execute(dryRun: true)
        XCTAssertTrue(report.dryRun)
        XCTAssertEqual(report.zonesCreated, 0)
        XCTAssertEqual(report.recordsSaved, 0)
        XCTAssertEqual(report.plan.recordCount, 5)
        XCTAssertEqual(report.photosSkippedMissingMedia, 1)
        XCTAssertTrue(report.failures.isEmpty)
    }

    func testExecuteUploadsAllZonesAndRecords() async throws {
        let mock = MockDatabase()
        let sink = try makeSink(mock)
        let report = await sink.execute(dryRun: false)

        XCTAssertEqual(report.zonesCreated, 1)
        XCTAssertEqual(report.recordsSaved, 5)
        XCTAssertTrue(report.succeeded)
        XCTAssertEqual(mock.lastSavePolicy, .allKeys, "initial migration = imported-data-wins overwrite")

        // Zone + recordNames = original UUIDs.
        XCTAssertNotNil(mock.savedZones[CKRecordZone.ID(zoneName: "journey-J1", ownerName: CKCurrentUserDefaultName)])
        let names = Set(mock.savedRecords.keys.map(\.recordName))
        XCTAssertEqual(names, ["J1", "W1", "W2", "P1", "P2"])
        // Everything lands in the journey zone.
        XCTAssertTrue(mock.savedRecords.keys.allSatisfy { $0.zoneID.zoneName == "journey-J1" })
    }

    func testReRunIsIdempotentNoDuplicates() async throws {
        let mock = MockDatabase()
        let sink = try makeSink(mock)
        _ = await sink.execute(dryRun: false)
        let firstCount = mock.savedRecords.count

        // Re-run through a fresh sink over the same mock (imported-data-wins overwrite).
        let sink2 = try makeSink(mock)
        let report2 = await sink2.execute(dryRun: false)

        XCTAssertEqual(mock.savedRecords.count, firstCount, "re-run overwrites by recordName — no duplicates")
        XCTAssertEqual(report2.recordsSaved, 5)
        XCTAssertEqual(Set(mock.savedRecords.keys.map(\.recordName)), ["J1", "W1", "W2", "P1", "P2"])
    }

    func testMissingMediaSkippedAndReported() async throws {
        let mock = MockDatabase()
        let report = await (try makeSink(mock)).execute(dryRun: false)
        XCTAssertEqual(report.photosSkippedMissingMedia, 1)
        XCTAssertEqual(report.plan.missingMedia.map(\.photoID), ["P3"])
        XCTAssertFalse(mock.savedRecords.keys.contains { $0.recordName == "P3" }, "P3 must never be uploaded")
        XCTAssertEqual(report.thumbsMissing, 1)   // P2 uploaded without its thumbnail
    }

    // MARK: - Retry / partial failure

    func testLimitExceededHalvesBatch() async throws {
        let mock = MockDatabase()
        // Throw limitExceeded whenever a batch has >2 records; the halves (≤2) succeed.
        mock.responder = { _, records in
            records.count > 2 ? .throwError(self.ckError(.limitExceeded)) : .ok
        }
        // One big batch of all 5 records.
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)

        XCTAssertEqual(report.recordsSaved, 5, "all records saved after splitting")
        XCTAssertTrue(report.failures.isEmpty)
        // 1 failed big op + splits: 5 -> (2,3) -> 3 splits to (1,2). Calls: big(5), (2)ok,
        // (3)fail, (1)ok, (2)ok = 5 calls. Assert it split at least once.
        XCTAssertGreaterThanOrEqual(mock.modifyRecordsCallCount, 3)
    }

    func testTransientErrorBacksOffAndRetries() async throws {
        let mock = MockDatabase()
        // First upload call fails transiently; the retry succeeds.
        mock.responder = { index, _ in
            index == 0 ? .throwError(self.ckError(.serviceUnavailable, retryAfter: 0.01)) : .ok
        }
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)

        XCTAssertEqual(report.recordsSaved, 5)
        XCTAssertTrue(report.succeeded)
        XCTAssertEqual(mock.modifyRecordsCallCount, 2, "one failure + one successful retry")
    }

    func testZoneCreationBacksOffOnBusy() async throws {
        let mock = MockDatabase()
        mock.zoneErrors = [ckError(.zoneBusy, retryAfter: 0.01)]   // fail once, then succeed
        let report = await (try makeSink(mock)).execute(dryRun: false)
        XCTAssertEqual(report.zonesCreated, 1)
        XCTAssertEqual(mock.modifyZonesCallCount, 2)
        XCTAssertEqual(report.recordsSaved, 5)
    }

    func testPartialFailureCollectsPermanentRetriesTransient() async throws {
        let mock = MockDatabase()
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        // Call 0: W1 hits a permanent error, W2 hits a transient one. Call 1 (retry of W2) ok.
        mock.responder = { index, _ in
            guard index == 0 else { return .ok }
            return .perRecordFailures([
                "W1": self.ckError(.invalidArguments),
                "W2": self.ckError(.serviceUnavailable, retryAfter: 0.01),
            ])
        }
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)

        XCTAssertEqual(report.failures.map(\.recordName), ["W1"], "permanent failure collected")
        XCTAssertEqual(report.failures.first?.recordType, "Waypoint")
        XCTAssertTrue(mock.savedRecords.keys.contains { $0.recordName == "W2" }, "transient failure retried & saved")
        XCTAssertFalse(mock.savedRecords.keys.contains { $0.recordName == "W1" })
        XCTAssertEqual(report.recordsSaved, 4)  // 5 planned − W1
    }

    func testThrownPartialFailureIsUnpacked() async throws {
        let mock = MockDatabase()
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        // Throw a classic CKError.partialFailure carrying one permanent per-item error (P1).
        mock.responder = { index, records in
            guard index == 0 else { return .ok }
            let id = records.first { $0.recordID.recordName == "P1" }!.recordID
            let partial = CKError(.partialFailure, userInfo: [
                CKPartialErrorsByItemIDKey: [id: self.ckError(.invalidArguments)]
            ])
            return .throwError(partial)
        }
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)
        XCTAssertEqual(report.failures.map(\.recordName), ["P1"])
        XCTAssertEqual(report.recordsSaved, 4)
    }

    // MARK: - Network transients (a connectivity blip must not write off a batch)

    func testNetworkErrorsAreTreatedAsTransient() {
        let base = 0.5, cap = 30.0
        for code in [CKError.Code.networkUnavailable, .networkFailure, .serverResponseLost] {
            XCTAssertNotNil(CloudKitImportSink.transientRetryDelay(ckError(code), attempt: 0, base: base, cap: cap),
                            "\(code) must be retryable")
        }
        // Bare URLError (URLSession-level drop).
        XCTAssertNotNil(CloudKitImportSink.transientRetryDelay(URLError(.notConnectedToInternet),
                                                               attempt: 0, base: base, cap: cap))
        XCTAssertNotNil(CloudKitImportSink.transientRetryDelay(URLError(.networkConnectionLost),
                                                               attempt: 0, base: base, cap: cap))
        // A CKError wrapping a URLError (CloudKit often does not map it).
        let wrapped = CKError(.internalError, userInfo: [NSUnderlyingErrorKey: URLError(.timedOut)])
        XCTAssertNotNil(CloudKitImportSink.transientRetryDelay(wrapped, attempt: 0, base: base, cap: cap))
        // Still permanent.
        XCTAssertNil(CloudKitImportSink.transientRetryDelay(ckError(.invalidArguments), attempt: 0, base: base, cap: cap))
        XCTAssertNil(CloudKitImportSink.transientRetryDelay(URLError(.badURL), attempt: 0, base: base, cap: cap))
        // Backoff stays bounded by the cap.
        XCTAssertEqual(CloudKitImportSink.backoff(attempt: 20, base: base, cap: cap), cap)
    }

    func testNetworkBlipMidUploadIsRetriedNotWrittenOff() async throws {
        let mock = MockDatabase()
        // A connectivity drop on the first upload op; the retry succeeds.
        mock.responder = { index, _ in
            index == 0 ? .throwError(self.ckError(.networkUnavailable, retryAfter: 0.01)) : .ok
        }
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)

        XCTAssertEqual(report.recordsSaved, 5, "a network blip must not write off the whole batch")
        XCTAssertTrue(report.succeeded)
        XCTAssertEqual(mock.modifyRecordsCallCount, 2)
    }

    func testPerRecordNetworkFailureIsRetried() async throws {
        let mock = MockDatabase()
        var config = CloudKitImportConfig.default
        config.maxRecordsPerBatch = 1000
        config.maxBatchBytes = .max
        mock.responder = { index, _ in
            guard index == 0 else { return .ok }
            return .perRecordFailures(["P1": self.ckError(.networkFailure)])
        }
        let report = await (try makeSink(mock, config: config)).execute(dryRun: false)
        XCTAssertTrue(report.failures.isEmpty)
        XCTAssertEqual(report.recordsSaved, 5)
        XCTAssertTrue(mock.savedRecords.keys.contains { $0.recordName == "P1" })
    }

    // MARK: - Zone creation failures

    func testPerZoneCreationFailureIsReported() async throws {
        let mock = MockDatabase()
        mock.zoneSaveFailures = ["journey-J1": ckError(.permissionFailure)]
        let report = await (try makeSink(mock)).execute(dryRun: false)

        XCTAssertEqual(report.zonesCreated, 0)
        let zoneFailure = report.failures.first { $0.recordType == "CKRecordZone" }
        XCTAssertNotNil(zoneFailure, "a per-zone .failure result must reach the report")
        XCTAssertEqual(zoneFailure?.zoneName, "journey-J1")
        XCTAssertFalse(report.succeeded)
        // Records in that zone are surfaced with the real cause, not a misleading zoneNotFound.
        XCTAssertEqual(report.recordsSaved, 0)
        XCTAssertEqual(mock.modifyRecordsCallCount, 0, "no upload attempted into a zone that failed")
        XCTAssertTrue(report.failures.contains { $0.recordName == "P1" && $0.message.contains("could not be created") })
    }

    // MARK: - Temp route assets

    func testRealRunPurgesRouteAssetTempFilesWhenDone() async throws {
        let mock = MockDatabase()
        let report = await (try makeSink(mock)).execute(dryRun: false)
        XCTAssertTrue(report.succeeded)
        let leftovers = (try? FileManager.default.contentsOfDirectory(
            at: RecordCoder.routeAssetDirectory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertTrue(leftovers.isEmpty, "route-asset temp files must not accumulate after a run")
    }

    // MARK: - Real-run gating + sync interlock

    @MainActor
    func testRealRunIsUnavailableWithoutTheCloudKitBuild() {
        let vm = CloudKitImportViewModel()
        #if AKASHIC_CLOUDKIT_BUILD
        XCTAssertTrue(vm.realRunAvailable)
        #else
        // The default (unentitled) build must never be able to reach a CKContainer — constructing
        // one traps (SIGTRAP). No runtime flag may arm this button.
        XCTAssertFalse(vm.realRunAvailable)
        XCTAssertFalse(vm.canStartRealImport)
        XCTAssertNotNil(vm.realRunBlockedReason)
        vm.runRealImport(bundlePath: "/nonexistent", mediaRoot: "/nonexistent")
        XCTAssertFalse(vm.isRunning)
        XCTAssertEqual(vm.statusMessage,
                       "Real import requires the Debug-CloudKit / Release-CloudKit build (entitlements + signing).")
        #endif
    }

    @MainActor
    func testRealRunRefusesWhileSyncEngineIsRunning() {
        let vm = CloudKitImportViewModel()
        vm.syncEngineIsLive = { true }
        XCTAssertTrue(vm.blockedByLiveSync)
        XCTAssertFalse(vm.canStartRealImport)
        vm.runRealImport(bundlePath: "/nonexistent", mediaRoot: "/nonexistent")
        XCTAssertFalse(vm.isRunning, "the importer must never write the private DB alongside CKSyncEngine")
        #if AKASHIC_CLOUDKIT_BUILD
        // In an unentitled build the (stricter) build gate reports first; here the interlock is
        // the only thing standing between the importer and a concurrent second writer.
        XCTAssertTrue(vm.statusMessage?.contains("CloudKit sync is running") == true)
        #endif
    }

    @MainActor
    func testDryRunIsAllowedWhileSyncIsRunning() {
        // The interlock guards writes only — the dry-run touches nothing.
        let vm = CloudKitImportViewModel()
        vm.syncEngineIsLive = { true }
        XCTAssertTrue(vm.blockedByLiveSync)
        vm.computePlan(bundlePath: "/nonexistent-bundle", mediaRoot: "/nonexistent-media")
        XCTAssertTrue(vm.isRunning, "dry-run starts regardless of the sync interlock")
        vm.cancel()
    }

    // MARK: - Cancellation

    // QUA-08: `@MainActor` so the `Task { }` below inherits this method's isolation instead of
    // starting a new region. `CloudKitImportSink` is a non-Sendable final class, so handing it to a
    // `Task` from a nonisolated context is a region transfer the compiler cannot prove is safe —
    // and it is right to ask, even though nothing here touches `sink` after the task is created.
    // Inheriting the isolation removes the crossing rather than asserting it is fine.
    @MainActor
    func testCancellationStopsBeforeUploading() async throws {
        let mock = MockDatabase()
        let sink = try makeSink(mock)
        let task = Task { await sink.execute(dryRun: false) }
        task.cancel()                    // cancel before the child task starts its work
        let report = await task.value
        XCTAssertTrue(report.wasCancelled)
        XCTAssertEqual(report.recordsSaved, 0)
    }

    // MARK: - Filesystem-gated: the REAL family export

    private static let realExportRoot = URL(fileURLWithPath: "/Users/cher/Privat/AkashicExport-20260722")
    private func realExportAvailable() -> Bool {
        FileManager.default.fileExists(
            atPath: Self.realExportRoot.appendingPathComponent("supabase/journeys.json").path)
    }

    func testRealExportPlanNumbers() throws {
        try XCTSkipUnless(realExportAvailable(), "Real export not present; skipping integration test")
        let sink = try CloudKitImportSink.fromExport(
            database: NullDatabase(),
            exportRoot: Self.realExportRoot,
            mediaRoot: Self.realExportRoot.appendingPathComponent("r2/objects"))
        let plan = sink.makePlan()

        XCTAssertEqual(plan.zoneCount, 3)
        XCTAssertEqual(plan.journeyCount, 3)
        XCTAssertEqual(plan.waypointCount, 18)
        XCTAssertEqual(plan.photoCount, 1538)
        XCTAssertEqual(plan.recordCount, 3 + 18 + 1538)          // 1559
        XCTAssertEqual(plan.thumbsMissing, 9)
        // The DB hero paths (`/hero-images/<slug>-hero.png`) do not exist in R2; the bytes are at
        // `journeys/<slug>/hero.png`. All three must resolve — they were silently dropped before.
        XCTAssertEqual(plan.heroAssetCount, 3)
        XCTAssertEqual(plan.heroMissing, 0)
        XCTAssertEqual(plan.missingMedia.count, 0, "every photo has at least its original on disk")
        XCTAssertEqual(plan.originalAssetCount, 1538)
        XCTAssertGreaterThan(plan.totalAssetBytes, 5_000_000_000, "referenced original+thumb bytes")

        print("REAL CK IMPORT PLAN →\n\(plan.summary)")
    }
}
