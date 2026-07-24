# App Store Listing — Akashic Journeys

Draft metadata for App Store Connect. Paste-ready. Every feature claim below is
true of the app **today** unless tagged `[v1.0 — in progress]` (journey creation
from scratch, the paywall/IAP, and onboarding are being built in parallel — do
not submit the listing until those ship or the tagged lines are removed).

Grounded against: `apple/Akashic/Views/*`, `apple/CloudKit/MAPPING.md §8`,
`APPLE-MIGRATION-PLAN.md §1–4`, `COMMERCIALIZATION-PLAN.md §4.6/§5/§10`, and the
three real journeys in `apple/Fixtures/recovered/`.

---

## 1. Identity & URLs

| Field | Value |
|---|---|
| App name | **Akashic Journeys** (already registered) |
| Bundle ID | `no.akashic.app` |
| Primary category | **Travel** |
| Secondary category | **Photo & Video** |
| Age rating | **4+** (see §7) |
| Support URL | `https://akashic.no/support.html` |
| Marketing URL | `https://akashic.no` |
| Privacy Policy URL | `https://akashic.no/privacy.html` |
| Minimum iOS | 17.0 (iPhone + iPad; runs on Apple Silicon Mac via "Designed for iPad") |
| Copyright | `2026 Christopher Hærem` |

> Support and Privacy Policy pages must exist and be reachable **before** you hit
> Submit — App Review clicks both. They are not built yet (M4 sibling task). The
> Privacy Policy must say, plainly and truthfully, "we collect nothing; your data
> lives in your own iCloud."

---

## 2. English (Primary / en-US)

### Subtitle (≤30 chars) — 28
```
Your treks on a living globe
```

### Promotional text (≤170 chars) — 149
*(Editable any time without review — use it for seasonal/launch messaging.)*
```
Relive every journey on a rotating 3D globe. Weather, photos, elevation and the story of each day — and your memories never leave your family iCloud.
```

### Keywords (≤100 chars, comma-separated, no spaces) — 98
```
trip journal,hiking diary,trek,gpx,travel log,mountain,expedition,itinerary,climb,route,map,summit
```
Rationale: no wasted characters (Apple counts spaces after commas, so there are
none). Avoids repeating words already in the app name/subtitle ("journeys",
"globe") — Apple indexes those separately, so repeating them wastes budget.
"gpx" is included because trekkers search it and the app genuinely imports/exports
it. "photo" is covered by the Photo & Video category + "photo journal" intent
without spending keyword budget.

### Description (~2,900 chars)
```
Akashic turns a trek into something you can hold onto. Open the app and your
journeys are pinned to a real 3D globe — day and night terrain, actual mountains,
the route drawn across the world exactly where you walked it. Tap a pin and dive
in.

YOUR MEMORIES STAY YOURS
Everything — every photo, every note, every route — lives in your own iCloud. We
run no servers, and we never see your data. There is no account to create, no
password, no company holding your memories on a database somewhere. Sign in with
the Apple ID already on your device and you are in.

LIVE EACH DAY AGAIN
Every journey unfolds day by day. For each day you get the weather as it was, the
photos you took, the camp you slept in, the elevation you climbed, and the little
discoveries along the way — points of interest, fun facts and the history of the
places you passed through.

A GLOBE, NOT A LIST
The map is the point. A rotating MapKit globe with realistic terrain flies you from
one camp to the next, follows your route, and shows the whole journey in one sweep.
Elevation profiles let you feel the climb; tap any point to jump to that moment.

SHARE IT WITH THE PEOPLE WHO WERE THERE
Share a journey with your family through iCloud. They see the photos, add their own
comments to each day, and relive the trip with you — all through Apple's built-in
sharing, no extra sign-up. One purchase covers your whole family through Apple
Family Sharing.

PHOTOS THAT KNOW WHERE THEY BELONG
Import from your photo library and Akashic matches each photo to the right day by
the date it was taken. You pick the photos; only the ones you choose ever leave the
picker. Full-resolution originals stay in your iCloud.

PUBLISH A PAGE THE WORLD CAN SEE — ONLY IF YOU WANT TO
Choose to publish a journey and it becomes a beautiful public page on akashic.no
that anyone can open in a browser, no app required. Nothing is public until you say
so, and only thumbnails and the story go out — never your full-resolution photos.

NO LOCK-IN, EVER
Export any journey as a single archive: your route as a standard GPX file, all the
details as JSON, and every original photo. Opens in any GPS or mapping tool. Your
journey is yours to take anywhere.

ASK SIRI
"List my journeys." "Show stats for Kilimanjaro." Akashic works with Siri and
Shortcuts out of the box.

THE HONEST FINE PRINT
Akashic needs iCloud. Photos count against your own iCloud storage — a large
archive may need an iCloud+ plan. Everyone you share with needs an Apple ID;
relatives on other platforms can still view any journey you publish to the web.

FREE TO START
Keep your first journey free, with the full experience and family sharing included.
Unlock Akashic Complete once — one payment, shared with your family — for unlimited
journeys, publishing and export.
```

> `[v1.0 — in progress]` reality check on the description: the free-tier/"Akashic
> Complete" paragraph and the implied ability to *create* a journey from scratch
> depend on the paywall (§4.4) and journey-creation flow (§4.1) shipping. If the
> build submitted for review cannot yet create a journey, cut the "FREE TO START"
> paragraph and soften "Open the app and your journeys are pinned…" — the reviewer
> must be able to do everything the text promises. See `review-notes.md`.

---

## 3. Norwegian (nb — Norsk bokmål)

### Subtitle (≤30 chars) — 26
```
Turene dine på en 3D-klode
```

### Promotional text (≤170 chars) — 144
```
Gjenopplev hver reise på en roterende 3D-klode. Vær, bilder, høydeprofil og historien bak hver dag — og minnene forlater aldri familiens iCloud.
```

### Keywords (≤100 chars) — Norwegian search intent
```
turdagbok,fjelltur,tur,gpx,reisedagbok,fottur,ekspedisjon,rute,kart,topptur,reise,fjell
```

### Description (nb)
```
Akashic gjør en fjelltur til noe du kan ta vare på. Åpne appen, og reisene dine
sitter festet på en ekte 3D-klode — terreng i dag- og nattlys, virkelige fjell, og
ruten tegnet tvers over verden akkurat der du gikk. Trykk på en nål og dykk inn.

MINNENE DINE FORBLIR DINE
Alt — hvert bilde, hvert notat, hver rute — ligger i din egen iCloud. Vi drifter
ingen servere, og vi ser aldri dataene dine. Ingen konto å opprette, ingen passord,
ingen bedrift som oppbevarer minnene dine i en database. Logg inn med Apple-ID-en du
allerede har på enheten, så er du i gang.

GJENOPPLEV HVER DAG
Hver reise utfolder seg dag for dag. For hver dag får du været slik det var, bildene
du tok, leiren du sov i, høyden du klatret, og de små oppdagelsene underveis —
severdigheter, artige fakta og historien bak stedene du passerte.

EN KLODE, IKKE EN LISTE
Kartet er poenget. En roterende MapKit-klode med realistisk terreng flyr deg fra
leir til leir, følger ruten din, og viser hele reisen i én bevegelse. Høydeprofiler
lar deg kjenne stigningen; trykk hvor som helst for å hoppe til det øyeblikket.

DEL DEN MED DE SOM VAR DER
Del en reise med familien gjennom iCloud. De ser bildene, legger til sine egne
kommentarer på hver dag, og gjenopplever turen sammen med deg — alt gjennom Apples
innebygde deling, uten ekstra registrering. Ett kjøp dekker hele familien gjennom
Apple Familiedeling.

BILDER SOM VET HVOR DE HØRER HJEMME
Importer fra bildebiblioteket, så matcher Akashic hvert bilde til riktig dag ut fra
datoen det ble tatt. Du velger bildene selv; bare de du velger forlater velgeren.
Originalene i full oppløsning blir liggende i din iCloud.

PUBLISER EN SIDE HELE VERDEN KAN SE — BARE HVIS DU VIL
Velg å publisere en reise, og den blir en vakker offentlig side på akashic.no som
hvem som helst kan åpne i en nettleser, uten app. Ingenting er offentlig før du sier
det, og bare miniatyrbilder og historien deles — aldri bildene i full oppløsning.

INGEN INNLÅSING
Eksporter en reise som ett arkiv: ruten som en standard GPX-fil, alle detaljer som
JSON, og hvert originalbilde. Åpnes i alle GPS- og kartverktøy. Reisen din er din å
ta med hvor du vil.

SPØR SIRI
«List opp reisene mine.» «Vis statistikk for Kilimanjaro.» Akashic fungerer med Siri
og Snarveier rett ut av boksen.

ÆRLIG SMÅTRYKK
Akashic trenger iCloud. Bilder teller mot din egen iCloud-lagring — et stort arkiv
kan trenge et iCloud+-abonnement. Alle du deler med trenger en Apple-ID; slektninger
på andre plattformer kan likevel se reiser du publiserer på nett.

GRATIS Å STARTE
Behold din første reise gratis, med hele opplevelsen og familiedeling inkludert. Lås
opp Akashic Complete én gang — én betaling, delt med familien — for ubegrenset antall
reiser, publisering og eksport.
```

---

## 4. App Privacy (the questionnaire in App Store Connect)

Answer to the first gate — **"Do you or your third-party partners collect data
from this app?"** → **No, we do not collect data from this app.**

This is honest and defensible, and it is the app's single strongest marketing
asset. Justification the reviewer/Apple can verify:

- **No analytics SDK, no ad SDK, no crash-reporting SDK, no third-party network
  calls.** The app talks only to the user's own CloudKit databases (private,
  shared, and — on explicit publish — the app's public DB). CloudKit data stored
  in the user's iCloud is **not** "collected by the developer" under Apple's
  definition — the developer has no access to it.
- **No account system.** Identity is the device Apple ID; we never receive it.
- **Photos** are chosen by the user through the system `PhotosPicker` and stored
  as CKAssets in the user's **own** iCloud. They are never uploaded to any server
  we operate. Not "collected."

Per-category answers (all **Data Not Collected**), with the honest note for each:

| Category | Answer | Note |
|---|---|---|
| Contact Info | Not Collected | No name/email/phone requested. Comment author name is a local display string synced only inside the user's own share. |
| Health & Fitness | Not Collected | Elevation/distance are journey attributes in the user's iCloud, not read from HealthKit and never sent to us. |
| Financial Info | Not Collected | IAP is handled entirely by Apple; we never see payment data. |
| Location | Not Collected | Coordinates are part of the user's journey/photo data in their iCloud. The app does not request device location / Core Location for tracking. |
| Sensitive Info | Not Collected | — |
| Contacts | Not Collected | Family sharing uses Apple's CKShare UI; we never read the address book. |
| User Content (Photos, etc.) | Not Collected | Photos/notes/comments live in the user's iCloud (CKAsset/CKRecord). We operate no server and cannot read them. |
| Browsing / Search History | Not Collected | — |
| Identifiers | Not Collected | No device ID, no user ID, no IDFA. |
| Purchases | Not Collected | Apple processes IAP; StoreKit entitlement is checked locally. |
| Usage Data | Not Collected | No product analytics. |
| Diagnostics | Not Collected | No third-party crash/diagnostics SDK. |

**Support / bug-report channel is outside the app:** support runs through a
`mailto:` link on `https://akashic.no/support.html`. If a user emails us, we of
course receive whatever they choose to write. That is ordinary email correspondence
initiated by the user, not in-app data collection, so it does not change any answer
above — but note it in the Privacy Policy for completeness.

---

## 5. Age rating (4+)

Answer every content question **None / No**:
- Cartoon/Fantasy Violence, Realistic Violence, Sexual Content/Nudity, Profanity,
  Alcohol/Tobacco/Drugs, Gambling, Horror, Mature/Suggestive → **None**.
- Unrestricted Web Access → **No** (the app does not embed a general web browser).
- Gambling / Contests → **No**.

Result: **4+**.

> Caveat to revisit before launch: the **public showcase** lets owners publish
> content that other people can view. This is owner-initiated, thumbnails-only, and
> moderated (report + takedown, `COMMERCIALIZATION-PLAN.md §4.5`), so it does not by
> itself force a higher rating — but if in-app browsing of *other users'* public
> journeys is ever added, re-run the questionnaire (user-generated content may push
> to 12+/17+ and require moderation attestations). For v1.0, publishing is an
> outbound action to a web page, not an in-app UGC feed → **4+ stands.**

---

## 6. What was deliberately left OUT of the copy (and why)

- **Widgets** — a `JourneyStatsWidget` exists but is dormant (`COMMERCIALIZATION
  -PLAN.md §3`). Not advertised until it is enabled and polished.
- **Apple Intelligence / "Akashic Intelligence"** — a v1.1 story (§10). No AI
  claims in the v1.0 listing; adding them later is a promo-text update, not fluff
  now.
- **"Award-winning", statistics, testimonials** — none. Nothing that isn't true.
- **Route drawing on the map** — v1.1 (`§4.1`/§8 risk row). The copy says "the
  route drawn… where you walked it" (describes viewing an existing route, true
  today) and never claims a draw tool.

---

## 7. Copy-paste order for App Store Connect

1. App Information → name, subtitle, categories, age rating, URLs.
2. Pricing → Free (with IAP; see `launch-checklist.md`).
3. Localizations → add **English (U.S.)** primary and **Norwegian** — paste §2/§3.
4. App Privacy → §4 (Data Not Collected across the board).
5. Version metadata → promo text, description, keywords, screenshots
   (`screenshots-plan.md`), App Review notes (`review-notes.md`).
