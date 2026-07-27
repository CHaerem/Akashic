import Foundation
import CoreData

/// Bridges local Core Data writes to the sync engine with **minimal coupling**: it observes
/// the view context's `NSManagedObjectContextDidSave` notification and forwards the inserted /
/// updated / deleted objects as `LocalChange`s. Core Data's own save notification IS the
/// "persistence posts change events" channel — so none of `PersistenceController`'s write
/// methods needed editing.
///
/// Echo suppression: while the store is applying fetched server changes
/// (`isApplyingRemoteChanges`), saves are ignored so server data does not bounce straight back
/// up. The notification is delivered synchronously (`queue: nil`) on the saving thread (the
/// main-queue view context), so the flag — cleared only after the remote-apply save returns —
/// reliably filters that save.
@MainActor
final class SyncScheduler {
    /// One engine per database scope (private + shared). Every change is offered to both;
    /// each ignores the journeys the other owns (`AkashicSyncEngine.handles(journeyID:)`), so
    /// an edit to a journey shared with us routes to the shared database and ours do not.
    private let engines: [WeakEngine]
    private let isApplyingRemoteChanges: () -> Bool
    /// QUA-08: an `ObserverToken` rather than a bare `NSObjectProtocol?`. A `@MainActor` type's
    /// `deinit` is nonisolated and may not READ its isolated stored properties — but it may destroy
    /// them, so the `removeObserver` call moves into the token's own deinit.
    private var observer: ObserverToken?

    /// Holder so the scheduler keeps the same non-owning reference semantics it had with a
    /// single `weak var` — `PersistenceController` owns the engines.
    private final class WeakEngine {
        weak var engine: AkashicSyncEngine?
        init(_ engine: AkashicSyncEngine) { self.engine = engine }
    }

    /// Owns the `NSManagedObjectContextDidSave` token and removes it when released.
    ///
    /// Deliberately NOT `@MainActor`: its deinit touches only its own storage, and
    /// `NotificationCenter.removeObserver` is thread-safe, so it is correct on whichever thread
    /// releases the scheduler. Nothing else can reach the token at that point, so no race exists.
    private final class ObserverToken {
        private let token: NSObjectProtocol
        init(_ token: NSObjectProtocol) { self.token = token }
        deinit { NotificationCenter.default.removeObserver(token) }
    }

    convenience init(context: NSManagedObjectContext,
                     engine: AkashicSyncEngine,
                     isApplyingRemoteChanges: @escaping () -> Bool) {
        self.init(context: context, engines: [engine], isApplyingRemoteChanges: isApplyingRemoteChanges)
    }

    init(context: NSManagedObjectContext,
         engines: [AkashicSyncEngine],
         isApplyingRemoteChanges: @escaping () -> Bool) {
        self.engines = engines.map(WeakEngine.init)
        self.isApplyingRemoteChanges = isApplyingRemoteChanges
        observer = ObserverToken(NotificationCenter.default.addObserver(
            forName: .NSManagedObjectContextDidSave,
            object: context,
            queue: nil) { [weak self] note in
                // `queue: nil` delivers this SYNCHRONOUSLY on the saving thread, and the saving
                // context is the main-queue view context — which is exactly what `assumeIsolated`
                // asserts, and traps on if that ever stops being true. `Notification` is not
                // Sendable because its `userInfo` carries `Set<NSManagedObject>`, and those have to
                // be read on the main queue anyway, so there is nothing worth extracting at the
                // boundary. QUA-08: the `nonisolated(unsafe)` capture is what the annotation below
                // documents rather than hides.
                nonisolated(unsafe) let note = note
                MainActor.assumeIsolated { self?.handleSave(note) }
            })
    }

    private func handleSave(_ note: Notification) {
        guard !isApplyingRemoteChanges() else { return }
        let info = note.userInfo ?? [:]
        let inserted = (info[NSInsertedObjectsKey] as? Set<NSManagedObject>) ?? []
        let updated  = (info[NSUpdatedObjectsKey]  as? Set<NSManagedObject>) ?? []
        let deleted  = (info[NSDeletedObjectsKey]  as? Set<NSManagedObject>) ?? []

        var changes: [LocalChange] = []
        for object in inserted.union(updated) {
            if let change = Self.localChange(for: object, kind: .save) { changes.append(change) }
        }
        for object in deleted {
            if let change = Self.localChange(for: object, kind: .delete) { changes.append(change) }
        }
        guard !changes.isEmpty else { return }
        for holder in engines { holder.engine?.localStoreDidChange(changes) }
    }

    /// Map a managed object to a `LocalChange`.
    ///
    /// Caveat (documented): deleted objects are read best-effort from the did-save
    /// notification, where their last attribute values are still available. If a delete ever
    /// arrives faulted, a coarser fallback (delete the whole zone) would be needed — a
    /// live-test refinement, not required for the foundation.
    static func localChange(for object: NSManagedObject, kind: LocalChange.Kind) -> LocalChange? {
        switch object.entity.name {
        case "CDJourney":
            guard let id = object.value(forKey: "id") as? String else { return nil }
            return LocalChange(kind: kind, recordType: RecordCoder.RecordType.journey,
                               recordName: id, journeyID: id)
        case "CDWaypoint":
            guard let id = object.value(forKey: "id") as? String,
                  let journeyID = object.value(forKey: "journeyId") as? String else { return nil }
            return LocalChange(kind: kind, recordType: RecordCoder.RecordType.waypoint,
                               recordName: id, journeyID: journeyID)
        case "CDPhoto":
            guard let id = object.value(forKey: "id") as? String,
                  let journeyID = object.value(forKey: "journeyId") as? String else { return nil }
            return LocalChange(kind: kind, recordType: RecordCoder.RecordType.photo,
                               recordName: id, journeyID: journeyID)
        case "CDDayComment":
            guard let id = object.value(forKey: "id") as? String,
                  let journeyID = object.value(forKey: "journeyId") as? String else { return nil }
            return LocalChange(kind: kind, recordType: RecordCoder.RecordType.dayComment,
                               recordName: id, journeyID: journeyID)
        default:
            return nil
        }
    }
}
