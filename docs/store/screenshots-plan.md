# Screenshots Plan — Akashic Journeys

The exact shot list, the real data to load, the caption overlays (EN + NB), and the
commands to produce clean, deterministic screenshots headlessly from the simulator.

## Required sizes (App Store Connect, 2026)

Apple now derives smaller sizes from the largest, so you only need to upload two
sets:

| Device set | Simulator | Portrait px | Slots |
|---|---|---|---|
| **6.9" iPhone** | iPhone 16 Pro Max | 1320 × 2868 | up to 10 (ship 6) |
| **13" iPad** | iPad Pro 13" (M4) | 2064 × 2752 | up to 10 (ship 6) |

Ship the same 6 shots for both, re-composed for the iPad's wider canvas.

## The data to load

Use the three real recovered journeys (`apple/Fixtures/recovered/`) — they are the
hero content. Verified facts to keep captions honest:

| Journey | Country | Distance | Elev. gain | Days | High point | Dates |
|---|---|---|---|---|---|---|
| **Kilimanjaro — Lemosho Route** | Tanzania | 70 km | 4,800 m | 7 | Uhuru Peak 5,895 m | 29 Sep–9 Oct 2023 |
| **Inca Trail to Machu Picchu** | Peru | 45 km | 3,000 m | 4 | Dead Woman's Pass 4,150 m | 1–4 May 2024 |
| **Mount Kenya — Chogoria/Sirimon** | Kenya | 50 km | 2,600 m | 4 | Point Lenana 4,989 m | 10–17 Oct 2023 |

Kilimanjaro is the star (highest, most photos, best globe pin-out). Lead with it.

---

## The 6 shots

Order matters — the first two show on the product page without a tap, so they must
land the globe + the privacy promise.

### Shot 1 — The globe, Kilimanjaro pinned out
- **Screen:** `GlobeExperienceView` — rotating MapKit globe, `.hybrid(elevation:
  .realistic)`, camera pulled back so Africa fills the frame with the Kilimanjaro
  route pin and label visible. Day/night terminator ideally over the Atlantic for
  drama.
- **Why first:** the signature. This is the differentiator the whole go-to-market
  leans on (`COMMERCIALIZATION-PLAN §6`).
- **Caption EN:** `Every journey, pinned to a living globe`
- **Caption NB:** `Hver reise, festet på en levende klode`

### Shot 2 — Day detail: weather + photos + story
- **Screen:** `DayDetailSheet` for a strong Kilimanjaro day (e.g. summit day —
  Barafu to Uhuru). Show the `WeatherRow`, a couple of real photos in the
  `DayPhotoStrip`, and the day's notes/discoveries visible.
- **Why second:** proves the "relive each day" promise + reinforces privacy.
- **Caption EN:** `Relive each day — weather, photos, the whole story`
- **Caption NB:** `Gjenopplev hver dag — vær, bilder, hele historien`

### Shot 3 — Photo grid / lightbox
- **Screen:** `PhotosGridView` for Kilimanjaro (dense, gorgeous grid), or a
  `PhotoLightboxView` on one standout summit photo with its caption + date.
- **Caption EN:** `Your photos, matched to the day you took them`
- **Caption NB:** `Bildene dine, koblet til dagen du tok dem`

### Shot 4 — Elevation profile
- **Screen:** `InteractiveElevationProfileView` for Kilimanjaro showing the climb
  to 5,895 m, with the day markers along the profile. Show the stat header (70 km ·
  4,800 m · 7 days).
- **Caption EN:** `Feel every metre of the climb`
- **Caption NB:** `Kjenn hver høydemeter av stigningen`

### Shot 5 — Family sharing
- **Screen:** `JourneyShareView` / the `UICloudSharingController` sheet mid-share,
  showing a journey being shared with family (roles visible). Keep participant
  names generic/fictional in the shot.
- **Caption EN:** `Share it with the people who were there`
- **Caption NB:** `Del den med de som var der`

### Shot 6 — Export (no lock-in) OR the second journey on the globe
- **Primary choice — Export:** `JourneyExportSheet` showing the archive contents
  (route.gpx + journey.json + photos). This is the trust shot — "your data is
  yours". Caption sells no-lock-in.
  - **Caption EN:** `No lock-in — export GPX, JSON and every original photo`
  - **Caption NB:** `Ingen innlåsing — eksporter GPX, JSON og hvert originalbilde`
- **Alternate — variety:** the Inca Trail or Mount Kenya route on the globe to show
  the archive spans continents.
  - **Caption EN:** `From Kilimanjaro to Machu Picchu — one archive`
  - **Caption NB:** `Fra Kilimanjaro til Machu Picchu — ett arkiv`

> Recommendation: ship **Export** as shot 6. The no-lock-in message is a stronger
> closer than a second globe and it is a differentiator competitors can't match.

### Caption style
- Keep overlays short (one line, ≤ ~42 chars renders cleanly at both sizes).
- Same font/placement across all six for a consistent strip. Put the caption in the
  top ~18% band over a darkened gradient so the UI below stays legible.
- Do the overlay compositing **outside** the app (design tool or a compositing
  script) — do not bake marketing text into the app UI.

---

## Producing clean shots headlessly

The point of the status-bar override is a pristine bar: **9:41**, full battery, full
signal, no clutter — the Apple house style. Commands below assume the simulator is
booted and the app is installed and showing the target screen.

```bash
# 1. Boot the exact device you're shooting (repeat per device).
xcrun simctl boot "iPhone 16 Pro Max"
# (iPad set:)  xcrun simctl boot "iPad Pro 13-inch (M4)"

# 2. Clean status bar: 9:41, full bars, 100% battery, carrier hidden.
xcrun simctl status_bar "iPhone 16 Pro Max" override \
  --time "9:41" \
  --dataNetwork wifi \
  --wifiMode active \
  --wifiBars 3 \
  --cellularMode active \
  --cellularBars 4 \
  --batteryState charged \
  --batteryLevel 100 \
  --operatorName ""

# 3. Force light appearance for consistency across the strip
#    (shoot a dark-mode alt set later if desired).
xcrun simctl ui "iPhone 16 Pro Max" appearance light

# 4. Launch the app (bundle id no.akashic.app), navigate to the target screen,
#    then capture. --type=png keeps it lossless.
xcrun simctl screenshot "iPhone 16 Pro Max" shot1-globe.png

# 5. When done, clear the overrides so the sim returns to normal.
xcrun simctl status_bar "iPhone 16 Pro Max" clear
```

Repeat step 2 + 4 for each of the six screens. For the iPad set, substitute the
device name in every command and re-capture.

### Notes / gotchas
- `simctl status_bar override` only affects the **status bar**, not app content —
  it will not fake data inside Akashic. Load the real fixtures/demo journey in the
  app first, navigate to the screen, then screenshot.
- The globe animates. For a crisp shot, let the fly-to camera settle (or add a
  brief pause) before capturing — motion blur reads as a rendering glitch in a
  static screenshot. A short `sleep 1` after navigation, before `screenshot`, is
  usually enough.
- Raw simulator dimensions already match App Store Connect's required pixel sizes
  for these two devices, so no upscaling is needed — but confirm the exact px in
  the table above after capture (`sips -g pixelWidth -g pixelHeight shot1-globe.png`).
- Keep any visible participant/owner names fictional in the sharing shot; keep the
  three real journey titles (they're the owner's own and are the marketing).
- A **preview video** of the globe rotating (§4.6 mentions it) is a strong add but
  optional for first submission — capture with `xcrun simctl io <device> recordVideo`
  once the six stills are locked.

### Suggested output naming
```
6.9/  1-globe.png  2-day.png  3-photos.png  4-elevation.png  5-share.png  6-export.png
13/   1-globe.png  2-day.png  3-photos.png  4-elevation.png  5-share.png  6-export.png
```
