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

### Public showcase — mention only if asked
The publish-to-web feature writes thumbnails-only metadata to a public CloudKit DB
that akashic.no reads. It is owner-initiated and off by default. It is not needed
to evaluate the app and is not part of the review flow; only raise it if the
reviewer asks about user-generated/public content. Moderation (report + takedown)
is covered in `COMMERCIALIZATION-PLAN §4.5`.

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
- [ ] If the paywall (`§4.4`) is in the build: the IAP is **submitted for review in
      the same version** and reachable by the reviewer (see `launch-checklist.md`).
