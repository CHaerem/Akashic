/**
 * Journey data layer - barrel file
 * Re-exports all journey-related functions and types
 */

// Types
export type { DbJourney, DbWaypoint } from './types';

// Transform utilities
export {
    toTrekConfig,
    toTrekData,
    findClosestRoutePointIndex,
    calculateElevationGainBetweenIndices,
    calculateElevationLossBetweenIndices,
    calculateDistanceBetweenIndices,
} from './transforms';

// Journey CRUD + cache
export {
    fetchJourneys,
    getJourneyCache,
    getTrekData,
    getTrekConfig,
    isDataLoaded,
    getJourneyIdBySlug,
    updateJourney,
    updateJourneyRoute,
    getJourneyForEdit,
} from './journeyAPI';
export type { JourneyUpdate } from './journeyAPI';

// Photo operations
export {
    fetchPhotos,
    createPhoto,
    updatePhoto,
    deletePhoto,
    assignPhotoToWaypoint,
    getPhotosForWaypoint,
} from './photoAPI';

// Waypoint operations
export {
    updateWaypoint,
    getWaypoint,
    updateWaypointPosition,
    createWaypoint,
    deleteWaypoint,
    updateWaypointOrder,
} from './waypointAPI';
export type { WaypointUpdate, NewWaypoint } from './waypointAPI';

// Member management
export {
    getJourneyMembers,
    getRegisteredUsers,
    addJourneyMember,
    removeJourneyMember,
    updateMemberRole,
    getUserJourneyRole,
    userHasRole,
} from './memberAPI';

// Legacy _internal export for backwards compatibility with existing tests
export const _internal = {
    findClosestRoutePointIndex,
    calculateElevationGainBetweenIndices,
    calculateElevationLossBetweenIndices,
    calculateDistanceBetweenIndices,
    toTrekConfig,
    toTrekData,
};

// Re-export from transforms for direct access
import {
    findClosestRoutePointIndex,
    calculateElevationGainBetweenIndices,
    calculateElevationLossBetweenIndices,
    calculateDistanceBetweenIndices,
    toTrekConfig,
    toTrekData,
} from './transforms';
