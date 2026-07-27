import Foundation
import CloudKit

/// Journey sharing (T2.8) — the family half of the migration.
///
/// ## Why the whole ZONE is shared, not the journey record
/// D3 is zone-per-journey, and a zone-wide `CKShare` (`CKShare(recordZoneID:)`) shares
/// everything in it: the journey root, its waypoints, its photos, its comments — including
/// records added *later*. The alternative, a hierarchical share rooted at the journey record,
/// would require every child to hold an owning `CKReference` back to the root, and that is
/// exactly the design we had to abandon during the import: CloudKit caps owning references at
/// roughly 750 per record and Kilimanjaro alone has 939 photos (see `apple/CloudKit/MAPPING.md`).
/// Zone-wide sharing has no such ceiling.
///
/// ## Roles
/// CloudKit expresses a participant's access as two separate values — a *role* (owner vs
/// invited user) and a *permission* (read-only vs read-write). The family only cares about
/// three outcomes, so `ShareRole` flattens them and `apply(to:)` converts back.

// MARK: - Domain types

/// What a participant may do with a shared journey.
enum ShareRole: String, CaseIterable, Equatable {
    /// Created the journey. Exactly one per share; cannot be changed or removed.
    case owner
    /// May add photos, comments and edits — everything except managing the share itself.
    case editor
    /// May read everything, change nothing.
    case viewer

    /// Row label and Picker option in the sharing sheet. Returns `String`, so it has to arrive
    /// already localised — the call site hands it to `Text(_:)`, which would render a bare literal
    /// verbatim (QUA-26). Keep these short: they sit in a trailing accessory next to a name.
    var displayName: String {
        switch self {
        case .owner:
            return String(localized: "Owner",
                          comment: "Sharing sheet: the participant who created the journey.")
        case .editor:
            return String(localized: "Can edit",
                          comment: "Sharing sheet: access level — may add photos, comments and edits.")
        case .viewer:
            return String(localized: "Can view",
                          comment: "Sharing sheet: access level — may read everything, change nothing.")
        }
    }

    /// Roles a participant can be *given*. `.owner` is not among them: ownership follows the
    /// zone, and CloudKit will not let it be handed over.
    static var assignable: [ShareRole] { [.editor, .viewer] }
}

/// Whether an invited person has actually joined yet.
enum ShareAcceptance: String, Equatable {
    case pending, accepted, removed, unknown
}

/// One person on a shared journey, in the terms the UI needs.
struct ShareParticipant: Identifiable, Equatable {
    /// The participant's user record name — stable, and what CloudKit matches on.
    let id: String
    /// Best available human name; falls back to the email/phone the invite was addressed to,
    /// and only then to a placeholder. A pending participant often has no name yet.
    let displayName: String
    let role: ShareRole
    let acceptance: ShareAcceptance
    /// True for the signed-in user — the row the UI must not offer to remove.
    let isCurrentUser: Bool

    /// Owners cannot be demoted or removed, and nobody may remove themselves through this UI
    /// (leaving a share is a different operation, handled by the system sheet).
    var isMutable: Bool { role != .owner && !isCurrentUser }
}

/// Everything the sharing UI needs about one journey.
struct JourneyShareState: Equatable {
    let journeyID: String
    /// nil when the journey has never been shared.
    let shareURL: URL?
    let participants: [ShareParticipant]
    /// True when the signed-in user owns the journey, i.e. may manage the share at all.
    let isOwner: Bool

    var isShared: Bool { shareURL != nil }

    static func notShared(journeyID: String, isOwner: Bool = true) -> JourneyShareState {
        JourneyShareState(journeyID: journeyID, shareURL: nil, participants: [], isOwner: isOwner)
    }
}

// MARK: - Seam

/// Seam over CloudKit sharing so the UI and its tests never touch a live container.
/// `CloudKitJourneySharing` is the real implementation; tests inject a fake.
@MainActor
protocol JourneySharingService: AnyObject {
    /// Current share state, or `.notShared` if the journey has never been shared.
    func shareState(forJourneyID journeyID: String) async throws -> JourneyShareState

    /// The share to hand to the system sharing sheet, creating it on first use.
    func prepareShare(forJourneyID journeyID: String, title: String) async throws -> CKShare

    /// Change one participant's access.
    func setRole(_ role: ShareRole, forParticipant participantID: String, journeyID: String) async throws

    /// Revoke one participant's access. Their local copy stays on their device — CloudKit only
    /// removes the mirror (see `AkashicSyncEngine.handleZoneDeletions`).
    func removeParticipant(_ participantID: String, journeyID: String) async throws

    /// Stop sharing entirely: deletes the share, leaving the journey private again.
    func stopSharing(forJourneyID journeyID: String) async throws
}

// MARK: - Role mapping (pure, unit-tested)

enum ShareRoleMapping {

    /// Flatten CloudKit's (role, permission) pair into the three cases the family cares about.
    /// An unknown permission is treated as read-only: the safe direction to guess is *less*
    /// access, never more.
    static func role(participantRole: CKShare.ParticipantRole,
                     permission: CKShare.ParticipantPermission) -> ShareRole {
        if participantRole == .owner { return .owner }
        return permission == .readWrite ? .editor : .viewer
    }

    /// The permission to write back for a role. `.owner` is not assignable, so it maps to
    /// read-write (the access an owner has anyway) rather than silently downgrading anyone.
    static func permission(for role: ShareRole) -> CKShare.ParticipantPermission {
        switch role {
        case .owner, .editor: return .readWrite
        case .viewer:         return .readOnly
        }
    }

    static func acceptance(_ status: CKShare.ParticipantAcceptanceStatus) -> ShareAcceptance {
        switch status {
        case .pending:  return .pending
        case .accepted: return .accepted
        case .removed:  return .removed
        case .unknown:  return .unknown
        @unknown default: return .unknown
        }
    }

    /// Best-effort human name for a participant.
    ///
    /// CloudKit fills in the real name only once the person has accepted *and* has chosen to
    /// share it; before that all we have is the address the invite went to. Showing the raw
    /// record name (a long opaque id) would be worse than useless in a family app, so the
    /// fallback chain ends at a plain placeholder.
    static func displayName(givenName: String?,
                            familyName: String?,
                            emailAddress: String?,
                            phoneNumber: String?) -> String {
        let name = [givenName, familyName]
            .compactMap { $0?.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if !name.isEmpty { return name }
        if let emailAddress, !emailAddress.isEmpty { return emailAddress }
        if let phoneNumber, !phoneNumber.isEmpty { return phoneNumber }
        return String(localized: "Invited",
                      comment: "Sharing sheet: placeholder name for a participant who has been invited but whose name CloudKit does not know yet.")
    }
}
