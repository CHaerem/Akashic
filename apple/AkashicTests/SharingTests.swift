import XCTest
import CloudKit
@testable import Akashic

/// T2.8 — journey sharing.
///
/// Two halves, both testable without a container: the pure role/participant mapping, and the
/// engine's zone routing (which database a journey belongs to, and how each engine behaves
/// differently there).
final class SharingRoleMappingTests: XCTestCase {

    func testOwnerRoleWinsRegardlessOfPermission() {
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .owner, permission: .readOnly), .owner)
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .owner, permission: .readWrite), .owner)
    }

    func testReadWriteIsEditorAndReadOnlyIsViewer() {
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .privateUser, permission: .readWrite), .editor)
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .privateUser, permission: .readOnly), .viewer)
    }

    /// An unreadable permission must never be guessed *upwards*: an unknown value granting
    /// edit access to the family archive is the one wrong answer that matters.
    func testUnknownPermissionFallsBackToViewer() {
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .privateUser, permission: .unknown), .viewer)
        XCTAssertEqual(ShareRoleMapping.role(participantRole: .privateUser, permission: .none), .viewer)
    }

    func testPermissionRoundTripsForAssignableRoles() {
        for role in ShareRole.assignable {
            let permission = ShareRoleMapping.permission(for: role)
            XCTAssertEqual(ShareRoleMapping.role(participantRole: .privateUser, permission: permission), role)
        }
    }

    func testOwnerIsNotOfferedAsAnAssignableRole() {
        XCTAssertFalse(ShareRole.assignable.contains(.owner))
    }

    func testDisplayNamePrefersRealNameThenEmailThenPhone() {
        XCTAssertEqual(ShareRoleMapping.displayName(givenName: "Ada", familyName: "Lovelace",
                                                    emailAddress: "ada@example.com", phoneNumber: nil),
                       "Ada Lovelace")
        XCTAssertEqual(ShareRoleMapping.displayName(givenName: nil, familyName: nil,
                                                    emailAddress: "ada@example.com", phoneNumber: "+4712345678"),
                       "ada@example.com")
        XCTAssertEqual(ShareRoleMapping.displayName(givenName: nil, familyName: nil,
                                                    emailAddress: nil, phoneNumber: "+4712345678"),
                       "+4712345678")
    }

    /// A pending invite typically has no name at all, and the raw user record name is an opaque
    /// id — showing it would be worse than a placeholder.
    func testDisplayNameFallsBackToPlaceholderRatherThanEmptyOrRecordName() {
        XCTAssertEqual(ShareRoleMapping.displayName(givenName: "  ", familyName: "",
                                                    emailAddress: "", phoneNumber: nil),
                       "Invited")
    }

    func testGivenNameOnlyIsEnough() {
        XCTAssertEqual(ShareRoleMapping.displayName(givenName: "Ada", familyName: nil,
                                                    emailAddress: nil, phoneNumber: nil),
                       "Ada")
    }

    // MARK: Participant mutability

    func testOwnerAndSelfRowsAreNotMutable() {
        XCTAssertFalse(participant(role: .owner, isCurrentUser: false).isMutable)
        XCTAssertFalse(participant(role: .editor, isCurrentUser: true).isMutable)
        XCTAssertTrue(participant(role: .editor, isCurrentUser: false).isMutable)
        XCTAssertTrue(participant(role: .viewer, isCurrentUser: false).isMutable)
    }

    func testNotSharedStateHasNoURLAndNoParticipants() {
        let state = JourneyShareState.notShared(journeyID: "j1")
        XCTAssertFalse(state.isShared)
        XCTAssertNil(state.shareURL)
        XCTAssertTrue(state.participants.isEmpty)
        XCTAssertTrue(state.isOwner)
    }

    private func participant(role: ShareRole, isCurrentUser: Bool) -> ShareParticipant {
        ShareParticipant(id: "u1", displayName: "Ada", role: role,
                         acceptance: .accepted, isCurrentUser: isCurrentUser)
    }
}

// MARK: - Zone routing between the two engines

@MainActor
final class SharedDatabaseRoutingTests: XCTestCase {

    private let sharingOwner = "_ownerRecordName"

    /// Every journey belongs to exactly one engine — otherwise both would try to sync it and
    /// the shared-database one would be writing into a zone it does not own.
    func testEachEngineHandlesOnlyItsOwnSideOfTheFence() {
        let store = FakeLocalStore()
        store.journeyIDs = ["mine", "theirs"]
        store.zoneOwners = ["theirs": sharingOwner]

        let privateEngine = makeEngine(store: store, scope: .private)
        let sharedEngine = makeEngine(store: store, scope: .shared)

        XCTAssertTrue(privateEngine.handles(journeyID: "mine"))
        XCTAssertFalse(privateEngine.handles(journeyID: "theirs"))
        XCTAssertFalse(sharedEngine.handles(journeyID: "mine"))
        XCTAssertTrue(sharedEngine.handles(journeyID: "theirs"))
    }

    /// A local edit to a journey shared with us must be addressed to the OWNER's zone. Sending
    /// it to a zone under our own name would silently miss the record entirely.
    func testEditToSharedJourneyIsRoutedToTheOwnersZone() async {
        let store = FakeLocalStore()
        store.zoneOwners = ["theirs": sharingOwner]
        let mock = MockSyncEngine()
        let engine = makeEngine(store: store, scope: .shared, engine: mock)
        await engine.activate()

        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.dayComment,
                        recordName: "c1", journeyID: "theirs")
        ])

        let zoneOwners = mock.pendingRecordZoneChanges.compactMap { change -> String? in
            if case .saveRecord(let id) = change { return id.zoneID.ownerName } else { return nil }
        }
        XCTAssertEqual(zoneOwners, [sharingOwner])
    }

    /// Participants never create zones: the zone is the owner's, and CloudKit rejects the write.
    func testSharedEngineDoesNotEnqueueZoneCreation() async {
        let store = FakeLocalStore()
        store.zoneOwners = ["theirs": sharingOwner]
        let mock = MockSyncEngine()
        let engine = makeEngine(store: store, scope: .shared, engine: mock)
        await engine.activate()

        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                        recordName: "theirs", journeyID: "theirs")
        ])

        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty,
                      "A participant must not try to save the owner's zone")
    }

    /// The private engine still creates zones for our own journeys — the guard above must not
    /// have disabled it everywhere.
    func testPrivateEngineStillEnqueuesZoneCreationForOurOwnJourney() async {
        let store = FakeLocalStore()
        let mock = MockSyncEngine()
        let engine = makeEngine(store: store, scope: .private, engine: mock)
        await engine.activate()

        engine.localStoreDidChange([
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                        recordName: "mine", journeyID: "mine")
        ])

        XCTAssertEqual(mock.pendingDatabaseChanges.count, 1)
    }

    /// A zone vanishing from the SHARED database means the owner revoked the share. Re-creating
    /// it is impossible and would have CKSyncEngine retrying a rejected write forever — while
    /// the local copy must survive untouched either way.
    func testRevokedShareDoesNotResurrectTheZoneAndKeepsLocalData() async {
        let store = FakeLocalStore()
        store.zoneOwners = ["theirs": sharingOwner]
        store.identities["theirs"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                        recordName: "theirs", journeyID: "theirs")
        ]
        let mock = MockSyncEngine()
        let engine = makeEngine(store: store, scope: .shared, engine: mock)
        await engine.activate()

        engine.handleZoneDeletions(
            [RecordCoder.zoneID(forJourneyID: "theirs", ownerName: sharingOwner)], reason: .deleted)

        XCTAssertTrue(mock.pendingDatabaseChanges.isEmpty)
        XCTAssertTrue(mock.pendingRecordZoneChanges.isEmpty)
        XCTAssertTrue(store.deletedRecords.isEmpty, "Losing access must never delete local data")
    }

    /// Same event in the PRIVATE database is the pre-existing protective behaviour: re-establish
    /// the mirror rather than accept the loss.
    func testPrivateZoneDeletionStillRebuildsTheMirror() async {
        let store = FakeLocalStore()
        store.identities["mine"] = [
            LocalChange(kind: .save, recordType: RecordCoder.RecordType.journey,
                        recordName: "mine", journeyID: "mine")
        ]
        let mock = MockSyncEngine()
        let engine = makeEngine(store: store, scope: .private, engine: mock)
        await engine.activate()

        engine.handleZoneDeletions(
            [RecordCoder.zoneID(forJourneyID: "mine")], reason: .deleted)

        XCTAssertEqual(mock.pendingDatabaseChanges.count, 1)
        XCTAssertEqual(mock.savedRecordNames, ["mine"])
        XCTAssertTrue(store.deletedRecords.isEmpty)
    }

    /// The two engines keep separate state files. Sharing one would have each overwrite the
    /// other's change tokens, and a restored engine would resume from the wrong database.
    func testStateFileIsPerDatabaseScope() {
        let privateURL = AkashicSyncEngine.stateURL(scope: .private)
        let sharedURL = AkashicSyncEngine.stateURL(scope: .shared)
        XCTAssertNotNil(privateURL)
        XCTAssertNotEqual(privateURL, sharedURL)
        // The private scope must keep the original filename so existing installs restore their
        // state instead of silently re-fetching the entire archive.
        XCTAssertEqual(privateURL?.lastPathComponent, "cksyncengine-state.json")
    }

    private func makeEngine(store: SyncLocalStore,
                            scope: CKDatabase.Scope,
                            engine: SyncEngineProtocol? = nil) -> AkashicSyncEngine {
        AkashicSyncEngine(store: store,
                          status: SyncStatus(),
                          accountProvider: MockAccountProvider(status: .available),
                          databaseScope: scope,
                          defaults: UserDefaults(suiteName: "sharing-tests-\(UUID().uuidString)")!,
                          engine: engine)
    }
}
