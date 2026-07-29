import XCTest
import CoreData
@testable import Akashic

/// Tests for the day-comments feature (web parity: `commentAPI` + `DayCommentsSection`).
/// Covers validation bounds, a full CRUD round-trip through an in-memory Core Data store,
/// `created_at`-ascending ordering, and the `isMine` author check.
@MainActor
final class CommentTests: XCTestCase {

    private let waypointID = "wp-1"
    private let journeyID = "jny-1"

    /// A fresh in-memory store + a service backed by an isolated `UserDefaults` suite, so the
    /// local author identity never touches (or leaks into) `.standard`.
    private func makeService(named suite: String = "akashic.comments.tests.\(UUID().uuidString)")
        -> (PersistenceController, CommentService, UserDefaults) {
        let controller = PersistenceController(mode: .fixtures, seed: false)
        let defaults = UserDefaults(suiteName: suite)!
        defaults.removePersistentDomain(forName: suite)
        let service = CommentService(persistence: controller, defaults: defaults)
        return (controller, service, defaults)
    }

    // MARK: - Validation bounds (0, 1, 2000, 2001)

    func testValidateRejectsEmpty() {
        XCTAssertThrowsError(try CommentService.validate("")) { error in
            XCTAssertEqual(error as? CommentService.ValidationError, .empty)
        }
    }

    func testValidateRejectsWhitespaceOnly() {
        XCTAssertThrowsError(try CommentService.validate("   \n\t  ")) { error in
            XCTAssertEqual(error as? CommentService.ValidationError, .empty)
        }
    }

    func testValidateAcceptsOneCharacter() throws {
        XCTAssertEqual(try CommentService.validate("a"), "a")
    }

    func testValidateTrimsSurroundingWhitespace() throws {
        XCTAssertEqual(try CommentService.validate("  hello  "), "hello")
    }

    func testValidateAcceptsExactly2000() throws {
        let text = String(repeating: "a", count: 2000)
        XCTAssertEqual(try CommentService.validate(text).count, 2000)
    }

    func testValidateRejects2001() {
        let text = String(repeating: "a", count: 2001)
        XCTAssertThrowsError(try CommentService.validate(text)) { error in
            XCTAssertEqual(error as? CommentService.ValidationError, .tooLong(max: 2000))
        }
    }

    func testMaxLengthMatchesWebParity() {
        XCTAssertEqual(CommentService.maxLength, 2000)
    }

    // MARK: - CRUD round-trip

    func testCreateReadUpdateDeleteRoundTrip() throws {
        let (_, service, _) = makeService()
        service.authorName = "Tester"

        // Create
        let created = try XCTUnwrap(
            try service.create(waypointID: waypointID, journeyID: journeyID, content: "  Hello world  "))
        XCTAssertEqual(created.content, "Hello world", "content is trimmed before storage")
        XCTAssertEqual(created.authorName, "Tester")
        XCTAssertEqual(created.waypointId, waypointID)
        XCTAssertEqual(created.journeyId, journeyID)
        XCTAssertTrue(created.isMine)
        XCTAssertFalse(created.wasEdited, "a freshly created comment is not marked edited")

        // Read
        let afterCreate = service.comments(forWaypoint: waypointID)
        XCTAssertEqual(afterCreate.count, 1)
        XCTAssertEqual(afterCreate.first?.id, created.id)

        // Update — bumps updatedAt so the row reads as edited
        let updated = try XCTUnwrap(try service.update(commentID: created.id, content: "Edited body"))
        XCTAssertEqual(updated.content, "Edited body")
        XCTAssertTrue(updated.wasEdited, "an updated comment is marked edited")
        XCTAssertGreaterThanOrEqual(updated.updatedAt, updated.createdAt)

        // Delete
        XCTAssertTrue(service.delete(commentID: created.id))
        XCTAssertTrue(service.comments(forWaypoint: waypointID).isEmpty)
        XCTAssertEqual(service.totalCommentCount, 0)
    }

    func testUpdateAndDeleteUnknownIdAreSafe() throws {
        let (_, service, _) = makeService()
        service.authorName = "Tester"
        XCTAssertNil(try service.update(commentID: "does-not-exist", content: "x"))
        XCTAssertFalse(service.delete(commentID: "does-not-exist"))
    }

    func testCreateRejectsInvalidContentBeforeWriting() {
        let (_, service, _) = makeService()
        service.authorName = "Tester"
        XCTAssertThrowsError(try service.create(waypointID: waypointID, journeyID: journeyID, content: "   "))
        XCTAssertEqual(service.totalCommentCount, 0, "invalid content must not create a row")
    }

    // MARK: - Ordering (created_at ascending, web parity)

    func testCommentsAreOrderedByCreatedAtAscending() throws {
        let (controller, service, _) = makeService()
        let base = Date(timeIntervalSince1970: 1_700_000_000)

        // Insert deliberately out of chronological order.
        controller.createComment(waypointID: waypointID, journeyID: journeyID,
                                 userID: "u", authorName: "A", content: "second",
                                 now: base.addingTimeInterval(60))
        controller.createComment(waypointID: waypointID, journeyID: journeyID,
                                 userID: "u", authorName: "A", content: "first",
                                 now: base)
        controller.createComment(waypointID: waypointID, journeyID: journeyID,
                                 userID: "u", authorName: "A", content: "third",
                                 now: base.addingTimeInterval(120))

        let ordered = service.comments(forWaypoint: waypointID)
        XCTAssertEqual(ordered.map(\.content), ["first", "second", "third"])
    }

    func testCommentsAreScopedToWaypoint() throws {
        let (controller, service, _) = makeService()
        controller.createComment(waypointID: "wp-a", journeyID: journeyID,
                                 userID: "u", authorName: "A", content: "a", now: Date())
        controller.createComment(waypointID: "wp-b", journeyID: journeyID,
                                 userID: "u", authorName: "A", content: "b", now: Date())
        XCTAssertEqual(service.comments(forWaypoint: "wp-a").map(\.content), ["a"])
        XCTAssertEqual(service.comments(forWaypoint: "wp-b").map(\.content), ["b"])
    }

    // MARK: - isMine

    func testIsMineDistinguishesLocalAuthorFromOthers() throws {
        let (controller, service, _) = makeService()
        service.authorName = "Me"

        // One comment authored locally (through the service) …
        _ = try service.create(waypointID: waypointID, journeyID: journeyID, content: "mine")
        // … and one authored by someone else (a different userId).
        controller.createComment(waypointID: waypointID, journeyID: journeyID,
                                 userID: "someone-else", authorName: "Meg", content: "theirs",
                                 now: Date().addingTimeInterval(1))

        let comments = service.comments(forWaypoint: waypointID)
        let mine = try XCTUnwrap(comments.first { $0.content == "mine" })
        let theirs = try XCTUnwrap(comments.first { $0.content == "theirs" })
        XCTAssertTrue(mine.isMine)
        XCTAssertFalse(theirs.isMine)
        XCTAssertEqual(theirs.authorName, "Meg", "stored authorDisplayName survives the round-trip")
    }

    func testLocalUserIdIsStableAcrossServiceInstances() {
        let suite = "akashic.comments.tests.stable.\(UUID().uuidString)"
        let (controller, service1, defaults) = makeService(named: suite)
        let id1 = service1.localUserId
        // A second service over the same defaults must resolve the same identity.
        let service2 = CommentService(persistence: controller, defaults: defaults)
        XCTAssertEqual(service2.localUserId, id1)
        defaults.removePersistentDomain(forName: suite)
    }

    // MARK: - Author identity

    func testAuthorNameStartsUnsetAndPersists() {
        let (_, service, _) = makeService()
        XCTAssertFalse(service.hasAuthorName)
        XCTAssertNil(service.authorName)
        service.authorName = "  Chris  "
        XCTAssertTrue(service.hasAuthorName)
        XCTAssertEqual(service.authorName, "Chris", "name is trimmed on write")
    }
}

/// QUA-86: comment identity must survive the same person's other devices. The per-install UUID
/// made your own comments read-only from your iPad; the fix prefers the CloudKit user record
/// name once resolved and migrates this install's own comments onto it through the normal write
/// path (so the change syncs). These tests cover the migration and the preference order; the
/// CKContainer fetch itself is CloudKit-gated and lands in SHIP-15's device session.
@MainActor
final class CommentIdentityTests: XCTestCase {

    private var bundle: Bundle { Bundle(for: type(of: self)) }

    private func makeDefaults() -> UserDefaults {
        UserDefaults(suiteName: "qua86-\(UUID().uuidString)")!
    }

    private func seeded() throws -> (PersistenceController, Journey) {
        let controller = PersistenceController(mode: .fixtures, seed: false, fixtureBundle: bundle)
        let journey = try FixtureLoader.load(named: "kilimanjaro", bundle: bundle)
        CoreDataMapping.upsertJourney(journey, into: controller.viewContext)
        try controller.viewContext.save()
        return (controller, journey)
    }

    func testLocalUserIdPrefersTheResolvedCloudIdentity() throws {
        let (controller, _) = try seeded()
        let defaults = makeDefaults()
        let service = CommentService(persistence: controller, defaults: defaults)

        let uuid = service.localUserId
        XCTAssertFalse(uuid.isEmpty)
        XCTAssertEqual(service.localUserId, uuid, "the per-install id is stable")

        defaults.set("_cloud-user-1", forKey: "akashic.comments.cloudUserId")
        XCTAssertEqual(service.localUserId, "_cloud-user-1",
                       "once resolved, the CloudKit user record name IS the identity")
    }

    func testReassignCommentAuthorMigratesOwnershipSoIsMineSurvivesDevices() throws {
        let (controller, journey) = try seeded()
        let camp = journey.camps[0]
        let created = try XCTUnwrap(controller.createComment(
            waypointID: camp.id, journeyID: journey.id,
            userID: "install-uuid", authorName: "Tester", content: "mine"))

        XCTAssertTrue(controller.reassignCommentAuthor(from: "install-uuid", to: "_cloud-user-1"))

        let asCloudUser = controller.loadComments(forWaypointID: camp.id, currentUserId: "_cloud-user-1")
        XCTAssertEqual(asCloudUser.first { $0.id == created.id }?.isMine, true,
                       "after migration the same person's comments are editable under the cloud id")
        let asOldInstall = controller.loadComments(forWaypointID: camp.id, currentUserId: "install-uuid")
        XCTAssertEqual(asOldInstall.first { $0.id == created.id }?.isMine, false,
                       "the stale per-install id no longer owns them")
    }

    func testReassignIsSafeToRetryAndHonestAboutFailure() throws {
        let (controller, journey) = try seeded()
        let camp = journey.camps[0]
        _ = try XCTUnwrap(controller.createComment(
            waypointID: camp.id, journeyID: journey.id,
            userID: "install-uuid", authorName: "Tester", content: "mine"))

        XCTAssertTrue(controller.reassignCommentAuthor(from: "install-uuid", to: "_cloud-user-1"))
        XCTAssertTrue(controller.reassignCommentAuthor(from: "install-uuid", to: "_cloud-user-1"),
                      "no rows left to migrate is success, not failure — the retry is idempotent")

        _ = try XCTUnwrap(controller.createComment(
            waypointID: camp.id, journeyID: journey.id,
            userID: "install-uuid-2", authorName: "Tester", content: "later"))
        // Poison the migration's own save (createComment saves directly, without the seam).
        controller.nextSaveErrorForTesting = NSError(domain: "qua86", code: 2)
        XCTAssertFalse(controller.reassignCommentAuthor(from: "install-uuid-2", to: "_cloud-user-2"),
                       "a failed migration save must be reported so the cloud id is not persisted")
        let unmigrated = controller.loadComments(forWaypointID: camp.id, currentUserId: "install-uuid-2")
        XCTAssertEqual(unmigrated.filter { $0.isMine }.count, 1,
                       "the rollback keeps the old ownership intact for the retry")
    }
}
