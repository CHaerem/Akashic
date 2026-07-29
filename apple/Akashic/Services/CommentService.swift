import CloudKit
import Foundation

/// Day-comments API for the native app — web parity with `src/lib/journeys/commentAPI.ts`
/// (see report-data-layer §1.9). Owns three things the Core Data layer deliberately does not:
///
///   1. **Validation** — the 1…2000 character rule the web `CommentInput` enforces.
///   2. **Local author identity** — a stable local user id + the "Your name" setting, both in
///      `UserDefaults`. The app has no signed-in user and no device-owner name available, and
///      the Settings screen is out of scope tonight, so the name is collected inline the first
///      time the user posts (see `DayCommentsSection`).
///   3. **`isMine` resolution** — comparing a comment's stored `userId` to the local user id.
///
/// Under CloudKit these roles change hands automatically: the author becomes the record's
/// system `creatorUserRecordID` (the `CKShare` participant identity), and `authorDisplayName`
/// is populated only for records migrated from Supabase — see CloudKit/MAPPING.md §7. This
/// service is the seam that lets the same UI work in both worlds.
@MainActor
final class CommentService {

    /// Thrown by `validate`/`create`/`update` when content is empty or over the limit.
    enum ValidationError: Error, Equatable {
        case empty
        case tooLong(max: Int)
    }

    /// Web parity: `CommentInput` caps content at 2000 characters.
    static let maxLength = 2000

    private let persistence: PersistenceController
    private let defaults: UserDefaults

    // Comment-scoped UserDefaults keys (namespaced so they never collide with other features).
    private static let localUserIdKey = "akashic.comments.localUserId"
    private static let authorNameKey = "akashic.comments.authorName"
    /// QUA-86: the resolved CloudKit user record name — the identity that is stable across the
    /// SAME person's devices, which the per-install UUID is not.
    private static let cloudUserIdKey = "akashic.comments.cloudUserId"

    init(persistence: PersistenceController, defaults: UserDefaults = .standard) {
        self.persistence = persistence
        self.defaults = defaults
        // QUA-86: resolve once per install (idempotent, silent when signed out or unentitled).
        Task { [weak self] in await self?.resolveCloudIdentityIfNeeded() }
    }

    // MARK: - Local author identity

    /// Stable local user id (generated once, then persisted). Locally this stands in for the
    /// CloudKit `creatorUserRecordID`, so `isMine` is meaningful before sync exists.
    var localUserId: String {
        // QUA-86: prefer the CloudKit user record name once resolved. The per-install UUID made
        // a person's OWN comments read-only from their other devices — the iPad saw the iPhone's
        // comments as someone else's, which multi-device beta households would report as data
        // loss within days. The UUID remains the offline/signed-out fallback.
        if let cloud = defaults.string(forKey: Self.cloudUserIdKey), !cloud.isEmpty {
            return cloud
        }
        if let existing = defaults.string(forKey: Self.localUserIdKey), !existing.isEmpty {
            return existing
        }
        let fresh = UUID().uuidString
        defaults.set(fresh, forKey: Self.localUserIdKey)
        return fresh
    }

    /// QUA-86: fetch the CloudKit user record name and migrate this install's own comments from
    /// the per-install UUID onto it — through the normal write path, so the change syncs and the
    /// same person's identity converges across their devices. Ordering matters: the key is only
    /// stored once the migration save succeeded, so a failure is retried on the next launch.
    func resolveCloudIdentityIfNeeded() async {
        #if AKASHIC_CLOUDKIT_BUILD
        guard persistence.mode == .cloudKit else { return }
        guard defaults.string(forKey: Self.cloudUserIdKey) == nil else { return }
        let legacyLocalId = localUserId   // capture BEFORE the cloud id takes precedence
        do {
            let container = CKContainer(identifier: Config.cloudKitContainerIdentifier)
            let recordID = try await container.userRecordID()
            let cloudId = recordID.recordName
            guard persistence.reassignCommentAuthor(from: legacyLocalId, to: cloudId) else { return }
            defaults.set(cloudId, forKey: Self.cloudUserIdKey)
        } catch {
            // Signed out or transient — the per-install UUID keeps working; retried next init.
        }
        #endif
    }

    /// The "Your name" setting, or `nil` until the user sets it. `nil` drives the inline
    /// first-comment name prompt in the UI.
    var authorName: String? {
        get {
            // QUA-86: iCloud key-value store first — the "Your name" typed on the iPhone should
            // greet the same person on their iPad. Entitled on Release builds
            // (ubiquity-kvstore-identifier); where the entitlement is absent (simulator, plain
            // Debug) KVS degrades to a local cache and the UserDefaults fallback still rules.
            let cloud = NSUbiquitousKeyValueStore.default.string(forKey: Self.authorNameKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if let cloud, !cloud.isEmpty { return cloud }
            let raw = defaults.string(forKey: Self.authorNameKey)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return (raw?.isEmpty == false) ? raw : nil
        }
        set {
            let trimmed = newValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let trimmed, !trimmed.isEmpty {
                defaults.set(trimmed, forKey: Self.authorNameKey)
                NSUbiquitousKeyValueStore.default.set(trimmed, forKey: Self.authorNameKey)
            } else {
                defaults.removeObject(forKey: Self.authorNameKey)
                NSUbiquitousKeyValueStore.default.removeObject(forKey: Self.authorNameKey)
            }
        }
    }

    /// True once the user has chosen a display name.
    var hasAuthorName: Bool { authorName != nil }

    // MARK: - Validation

    /// Web parity: content must be non-empty after trimming and at most `maxLength` characters.
    /// Returns the trimmed content on success. Empty/whitespace → `.empty`; `> maxLength` →
    /// `.tooLong`. (Bounds under test: 0 → empty, 1 → ok, 2000 → ok, 2001 → tooLong.)
    @discardableResult
    static func validate(_ content: String) throws -> String {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ValidationError.empty }
        guard trimmed.count <= maxLength else { throw ValidationError.tooLong(max: maxLength) }
        return trimmed
    }

    // MARK: - CRUD (web parity: commentAPI)

    /// Comments for a day/waypoint, oldest first (`created_at` ascending), each tagged `isMine`.
    func comments(forWaypoint waypointID: String) -> [DayComment] {
        persistence.loadComments(forWaypointID: waypointID, currentUserId: localUserId)
    }

    /// Create a comment authored by the local user. Validates 1…2000 chars and stamps the
    /// current "Your name" value (falling back to "Anonymous" if somehow unset).
    @discardableResult
    func create(waypointID: String, journeyID: String, content: String) throws -> DayComment? {
        let trimmed = try Self.validate(content)
        return persistence.createComment(
            waypointID: waypointID,
            journeyID: journeyID,
            userID: localUserId,
            authorName: authorName ?? "Anonymous",
            content: trimmed)
    }

    /// Update one of the local user's comments. Validates content and bumps `updatedAt`
    /// (which surfaces the "(edited)" marker). Returns nil for an unknown id.
    @discardableResult
    func update(commentID: String, content: String) throws -> DayComment? {
        let trimmed = try Self.validate(content)
        return persistence.updateComment(id: commentID, content: trimmed, currentUserId: localUserId)
    }

    /// Delete a comment by id. Returns false for an unknown id.
    @discardableResult
    func delete(commentID: String) -> Bool {
        persistence.deleteComment(id: commentID)
    }

    /// Total comments in the store (status display / tests).
    var totalCommentCount: Int { persistence.commentCount() }

    // MARK: - Demo seed (screenshots only)

    /// Seed a few illustrative comments on one day, behind the `AKASHIC_SEED_COMMENTS` env flag.
    /// Used only to populate `Docs/screenshot-comments.png`; a no-op for normal launches and
    /// idempotent (skips if the day already has comments). Seeds two "family" authors plus the
    /// local user, staggered in time, with one edited comment so the UI shows every state:
    /// author, relative timestamp, "(edited)" marker, and the owner's edit/delete affordance.
    func seedDemoCommentsIfRequested(waypointID: String,
                                     journeyID: String,
                                     environment env: [String: String] = ProcessInfo.processInfo.environment) {
        guard env["AKASHIC_SEED_COMMENTS"] != nil else { return }
        guard comments(forWaypoint: waypointID).isEmpty else { return }

        // Make sure one comment reads as "mine" so the edit/delete affordance is visible.
        if authorName == nil { authorName = "Chris" }
        let base = Date().addingTimeInterval(-6 * 3600)

        persistence.createComment(
            waypointID: waypointID, journeyID: journeyID,
            userID: "seed-meg", authorName: "Meg",
            content: "The sunrise from here was unreal — worth every step of the climb.",
            now: base)

        let edited = persistence.createComment(
            waypointID: waypointID, journeyID: journeyID,
            userID: "seed-dad", authorName: "Dad",
            content: "Refill water at the last stream before the ridge.",
            now: base.addingTimeInterval(1800))
        if let edited {
            persistence.updateComment(
                id: edited.id,
                content: "Refill water at the last stream before the ridge (it dries up by midday!).",
                currentUserId: localUserId,
                now: base.addingTimeInterval(3600))
        }

        persistence.createComment(
            waypointID: waypointID, journeyID: journeyID,
            userID: localUserId, authorName: authorName ?? "Chris",
            content: "Adding a few more photos tonight once we get signal.",
            now: base.addingTimeInterval(2 * 3600))
    }
}
