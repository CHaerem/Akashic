/**
 * Supabase data layer for journeys
 *
 * This file re-exports from the modular journeys/ directory.
 * Direct imports from this file are preserved for backwards compatibility.
 *
 * For new code, prefer importing directly from 'lib/journeys' or specific submodules:
 * - import { fetchJourneys, getTrekData } from '../lib/journeys'
 * - import { fetchPhotos } from '../lib/journeys/photoAPI'
 */

export * from './journeys/index';
