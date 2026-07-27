import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * MAP-01 — the test that keeps the map boundary from eroding.
 *
 * ARCH-01's whole premise is that a future vendor change is ONE job because the map sits behind an
 * adapter. That premise decays the first time someone reaches past the boundary for a vendor type, and it
 * decays invisibly: the code still compiles, the tests still pass, and the cost only appears years later
 * when the swap is quoted. A comment asking people not to do it is not a boundary. This is.
 *
 * Deliberately a source-text test rather than a lint rule: it needs no plugin, it fails with the offending
 * file and line, and it survives a lint config being rewritten.
 */

// process.cwd() is the project root under vitest. Resolved rather than derived from import.meta.url,
// which yielded a bare "/src" here and made the first run fail on ENOENT.
const SRC = resolve(process.cwd(), 'src');

/**
 * Files allowed to name a map vendor. Everything here IS the adapter.
 *
 * MAP-05 removed three entries — `hooks/mapbox/`, `hooks/useMapbox.ts` and `components/MapboxGlobe.tsx` —
 * because the files themselves are gone. One vendor is left.
 */
const ADAPTER = [
    'components/MapKitJourneyMap.tsx',  // MAP-03: the MapKit component implementing MapSurfaceProps
    'lib/map/',                         // the contract itself, AND lib/map/mapkit/ — the MapKit adapter
];

// Deliberately NOT in ADAPTER: `components/MapSurface.tsx`. It composes the globe and the journey surface and
// picks between them, but names no vendor SDK — so it is held to the same standard as the rest of the app, and
// the day it reaches for `window.mapkit` the test below catches it.

/**
 * MAP-02's tokenless globe, held to a STRICTER standard than the rest of the app.
 *
 * These files are the landing globe: `src/lib/globe/` and the component that mounts it. They are sited
 * outside `lib/map/` on purpose, because `lib/map/` is in ADAPTER above — putting the globe under
 * `src/lib/map/globe/` (as MAP-02's original file list proposed) would have placed it inside the very
 * allowlist that exempts files from these checks, and MAP-02's central promise would have been guarded by
 * nothing at all.
 *
 * The last test in this file is the mechanical statement of that promise: no map service, no token, no
 * vendor SDK, not even a mention. It is stricter than the two checks above, which only ban imports and
 * globals — here even the substring is a failure, because the whole value of this screen is that it has no
 * runtime dependency that can lapse.
 */
const TOKENLESS_GLOBE = [
    'lib/globe/',
    'components/AkashicGlobe.tsx',
];

/** Any mention at all, not just an import. Deliberately broader than VENDOR_IMPORTS. */
const ANY_VENDOR_MENTION = /mapbox|mapkit|maplibre|leaflet|google\.maps|openlayers/i;

/**
 * Vendor globals that must not appear outside the adapter.
 *
 * MAP-03: **MapKit JS is not on npm.** It arrives as a global from a `<script>` tag pointing at
 * `cdn.apple-mapkit.com`, so `VENDOR_IMPORTS`' `/from ['"]mapkit['"]/` can never fire — it is a guard against
 * a package that does not exist. Without this second check the MapKit half of the boundary was decorative.
 */
const VENDOR_GLOBALS = [
    /\bwindow\.mapkit\b/,
    /\bmapkit\.[A-Za-z]/,
    // MAP-05 KEPT this deliberately, and its job changed rather than ended. While Mapbox shipped it was half
    // of a boundary; now that the package is gone it is a REINTRODUCTION guard, which is worth more — the
    // cheapest way to undo MAP-05 is `npm i mapbox-gl` in a hurry, and this fails on the first line of it.
    /\bmapboxgl\.[A-Za-z]/,
];

/**
 * Vendor SDK identifiers that must not appear in an import outside the adapter.
 *
 * The three `mapbox` patterns survive MAP-05 for the reason given in VENDOR_GLOBALS: nothing in the tree can
 * satisfy them any more, so they are a tripwire on the package coming back rather than a boundary between
 * two live vendors. Note they are scoped to files OUTSIDE the adapter, so they would not catch a
 * reintroduction inside `lib/map/` — `assertNoFixtureInBundle`-style bundle checks and the missing
 * dependency in `package.json` are the other two layers.
 */
const VENDOR_IMPORTS = [
    /from\s+['"]mapbox-gl['"]/,
    /from\s+['"]mapbox-gl\/[^'"]*['"]/,
    /from\s+['"]@?mapbox\/[^'"]*['"]/,
    /from\s+['"]mapkit['"]/,          // pre-emptive: MapKit JS is a CDN global, not a package
    /from\s+['"]@?apple\/mapkit[^'"]*['"]/,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry !== 'node_modules') sourceFiles(full, out);
        } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

const files = sourceFiles(SRC).map(f => ({ path: f, rel: relative(SRC, f) }));

describe('map vendor boundary (MAP-01)', () => {
    it('finds the source tree at all', () => {
        // Guards against the suite silently passing because the glob broke — a boundary test that
        // inspects zero files is worse than no boundary test, since it reports success.
        expect(files.length).toBeGreaterThan(50);
    });

    it('no file outside the adapter imports a map vendor', () => {
        const offenders: string[] = [];
        for (const { path, rel } of files) {
            if (ADAPTER.some(a => rel.startsWith(a))) continue;
            if (rel.endsWith('boundary.test.ts')) continue;   // this file names them on purpose
            const lines = readFileSync(path, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (VENDOR_IMPORTS.some(re => re.test(line))) {
                    offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
                }
            });
        }
        expect(offenders, [
            'A file outside the map adapter imports a map vendor directly.',
            'Route it through src/lib/map/types.ts instead — see ARCH-01. If this file genuinely IS',
            'part of the adapter, add it to ADAPTER above and say why in the commit.',
            '',
            ...offenders,
        ].join('\n')).toEqual([]);
    });

    it('no file outside the adapter touches a map vendor GLOBAL', () => {
        // The import ban cannot see MapKit at all — it is a CDN script tag, not a package. See VENDOR_GLOBALS.
        const offenders: string[] = [];
        for (const { path, rel } of files) {
            if (ADAPTER.some(a => rel.startsWith(a))) continue;
            if (rel.endsWith('boundary.test.ts')) continue;   // this file names them on purpose
            const lines = readFileSync(path, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (VENDOR_GLOBALS.some(re => re.test(line))) {
                    offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
                }
            });
        }
        expect(offenders, [
            'A file outside the map adapter reaches for a map vendor global.',
            'MapKit JS in particular has no import to ban — it is window.mapkit, put there by a CDN script',
            'tag — so this is the only check that can catch it. Route the need through',
            'src/lib/map/types.ts, or add the file to ADAPTER and say why in the commit.',
            '',
            ...offenders,
        ].join('\n')).toEqual([]);
    });

    it('MAP-02: the tokenless globe names no map vendor in CODE, only in prose', () => {
        // The rule is "no vendor code", not "no vendor word". The globe's comments cite the Mapbox globe
        // constantly and should: they record what each behaviour replaced, which measurements justified
        // dropping zoom and terrain, and why the missing-token path has no counterpart. Deleting that
        // history to satisfy a regex would make the code worse. So a vendor mention is allowed on a
        // comment line and banned everywhere else — which still catches the thing that matters, an
        // import or an API call sneaking into the one screen that must have no runtime dependency.
        const offenders: string[] = [];
        const globeFiles = files.filter(({ rel }) => TOKENLESS_GLOBE.some(g => rel.startsWith(g)));

        for (const { path, rel } of globeFiles) {
            readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
                if (!ANY_VENDOR_MENTION.test(line)) return;
                const t = line.trim();
                const isComment = t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
                if (!isComment) offenders.push(`${rel}:${i + 1}  ${t}`);
            });
        }

        expect(offenders, [
            'The landing globe reached for a map vendor.',
            'MAP-02 exists so that the first screen keeps working with no token and no tile service — if a',
            'vendor lapses, the visitor still sees a rotating Earth. A vendor name in executable code here',
            'defeats the whole point. Keep the explanation in a comment and the dependency out.',
            '',
            ...offenders,
        ].join('\n')).toEqual([]);
    });

    it('MAP-02: the globe is sited OUTSIDE the adapter allowlist, so the check above can bite', () => {
        // The trap this guards: if the globe were moved under `src/lib/map/globe/`, `lib/map/` in ADAPTER
        // would exempt it from the import and global checks, and a stray vendor import would pass all of
        // them. The assertion is on the layout itself rather than on anyone remembering why.
        for (const dir of TOKENLESS_GLOBE) {
            expect(
                ADAPTER.some(a => dir.startsWith(a)),
                `${dir} must not sit inside an ADAPTER path — it would exempt the tokenless globe from the vendor checks.`,
            ).toBe(false);
        }
        // And the files must actually exist, or both globe tests pass by inspecting nothing.
        const globeFiles = files.filter(({ rel }) => TOKENLESS_GLOBE.some(g => rel.startsWith(g)));
        expect(globeFiles.length).toBeGreaterThan(4);
    });

    it('the adapter is where the vendor actually lives, so the tests are not vacuous', () => {
        // If the adapter stopped naming its vendor, the checks above would pass for the wrong reason: every
        // file would be clean because no file talks to a map at all.
        //
        // MAP-05 RETARGETED this test rather than deleting it, as the previous comment here instructed. It
        // used to make two assertions, one per live vendor, and the Mapbox half was computed from `ADAPTER`
        // minus `lib/map/` — a filter that existed only because the Mapbox adapter lived under `hooks/`.
        // With those three entries removed that filter selects exactly one file, so it was not a
        // one-line deletion: the expression went with the assertion, and what remains is stated directly
        // against the MapKit adapter's own paths instead of being derived from ADAPTER by subtraction.
        const adapterFiles = files.filter(
            ({ rel }) => rel.startsWith('lib/map/mapkit/') || rel === 'components/MapKitJourneyMap.tsx',
        );

        // Guard the filter itself, not just its output — the failure mode this whole test exists to catch is
        // "inspected nothing and reported success", and a renamed directory would reproduce it exactly.
        expect(
            adapterFiles.length,
            'the MapKit adapter has no files — this test would pass vacuously. Did lib/map/mapkit/ move?',
        ).toBeGreaterThan(5);

        const adapterText = adapterFiles.map(({ path }) => readFileSync(path, 'utf8')).join('\n');
        expect(adapterText).toMatch(/mapkit/i);
    });
});
