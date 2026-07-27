import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EVENTS_USED, MAPKIT_EVENT_NAMES, MAPKIT_MAP_EVENT_NAMES, assertKnownEvent } from './events';

const HERE = resolve(process.cwd(), 'src/lib/map/mapkit');

/**
 * The misspelled-event trap, made mechanical.
 *
 * MEASURED (scripts/mapkit/surface-probe/?probe=ready): `map.addEventListener('this-name-is-not-real')` and
 * five plausible-looking names — `load`, `ready`, `idle`, `render`, `tiles-loaded` — all attached with no
 * throw, no console warning and no `error` event, and fired **zero** times. A listener that cannot fire is
 * indistinguishable from a feature that is quiet, which is the same shape as the ignored-`waitForExistence`
 * trap in `CLAUDE.md`.
 */
describe('MapKit event names (MAP-03)', () => {
    it('accepts every real name', () => {
        for (const name of MAPKIT_EVENT_NAMES) {
            expect(assertKnownEvent(name)).toBe(name);
        }
    });

    it('throws on the names that MapKit itself accepts and never fires', () => {
        for (const name of ['load', 'ready', 'idle', 'render', 'tiles-loaded', 'this-name-is-not-real']) {
            expect(() => assertKnownEvent(name), `"${name}" must be rejected`).toThrow(/not a MapKit JS event/);
        }
    });

    it('keeps annotation and namespace events out of the MAP event set', () => {
        // Measured: `drag-start` on the map object fires never — it is real on an ANNOTATION. Same for
        // `configuration-change`, which is real on the `mapkit` namespace. Using one on the wrong object is
        // the invisible no-op this file exists to prevent, so the spellings are accepted while the map set
        // stays the answer to "what can a map dispatch".
        expect(MAPKIT_MAP_EVENT_NAMES).not.toContain('drag-start');
        expect(MAPKIT_MAP_EVENT_NAMES).not.toContain('configuration-change');
        expect(MAPKIT_EVENT_NAMES).toContain('drag-start');
    });

    it('does not accept `start-up-complete` as the readiness signal', () => {
        // It is a real name, so the allowlist lets it through — but it was measured at 952 ms, 26 264 ms and
        // once not at all within 9 s. Gating readiness on it would put a variable multi-second wait under
        // every Playwright spec's openApp(). The name is here; the USE is not.
        expect(MAPKIT_MAP_EVENT_NAMES).toContain('start-up-complete');
        expect(EVENTS_USED.ready).toBe('map-node-ready');
    });

    it('every name the adapter subscribes to is in the allowlist', () => {
        for (const [role, name] of Object.entries(EVENTS_USED)) {
            expect(MAPKIT_EVENT_NAMES, `EVENTS_USED.${role}`).toContain(name);
        }
    });

    it('no adapter file passes a raw string literal to addEventListener', () => {
        // The allowlist only helps if it is on the path. This catches someone bypassing assertKnownEvent —
        // which is the exact mistake it exists to prevent, and which would otherwise be invisible.
        const offenders: string[] = [];
        for (const entry of readdirSync(HERE)) {
            if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
            readFileSync(join(HERE, entry), 'utf8').split('\n').forEach((line, i) => {
                const trimmed = line.trim();
                if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;   // prose, not a call
                if (/\.addEventListener\(\s*['"`]/.test(line)) offenders.push(`${entry}:${i + 1} ${trimmed}`);
            });
        }
        // DOM `element.addEventListener('click', …)` is fine and common in annotations.ts; only MapKit
        // subscriptions must go through the guard, so allow the DOM event names explicitly.
        const mapkitish = offenders.filter(o => !/'(click|load|error|mouseenter|mouseleave)'/.test(o));
        expect(mapkitish, ['A MapKit addEventListener bypasses assertKnownEvent:', ...mapkitish].join('\n'))
            .toEqual([]);
    });
});
