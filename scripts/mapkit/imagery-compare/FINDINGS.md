# Apple MapKit JS vs Mapbox satellite imagery — measured 2026-07-27

MAP-03's first gate. ARCH-01 chose Apple MapKit for both surfaces on a parity argument: `mapType`
satellite gives the web the same imagery the native app draws. That argument only holds where Apple's
coverage is good, and this app's journeys are in East Africa and the Himalaya — the regions the ledger
flagged as unverified. **If Apple were visibly worse there, ARCH-01 would be wrong**, and it is far
cheaper to learn that before MAP-05 deletes Mapbox.

Measured with the real key (`9UN97VBZR8`), MapKit JS 5.81.65, mapbox-gl 3.9.0, `satellite-v9`
(unlabelled, the fair match for MapKit's Satellite).

## Verdict

**ARCH-01 survives.** Apple's coverage is not systematically worse in either region. Five of seven views
are at parity, one favours Apple clearly, one favours Mapbox clearly — and the one that favours Mapbox is
a specific, narrow, mitigable defect rather than a coverage failure.

| View | m/px (Apple / Mapbox) | Result |
|---|---|---|
| Kilimanjaro — Uhuru Peak | 19.75 / 19.76 | **Parity.** Near-identical; same glaciers, crater rim, radial gullies, same cloud patches in the same places. Mapbox marginally warmer and more contrast-boosted, Apple marginally softer. |
| Kilimanjaro — Barranco, close | 4.83 / 4.83 | **Parity.** Effectively the same frame, down to the cloud shadow. Trail switchbacks and ravines legible on both. |
| Everest — Khumbu / base camp | 19.75 / 19.76 | **Apple worse — the one real finding.** Apple's mosaic here carries heavy cloud and cloud shadow over much of the frame, plus a visible vertical tile seam. Mapbox is essentially cloud-free, with crevasse fields and moraine crisply readable. |
| Everest — Khumbu Icefall, close | 4.83 / 4.83 | **Apple better, clearly.** Apple holds serac and crevasse structure, moraine ridges and the teal glacial ponds. Mapbox is blown out — flat over-exposed white with much of that detail lost. |
| Mount Kenya — Batian & Nelion | 10.97 / 10.98 | **Parity.** Identical, including the same cloud in the lower-left corner. |
| Inca Trail — Machu Picchu | 6.58 / 6.59 | **Parity.** Same imagery; Apple perhaps a shade sharper on the terraces. |
| Jotunheimen — Norway | 10.97 / 10.98 | **Parity**, Mapbox marginally sharper at the glacier margin and more saturated on the lakes. Apple shows faint tile seams. |

## What the Khumbu finding does and does not mean

It is **zoom-band specific, and it inverts**. The cloudy imagery is in Apple's wide-zoom mosaic
(~20 m/px). At ~5 m/px over the same ground, Apple is the better of the two by a clear margin. So this is
not "Apple's Nepal coverage is bad" — it is one cloudy scene in one mosaic level.

Two consequences for MAP-03:

1. **Do not open a journey at ~20 m/px in the Khumbu.** The arrival framing should be driven by the
   route's own bounds, which for a trek is tighter than the whole massif anyway — and that lands in the
   band where Apple wins. Worth an explicit check when the journey view is built.
2. **Mapbox is not a fallback worth keeping for this.** Keeping a second vendor alive to cover one cloudy
   mosaic level would carry the full 1626 KB chunk, the token, the SW rules and the maintenance, against
   one view of one journey that the framing above already avoids. MAP-05 stands.

## Two methodological traps, both of which produced wrong answers first

**Matching the coordinate span is not matching the view.** `CoordinateRegion` and `fitBounds` each adjust
to the container's aspect ratio, and differently. Asking both for `span: 0.09°` gave Mapbox a tighter
frame, and the first comparison therefore "showed" Apple as washed out and low-detail — an artefact of
comparing two magnifications. The harness now matches on **metres per pixel** with MapKit as the reference
(set its region, read back what it actually chose, give Mapbox that resolution) and prints the achieved
m/px into each pane, so any screenshot carries its own proof of comparability. Every pair above agrees to
within 0.05%.

**A half-loaded map looks exactly like bad coverage.** The very first screenshot of Kilimanjaro showed
Apple as a flat green blur; the same view fully loaded is highly detailed. Related: MapKit renders an empty
grey tile grid while loading, which reads as a coverage hole. Never judge imagery from the first paint.

A third, harness-specific: Mapbox GL drives itself from `requestAnimationFrame`, so in a hidden document
it stops painting entirely — black pane, no error, no failed request, `isStyleLoaded() === false`. That
reads as "Mapbox cannot render here". The harness now nudges `triggerRepaint()` while hidden.

## Re-running it

```bash
node scripts/mapkit/imagery-compare/tokens.mjs   # writes the gitignored tokens.js
```

Then open the `mapcompare` preview and step through `?place=0` … `?place=6`. Give each view several
seconds; judge nothing from the first paint.
