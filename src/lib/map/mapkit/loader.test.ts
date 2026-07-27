import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadMapKit, resetMapKitLoaderForTests } from './loader';

const SRC = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';

/**
 * A minimal stand-in for the `mapkit` global, built so the two ORDERING traps are observable:
 * `configuration-change` is dispatched once, asynchronously after `init`, and a listener registered after
 * `init` misses it — which is exactly how the real namespace behaves and exactly how a wrong loader hangs
 * forever with no error.
 */
function stubMapKit() {
    const listeners: Array<(event: { status: string }) => void> = [];
    let initialised = false;
    const mapkit = {
        version: '5.81.65',
        addEventListener: (_name: string, handler: (event: { status: string }) => void) => {
            // Registered after init? Then it never hears about it — same as the real thing.
            if (!initialised) listeners.push(handler);
        },
        init: (_options: unknown) => {
            initialised = true;
            queueMicrotask(() => listeners.forEach(h => h({ status: 'Initialized' })));
        },
    };
    return mapkit as unknown as Window['mapkit'];
}

beforeEach(() => {
    resetMapKitLoaderForTests();
    document.head.innerHTML = '';
    delete (window as { mapkit?: unknown }).mapkit;
    vi.useRealTimers();
});

describe('loadMapKit (MAP-03)', () => {
    it('rejects with something actionable when there is no token', async () => {
        await expect(loadMapKit('')).rejects.toThrow(/devToken\.mjs|MAPKIT_PRIVATE_KEY/);
    });

    it('registers configuration-change BEFORE init, or it would never resolve', async () => {
        // The stub drops listeners registered after init. So this test passing IS the ordering assertion:
        // swap the two lines in loader.ts and it hangs, which is what production would do.
        window.mapkit = stubMapKit();
        await expect(loadMapKit('tok')).resolves.toBe(window.mapkit);
    });

    it('injects the CDN script exactly once, however many callers ask', async () => {
        const first = loadMapKit('tok');
        const second = loadMapKit('tok');
        expect(first).toBe(second);
        expect(document.querySelectorAll(`script[src="${SRC}"]`)).toHaveLength(1);

        // Now let the "download" finish, so the promise settles rather than leaking into the next test.
        window.mapkit = stubMapKit();
        document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!
            .dispatchEvent(new Event('load'));
        await expect(first).resolves.toBeDefined();
    });

    it('loads MapKit from Apple\'s CDN, with no npm package and no local fallback', async () => {
        loadMapKit('tok');
        const script = document.querySelector<HTMLScriptElement>('script[src*="apple-mapkit"]');
        expect(script).not.toBeNull();
        expect(script!.src).toBe(SRC);
        // crossOrigin matters: without it the bundle's errors arrive as opaque "Script error".
        expect(script!.crossOrigin).toBe('anonymous');
    });

    it('names the origin claim when the script loads but MapKit never initialises', async () => {
        vi.useFakeTimers();
        const promise = loadMapKit('tok');
        // A namespace that loads and never dispatches Initialized — the shape of a rejected token.
        window.mapkit = { addEventListener: () => {}, init: () => {} } as unknown as Window['mapkit'];
        document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!.dispatchEvent(new Event('load'));
        const assertion = expect(promise).rejects.toThrow(/origin claim|ORIGIN_CHECK_FAILURE/);
        await vi.advanceTimersByTimeAsync(16_000);
        await assertion;
    });

    it('lets a caller retry after a failure instead of caching it forever', async () => {
        const scriptPromise = loadMapKit('tok');
        const failed = expect(scriptPromise).rejects.toThrow(/Could not load/);
        document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!.dispatchEvent(new Event('error'));
        await failed;

        // A cached rejected promise would make the map permanently broken after one flaky network moment.
        window.mapkit = stubMapKit();
        await expect(loadMapKit('tok')).resolves.toBeDefined();
    });
});
