/**
 * Mapbox layer configurations
 * Extracted from useMapbox for better organization
 */

import type mapboxgl from 'mapbox-gl';

/**
 * Fog configuration for globe view (transparent space for CSS starfield)
 */
export const GLOBE_FOG_CONFIG: mapboxgl.FogSpecification = {
    'range': [1, 12],
    'color': 'rgb(186, 210, 235)',
    'high-color': 'rgb(36, 92, 223)',
    'horizon-blend': 0.02,
    'space-color': 'rgba(0, 0, 0, 0)', // Transparent - CSS stars show through
    'star-intensity': 0 // Disable Mapbox stars
};

/**
 * Fog configuration for trek view (day mode atmosphere)
 */
export const TREK_FOG_CONFIG: mapboxgl.FogSpecification = {
    'range': [0.5, 10],
    'color': 'rgb(186, 210, 235)',
    'high-color': 'rgb(36, 92, 223)',
    'horizon-blend': 0.02,
    'space-color': 'rgb(11, 11, 25)',
    'star-intensity': 0.0
};

/**
 * Photo cluster layer paint configurations
 */
export const PHOTO_CLUSTER_GLOW_PAINT = {
    'circle-color': 'rgba(147, 197, 253, 0.7)',
    'circle-radius': [
        'step',
        ['get', 'point_count'],
        14, // radius for < 5 photos
        5, 17, // radius for 5-9 photos
        10, 20 // radius for 10+ photos
    ],
    'circle-opacity': 0.4,
    'circle-blur': 0.6
} as const;

export const PHOTO_CLUSTER_CIRCLE_PAINT = {
    'circle-color': 'rgba(219, 234, 254, 0.92)',
    'circle-radius': [
        'step',
        ['get', 'point_count'],
        10, // radius for < 5 photos
        5, 12, // radius for 5-9 photos
        10, 14 // radius for 10+ photos
    ],
    'circle-stroke-width': 1.5,
    'circle-stroke-color': 'rgba(96, 165, 250, 0.5)'
} as const;

/**
 * Photo marker layer paint configurations
 */
export const PHOTO_MARKER_GLOW_PAINT = {
    'circle-color': ['case', ['get', 'highlighted'], 'rgba(96, 165, 250, 0.8)', 'rgba(147, 197, 253, 0.6)'],
    'circle-radius': ['case', ['get', 'highlighted'], 10, 6],
    'circle-opacity': ['case', ['get', 'highlighted'], 0.5, 0.3],
    'circle-blur': 0.7
} as const;

export const PHOTO_MARKER_CIRCLE_PAINT = {
    'circle-color': ['case', ['get', 'highlighted'], 'rgba(219, 234, 254, 0.98)', 'rgba(241, 245, 249, 0.9)'],
    'circle-radius': ['case', ['get', 'highlighted'], 5, 3],
    'circle-stroke-width': ['case', ['get', 'highlighted'], 1.5, 0.5],
    'circle-stroke-color': ['case', ['get', 'highlighted'], 'rgba(59, 130, 246, 0.7)', 'rgba(147, 197, 253, 0.5)']
} as const;

/**
 * Camp marker layer paint configurations (warm amber tint)
 */
export const CAMP_MARKER_GLOW_PAINT = {
    'circle-color': ['case', ['get', 'selected'], 'rgba(251, 191, 36, 0.8)', 'rgba(253, 224, 168, 0.7)'],
    'circle-radius': ['case', ['get', 'selected'], 18, 14],
    'circle-opacity': ['case', ['get', 'selected'], 0.5, 0.35],
    'circle-blur': 0.6
} as const;

export const CAMP_MARKER_CIRCLE_PAINT = {
    'circle-color': ['case', ['get', 'selected'], 'rgba(254, 243, 199, 0.95)', 'rgba(254, 249, 235, 0.9)'],
    'circle-radius': ['case', ['get', 'selected'], 12, 9],
    'circle-stroke-width': ['case', ['get', 'selected'], 2, 1.5],
    'circle-stroke-color': ['case', ['get', 'selected'], 'rgba(251, 191, 36, 0.7)', 'rgba(253, 211, 106, 0.5)']
} as const;

export const CAMP_MARKER_LABEL_PAINT = {
    'text-color': ['case', ['get', 'selected'], 'rgba(120, 53, 15, 0.95)', 'rgba(146, 64, 14, 0.85)'],
    'text-halo-color': 'rgba(254, 243, 199, 0.6)',
    'text-halo-width': 1
} as const;

/**
 * POI marker category color mapping
 */
export const POI_CATEGORY_COLORS = {
    glow: {
        'viewpoint': 'rgba(168, 85, 247, 0.7)',     // Purple
        'water': 'rgba(59, 130, 246, 0.7)',         // Blue
        'landmark': 'rgba(234, 179, 8, 0.7)',       // Yellow
        'shelter': 'rgba(34, 197, 94, 0.7)',        // Green
        'warning': 'rgba(239, 68, 68, 0.7)',        // Red
        'summit': 'rgba(251, 146, 60, 0.7)',        // Orange
        'wildlife': 'rgba(20, 184, 166, 0.7)',      // Teal
        'photo_spot': 'rgba(236, 72, 153, 0.7)',    // Pink
        'rest_area': 'rgba(132, 204, 22, 0.7)',     // Lime
        'default': 'rgba(148, 163, 184, 0.7)'       // Gray
    },
    fill: {
        'viewpoint': 'rgba(233, 213, 255, 0.95)',   // Light purple
        'water': 'rgba(219, 234, 254, 0.95)',       // Light blue
        'landmark': 'rgba(254, 249, 195, 0.95)',    // Light yellow
        'shelter': 'rgba(220, 252, 231, 0.95)',     // Light green
        'warning': 'rgba(254, 226, 226, 0.95)',     // Light red
        'summit': 'rgba(255, 237, 213, 0.95)',      // Light orange
        'wildlife': 'rgba(204, 251, 241, 0.95)',    // Light teal
        'photo_spot': 'rgba(252, 231, 243, 0.95)',  // Light pink
        'rest_area': 'rgba(236, 252, 203, 0.95)',   // Light lime
        'default': 'rgba(241, 245, 249, 0.95)'      // Light gray
    },
    stroke: {
        'viewpoint': 'rgba(168, 85, 247, 0.8)',
        'water': 'rgba(59, 130, 246, 0.8)',
        'landmark': 'rgba(234, 179, 8, 0.8)',
        'shelter': 'rgba(34, 197, 94, 0.8)',
        'warning': 'rgba(239, 68, 68, 0.8)',
        'summit': 'rgba(251, 146, 60, 0.8)',
        'wildlife': 'rgba(20, 184, 166, 0.8)',
        'photo_spot': 'rgba(236, 72, 153, 0.8)',
        'rest_area': 'rgba(132, 204, 22, 0.8)',
        'default': 'rgba(148, 163, 184, 0.8)'
    }
};

/**
 * POI category icons
 */
export const POI_CATEGORY_ICONS: Record<string, string> = {
    'viewpoint': '👁',
    'water': '💧',
    'landmark': '🏔',
    'shelter': '🏠',
    'warning': '⚠',
    'summit': '⛰',
    'wildlife': '🦌',
    'photo_spot': '📷',
    'rest_area': '🪑',
    'info': 'ℹ',
    'default': '•'
};

/**
 * Trek marker layer paint configurations (Liquid Glass)
 */
export const TREK_MARKER_CIRCLE_PAINT = {
    'circle-color': 'rgba(255, 255, 255, 0.92)',
    'circle-radius': 6,
    'circle-stroke-width': 1,
    'circle-stroke-color': 'rgba(255, 255, 255, 0.35)',
    'circle-emissive-strength': 1
} as const;

export const TREK_MARKER_GLOW_PAINT = {
    'circle-color': 'rgba(255, 255, 255, 0.75)',
    'circle-radius': 12,
    'circle-opacity': 0.25,
    'circle-blur': 0.75,
    'circle-emissive-strength': 1
} as const;

/**
 * Route line paint configurations
 */
export const ROUTE_GLOW_PAINT = {
    'line-color': 'rgba(255,255,255,0.15)',
    'line-width': 12,
    'line-blur': 8
} as const;

export const ROUTE_LINE_PAINT = {
    'line-color': 'rgba(255,255,255,0.8)',
    'line-width': 2
} as const;

/**
 * Active segment (highlighted day) paint configurations
 */
export const ACTIVE_SEGMENT_GLOW_PAINT = {
    'line-color': '#00ffff',
    'line-width': 15,
    'line-blur': 10,
    'line-opacity': 0.5
} as const;

export const ACTIVE_SEGMENT_LINE_PAINT = {
    'line-color': '#00ffff',
    'line-width': 4
} as const;
