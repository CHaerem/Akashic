import Foundation
import CloudKit

/// CloudKit-backed `JourneySharingService`: zone-wide `CKShare`s, one per journey.
///
/// Every method needs a real `CKContainer`, which **traps** in a binary without the iCloud
/// entitlement — so the container is constructed only inside `#if AKASHIC_CLOUDKIT_BUILD`, and
/// in every other build these calls fail with `.notEntitled` instead of killing the app. Same
/// rule as `CloudKitAccountStatusProvider`; see the note there.
@MainActor
final class CloudKitJourneySharing: JourneySharingService {

    enum SharingError: LocalizedError, Equatable {
        case notEntitled
        case notShared
        case notOwner
        case unknownParticipant

        /// `errorDescription` is what the user reads in an alert when sharing fails, so every branch
        /// is localised (QUA-26) — this is the worst possible place to leave English.
        var errorDescription: String? {
            switch self {
            case .notEntitled:
                return String(localized: "This build cannot share journeys — rebuild with the CloudKit configuration.",
                              comment: "Sharing failure alert: the running build has no iCloud entitlement. Only reachable in a misconfigured build, never by a customer.")
            case .notShared:
                return String(localized: "This journey is not shared yet.",
                              comment: "Sharing failure alert: an operation needed an existing share and there is none.")
            case .notOwner:
                return String(localized: "Only the owner of a journey can manage who it is shared with.",
                              comment: "Sharing failure alert: the journey was shared with this user, so they cannot change its participants.")
            case .unknownParticipant:
                return String(localized: "That person is no longer part of this share.",
                              comment: "Sharing failure alert: the participant being changed or removed has already left the share.")
            }
        }
    }

    private let containerIdentifier: String
    /// Resolves a journey's zone owner, so a journey shared *with us* is looked up in the
    /// shared database under the owner's name rather than our own.
    private let zoneOwnerProvider: (String) -> String?

    init(containerIdentifier: String = Config.cloudKitContainerIdentifier,
         zoneOwnerProvider: @escaping (String) -> String?) {
        self.containerIdentifier = containerIdentifier
        self.zoneOwnerProvider = zoneOwnerProvider
    }

    // MARK: - JourneySharingService

    func shareState(forJourneyID journeyID: String) async throws -> JourneyShareState {
        #if AKASHIC_CLOUDKIT_BUILD
        let isOwner = zoneOwnerProvider(journeyID) == nil
        guard let share = try await fetchShare(forJourneyID: journeyID) else {
            return .notShared(journeyID: journeyID, isOwner: isOwner)
        }
        return state(from: share, journeyID: journeyID, isOwner: isOwner)
        #else
        throw SharingError.notEntitled
        #endif
    }

    func prepareShare(forJourneyID journeyID: String, title: String) async throws -> CKShare {
        #if AKASHIC_CLOUDKIT_BUILD
        guard zoneOwnerProvider(journeyID) == nil else { throw SharingError.notOwner }
        if let existing = try await fetchShare(forJourneyID: journeyID) { return existing }

        let share = CKShare(recordZoneID: zoneID(forJourneyID: journeyID))
        share[CKShare.SystemFieldKey.title] = title as CKRecordValue
        // Invitation-only. `.none` would let anyone with the link join, which is not what a
        // private family archive wants — the public showcase is a separate mirror (D9).
        share.publicPermission = .none

        let (results, _) = try await database(forJourneyID: journeyID)
            .modifyRecords(saving: [share], deleting: [])
        guard let saved = try results[share.recordID]?.get() as? CKShare else {
            throw SharingError.notShared
        }
        return saved
        #else
        throw SharingError.notEntitled
        #endif
    }

    func setRole(_ role: ShareRole, forParticipant participantID: String, journeyID: String) async throws {
        #if AKASHIC_CLOUDKIT_BUILD
        try await mutateShare(journeyID: journeyID) { share in
            guard let participant = Self.participant(participantID, in: share) else {
                throw SharingError.unknownParticipant
            }
            participant.permission = ShareRoleMapping.permission(for: role)
        }
        #else
        throw SharingError.notEntitled
        #endif
    }

    func removeParticipant(_ participantID: String, journeyID: String) async throws {
        #if AKASHIC_CLOUDKIT_BUILD
        try await mutateShare(journeyID: journeyID) { share in
            guard let participant = Self.participant(participantID, in: share) else {
                throw SharingError.unknownParticipant
            }
            share.removeParticipant(participant)
        }
        #else
        throw SharingError.notEntitled
        #endif
    }

    func stopSharing(forJourneyID journeyID: String) async throws {
        #if AKASHIC_CLOUDKIT_BUILD
        guard zoneOwnerProvider(journeyID) == nil else { throw SharingError.notOwner }
        // Delete the SHARE record, never the zone. Deleting the zone would destroy the owner's
        // own copy of the journey in CloudKit; deleting the share only withdraws everyone
        // else's access and leaves the journey private again.
        _ = try await database(forJourneyID: journeyID)
            .modifyRecords(saving: [], deleting: [shareRecordID(forJourneyID: journeyID)])
        #else
        throw SharingError.notEntitled
        #endif
    }

    // MARK: - Pure mapping (no container; exercised by tests via `state(from:)`)

    nonisolated func state(from share: CKShare, journeyID: String, isOwner: Bool) -> JourneyShareState {
        let currentUserID = share.currentUserParticipant?.userIdentity.userRecordID?.recordName
        let participants = share.participants.map { participant -> ShareParticipant in
            let identity = participant.userIdentity
            let components = identity.nameComponents
            let id = identity.userRecordID?.recordName ?? UUID().uuidString
            return ShareParticipant(
                id: id,
                displayName: ShareRoleMapping.displayName(
                    givenName: components?.givenName,
                    familyName: components?.familyName,
                    emailAddress: identity.lookupInfo?.emailAddress,
                    phoneNumber: identity.lookupInfo?.phoneNumber),
                role: ShareRoleMapping.role(participantRole: participant.role,
                                            permission: participant.permission),
                acceptance: ShareRoleMapping.acceptance(participant.acceptanceStatus),
                isCurrentUser: id == currentUserID)
        }
        return JourneyShareState(journeyID: journeyID,
                                 shareURL: share.url,
                                 participants: participants,
                                 isOwner: isOwner)
    }

    // MARK: - CloudKit plumbing

    #if AKASHIC_CLOUDKIT_BUILD
    private var container: CKContainer { CKContainer(identifier: containerIdentifier) }

    private func zoneID(forJourneyID journeyID: String) -> CKRecordZone.ID {
        RecordCoder.zoneID(forJourneyID: journeyID,
                           ownerName: zoneOwnerProvider(journeyID) ?? CKCurrentUserDefaultName)
    }

    /// A zone-wide share always lives at the reserved record name inside its own zone.
    private func shareRecordID(forJourneyID journeyID: String) -> CKRecord.ID {
        CKRecord.ID(recordName: CKRecordNameZoneWideShare, zoneID: zoneID(forJourneyID: journeyID))
    }

    private func database(forJourneyID journeyID: String) -> CKDatabase {
        zoneOwnerProvider(journeyID) == nil ? container.privateCloudDatabase : container.sharedCloudDatabase
    }

    /// The journey's share, or nil when it has never been shared. A missing share surfaces as
    /// `.unknownItem`, which is an expected answer here rather than an error.
    private func fetchShare(forJourneyID journeyID: String) async throws -> CKShare? {
        do {
            return try await database(forJourneyID: journeyID)
                .record(for: shareRecordID(forJourneyID: journeyID)) as? CKShare
        } catch let error as CKError where error.code == .unknownItem || error.code == .zoneNotFound {
            return nil
        }
    }

    /// Read-modify-write on the share. Always re-fetches first: the share record carries a
    /// change tag, and saving a stale copy loses whichever participant change landed in between.
    private func mutateShare(journeyID: String, _ mutate: (CKShare) throws -> Void) async throws {
        guard zoneOwnerProvider(journeyID) == nil else { throw SharingError.notOwner }
        guard let share = try await fetchShare(forJourneyID: journeyID) else {
            throw SharingError.notShared
        }
        try mutate(share)
        _ = try await database(forJourneyID: journeyID).modifyRecords(saving: [share], deleting: [])
    }

    private static func participant(_ id: String, in share: CKShare) -> CKShare.Participant? {
        share.participants.first { $0.userIdentity.userRecordID?.recordName == id }
    }
    #endif
}
