# CloudKit sync — live verification (T2.4)

First end-to-end verification of the `CKSyncEngine` layer against the real
`iCloud.no.akashic` **Development** container, on a Simulator signed into
chris.haerem@gmail.com. Everything below is observed evidence, not reasoning.

- Date: 2026-07-22
- Device: iPhone 17 Pro Simulator, `5B09400C-4865-4044-8398-5BB050B762C9`
- Build: `Debug-CloudKit` (`AKASHIC_CLOUDKIT_BUILD`), launched with
  `AKASHIC_CLOUDKIT=1` and `AKASHIC_SYNC_LOG=1`
- Container contents before the test: 3 custom zones, 3 Journey / 18 Waypoint /
  1538 Photo records — written earlier by `Import/CloudKitImportSink` using direct
  `CKDatabase` writes, i.e. **outside** `CKSyncEngine`, so the engine's persisted
  state knew nothing about them.

## Result

| Direction | Status |
|---|---|
| Down (server → new local store) | **Works.** A clean install ends with 3 journeys / 18 waypoints / 1538 photos + 3067 media files (~5 GB), all visible in the UI. |
| Up (local edit → server) | **Works.** As first verified it cost one wasted round-trip on every record's first save (the code-14 conflict, gotcha 5); that has since been fixed by persisting each record's encoded system fields — pending live re-verification (gotcha 5). |
| Zone deletion / conflict / account switching | Unit-tested only. Not exercised live. |

## How to reproduce

```sh
cd apple
UDID=5B09400C-4865-4044-8398-5BB050B762C9
xcodebuild -project Akashic.xcodeproj -scheme Akashic -configuration Debug-CloudKit \
  -destination "platform=iOS Simulator,id=$UDID" build
APP=~/Library/Developer/Xcode/DerivedData/Akashic-*/Build/Products/Debug-CloudKit-iphonesimulator/Akashic.app
xcrun simctl terminate $UDID no.akashic.app; xcrun simctl uninstall $UDID no.akashic.app
xcrun simctl install $UDID "$APP"
SIMCTL_CHILD_AKASHIC_CLOUDKIT=1 SIMCTL_CHILD_AKASHIC_SYNC_LOG=1 \
  xcrun simctl launch $UDID no.akashic.app
```

Read the event stream in another shell:

```sh
xcrun simctl spawn $UDID log stream \
  --predicate 'subsystem == "no.akashic.app"' --style compact
```

Always pass the UDID explicitly — a second Simulator is often booted on this machine,
and it will silently take the command otherwise.

## Diagnostics

`Sync/SyncLog.swift` logs the whole `CKSyncEngine` event stream (which events fire and
with what counts), the activation pull, every send failure with its `CKError` code, and
every remote-apply save. It is **kept, not removed**, but is off unless
`AKASHIC_SYNC_LOG=1` is set — this layer is undebuggable from the UI (the engine drives
itself, all the interesting work is in delegate callbacks, and the failure mode is
"nothing happens"), and two of the three bugs below were only findable from these logs.
`SyncLog.error` always logs: those lines are rare and always actionable.

## What actually broke

### 1. The app was crashing mid-pull — every clean install

The symptom was "status says Syncing, 0 records land". The log showed the engine
starting, `willFetchChanges` firing, and then nothing at all:

```
activate: fetchChanges() starting
event: accountChange(signIn(currentUser: <CKRecordID: …>))
event: willFetchChanges
activate: accountStatus=1 state=true      <- activate() running a SECOND time
activate: fetchChanges() starting
CloudKit/CKSyncEngine.swift:293: Fatal error: BUG IN CLIENT OF CLOUDKIT: Cannot await a
call into CKSyncEngine from within a delegate callback if that function will end up
calling back into the delegate. … Try performing this in a detached Task.
```

`CKSyncEngine` posts an `.accountChange(.signIn)` immediately after it starts on an
already signed-in device — i.e. on *every ordinary launch*, while `activate()` is still
in flight. The handler treated that as a real sign-in and re-entered `activate()`, which
awaits `fetchChanges()`. Awaiting into the engine from inside a delegate callback is an
uncatchable `fatalError`, so the app died with the pull half-finished.

Fixed by `AkashicSyncEngine.handleAccountSignIn()`: a sign-in that finds the engine
already running is ignored, and reactivation is dispatched with `Task.detached`.

### 2. Pulled data never reached the UI

With the crash gone the store filled up (verified directly in SQLite: 3 / 18 / 1538) but
the app still showed **"No journeys"**. `JourneyStore` does not observe Core Data; it
publishes a snapshot taken by `reload()`, which ran once at init — before anything had
been fetched — and then only after local edits.

Fixed by wiring `AkashicSyncEngine.onRemoteChangesApplied` to `JourneyStore.reload()` in
the store's initializer. The hook already existed and had no production caller.

### 3. Every photo broke after a reinstall

After reinstalling over the synced data, all 1538 photos rendered as broken-image
placeholders, while all 3067 files were still on disk. `CDPhoto.localOriginalPath` /
`.localThumbPath` are **absolute**, and iOS re-creates an app's data container with a
fresh UUID on reinstall — the path recorded during sync pointed at
`…/Application/F2BDB360-…/`, which no longer existed.

This is not a Simulator quirk: it is exactly what happens when the family archive is
restored onto a new phone, which is the entire point of this sync layer.

Fixed in `Photo.resolveMedia`: the absolute path is now a *hint*. If it no longer
resolves, the canonical R2-style relative key (`url` / `thumbnailURL`) is re-resolved
against the current media root — the two layouts are identical by construction (see
`MediaLibrary`). The absolute path is still tried first, because after a local import it
legitimately points outside the media root, into the export bundle.
`hasStableLocalBytes` in `PersistenceController+Sync` got the same treatment, so a
post-restore re-fetch does not re-copy assets it already has.

### 4. Missing `remote-notification` background mode

```
BUG IN CLIENT OF CLOUDKIT: CloudKit push notifications require the
'remote-notification' background mode in your info plist.
```

CloudKit announces server-side changes with a silent push, and the app could not receive
any. Added `INFOPLIST_KEY_UIBackgroundModes: remote-notification` in `project.yml`.
This does not matter on the Simulator (which never gets the pushes anyway — hence the
explicit activation pull), but it does on a device.

## Evidence — down direction

Clean install, from the log:

```
activate: accountStatus=1 state=false
activate: fetchChanges() starting
accountChange(.signIn) ignored: engine already running
event: fetchedDatabaseChanges mods=3 dels=0 [journey-e27c89f6…,journey-447670e5…,journey-23fca2e6…]
event: willFetchRecordZoneChanges(journey-e27c89f6…)   (×3)
event: fetchedRecordZoneChanges mods=600 dels=0 ["Waypoint": 18, "Journey": 3, "Photo": 579]
endRemoteApply: saved inserted=600 updated=0
event: fetchedRecordZoneChanges mods=411 dels=0 ["Photo": 411]   endRemoteApply: inserted=411
event: fetchedRecordZoneChanges mods=200 dels=0 ["Photo": 200]   endRemoteApply: inserted=200
event: fetchedRecordZoneChanges mods=200 dels=0 ["Photo": 200]   endRemoteApply: inserted=200
event: fetchedRecordZoneChanges mods=148 dels=0 ["Photo": 148]   endRemoteApply: inserted=148
event: didFetchRecordZoneChanges(…) error=nil   (×3)
```

600 + 411 + 200 + 200 + 148 = **1559 records = 3 + 18 + 1538**. Then, in the store:

```
$ sqlite3 Akashic.sqlite 'select count(*) from ZCDJOURNEY; …'
journeys|3   waypoints|18   photos|1538   comments|0
photos with localOriginalPath: 1538
photos with localThumbPath:    1529
media files on disk: 3067 (5.0 GB)
```

And in the app: the globe shows the journey pins, Settings reads *Journeys loaded 3 /
Photos in store 1538 / Sync: Syncing*, the trek map renders real photo thumbnails, and
the day sheet has the full synced waypoint payload (description, highlights, weather,
"did you know", points of interest).

9 photos have no thumbnail path. Not investigated — most likely videos or photos whose
`thumb` asset was never populated server-side. They still resolve via the original.

## Evidence — up direction

Edited a caption in the app (`Edit Photo → CAPTION → SYNC-UPLOAD-TEST-T24 → Save`) on
Photo `af2ecf7b-bbf8-45f1-9344-3b6477e0abbe`:

```
event: sentRecordZoneChanges saved=0 failedSaves=1
sendFailure Photo/af2ecf7b-… code=14 … "record to insert already exists"
nextBatch: pending=1 -> saves=1 deletes=0
event: sentRecordZoneChanges saved=1 failedSaves=0        <- server accepted it
…
event: fetchedDatabaseChanges mods=1 dels=0 [journey-e27c89f6-…]
event: fetchedRecordZoneChanges mods=1 dels=0 ["Photo": 1]
endRemoteApply: saved inserted=0 updated=1
```

The server accepted the save, and then handed the record *back* on the next pull.

The independent confirmation is the **clean install afterwards**: the app was
uninstalled (local store and all media destroyed), reinstalled, and re-synced from
scratch — and the caption came back:

```
$ sqlite3 Akashic.sqlite "select ZID, ZCAPTION from ZCDPHOTO where ZCAPTION like '%SYNC-UPLOAD%'"
af2ecf7b-bbf8-45f1-9344-3b6477e0abbe|SYNC-UPLOAD-TEST-T24
```

Nothing local could have supplied that value. It came from CloudKit.

The failure/retry also survived a process kill: the first attempt failed at 17:36, the
app was terminated, and the pending change was restored from the persisted engine state
and successfully resent on the next launch at 17:39.

### Final clean-install run

Uninstall → install → launch → wait. End state:

```
journeys|3   waypoints|18   photos|1538
media files: 3067 (5.0 GB)
event: didFetchRecordZoneChanges(…) error=nil   (×3)   event: didFetchChanges
```

Settings reads *Journeys loaded 3 / Photos in store 1538 / Sync: Syncing · last update
2 min. ago*, and the globe shows the journey pins.

Two operational notes from this run, both self-inflicted and worth avoiding next time:

- Running `xcodebuild … test` **installs the plain `Debug` app over the `Debug-CloudKit`
  one**, silently dropping the entitlement mid-sync (Settings then shows *Sync: Rebuild
  with the CloudKit configuration to sync*). Do not run the test suite against the same
  Simulator while a sync is in flight.
- Relaunching with a bare `xcrun simctl launch` drops `AKASHIC_CLOUDKIT=1`, so the app
  comes back up in `.fixtures` mode and syncs nothing. Always relaunch through
  `SIMCTL_CHILD_AKASHIC_CLOUDKIT=1`.

Both interruptions were recovered from cleanly: the engine re-fetched from its last
committed change token (`endRemoteApply: saved inserted=0 updated=600` — the re-apply is
idempotent) and carried on. The change token only advances on
`didFetchRecordZoneChanges`, so an interrupted zone fetch costs a repeat, never data.

## `CKSyncEngine` gotchas worth remembering

1. **Never await into the engine from a delegate callback.** `fetchChanges()` /
   `sendChanges()` from inside `handleEvent` (or anything it spawns with a plain
   `Task { }`) is an uncatchable `fatalError`. The check uses a **task-local**, and
   `Task { }` *inherits* task-locals — only `Task.detached` clears them. This is the
   same family as the earlier finding that a manual `sendChanges()` at activation traps.
2. **`.accountChange(.signIn)` fires on every launch**, not only on a real sign-in.
   Guard any reactivation on the engine actually being stopped.
3. **Zone discovery is automatic.** `.fetchedDatabaseChanges.modifications` needs no
   handling: the engine fetches record-zone changes for newly discovered zones on its
   own, including zones created entirely outside the engine by direct `CKDatabase`
   writes. (This was the prime suspect going in, and it was wrong — worth recording.)
4. **The first big pull gets cancelled and that is fine.** Roughly 100 s in, all three
   zones failed with `CKError` 20 "Operation Cancelled", `didFetchChanges` fired with
   only 600 of 1559 records applied — and the engine immediately re-issued
   `willFetchRecordZoneChanges` and finished the remaining 959 from its change token.
   Do not treat a cancelled zone fetch as a failure; do not clear state on it.
5. **Records are re-uploaded without a change tag, so the first save of each always
   conflicts.** *(FIXED — see below. History kept because it is what the log lines in the
   "up direction" evidence above show, and what live re-verification must confirm is gone.)*
   As first observed: `makeRecord` built a fresh `CKRecord`, so CloudKit saw an insert and
   returned code 14 (`serverRecordChanged`, "record to insert already exists"). The
   conflict path rebased onto the server record and the resend succeeded, so edits did
   land — at double the round-trips, and only after the engine's retry backoff (minutes,
   not seconds, on the Simulator).

   **The fix (post-T2.4): persist each record's encoded system fields.** A new Core Data
   model version (`Akashic 3`) adds a single side table,
   `CDSyncRecordMeta { recordName (unique, indexed), systemFields: Binary }`.
   `RecordCoder.archivedSystemFields(of:)` / `recordFromSystemFields(_:)` archive and
   rehydrate a record's system fields (`encodeSystemFields` + `NSKeyedArchiver`, secure
   coding). A meta row is written for **every applied fetched record**
   (`applyFetchedRecord`) and **every successfully sent record**
   (`AkashicSyncEngine.handleSentChanges` → `recordsDidSave`, so the second edit of a
   locally created record also carries a tag), and removed when a record is deleted
   locally/remotely (`applyDeletedRecord`, `recordsDidDelete`) or a store is purged
   (`resetJourneys`). `makeRecord` now rehydrates that base when the caller supplies no
   rebased record, so the outgoing save carries the last-known server change tag and
   `CKSyncEngine` diffs it instead of re-inserting.

   The migration is lightweight by construction: `Akashic 3` adds one **new** entity and
   changes none of the four domain entities, so there are no existing rows to transform;
   `NSPersistentContainer`'s default automatic + inferred migration handles it (guarded by
   `StoreMigrationTests.testVersionTwoStoreMigratesToCurrent`).

   **What live re-verification should show (the proof the code-14 path is gone).** Edit a
   caption on a photo that was pulled down from the server (not one created in this session),
   with `AKASHIC_SYNC_LOG=1`. Before the fix the log read:

   ```
   event: sentRecordZoneChanges saved=0 failedSaves=1
   sendFailure Photo/<id> code=14 … "record to insert already exists"
   nextBatch: pending=1 -> saves=1 deletes=0
   event: sentRecordZoneChanges saved=1 failedSaves=0        <- accepted only on the RETRY
   ```

   After the fix it should be a single clean send, with **no `sendFailure … code=14`** line
   and **no second `sentRecordZoneChanges`**:

   ```
   event: sentRecordZoneChanges saved=1 failedSaves=0        <- accepted first try
   recordsDidSave: stored systemFields for 1 saved record(s)
   ```

   The `recordsDidSave: stored systemFields …` line (and the absence of `sendFailure`
   code=14) is the positive signal. A `serverRecordChanged` rebase can still legitimately
   occur if the server copy genuinely changed since the last pull — that is real conflict
   resolution, not the first-save artifact.
6. **Sends are the engine's business.** `automaticallySync = true` means the engine
   schedules sends itself; fetches still need an explicit `fetchChanges()` at
   activation, because the Simulator never receives the silent push that would trigger
   one (and a device won't either without the `remote-notification` background mode).

## Not verified

- Two devices converging on the same account.
- Real silent pushes (Simulator does not deliver them).
- Zone deletion, account switching and conflict resolution against the live container —
  unit-tested at the seam only (`AkashicTests/SyncEngineTests.swift`).
- Photo/video **asset upload** from the app: the caption test only changed a scalar
  field. A newly ingested photo's `CKAsset` upload is untested live.
