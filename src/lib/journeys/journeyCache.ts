/**
 * Shared module-level journey cache.
 *
 * Extracted from journeyAPI so that whichever backend (Supabase or CloudKit)
 * runs `fetchJourneys` populates the exact same in-memory cache that
 * `getJourneyCache`/`getTrekData`/`getTrekConfig`/`isDataLoaded` read from.
 * The public surface is unchanged — journeyAPI still owns those exports and
 * simply reads/writes this state.
 */

import type { TrekConfig, TrekData } from '../../types/trek';

export interface JourneyCacheState {
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
    loaded: boolean;
}

let cache: JourneyCacheState = {
    treks: [],
    trekDataMap: {},
    loaded: false,
};

/** Get the live cache object (mutations in place are intentional). */
export function getJourneyCacheState(): JourneyCacheState {
    return cache;
}

/** Replace the cache wholesale (used by fetchJourneys). */
export function setJourneyCacheState(next: JourneyCacheState): void {
    cache = next;
}
