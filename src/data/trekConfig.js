/**
 * Centralized trek configuration - single source of truth
 */

import kilimanjaroData from './kilimanjaro.json';
import mountKenyaData from './mountKenya.json';
import incaTrailData from './incaTrail.json';

/**
 * Trek data mapping by ID
 */
export const trekDataMap = {
    'kilimanjaro': kilimanjaroData,
    'mount-kenya': mountKenyaData,
    'inca-trail': incaTrailData
};

/**
 * Trek marker configuration for globe view
 */
export const treks = [
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
 * @param {string} id - Trek ID
 * @returns {Object|null} Trek data or null if not found
 */
export function getTrekData(id) {
    return trekDataMap[id] || null;
}

/**
 * Get trek config by ID
 * @param {string} id - Trek ID
 * @returns {Object|null} Trek config or null if not found
 */
export function getTrekConfig(id) {
    return treks.find(t => t.id === id) || null;
}

/**
 * Get all trek IDs
 * @returns {string[]} Array of trek IDs
 */
export function getAllTrekIds() {
    return Object.keys(trekDataMap);
}
