# Coastline geometry — source, licence, and what it costs

MAP-02. The landing globe draws its continents from vendored public-domain geometry. This file records
where it came from and what it weighs, because two earlier tasks in this repo went wrong on exactly this:
LEG-16 deleted 3.8 MB of unattributed imagery, and LEG-17 nearly committed a 14-byte `404: Not Found`
body as a font licence.

## Source

| | |
|---|---|
| Dataset | Natural Earth 1:110m Physical — `ne_110m_land` |
| URL | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_land.geojson` |
| Version | tag `v5.1.2` |
| SHA-256 | `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9` |
| Size | 138 160 bytes |
| Licence | Public domain — `./LICENSE-natural-earth.md`, committed alongside |
| Committed copy | `scripts/geo/ne_110m_land.geojson` |

Verified at download rather than assumed: **HTTP 200, 138 160 bytes**, and the content checked to be
127 features / 128 rings / 5143 points with a latitude range of **−90 to +83.645**. The generator
re-asserts the byte count and hash on every run, so a silent upstream change fails the build step rather
than the screen.

The licence was fetched and read, not just status-checked: **HTTP 200, 4636 bytes**, opening
"Everything here is public domain." Attribution is not required; the suggested credit line is
"Made with Natural Earth."

**The LEG-17 trap is live in that same repository and was reproduced during this work.** The same tag's
`/LICENSE`, without the `.md`, returns **HTTP 404 with a 14-byte body reading `404: Not Found`** — which a
careless download would commit as the licence. Check byte counts, not status codes alone.

## Why this resolution, and not the alternatives

- **1:110m is enough.** Median segment 0.567°, which is 2.55 px on the 515 px-diameter globe the
  committed desktop baseline shows.
- **1:50m was rejected on measurement**: 1 636 166 bytes raw / 530 230 gzip, ~10× the cost, for a median
  segment of 0.31 px — sub-pixel. It cannot show detail the screen can resolve.
- **`world-atlas` TopoJSON (20 722 B gzip) was rejected despite being the cheapest option**, because it is
  merged from Natural Earth's `admin_0` countries and therefore **clips Antarctica at −85.6°**. On an
  orthographic globe that is a straight cut across the south polar cap, visible on any southward camera.
  Measured: its latitude range is −85.609 to +83.645 against −90 here. `coastline.test.ts` asserts
  `minLat === -90` so a future swap to a countries-derived dataset fails a test.
- **Coastline *lines* (`ne_110m_coastline`) were rejected**: marginally larger for the same information,
  and open linestrings cannot be filled — so there would be no polygon for the horizon clip to test
  against and no way to shade the continents.

## Encoding

`scripts/geo/buildCoastline.mjs` emits `coastline.generated.ts`. It quantises to a 0.01° integer grid,
delta-encodes each ring against the previous point, drops GeoJSON's repeated closing point (128 points),
and embeds the result as one JSON string literal read back by `decodeRings` in `./coastline.ts`.

0.01° is **0.03 px** at the shipped globe size, where one pixel is ~0.35°. The quantisation is invisible.

| Form | Raw | Gzip −9 |
|---|---|---|
| Source GeoJSON | 138 160 | 51 269 |
| Packed delta JSON | **36 280** | **14 529** |
| Generated module (with provenance and comments) | 37 566 | 15 669 |

That is **74 % off raw and 72 % off gzip** for identical geometry — same 5015 points, same coastline.

No Ramer–Douglas–Peucker simplification, deliberately. It would save perhaps a further 40 %, and it would
cost the ability of `horizon.test.ts` to separate renderer error from encoder error: that harness compares
the rendered path against a ray-cast of *these* rings, so both sides must describe the same coastline. If
the bytes are ever wanted, add RDP in the generator, keep small rings whole below a projected-area
threshold, assert ring closure and a point-count floor, and re-point the harness's ray-cast side at the
unsimplified geometry so it still measures total error.

## Why a TS module instead of `public/geo/`

MAP-02's declared file list said `public/geo/**`. This deviates from it, measured:

`vite.config.js`'s Workbox `globPatterns` is `**/*.{js,css,html,ico,png,svg,json,woff,woff2}`. **A file
named `land.geojson` does not match** — `"land.geojson"` does not end in `".json"` — so it would land in
`dist/` and get zero references in `sw.js`, and the landing globe would be blank on an offline first
visit while every gate stayed green. `.bin` fails identically. Naming it `.json` dodges the trap but
leaves it one rename away from returning; a generated `.ts` becomes a content-hashed `.js` chunk, which
matches, so the bug becomes structurally impossible. It also needs no edit to `vite.config.js`, which is
outside this task's file list.

## Byte cost of MAP-02, measured on this tree

"Before" is commit `8bc4a99` extracted with `git archive` into a clean directory and built there, rather
than reached by stashing in place. That distinction is the whole reason these numbers can be trusted: a
stash leaves UNTRACKED files behind, so a "before" build taken that way can still contain part of the
feature and quietly flatter the delta. Both sides are `rm -rf dist && npm run build`.

| | Entries | Precache | `dist/` on disk | total `dist/` bytes |
|---|---|---|---|---|
| Before (`8bc4a99`, isolated) | 48 | 7764.00 KiB | 8620 KB | 8 091 595 |
| After | 49 | 7810.94 KiB | 8668 KB | 8 139 730 |

**+1 precache entry, +46.94 KiB (+0.60 %), +48 KB on disk, +48 135 B of total output.** Where it goes:

| Chunk | Before | After | Delta |
|---|---|---|---|
| `assets/coastline.generated-*.js` | — | 36 322 B raw / 14 659 B gzip | new, code-split |
| `assets/AkashicApp-*.js` | 206 252 B raw | 217 785 B raw | **+11 533 B raw** |

The second row is the component, the projection, the horizon clip and the renderer together — about 11.5 kB
of code for the whole feature, against 36 kB of geometry. 36 322 + 11 533 = 47 855, within 280 B of the
measured total; the remainder is the index chunk and one CSS rule.

**Correcting this table is why it reads the way it does.** The first version of it claimed +6585 B for the
code row and "about 6.6 kB for the whole feature". That was measured against a baseline whose
`AkashicApp` chunk was 211 200 B, and no commit in this history produces that figure — the isolated build
of `8bc4a99` gives 206 252 B. The most likely cause is a stash-in-place baseline that still held part of
the globe code, inflating "before" and shrinking the apparent delta. An adversarial pass caught that the
number was wrong, and then reported its own baseline (7754.34 KiB / 196 362 B) which does not reproduce
either — the isolated build matches the precache and disk figures above exactly. So all three passes
disagreed, and the table now carries only what an isolated `git archive` build produces. If you re-measure
and get something else, distrust this file and say so here: a byte figure written into a provenance
document as fact is precisely the failure mode this repo's traps file exists to prevent.

The coastline is its own chunk because `coastline.ts` reaches it through a dynamic `import()`, so it is
deferred past first paint — the globe draws its sphere, atmosphere and journey pins without it. Verified
that it is still precached and the extension trap above is genuinely avoided: `dist/sw.js` contains 49
`url:` entries and one of them is `coastline.generated-txXG1mJz.js`.

Report both raw and gzip. Workbox's Cache Storage keeps decompressed bodies, so raw bytes are the
visitor's disk footprint while gzip is their download; quoting only the gzip figure understates the cost.

Report this honestly and do not net it against MAP-05. `dist/assets/mapbox-*.js` is 1 664 111 bytes raw /
458.75 KiB gzip and its removal is **MAP-05's** credit, not this task's. The track is strongly net negative
on bytes; MAP-02 alone is net positive by a third of a percent.
