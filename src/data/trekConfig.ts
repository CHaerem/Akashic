/**
 * Centralized trek configuration - single source of truth
 */

import type { TrekData, TrekConfig } from '../types/trek';
import kilimanjaroData from './kilimanjaro.json';
import mountKenyaData from './mountKenya.json';
import incaTrailData from './incaTrail.json';

type TrekId = 'kilimanjaro' | 'mount-kenya' | 'inca-trail';

/**
 * Trek data mapping by ID
 */
export const trekDataMap: Record<TrekId, TrekData> = {
    'kilimanjaro': kilimanjaroData as TrekData,
    'mount-kenya': mountKenyaData as TrekData,
    'inca-trail': incaTrailData as TrekData
};

/**
 * Trek marker configuration for globe view
 */
export const treks: TrekConfig[] = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        lat: -3.0674,
        lng: 37.3556,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        elevation: '5,199m',
        lat: -0.1521,
        lng: 37.3084,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        elevation: '4,215m',
        lat: -13.1631,
        lng: -72.5450,
        preferredBearing: 45,
        preferredPitch: 60
    }
];

/**
 * Get trek data by ID
 */
export function getTrekData(id: string): TrekData | null {
    return trekDataMap[id as TrekId] || null;
}

/**
 * Get trek config by ID
 */
export function getTrekConfig(id: string): TrekConfig | null {
    return treks.find(t => t.id === id) || null;
}

/**
 * Get all trek IDs
 */
export function getAllTrekIds(): string[] {
    return Object.keys(trekDataMap);
}
