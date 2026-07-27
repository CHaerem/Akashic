/**
 * Load MapKit JS from Apple's CDN and initialise it, exactly once. (MAP-03)
 *
 * The **only** file in the repo that names `cdn.apple-mapkit.com` or reads `VITE_MAPKIT_TOKEN`.
 *
 * ## Two traps this exists to contain
 *
 * 1. **`mapkit.addEventListener('configuration-change')` must be registered BEFORE `mapkit.init`.**
 *    Registered after, the `Initialized` status has already been dispatched and the promise never settles —
 *    with no error anywhere. Measured: `Initialized` arrives 743–864 ms after the script loads.
 * 2. **There is no `map.loaded` and no tile event**, so "ready" means two signals, not one: the namespace
 *    reaching `Initialized` (here) and the map node existing (`map-node-ready`, in the hook). Anything gated
 *    on `start-up-complete` instead is a coin flip — it was 952 ms in one run, 26 264 ms in the next, and did
 *    not fire at all inside 9 s in a third. See `./events.ts`.
 *
 * The token is public by design: it ships in the client bundle and is protected by its `origin` claim, not by
 * secrecy. `scripts/mapkit/mintToken.mjs` documents what Apple actually enforces (the short version: the
 * claim must be `akashic.no,*.akashic.no` — a bare domain and a wildcard are disjoint, and one alone breaks
 * half the visitors).
 */

import type { MapKitNamespace } from './mapkitTypes';
import { assertKnownEvent } from './events';

const MAPKIT_SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';

/** How long to wait for `Initialized` before giving up with something actionable. */
const INIT_TIMEOUT_MS = 15_000;

/** Module-level, so a remount or a second surface reuses one namespace rather than racing another init. */
let pending: Promise<MapKitNamespace> | null = null;

export function mapKitToken(): string | undefined {
    const token = import.meta.env.VITE_MAPKIT_TOKEN;
    return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** Reset the memoised load. Tests only — production has exactly one namespace per document. */
export function resetMapKitLoaderForTests(): void {
    pending = null;
}

export function loadMapKit(token: string): Promise<MapKitNamespace> {
    if (pending) return pending;

    pending = new Promise<MapKitNamespace>((resolve, reject) => {
        if (!token) {
            reject(new Error(
                'No MapKit token. Set VITE_MAPKIT_TOKEN — mint one with '
                + '`node scripts/mapkit/devToken.mjs` for local work, or in CI from the MAPKIT_PRIVATE_KEY '
                + 'secret via scripts/mapkit/mintToken.mjs.',
            ));
            return;
        }

        const fail = (message: string) => {
            pending = null;               // let a later attempt retry rather than caching the failure
            reject(new Error(message));
        };

        const init = (mapkit: MapKitNamespace) => {
            const timer = setTimeout(() => fail(
                `MapKit did not reach "Initialized" within ${INIT_TIMEOUT_MS} ms. The usual cause is a token `
                + `whose origin claim does not cover ${window.location.origin} — Apple returns `
                + `ORIGIN_CHECK_FAILURE, and note a bare domain does NOT cover its subdomains. See `
                + `scripts/mapkit/mintToken.mjs for the measured matrix.`,
            ), INIT_TIMEOUT_MS);

            // BEFORE init. Registered after, this never fires and nothing says so.
            mapkit.addEventListener(assertKnownEvent('configuration-change'), (event) => {
                if (event.status === 'Initialized') {
                    clearTimeout(timer);
                    resolve(mapkit);
                } else if (event.status === 'Error') {
                    clearTimeout(timer);
                    fail('MapKit reported configuration-change status "Error" — almost always a rejected '
                        + 'token. Check its origin and exp claims.');
                }
            });
            mapkit.init({ authorizationCallback: (done) => done(token) });
        };

        if (window.mapkit) {
            init(window.mapkit);
            return;
        }

        const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPKIT_SRC}"]`);
        if (existing) {
            existing.addEventListener('load', () => {
                if (window.mapkit) init(window.mapkit);
                else fail('mapkit.js loaded but window.mapkit is undefined.');
            });
            return;
        }

        const script = document.createElement('script');
        script.src = MAPKIT_SRC;
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.addEventListener('load', () => {
            if (window.mapkit) init(window.mapkit);
            else fail('mapkit.js loaded but window.mapkit is undefined.');
        });
        script.addEventListener('error', () => fail(
            `Could not load ${MAPKIT_SRC}. MapKit JS is served from Apple's CDN — there is no npm package and `
            + `no offline fallback, so this surface cannot render without network access to that host.`,
        ));
        document.head.appendChild(script);
    });

    return pending;
}
