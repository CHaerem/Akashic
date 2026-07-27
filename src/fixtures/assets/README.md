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
- `route.coordinates` must hold **at least two** entries. THE REASON FOR THIS CHANGED UNDER MAP-05
  and the constraint did not, so do not delete it along with its old citation. It used to be a crash:
  `useMapbox.ts:1131-1134` dereferenced `coordinates[0][0]` unguarded in the no-camp branch — the
  state entered by clicking "Explore Journey →" — and threw inside a `requestAnimationFrame`
  callback, landing in the console uncaught and failing the zero-console-error tests. MAP-05 deleted
  that surface, and the MapKit path GUARDS the case
  (`src/lib/map/mapkit/geometry.ts:142`, `if (coordinates.length < 2) return null`), so the crash is
  gone. What remains is the plain-validity reason, which was always the better one: fewer than two
  points is not a LineString. A one-point route now degrades silently to "no route drawn" instead of
  throwing — a *worse* failure mode for a fixture, because nothing goes red.
- Waypoint keys are **camelCase** (Swift `Codable`, `apple/Akashic/Models/Domain.swift`) and the
  day text field is `notes`, not `description`. `snakeCaseKeys` + `mapWaypoint` handle the
  conversion; writing snake_case here would bypass the code under test.
