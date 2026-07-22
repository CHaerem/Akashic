/**
 * Journeys, and the cache the whole app reads from.
 *
 * CloudKit is the only backend (T3.4). Editing a journey is native-only (D6); the
 * adapter's write functions are guarded no-ops.
 */

import type { TrekConfig, TrekData, Route } from '../../types/trek';
import { getJourneyCacheState } from './journeyCache';

/** Editable journey fields. Declared here because the adapter imports the shape. */
export interface JourneyUpdate {
    name?: string;
    description?: string;
    country?: string;
    date_started?: string | null;
    date_ended?: string | null;
    total_days?: number | null;
    total_distance?: number | null;
    summit_elevation?: number | null;
    route?: Route | null;
}

export {
    fetchJourneys,
    getJourneyIdBySlug,
    getJourneyForEdit,
    updateJourney,
    updateJourneyRoute,
} from './adapters/cloudkit/journeyAdapter';

// --- Cache accessors (backend-independent) ----------------------------------

/** The whole cache. Populated by `fetchJourneys`. */
export function getJourneyCache() {
    return getJourneyCacheState();
}

export function getTrekData(id: string): TrekData | null {
    return getJourneyCacheState().trekDataMap[id] || null;
}

export function getTrekConfig(id: string): TrekConfig | null {
    return getJourneyCacheState().treks.find((t) => t.id === id) || null;
}

export function isDataLoaded(): boolean {
    return getJourneyCacheState().loaded;
}
