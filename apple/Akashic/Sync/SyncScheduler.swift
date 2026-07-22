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
    private weak var engine: AkashicSyncEngine?
    private let isApplyingRemoteChanges: () -> Bool
    private var observer: NSObjectProtocol?

    init(context: NSManagedObjectContext,
         engine: AkashicSyncEngine,
         isApplyingRemoteChanges: @escaping () -> Bool) {
        self.engine = engine
        self.isApplyingRemoteChanges = isApplyingRemoteChanges
        observer = NotificationCenter.default.addObserver(
            forName: .NSManagedObjectContextDidSave,
            object: context,
            queue: nil) { [weak self] note in
                MainActor.assumeIsolated { self?.handleSave(note) }
            }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
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
        engine?.localStoreDidChange(changes)
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
