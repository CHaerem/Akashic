# Spike B — MapKit globe / terrain (decision D5)

Standalone SwiftUI prototype that tests whether Apple **MapKit** can replace the
Mapbox "signature" experience — spinning **globe → fly-in → 3D terrain**, the
per-day cinematic camera, and the white/cyan route styling — for the Akashic
Apple migration.

- Bundle id: `no.akashic.spike.mapkit`
- Deployment target: **iOS 17.0** (Swift language mode 5)
- Fixture: `Resources/kilimanjaro.json` (bundled copy of the recovered route +
  8 camps; read-only in the real repo)
- Spec being reproduced: `scratchpad/report-globe-map.md` (the Mapbox
  choreography — camera values, durations, colors, rotation behavior)

Everything here lives under `apple/Spikes/MapKitGlobe/` and touches nothing else.

## Build & run

```sh
cd apple/Spikes/MapKitGlobe
xcodegen generate
xcodebuild build -project MapKitGlobe.xcodeproj -scheme MapKitGlobe \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' CODE_SIGNING_ALLOWED=NO
```

Launch on a booted simulator:

```sh
xcrun simctl install booted <DerivedData>/…/MapKitGlobe.app
xcrun simctl launch booted no.akashic.spike.mapkit          # interactive
```

### Deterministic scenes (used for the screenshots)

Launch arguments jump straight to a settled state so `xcrun simctl io booted
screenshot` captures a known frame (taps can't be scripted via simctl):

| Argument | State |
| --- | --- |
| `--scene globe` | full globe, idle spin armed |
| `--scene overview` | route overview (fit bbox) |
| `--scene dayN` | day-N leg with cyan segment (N = 1…8) |
| `--scene probe` | diagnostic close camera at pitch 75 (measures the clamp) |
| `--map-style imagery` \| `hybrid` | pick the base style |

```sh
xcrun simctl launch booted no.akashic.spike.mapkit --scene day3
```

Interactively: tap the glowing pin (or **Fly in**) → **Day 1…8** picker →
**Overview** / **Globe**. The **Hybrid/Imagery** pill (top-right) is the A/B
toggle; the HUD (top-left) prints live `lat/lon/dist/pitch/heading`, the current
stage, and whether the globe is spinning.

## Screenshots/

| File | What it shows |
| --- | --- |
| `01-globe.png` | full globe, day/night terminator, journey pin, idle spin |
| `02-overview.png` | whole route fit to frame, white glowing polyline |
| `03-day.png` | a mid-trek day leg — 3D terrain + highlighted cyan segment |
| `04-imagery-variant.png` | same overview under `.imagery(elevation:.realistic)` |
| `probe.png` | diagnostic — a 900 m camera asked for pitch 75°, HUD shows 30° (the clamp) |

## What to evaluate

1. **Globe look at distance** — does MapKit's low-zoom view read as a "globe"?
   How does its own space/atmosphere compare to Mapbox's transparent-fog +
   CSS-starfield trick?
2. **Terrain quality at Kilimanjaro** — relief fidelity, imagery resolution, and
   whether the 3D exaggeration reads as dramatic as Mapbox's `exaggeration 1.2`.
3. **Camera-animation smoothness & control granularity** vs Mapbox `flyTo` /
   `fitBounds` — easing curves, duration control, chaining, interruption.
4. **Whether MapCamera animations can be chained / interrupted cleanly** during
   rapid day switching.
5. **Route/marker styling parity** — white 0.8 line + 0.15 glow, cyan `#00FFFF`
   segment + glow, amber day badges.

---

## Technical assessment (after running on iPhone 17 Pro sim, iOS 26.5)

Every screenshot below was produced by the deterministic `--scene` launches
above. `Screenshots/probe.png` is a diagnostic: a 900 m-altitude camera asked
for **pitch 75°** — the HUD reads back **30°**.

### Where MapKit MATCHED the Mapbox spec

- **Globe at distance — excellent, arguably better.** A low-zoom
  `centerCoordinateDistance ≈ 42,000 km` at `[30,15]` frames a full disc. With
  `.hybrid(elevation:.realistic)` MapKit renders a real **day/night terminator,
  city lights, atmosphere, and its own starfield** — richer than Mapbox
  `satellite-v9`, with no token, no fog config, no CSS starfield needed.
- **Idle spin — faithful.** A 30 fps `Timer` decrements the camera-center
  longitude **2°/s**, armed **3.5 s** after showing the globe, cancelled on any
  drag/magnify gesture or on fly-in. Smooth; matches §1b behaviour including the
  westward drift.
- **3D terrain quality — very good.** Kilimanjaro's flanks, valleys, the Kibo
  cone and the summit ridge read with genuine relief (`03-day.png`,
  `probe.png`). Comparable to Mapbox `terrain-rgb`, minus the artistic
  exaggeration.
- **Route + segment styling — convincing.** Stacked `MapPolyline`s reproduce the
  white `0.8`/2 pt line over a white `0.15`/12 pt glow, and the cyan `#00FFFF`
  4 pt segment over a cyan `0.5`/15 pt glow. Amber day-number badges
  (`Annotation`) render once Apple POIs are excluded (`probe.png` badge "6").
- **Fly-in choreography — works.** `withAnimation` around `MapCameraPosition`
  changes animates center/distance/heading over the spec durations
  (2.5 / 2.2 / 3.0 s). Re-targeting mid-flight (rapid day switching) animates
  from the current camera without stutter or crash.
- **Fixture-driven camera — correct.** Heading is computed from the route vertex
  5 points back to each camp (HUD `head 159°` on day 3, `45°` on day 5);
  per-camp `bearing`/`pitch` overrides from the fixture are honoured.

### Where MapKit CANNOT match the spec

1. **Pitch is hard-clamped to ~30–35° — the biggest gap.** Every framing that
   fits a route leg clamps pitch: 35° at 61 km (overview), 35° at 12.5 km
   (day 3), 35° at 5.1 km (day 5), and **30° for a 75°-request at 900 m**
   (`probe.png`). MapKit couples max pitch to camera altitude and will not give
   the **55–60° oblique** the Mapbox day legs and overview use. You only approach
   55–60° at a few-hundred-metre eye altitude, which cannot frame a 5–17 km day.
   The cinematic "lean into the mountain" is flattened to a gentle tilt.
2. **No custom fog / atmosphere / terrain exaggeration.** No analogue to Mapbox
   `exaggeration 1.2`, the fog `range`/`space-color`/`horizon-blend`, or
   `sky-atmosphere` tuning. Relief is realistic but subtler than the exaggerated
   signature look; the atmosphere is Apple's, not tunable.
3. **Space rendering is not customisable.** MapKit paints its own opaque space +
   starfield at globe distance, so the app's `#0B0B19` backdrop and seeded
   starfield are **fully occluded** (kept only as an edge-fade fallback). The
   Mapbox transparent-`space-color` + CSS-starfield trick has no MapKit
   equivalent — you take Apple's globe aesthetic as-is.
4. **Easing control is coarse.** SwiftUI offers `.easeInOut/.easeOut/.timingCurve`
   but not Mapbox `flyTo`'s `curve` (the pull-back-through-space-then-dive arc).
   `withAnimation` interpolates center/distance/heading monotonically.
   `MapCameraKeyframeAnimator` (iOS 17) can script a multi-keyframe
   globe→overview→dive with per-keyframe timing and is the right tool for a true
   fly-through, but it still cannot exceed the pitch clamp.
5. **Polyline "glow" is faked and non-emissive.** MapKit overlays have no
   `line-blur` and no emissive strength; the glow is a wider translucent
   polyline underneath. It reads well but is a hard-edged translucent band, not a
   real blur, and it does not emit light on the night side of the globe.
6. **Annotation declutter + injected POIs.** MapKit auto-hides overlapping
   annotations and adds its own POIs (Apple's "Barafu Camp" collided with the
   custom badge until `pointsOfInterest: .excludingAll`). At overview zoom the
   eight camp badges will still declutter — less controllable than Mapbox DOM
   markers, which never hide.

### iOS 26-only APIs noticed (code kept iOS 17-compatible)

- The realistic globe/terrain look clearly benefits from the **iOS 26 runtime**
  (this sim is 26.5) — the day/night terminator and relief are richer than on
  older MapKit — but every API used here (`Map(position:)`, `MapPolyline`,
  `Annotation`, `.mapStyle(.hybrid(elevation:pointsOfInterest:))`,
  `onMapCameraChange`, `MapCameraKeyframeAnimator`) is **iOS 17**.
- Honest note: I found **no** iOS-26 API that lifts the pitch clamp or adds
  tunable fog / exaggeration / space theming. The four hard gaps above are
  architectural, not a matter of adopting a newer symbol — a `.mapStyle`
  elevation exaggeration parameter or an unclamped cinematic-camera mode would be
  the features to watch for, but they do not exist as of iOS 26.5.

### Preliminary D5 recommendation — CONDITIONAL GO for MapKit

MapKit convincingly reproduces most of the signature experience — the globe,
terrain quality, route/segment/marker styling, the idle spin, and the fly-in —
and in several ways beats Mapbox (a real day/night globe, native performance, no
access token or usage cost, smaller bundle, one less third-party dependency). The
one genuine casualty is the **steep-pitch cinematic camera**: the ~35° pitch
ceiling at route-framing altitude means the 55–60° "dive into the mountain" is
lost, and custom fog / exaggeration / space theming go with it.

- **GO** if the team accepts a ~35° max oblique (still a strong 3D view) and
  Apple's globe/atmosphere aesthetic, in return for native, tokenless,
  high-quality terrain and one fewer SDK. Use `MapCameraKeyframeAnimator` for the
  scripted fly-through and lean on the day/night globe as a feature, not a
  compromise.
- **Keep Mapbox** (or go hybrid — MapKit globe + Mapbox trek, or vice-versa) only
  if the 55–60° signature dive and the custom night-sky/atmosphere are deemed
  non-negotiable brand identity.

Suggest confirming the pitch-clamp behaviour with Apple (feedback/radar) before
locking D5, since it is the single deciding factor.

### Exact spec values preserved

- Globe center `[lng 30, lat 15]`; approximated Mapbox zoom 1.2–1.5 with
  `MKMapCamera.centerCoordinateDistance = 42,000,000 m`.
- Idle spin: **2°/s** westward longitude decrement, armed **3,500 ms** after
  entering the globe, cancelled on any gesture or fly-in.
- Fly-in durations: overview **2.5 s** ease-in-out, day leg **2.2 s**, return to
  globe **3.0 s**.
- Overview camera: pitch = `preferredPitch 60`, heading = `preferredBearing -20`.
- Day camera: pitch = `camp.pitch ?? 55`, heading = `camp.bearing ?? bearing`
  from the route vertex 5 points back to the camp.
- Colors: route white `0.8` (2 pt) over white `0.15` (12 pt) glow; segment cyan
  `#00FFFF` (4 pt) over cyan `0.5` (15 pt) glow; camps amber
  `rgba(251,191,36,·)`; space `#0B0B19`.
