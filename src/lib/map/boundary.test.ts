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

/** Files allowed to name a map vendor. Everything here IS the adapter. */
const ADAPTER = [
    'hooks/mapbox/',                    // the Mapbox implementation
    'hooks/useMapbox.ts',               // its re-export shim
    'components/MapboxGlobe.tsx',       // the component implementing MapSurfaceProps
    'components/MapKitJourneyMap.tsx',  // MAP-03: the MapKit component implementing the same contract
    'lib/map/',                         // the contract itself, AND lib/map/mapkit/ — the MapKit adapter
];

// Deliberately NOT in ADAPTER: `components/MapSurface.tsx`. It composes the two vendor components and picks
// between them, but names no vendor SDK — so it is held to the same standard as the rest of the app, and the
// day it reaches for `window.mapkit` the test below catches it.

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
    /\bmapboxgl\.[A-Za-z]/,
];

/** Vendor SDK identifiers that must not appear in an import outside the adapter. */
const VENDOR_IMPORTS = [
    /from\s+['"]mapbox-gl['"]/,
    /from\s+['"]mapbox-gl\/[^'"]*['"]/,
    /from\s+['"]@?mapbox\/[^'"]*['"]/,
    /from\s+['"]mapkit['"]/,          // pre-emptive: MAP-03 must not leak either
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

    it('the adapter is where the vendors actually live, so the tests are not vacuous', () => {
        // If an adapter stopped naming its vendor, the checks above would pass for the wrong reason.
        // BOTH vendors must be findable here while both exist. When MAP-05 deletes Mapbox, drop the mapbox
        // line — do NOT drop the whole test, or the boundary goes unguarded again.
        const adapterText = files
            .filter(({ rel }) => ADAPTER.some(a => rel.startsWith(a)) && !rel.startsWith('lib/map/'))
            .map(({ path }) => readFileSync(path, 'utf8'))
            .join('\n');
        expect(adapterText).toMatch(/mapbox/i);

        // lib/map/ is included for MapKit: unlike Mapbox, most of its adapter lives under lib/map/mapkit/.
        const mapkitAdapterText = files
            .filter(({ rel }) => rel.startsWith('lib/map/mapkit/') || rel === 'components/MapKitJourneyMap.tsx')
            .map(({ path }) => readFileSync(path, 'utf8'))
            .join('\n');
        expect(mapkitAdapterText).toMatch(/mapkit/i);
    });
});
