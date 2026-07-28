/**
 * What the e2e specs actually reach for on `window.mapkit`, and nothing more. (QUA-42)
 *
 * The first type-check of `e2e/` — which nothing had ever looked at — found exactly two errors, both this:
 * `mapkit-journey.spec.ts` reads `window.mapkit?.maps[0]` inside `page.evaluate` to assert on the LIVE map
 * object rather than on the adapter's own reporting, and the property was undeclared.
 *
 * Deliberately NOT imported from `src/lib/map/mapkit/mapkitTypes.ts`, even though a full namespace type lives
 * there. Two reasons. The vendor boundary is the point of ARCH-01: `src/lib/map/boundary.test.ts` keeps vendor
 * names out of every file outside the adapter, and while it scans `src/` and would not currently catch an
 * import from `e2e/`, reaching across would make the specs depend on the adapter's internal shape — so a
 * refactor inside the adapter would break the tests that are supposed to be checking behaviour from outside.
 * And this file is a statement of what the SPECS require, which is a far smaller surface than what the
 * adapter implements: three properties, read-only. If a spec needs a fourth, adding it here is a deliberate
 * act rather than an inherited convenience.
 *
 * `maps` is the array MapKit maintains of live map instances; `overlays` and `padding` are what the specs
 * assert on. Everything is optional or possibly-undefined on purpose: in a tokenless run the loader is
 * dead-code-eliminated entirely (see the CLAUDE.md trap), so `window.mapkit` genuinely may not exist, and a
 * spec that does not handle that would fail with a TypeError instead of a useful assertion.
 */
declare global {
    interface Window {
        mapkit?: {
            maps: Array<{
                overlays: unknown[];
                padding: { top: number; right: number; bottom: number; left: number };
            }>;
        };
    }
}

export {};
