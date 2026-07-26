# App Store screenshots — how these were made

24 assets: **6 shots × 2 device sizes × 2 languages**. `screenshots-plan.md` is the shot list and
the marketing intent; this file is the reproduction recipe and the record of what was substituted.

| | |
|---|---|
| Produced | 2026-07-26, SHIP-03 |
| Built from | `Debug` (`.fixtures` persistence — three bundled recovered journeys, seeded in memory every launch) |
| iPhone 6.9" | iPhone 17 Pro Max, `44235FC8-AFD3-429E-8BF8-5C00CB75634E`, **1320 × 2868** |
| iPad 13" | iPad Pro 13-inch (M5), `48F461FD-4C77-4444-AD07-97776FD553FE`, **2064 × 2752** |
| Appearance | **dark**, both devices |
| Languages | `en` and `nb` — see "Two languages, not one" below |
| Alpha channel | stripped; every file is opaque RGB |

Both sizes are mandatory: `TARGETED_DEVICE_FAMILY` is `1,2`, and App Store Connect will not enable
Submit without an iPhone 6.9" set *and* an iPad 13" set. The two simulators above render at exactly
the required pixel sizes, so nothing is scaled — do not substitute a different device without
re-checking `file *.png`.

## Two languages, not one

The listing is EN + NB and the app itself is fully localised (QUA-06), so a Norwegian listing
carrying English app chrome would be the one mismatch a reviewer actually notices. Both sets are
therefore shot from the same build, switching only the launch language.

Norwegian is worth the second pass for more than the app's own strings: MapKit localises with it,
so the globe reads `EUROPA` / `AFRIKA` / `Det Indiske hav` and the attribution becomes
`Kart · Rettigheter`. Number formatting follows too (`5 895 m` and `13,1 km` in `nb`, `5,895 m` and
`13.1 km` in `en`).

**Journey content stays English in the `nb` set** — day notes ("Summit at sunrise! Roof of Africa."),
highlights, camp names, the photo caption and the seeded family comments. That is correct rather
than a gap: those are the family's own recorded words, not UI strings, and the real archive was
written in English. Only chrome is translated, in the app and therefore in the screenshots.

## Naming

```
<lang>-<device>-<slot>-<shot>.png     e.g. nb-ipad13-4-elevation.png
lang   = en | nb
device = iphone69 (1320×2868) | ipad13 (2064×2752)
slot   = 1…6, the App Store Connect display order
```

## Setup, once per device

```bash
UDID=44235FC8-AFD3-429E-8BF8-5C00CB75634E          # or the iPad's
APP=$(find ~/Library/Developer/Xcode/DerivedData/Akashic-*/Build/Products/Debug-iphonesimulator \
      -name Akashic.app -maxdepth 1 | head -1)

xcrun simctl bootstatus "$UDID" -b
xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --batteryState charged --batteryLevel 100 --operatorName ""

# Uninstall FIRST. `simctl install` over an existing install keeps the app container, and a
# stale `akashic.persistenceMode.override` in UserDefaults silently puts the app in `.local`
# mode — which seeds ONE demo journey instead of the three fixtures. The first capture run hit
# exactly this and produced a globe with a single journey card.
xcrun simctl uninstall "$UDID" no.akashic.app
xcrun simctl install "$UDID" "$APP"
```

## Capturing one shot

Every shot is the same shape: terminate, launch with the seams for that screen, let it settle,
capture. Nothing is tapped — see "No touch injection" below.

```bash
xcrun simctl terminate "$UDID" no.akashic.app
env <PER-SHOT SIMCTL_CHILD_* SEAMS> \
    SIMCTL_CHILD_AKASHIC_SKIP_ONBOARDING=1 \
    SIMCTL_CHILD_AKASHIC_DISABLE_AI=1 \
    SIMCTL_CHILD_AKASHIC_HIDE_SAMPLE_BADGE=1 \
  xcrun simctl launch "$UDID" no.akashic.app -AppleLanguages "(nb)" -AppleLocale nb_NO
sleep 8            # 16 s for shot 4 — see the note there
xcrun simctl io "$UDID" screenshot --type=png out.png
```

`-AppleLanguages` / `-AppleLocale` must be **launch arguments**, after the bundle id — they land in
`NSArgumentDomain`. Passing them as `SIMCTL_CHILD_AppleLanguages` env vars does nothing, silently:
`UserDefaults` never reads the environment, so the app comes up in the simulator's own language and
the "Norwegian" set is quietly English. For the `en` set use `-AppleLanguages "(en)" -AppleLocale en_US`.

### Seams applied to every shot

| Seam | Why |
|---|---|
| `AKASHIC_SKIP_ONBOARDING=1` | the first-run cover would otherwise be the only thing in frame |
| `AKASHIC_DISABLE_AI=1` | the Intelligence entry points appear or vanish with model availability; pin them off so runs match |
| `AKASHIC_HIDE_SAMPLE_BADGE=1` | **added by SHIP-03.** `.fixtures` marks all three journeys as seeded, so every card carried a "SAMPLE" pill — advertising the product as a demo, and stealing enough width from the globe cards to truncate "Kilimanjaro" to "Kilima…". Hides the badge and nothing else: `isSampleJourney` stays truthful, so the free-tier exemption, the sync exclusion and the delete dialog's honest copy are untouched (asserted in `ConfigModeTests`) |

## The six shots

### 1 — `1-globe` · the signature globe
```
AKASHIC_SCENE=globe
```
Full-bleed MapKit globe framing Africa, two glowing route pins over Tanzania/Kenya, day/night
terminator across the Indian Ocean, and the journey strip along the bottom: Inca Trail (Peru ·
4 days), Kilimanjaro (Tanzania · 7 days), Mount Kenya (Kenya · 4 days). All three cards fit on the
iPad; the iPhone shows two and a half. The globe rotates idly, so the exact longitude drifts a few
degrees between runs — Africa stays framed, but this is the one shot that is not pixel-reproducible.
No status bar: `GlobeExperienceView` sets `.statusBarHidden(true)`, so the 9:41 override does not
appear on shots 1, 2, 3 or 5.

### 2 — `2-day` · a day, over the map
```
AKASHIC_SCENE=day6 AKASHIC_JOURNEY=kilimanjaro
```
Summit day. `DAY 6 · Uhuru Peak (Summit) · Oct 4, 2023 · 5,874 m`, the distance/ascent/elevation
chips, the day's notes, HIGHLIGHTS (Sunrise, Roof of Africa) and the photo strip — over live
satellite terrain of the summit slopes with the route drawn in cyan.

Deliberately at the **default `.medium` detent, not** `AKASHIC_SHEET_DETENT=large`: the large detent
covers the map and still leaves ~20 % of the frame empty below the content, whereas the medium
detent shows the map-and-day relationship that is the app's actual loop. On iPad this is D2's
floating side panel beside the map rather than a sheet, which is the more distinctive of the two.

**Deviation from the plan:** the plan wants `WeatherRow` visible. The recovered fixtures carry no
weather, so the section correctly hides itself and no shot in this set can show it. Nothing to fix
in the app — it needs weather data in the fixture.

### 3 — `3-photo` · one photograph, captioned
```
AKASHIC_SCENE=overview AKASHIC_JOURNEY=kilimanjaro AKASHIC_LIGHTBOX=1 AKASHIC_LIGHTBOX_DAY=6
```
`PhotoLightboxView` on the Kilimanjaro hero image with its caption ("Kilimanjaro from the plains —
the mountain you spend a week walking up.") and the `Day 6` / `Dag 6` badge.

**Deviation from the plan:** the plan's first choice is a "dense, gorgeous" `PhotosGridView`. Not
possible — `Fixtures/demo-media/demo-photos.json` carries **one** photograph per journey, so a grid
would be a single tile and the lightbox counter honestly reads `1 / 1`. The plan's own alternative
(a lightbox on one standout photo) is what is shipped. The image is also the repo's generated hero
art, not a trek photograph — that caveat is already recorded in `demo-photos.json`, and replacing it
is a file copy plus a manifest edit. On the iPhone the square source letterboxes top and bottom; on
the iPad it nearly fills the frame.

### 4 — `4-elevation` · the climb
```
AKASHIC_TAB=1 AKASHIC_STATS_JOURNEY=kilimanjaro AKASHIC_STATS_DAY=6
sleep 16     # not 8 — see below
```
Stats for Kilimanjaro: `SUMMIT 5,895 m · Uhuru Peak`, the `7 d / 70 km / +4,800 m` header chips
(these match `screenshots-plan.md`'s verified-facts table exactly), the elevation profile with day
markers D1–D6 and D6 selected, and the Day 6 stat row. The iPad additionally shows the whole
extended-stats grid down to the difficulty rating.

Two things about this shot:

* **Use a 16 s settle, not 8 s.** At 8 s the iPad captured a mid-scroll frame with a ghost of the
  "DIFFICULTY" heading bleeding above the title. It settles on its own; the shot just needs longer.
* Kilimanjaro is the *second* journey alphabetically, so its chip used to render clipped mid-word
  ("Kilimanjaro - Lemosho Ro"). Fixed in the app rather than worked around — `StatsTabView` now
  centres the selected chip on arrival. This was a real defect, not only a photogenic one: the
  initially-selected journey could start off-screen, so the screen read as though nothing were
  selected.

### 5 — `5-family` · the people who were there
```
AKASHIC_SCENE=day6 AKASHIC_JOURNEY=kilimanjaro AKASHIC_SHEET_DETENT=large \
AKASHIC_SEED_COMMENTS=1 AKASHIC_SCROLL_COMMENTS=1
```
The day sheet at full height with three family comments — Meg, Dad (with an `(edited)` marker) and
Chris — relative timestamps, and the compose field. Names are fictional, per the plan. This is the
only shot where the large detent is right: the comments fill the frame that was empty in shot 2.

**Substitution.** The plan asks for `UICloudSharingController` with visible participants. Not
reachable: `CloudKitJourneySharing` guards every method with `#if AKASHIC_CLOUDKIT_BUILD` and throws
`.notEntitled` otherwise, so in a plain Debug build `JourneyShareView` renders "This build cannot
share journeys — rebuild with the CloudKit configuration"; and a `Debug-CloudKit` build in a
simulator with no iCloud account gets no further than "Only you can see this journey", with no
participants to show. The plan's stated fallback (`JourneyShareView`) therefore does not work
either. Day comments carry the same message — several family members writing on one day of a shared
journey — using real UI over real seeded data, so that is what shot 5 shows.

### 6 — `6-export` · no lock-in
```
AKASHIC_SCREEN=exportsheet AKASHIC_EXPORT_JOURNEY=kilimanjaro
```
`JourneyExportSheet` over the real `JourneyDetailView` it is reached from: the journey header, the
route map with its camp pins, the stats row, and (on iPad) the day list — with the sheet in front
showing "Include original photos" and the footer that carries the whole message: *"A .zip containing
route.gpx, journey.json and the photos. Everything opens without Akashic."*

Deliberately the **idle** state. Tapping "Create export" replaces that footer with a photo count,
which says less.

This shot needed a new harness (`ExportScreenshotHarness`, `AKASHIC_SCREEN=exportsheet`), because
the sheet's only route in the app is Explore → Journeys → a journey → overflow menu → "Export
journey" — five taps that `simctl` cannot inject. It follows the pattern `EditScreenshotHarness`
already set for the four editing sheets. It also hosts the sheet at the `.medium` detent over the
journey screen: presented full-height over a placeholder backdrop, two thirds of the frame was empty.

## No touch injection

`xcrun simctl` has no tap/swipe verb, and driving the Simulator window from outside needs
interactive approval this run did not have. **All six shots are therefore launch-argument-driven and
require no interaction at all** — which is the better outcome anyway: the whole set is reproducible
by script next release instead of being re-improvised by hand. Where a screen had no seam, the seam
was added (shot 6) or the composition was chosen to avoid needing one (shot 2's detent).

## Post-processing

Exactly one step, and it is not cosmetic:

```bash
python3 flatten.py <captures/> <docs/store/screenshots/>
```

`xcrun simctl io … screenshot` always writes **RGBA**, and App Store Connect rejects screenshots
with an alpha channel. The script composites over black, re-encodes as RGB, and asserts both that
the dimensions are untouched and that every source pixel was already fully opaque — so the flatten
provably changes the channel and not the picture. (`flatten.py` was a throwaway; the seven lines
that matter are `Image.open` → check `getextrema() == (255, 255)` → `convert("RGB")` → save.)

**No captions are baked in.** The plan specifies caption overlays in a darkened top band, and that
band would sit exactly on top of the thing each shot exists to show — the `DAY 6` header, the
`Stats` title, the globe's own chrome. The uploaded assets are the clean screenshots; caption
compositing is a marketing decision to make against the real product page, with the EN/NB caption
text already written in `screenshots-plan.md`.

## Known English text in the `nb` set

Beyond the journey content (which is correct — see above), two UI strings are genuinely still
English in Norwegian, both found by shooting this set:

1. **`"DAY"`** above the day number in the journey detail's day list and in the story view — visible
   in `nb-ipad13-6-export.png` as `DAY 1`, `DAY 2` under the Norwegian heading `Dager`. The
   catalogue entry is marked `"shouldTranslate": false`, while `"DAY %lld"` three screens away *is*
   translated to `"DAG %lld"`. Left alone here because reversing an explicit don't-translate flag is
   a localisation decision, not a screenshot one.
2. **`PhotoImportSheet.dayLabel`** and **`ImportBrowserView.section(title: String)`** — both build
   `"Day \(n)"` in `String` position, the same trap as the lightbox badge below. Not in any shot.

Fixed in passing, because it *was* in a shot: `LightboxData.dayLabel` is a `String`, and all five
call sites passed a bare `"Day \(n)"` literal, so the lightbox badge shipped English in every
language — `nb-iphone69-3-photo.png` said `Day 6` under otherwise fully Norwegian chrome. In
`PhotosGridView` the identical literal localises correctly as the section `title` and not as
`dayLabel`, three lines apart, which is the trap in `CLAUDE.md` almost verbatim. The catalogue
already had `"Day %lld"` → `"Dag %lld"`; only the call sites needed `String(localized:)`.
