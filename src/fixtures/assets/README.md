# E2E fixture asset bodies

These files are the **CKAsset bodies** of the fixture `PublicJourney` records — the bytes that
`resolveJsonField` (`src/lib/journeys/adapters/cloudkit/records.ts:183`) fetches when it finds a
`{ downloadURL, fileChecksum }` descriptor instead of an inline JSON string. In production those
bodies live behind pre-authenticated `https://cvws.icloud.com/...` URLs; under
`VITE_E2E_TEST_MODE=true` they are served from here.

**How they are served, and why there is no Vite plugin.** MEASURED against Vite 7.3.6: the dev
server already serves files under the project root verbatim —
`GET /src/fixtures/assets/e2e-alpine-loop.route.json` answers `200` with
`Content-Type: application/json`, and `thumb.png` answers `200 image/png`. No `configureServer`
middleware, no change to `vite.config.js`, and nothing in `public/` (which is copied verbatim into
`dist/`, and `vite.config.js`'s `globPatterns` already lists `json` — a fixture body there would
join the service-worker precache manifest that every real visitor downloads).

`npm run build` never emits `src/` into `dist/`, and nothing imports these files, so they cannot
reach a production bundle. `scripts/assertNoFixtureInBundle.mjs` asserts that rather than assuming it.

**Two consumers, one source of truth.** `src/lib/journeys/adapters/cloudkit/publicAdapter.test.ts`
reads these same bytes off disk for its stubbed `fetch`, so the unit suite asserts the CloudKit
mapping against the exact payload the e2e run drives. If a body drifts from what the mappers
expect, a unit test goes red before the e2e gate does.

**Constraints that are load-bearing** (each one has cost real time somewhere in this repo):

- `route.coordinates` must be `[lng, lat, elevation]` **triples**, never pairs. `transforms.ts:65,86`
  and `stats.ts:241` read index `[2]`; pairs give `NaN` elevation maths that renders garbage
  instead of failing.
- `route.coordinates` must hold **at least two** entries. `useMapbox.ts:1131-1134` dereferences
  `coordinates[0][0]` unguarded in the no-camp branch — the state entered by clicking
  "Explore Journey →" — and throws inside a `requestAnimationFrame` callback, which lands in the
  console uncaught and fails the zero-console-error tests. Fewer than two points is also invalid
  GeoJSON for the `route-<slug>` LineString source at `useMapbox.ts:687`.
- Waypoint keys are **camelCase** (Swift `Codable`, `apple/Akashic/Models/Domain.swift`) and the
  day text field is `notes`, not `description`. `snakeCaseKeys` + `mapWaypoint` handle the
  conversion; writing snake_case here would bypass the code under test.
