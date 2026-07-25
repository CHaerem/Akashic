# Journey sharing (T2.8)

How the family gets to each other's journeys, what is verified, and what is not.

## The shape

A journey is a CloudKit **record zone** (D3), and sharing is done at the zone level:
`CKShare(recordZoneID:)`. Everything in the zone comes along — the journey root, its
waypoints, its photos, its comments — including records added later.

The obvious alternative, a *hierarchical* share rooted at the journey record, is not
available to us: it requires every child record to hold an owning `CKReference` back to the
root, and CloudKit caps owning references at roughly 750 per record. Kilimanjaro has 939
photos. That ceiling is what forced `journeyRef` to `.none` during the import (see
[`apple/CloudKit/MAPPING.md`](../CloudKit/MAPPING.md)); zone-wide sharing has no equivalent limit.

## Two engines, one for each database

`CKSyncEngine` binds to exactly one database, so participation needs a second engine:

| | private engine | shared engine |
|---|---|---|
| database | `privateCloudDatabase` | `sharedCloudDatabase` |
| holds | journeys we own | journeys shared with us |
| initial upload | yes | **never** |
| creates zones | yes | **never** — the zone is the owner's |
| zone disappears | rebuild the mirror | share was revoked; keep local data, do nothing |
| state file | `cksyncengine-state.json` | `cksyncengine-state-shared.json` |

Routing hangs off one new field, `CDJourney.zoneOwnerName`: nil means "mine", a non-nil value
is the sharing owner's record name. `AkashicSyncEngine.handles(journeyID:)` uses it so every
journey belongs to exactly one engine, and `zoneID(forJourneyID:)` addresses an edit to a
shared journey to the **owner's** zone. Getting that wrong is silent: the write goes to a zone
under our own name and simply never reaches anyone.

The separate state files matter for the same reason. The two engines hold different change
tokens and pending-change sets; one shared file would have each overwrite the other, and a
restored engine would resume against the wrong database. The private scope deliberately keeps
the original filename so existing installs restore their state instead of re-fetching 5 GB.

## Roles

CloudKit models access as two values — a role (owner / invited) and a permission
(read-only / read-write). `ShareRole` flattens them to the three the family cares about:

- **Owner** — created the journey. One per share, not transferable, cannot be removed.
- **Can edit** — read-write: may add photos, comments and edits.
- **Can view** — read-only.

An *unknown* permission maps to viewer, never editor. Guessing upward would hand out write
access to the family archive on a value we could not read.

## Model version

T2.8 added `CDJourney.zoneOwnerName`, which required a **second model version**
(`Akashic 2.xcdatamodel`, now current). Editing the single model in place would have been
silently destructive: with no earlier version left in the bundle, Core Data cannot migrate an
existing store at all — it fails to open, and `PersistenceController` only asserts, so a
release build would launch with no archive and no message. `StoreMigrationTests` builds a
store with the v1 model and reopens it with the current one, which is exactly what an
upgrading install does.

**Any future model change must add a version the same way.** There is no migration path back.

## Accepting an invitation

Tapping a share link launches the app and delivers `CKShare.Metadata` to
`AkashicAppDelegate.application(_:userDidAcceptCloudKitShareWith:)` — SwiftUI has no
equivalent, so the app-delegate adaptor is the only route. `PersistenceController.acceptShare`
then calls `container.accept(_:)` **and explicitly fetches**: acceptance grants access but
delivers no data, and the Simulator never receives the silent push that would otherwise
trigger the pull. That is the same trap that hid the entire archive in T2.4.

`INFOPLIST_KEY_CKSharingSupported` is set in `project.yml`. Without it iOS opens the share
link in Safari instead of handing it to the app.

## What is verified — and what is not

Verified by tests (241 green, 20 of them new here):

- role/permission mapping in both directions, including the unknown-permission fallback
- participant mutability (owners and yourself are not editable rows)
- each engine handles only its own journeys
- an edit to a shared journey is addressed to the owner's zone
- a participant never enqueues a zone save
- a revoked share neither resurrects the zone nor deletes local data
- the private engine still rebuilds its mirror on a zone deletion
- state files are per scope, and the private one keeps its original name
- a v1 store migrates to v2 with its data intact

**Not verified — needs a second iCloud account:**

- sending an actual invitation and having someone accept it
- a participant reading the shared journey
- a participant *writing* to it (an editor's comment reaching the owner)
- read-only enforcement in practice
- revocation as experienced by the participant

These are the parts that cannot be exercised from one account on one simulator. They are the
first thing to test once the family is on TestFlight (RUNBOOK §7), and until then sharing
should be treated as built-and-unit-tested, not proven.

One known rough edge inherited from T2.4: the first save of any record conflicts (code 14) and
recovers via the rebase path, because `makeRecord` builds records without a stored change tag.
It costs a round trip, not correctness. The fix is the `encodedSystemFields` TODO in
`PersistenceController+Sync`.
