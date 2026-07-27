# App Review Notes — Akashic Journeys

Paste the "For App Review" block below into App Store Connect → App Review
Information → Notes. The sections after it are internal guidance for whoever
prepares the review build.

---

## Paste-ready "Notes to Reviewer"

```
Thank you for reviewing Akashic Journeys.

NO ACCOUNT OR LOGIN REQUIRED
Akashic has no account system and no login screen. Identity is the device's
iCloud (Apple ID) — the same one already signed in on the test device. There is
no username, password, or sign-up to complete, and no demo credentials are
needed. Please make sure the simulator/device is signed into an iCloud account
(Settings > [Apple ID]) so CloudKit sync can initialise; any account works.

WHAT YOU CAN DO WITHOUT A FAMILY
The core experience is fully usable by one person on one device — you do not need
a second Apple ID or a shared family. This build includes sample journeys
(Kilimanjaro, the Inca Trail, and Mount Kenya) so the app is populated on first
launch. From there you can:
- Explore the 3D globe and fly between the pinned journeys.
- Open a journey and browse it day by day (weather, photos, elevation, notes).
- View the photo grid and lightbox, and the interactive elevation profile.
- Open the Share sheet (Apple's standard iCloud sharing UI) and the Export sheet.
Family sharing (CKShare) is Apple's built-in sharing — inviting a second person is
optional and not required to evaluate the app.

PHOTO ACCESS
Akashic uses the system photo picker (SwiftUI PhotosPicker / PHPicker). It does
NOT request full photo-library permission and shows no library-access prompt: the
user picks specific photos in Apple's out-of-process picker, and only those
selected photos are handed to the app. Photos are stored as CKAssets in the
user's own iCloud. We operate no server and never receive user photos or data.

ENCRYPTION / EXPORT COMPLIANCE
The app uses only standard Apple encryption (HTTPS/CloudKit) and no proprietary or
non-exempt cryptography. ITSAppUsesNonExemptEncryption is set to NO in the binary
(export-compliance exempt). No CCATS/ERN is required.

PRIVACY
We collect no data. Everything lives in the user's own iCloud (private, shared,
and — only when the user explicitly publishes a journey — a public showcase
database that powers akashic.no). App Privacy is declared "Data Not Collected".
Support is via email from https://akashic.no/support.html.

USER-GENERATED CONTENT AND MODERATION (Guideline 1.2)
Publishing is off by default and owner-initiated: nothing a user creates becomes
public unless they deliberately tap Publish on their own journey, and only
metadata and photo THUMBNAILS are published — never full-resolution originals.
Nothing in the app displays other users' public content; the public journeys are
read on the website (akashic.no), not in the app, so the app has no feed, no
discovery surface, and no user-to-user messaging.
For the content that is published, we operate a full moderation path:
- Report: every public page carries a "Report content" link that opens a
  prefilled email to report@akashic.no. The path is also documented on
  https://akashic.no/privacy.html and https://akashic.no/terms.html.
- Triage: the developer reads that inbox directly and acknowledges within three
  working days.
- Takedown: we administer the public database, so we can remove a published
  journey — page, thumbnails, coordinates and timestamps — without the
  publisher's cooperation, and we tell them it was removed and why. The terms
  allow removal while a report is being reviewed.
- Appeal: a reply to the same address gets a second look.

Contact for review questions: support@akashic.no
```

---

## Why each point is in there (internal)

### No account / no login
True today: identity is the device Apple ID via CloudKit. There is no auth UI to
get stuck on — a common review rejection cause is a login wall with no demo
account; we pre-empt it by stating plainly there is none. **Action:** the review
build's target simulator/device must be signed into iCloud, or CloudKit sync sits
idle and the reviewer may think the app is broken. Call this out (done above).

### Usable without an iCloud family — the demo/fixtures state
`COMMERCIALIZATION-PLAN §4.2` calls for a **bundled demo journey** so the empty
state sells the vision. For review this is essential: a reviewer with a fresh
Apple ID and no shared journeys would otherwise see an **empty app** and could
reject under Guideline 2.1 (incomplete/no content to review).

> **BLOCKER to confirm before submitting:** the review build MUST launch into a
> populated state without any migration or second device. Ship the three recovered
> journeys (or at least Kilimanjaro) as bundled read-only sample content
> (`apple/Fixtures/recovered/`), loadable offline on first launch. If journey
> creation (`§4.1`) is not yet in the reviewed build, the sample content is the
> ONLY thing the reviewer can look at — so it must be present, or the app reads as
> empty/non-functional. This is the single highest-risk item for a first
> submission. Verify on a clean simulator with a brand-new Apple ID before you hit
> Submit.

### Why photo access is requested — and the honest, strong version
The app imports photos with SwiftUI `PhotosPicker` (PHPicker-backed —
`apple/Akashic/Views/Edit/PhotoImportSheet.swift`). This means:
- **No `NSPhotoLibraryUsageDescription` prompt** and no full-library access. The
  picker runs out-of-process; the app only ever receives the specific items the
  user selects.
- So the accurate answer to "why does the app request photo library access" is: it
  **doesn't** request broad access — it uses the privacy-preserving picker. Photos
  the user selects are matched to the right day by EXIF capture date and stored as
  CKAssets in the user's own iCloud.

Stating this proactively heads off any reviewer confusion about photo permissions
and doubles as a privacy selling point.

### Export-compliance / encryption
`apple/project.yml` sets `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: "NO"` — the
binary already declares the exemption (only standard Apple TLS/CloudKit crypto).
Reviewer needs no encryption documentation. (Confirmed in repo; also referenced in
the recent commit "Declare export compliance in the binary (exempt encryption)".)

### Public showcase and moderation — state it up front, do not wait to be asked

This section used to say "mention only if asked". That was the wrong call and the
notes above now declare it proactively. Guideline 1.2 is not satisfied by the
feature being small or optional: the moment a stranger can publish world-readable
material into a database we administer, we own moderation, and the reviewer's
question is whether a mechanism exists — not whether the feature is central.
Volunteering it with the mechanism attached is a much better position than being
asked and answering "yes, but it's off by default". This is the sharper review risk
for this app than any of the metadata items on the checklist.

What the mechanism actually is, end to end:

| Stage | Where it lives |
|---|---|
| Report affordance | `src/components/public/ReportLink.tsx` — a discreet flag on every public journey page, hidden from signed-in owners. Builds the mailto via `buildReportMailto` in `src/lib/branding.ts`, which puts the slug in the subject and the page URL in the body. |
| Documented path | `public/privacy.html` ("Reporting a public journey, and having it removed") and `public/terms.html`. App Review opens both. |
| Inbox | `report@akashic.no` (`REPORT_EMAIL`). One person reads it: the developer. |
| Takedown | `scripts/takedown.mjs` — removes the `PublicJourney` record and every `PublicPhoto` joined to it from the public CloudKit database. |
| Appeal | Reply to the same address. |

**Who triages:** the developer, personally. There is no moderation team and the
notes do not claim one. **Turnaround:** acknowledge within three working days
(what `privacy.html` promises — do not promise faster in Connect than the page
says). Removal itself is a single command and takes minutes once triaged.

**Publishing is owner-initiated and off by default.** Nothing becomes public
without a deliberate Publish on the owner's own journey; only metadata and photo
*thumbnails* are mirrored, never full-resolution originals; and the app itself has
no feed of other people's content — the public mirror is read by the website, so
there is no in-app UGC surface, no discovery, and no user-to-user messaging. That
combination is worth stating because it is what keeps this out of the "social app
needs in-app blocking and reporting" bucket.

#### Running a takedown

Dry-run is the default; `--apply` is required to delete anything.

```bash
node scripts/takedown.mjs --dry-run kilimanjaro   # prints every record it would remove
node scripts/takedown.mjs --apply   kilimanjaro
```

Credentials are a CloudKit server-to-server key read from `CLOUDKIT_KEY_ID` and
`CLOUDKIT_PRIVATE_KEY_PATH`. Nothing is embedded in the repo; run the script with
no credentials set and it prints exactly what to create. **Set this up before
submitting, not after the first report arrives** — creating the key needs the
CloudKit Console and is an owner task.

One trap worth knowing before you run it: the reported slug is often *not* the
record name. Two families can both mint `kilimanjaro` locally, so
`PublicMirrorPublisher.resolveEffectiveSlug` publishes the second one under
`kilimanjaro-a1b2c3` while the journey in the app still calls itself
`kilimanjaro`. That is DIFF-01 — unpublish swept only the pretty slug, CloudKit
reports deleting an absent record as success, and the real records stayed
world-readable. The script therefore *discovers* the records (exact lookup, plus a
`slug BEGINS_WITH` query filtered to the six-hex suffix shape) rather than trusting
the slug, and refuses to act when one slug resolves to two owners' journeys. Read
its output before passing `--apply`.

Moderation policy background: `COMMERCIALIZATION-PLAN §4.5`.

---

## Pre-submission checklist (review-specific)

- [ ] Review build launches into a **populated** state on a clean device with a
      fresh Apple ID (bundled sample journeys visible offline).
- [ ] Test device/simulator is **signed into iCloud** and the notes say so.
- [ ] `https://akashic.no/support.html` and `.../privacy.html` are **live** and
      reachable (App Review opens both).
- [ ] Privacy Policy page states "no data collected; data lives in your iCloud".
- [ ] App Privacy in Connect = **Data Not Collected** (matches `app-store-listing.md §4`).
- [ ] `ITSAppUsesNonExemptEncryption = NO` present in the uploaded build.
- [ ] No dev-only scaffolding reachable in Release (migration import, dry-run,
      environment overrides) — `§4.3` de-scaffolding done, or those rows gated out.
- [ ] `support@akashic.no` inbox is monitored during the review window.
- [ ] `report@akashic.no` **exists and is monitored** — the Report link, the privacy
      page, the terms page and the review notes all point at it. A bouncing address
      turns a documented moderation path into a Guideline 1.2 problem.
- [ ] CloudKit **server-to-server key created** and `scripts/takedown.mjs --dry-run
      <slug>` runs against the production environment without a credential error.
      Owner task (needs the CloudKit Console); do it before submitting.
- [ ] If the paywall (`§4.4`) is in the build: the IAP is **submitted for review in
      the same version** and reachable by the reviewer (see `launch-checklist.md`).
