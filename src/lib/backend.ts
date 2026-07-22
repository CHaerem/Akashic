/**
 * Data backend selection (feature flag)
 *
 * Controls which data layer the app talks to:
 *   - 'supabase' (default): the current Supabase + R2/Worker stack
 *   - 'cloudkit': the Apple CloudKit JS adapter (Phase 4 groundwork)
 *
 * Flip with the VITE_DATA_BACKEND env var. Anything other than the exact
 * string 'cloudkit' resolves to Supabase, so the default is always safe.
 */

export type DataBackend = 'supabase' | 'cloudkit';

const configured = import.meta.env.VITE_DATA_BACKEND;

/** The active data backend (defaults to 'supabase'). */
export const dataBackend: DataBackend =
    configured === 'cloudkit' ? 'cloudkit' : 'supabase';

/** True when the app should route data operations through the CloudKit adapter. */
export const isCloudKitBackend = dataBackend === 'cloudkit';
