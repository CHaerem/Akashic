/**
 * Types for Mapbox hook
 */

import type { RefObject, MutableRefObject } from 'react';
import type * as mapboxgl from 'mapbox-gl';
import type { TrekConfig, TrekData, Camp, Photo, PointOfInterest } from '../../types/trek';

/**
 * Information returned when clicking on a route
 */
export interface RouteClickInfo {
    coordinates: [number, number];
    distanceFromStart: number; // in km
    elevation: number | null;
    nearestCamp: Camp | null;
    distanceToNearestCamp: number | null; // km
    // Enhanced info
    totalDistance: number; // total journey distance in km
    progressPercent: number; // 0-100
    previousCamp: Camp | null; // camp before this point
    nextCamp: Camp | null; // camp after this point
    distanceToPreviousCamp: number | null; // km
    distanceToNextCamp: number | null; // km
}

/**
 * Options for useMapbox hook
 */
export interface UseMapboxOptions {
    containerRef: RefObject<HTMLDivElement | null>;
    onTrekSelect: (trek: TrekConfig) => void;
    onPhotoClick?: (photo: Photo) => void;
    onRouteClick?: (info: RouteClickInfo) => void;
    onPOIClick?: (poi: PointOfInterest) => void;
    onCampClick?: (camp: Camp) => void;
    getMediaUrl?: (path: string) => string;
    editMode?: boolean;
    onPhotoLocationUpdate?: (photoId: string, coordinates: [number, number]) => void;
}

/**
 * Playback state for journey animation
 */
export interface PlaybackState {
    isPlaying: boolean;
    progress: number; // 0-100 percentage
    currentCampIndex: number;
}

/**
 * Camera/animation snapshot exposed for e2e assertions (window.__mapState).
 * Every field is nullable because the map may not be constructed yet.
 */
export interface MapStateForTesting {
    cameraCenter: [number, number] | null;
    cameraZoom: number | null;
    cameraBearing: number | null;
    pendingHighlightCampId: string | null;
    hasPendingAnimations: boolean;
}

/**
 * Return type for useMapbox hook
 */
export interface UseMapboxReturn {
    map: MutableRefObject<mapboxgl.Map | null>;
    mapReady: boolean;
    error: string | null;
    flyToGlobe: (selectedTrek?: TrekConfig | null) => void;
    flyToTrek: (selectedTrek: TrekConfig, selectedCamp?: Camp | null) => void;
    highlightSegment: (trekData: TrekData, selectedCamp: Camp) => void;
    updatePhotoMarkers: (photos: Photo[], selectedCampId?: string | null) => void;
    updateCampMarkers: (camps: Camp[], selectedCampId?: string | null) => void;
    updatePOIMarkers: (pois: PointOfInterest[]) => void;
    flyToPhoto: (photo: Photo) => void;
    flyToPOI: (poi: PointOfInterest) => void;
    startRotation: () => void;
    stopRotation: () => void;
    isRotating: boolean;
    getMapCenter: () => [number, number] | null;
    // Playback controls
    startPlayback: (trekData: TrekData, onCampReached?: (camp: Camp) => void) => void;
    stopPlayback: () => void;
    playbackState: PlaybackState;
    /** e2e-only camera snapshot. useMapbox has always returned it; the interface just never said so. */
    getMapStateForTesting: () => MapStateForTesting;
}

/**
 * Default globe center coordinates (Africa/Middle East region)
 */
export const GLOBE_CENTER: [number, number] = [30, 15];
