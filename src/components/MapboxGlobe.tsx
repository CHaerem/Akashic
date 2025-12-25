/**
 * Mapbox Globe component with 3D terrain visualization
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { useMapbox } from '../hooks/useMapbox';
import { useJourneys } from '../contexts/JourneysContext';
import { MapErrorFallback } from './common/ErrorBoundary';
import { colors, radius, glassFloating, glassButton } from '../styles/liquidGlass';
import type { TrekConfig, Camp, ViewMode, Photo, PointOfInterest } from '../types/trek';

// POI category display info
const POI_CATEGORY_INFO: Record<string, { icon: string; label: string; color: string }> = {
    viewpoint: { icon: '👁', label: 'Viewpoint', color: 'rgba(168, 85, 247, 0.8)' },
    water: { icon: '💧', label: 'Water Source', color: 'rgba(59, 130, 246, 0.8)' },
    landmark: { icon: '🏔', label: 'Landmark', color: 'rgba(234, 179, 8, 0.8)' },
    shelter: { icon: '🏠', label: 'Shelter', color: 'rgba(34, 197, 94, 0.8)' },
    warning: { icon: '⚠', label: 'Caution', color: 'rgba(239, 68, 68, 0.8)' },
    summit: { icon: '⛰', label: 'Summit', color: 'rgba(251, 146, 60, 0.8)' },
    wildlife: { icon: '🦌', label: 'Wildlife Area', color: 'rgba(20, 184, 166, 0.8)' },
    photo_spot: { icon: '📷', label: 'Photo Spot', color: 'rgba(236, 72, 153, 0.8)' },
    rest_area: { icon: '🪑', label: 'Rest Area', color: 'rgba(132, 204, 22, 0.8)' },
    info: { icon: 'ℹ', label: 'Information', color: 'rgba(148, 163, 184, 0.8)' }
};

// Check if running in E2E test mode
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

// Delay before starting globe rotation (ms) - allows user to see the globe stationary first
const ROTATION_START_DELAY_MS = 3500;

// Test helpers interface for E2E testing
interface TestHelpers {
    selectTrek: (id: string) => boolean;
    getTreks: () => Array<{ id: string; name: string }>;
    getSelectedTrek: () => string | null;
    selectDay: (dayNumber: number) => boolean;
    getCurrentDay: () => number | null;
    getCamps: () => Array<{ id: string; name: string; dayNumber: number }>;
    getTrekDataKeys: () => string[]; // Debug: see what trek IDs are in trekDataMap
    getTrekData: (id: string) => any; // Debug: get full trek data
    isMapReady: () => boolean;
    isDataLoaded: () => boolean;
    // Map state inspection for visual verification
    getMapState: () => {
        cameraCenter: [number, number] | null;
        cameraZoom: number | null;
        cameraBearing: number | null;
        pendingHighlightCampId: string | null;
        hasPendingAnimations: boolean;
    };
}

// Declare global window extension for test helpers
declare global {
    interface Window {
        testHelpers?: TestHelpers;
    }
}

interface MapboxGlobeProps {
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    onSelectTrek: (trek: TrekConfig) => void;
    view: ViewMode;
    photos?: Photo[];
    onPhotoClick?: (photo: Photo, index: number) => void;
    flyToPhotoRef?: React.MutableRefObject<((photo: Photo) => void) | null>;
    recenterRef?: React.MutableRefObject<(() => void) | null>;
    onCampSelect?: (camp: Camp) => void;
    getMediaUrl?: (path: string) => string;
    onViewportChange?: (bounds: mapboxgl.LngLatBoundsLike) => void;
    onViewportVisiblePhotoIdsChange?: (photoIds: string[]) => void;
    editMode?: boolean;
    onPhotoLocationUpdate?: (photoId: string, coordinates: [number, number]) => void;
}

// Generate realistic starfield - seeded positions for consistency
// Optimized for mobile with fewer stars while maintaining visual quality
function generateStarfield(isMobile: boolean): string {
    const stars: string[] = [];

    // Seed-based pseudo-random for consistent star positions
    const seededRandom = (seed: number) => {
        const x = Math.sin(seed * 9999) * 10000;
        return x - Math.floor(x);
    };

    // Adjust star counts for mobile performance
    const dimCount = isMobile ? 80 : 200;
    const mediumCount = isMobile ? 35 : 80;
    const brightCount = isMobile ? 15 : 30;
    const veryBrightCount = isMobile ? 8 : 12;

    // Dim background stars (magnitude 5-6, barely visible)
    for (let i = 0; i < dimCount; i++) {
        const x = seededRandom(i * 1.1) * 100;
        const y = seededRandom(i * 2.2) * 100;
        const opacity = 0.15 + seededRandom(i * 3.3) * 0.15;
        stars.push(`radial-gradient(0.5px 0.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`);
    }

    // Medium stars (magnitude 3-4)
    for (let i = 0; i < mediumCount; i++) {
        const x = seededRandom(i * 4.4 + 100) * 100;
        const y = seededRandom(i * 5.5 + 100) * 100;
        const opacity = 0.3 + seededRandom(i * 6.6) * 0.3;
        stars.push(`radial-gradient(1px 1px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`);
    }

    // Brighter stars (magnitude 2-3)
    for (let i = 0; i < brightCount; i++) {
        const x = seededRandom(i * 7.7 + 200) * 100;
        const y = seededRandom(i * 8.8 + 200) * 100;
        const opacity = 0.6 + seededRandom(i * 9.9) * 0.3;
        // Slight color variation - some stars slightly blue or yellow
        const colorVar = seededRandom(i * 10.1);
        let color = '255,255,255';
        if (colorVar < 0.2) color = '200,220,255'; // Blue-white
        else if (colorVar > 0.8) color = '255,250,230'; // Yellow-white
        stars.push(`radial-gradient(1.5px 1.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},${opacity.toFixed(2)}), transparent)`);
    }

    // Bright stars (magnitude 1-2) - fewer, larger
    for (let i = 0; i < veryBrightCount; i++) {
        const x = seededRandom(i * 11.1 + 300) * 100;
        const y = seededRandom(i * 12.2 + 300) * 100;
        const colorVar = seededRandom(i * 13.3);
        let color = '255,255,255';
        if (colorVar < 0.25) color = '180,200,255'; // Blue (like Rigel)
        else if (colorVar > 0.75) color = '255,220,180'; // Orange (like Betelgeuse)
        stars.push(`radial-gradient(2px 2px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},0.9), transparent)`);
    }

    // Very bright stars (magnitude 0 or brighter) - just a few prominent ones
    const prominentStars = [
        { x: 23, y: 15, color: '180,200,255' },  // Blue giant
        { x: 67, y: 42, color: '255,255,255' },  // White
        { x: 82, y: 78, color: '255,210,170' },  // Orange
        { x: 12, y: 65, color: '255,255,240' },  // Yellow-white
        { x: 91, y: 23, color: '200,220,255' },  // Blue-white
    ];

    prominentStars.forEach(star => {
        stars.push(`radial-gradient(2.5px 2.5px at ${star.x}% ${star.y}%, rgba(${star.color},1), rgba(${star.color},0.3) 50%, transparent)`);
    });

    return stars.join(',\n        ');
}

// Check if mobile at module load time (for initial render)
const isMobileDevice = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

// Static starfield CSS - stars won't move when globe rotates
// Generated once at load time for performance
const starfieldStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgb(11, 11, 25)',
    backgroundImage: generateStarfield(isMobileDevice),
    pointerEvents: 'none',
    zIndex: 0
};

export function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view, photos = [], onPhotoClick, flyToPhotoRef, recenterRef, onCampSelect, getMediaUrl, onViewportChange, onViewportVisiblePhotoIdsChange, editMode, onPhotoLocationUpdate }: MapboxGlobeProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { treks, trekDataMap, loading: journeysLoading } = useJourneys();
    const [poiInfo, setPOIInfo] = useState<PointOfInterest | null>(null);
    const rotationTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Get camps and POIs for the selected trek
    const camps = selectedTrek ? trekDataMap[selectedTrek.id]?.camps || [] : [];
    const pois = selectedTrek ? trekDataMap[selectedTrek.id]?.pointsOfInterest || [] : [];

    // Handle photo click from map marker
    const handlePhotoClick = useCallback((photo: Photo) => {
        if (onPhotoClick) {
            const index = photos.findIndex(p => p.id === photo.id);
            onPhotoClick(photo, index >= 0 ? index : 0);
        }
    }, [photos, onPhotoClick]);

    // Handle POI click - show POI popup
    const handlePOIClick = useCallback((poi: PointOfInterest) => {
        setPOIInfo(poi);
    }, []);

    // Clear popups when changing trek
    useEffect(() => {
        setPOIInfo(null);
    }, [selectedTrek, selectedCamp]);

    // Handle camp click - select the camp
    const handleCampClick = useCallback((camp: Camp) => {
        if (onCampSelect) {
            onCampSelect(camp);
        }
    }, [onCampSelect]);

    const { map, mapReady, error, flyToGlobe, flyToTrek, updatePhotoMarkers, updateCampMarkers, updatePOIMarkers, flyToPhoto, flyToPOI, startRotation, stopRotation, isRotating, getMapCenter, getMapStateForTesting } = useMapbox({
        containerRef,
        onTrekSelect: onSelectTrek,
        onPhotoClick: handlePhotoClick,
        onPOIClick: handlePOIClick,
        onCampClick: handleCampClick,
        getMediaUrl,
        editMode,
        onPhotoLocationUpdate
    });

    useEffect(() => {
        if (!mapReady || !map.current) return;
        if (!onViewportChange && !onViewportVisiblePhotoIdsChange) return;

        const mapInstance = map.current;
        const marginPx = 24;

        const emitViewportInfo = () => {
            if (onViewportChange) {
                const bounds = mapInstance.getBounds().toArray();
                onViewportChange(bounds);
            }

            if (onViewportVisiblePhotoIdsChange) {
                const { clientWidth, clientHeight } = mapInstance.getContainer();

                const visiblePhotoIds = photos
                    .filter((photo) => {
                        if (!photo.coordinates || photo.coordinates.length !== 2) return false;
                        const point = mapInstance.project(photo.coordinates as [number, number]);
                        return Number.isFinite(point.x)
                            && Number.isFinite(point.y)
                            && point.x >= -marginPx
                            && point.x <= clientWidth + marginPx
                            && point.y >= -marginPx
                            && point.y <= clientHeight + marginPx;
                    })
                    .map(photo => photo.id);

                onViewportVisiblePhotoIdsChange(visiblePhotoIds);
            }
        };

        emitViewportInfo();
        mapInstance.on('moveend', emitViewportInfo);
        mapInstance.on('resize', emitViewportInfo);

        return () => {
            mapInstance.off('moveend', emitViewportInfo);
            mapInstance.off('resize', emitViewportInfo);
        };
    }, [map, mapReady, onViewportChange, onViewportVisiblePhotoIdsChange, photos]);

    // Expose test helpers for E2E testing
    useEffect(() => {
        if (!isE2ETestMode) return;

        // Get camps for currently selected trek
        const currentCamps = selectedTrek ? trekDataMap[selectedTrek.id]?.camps || [] : [];

        // Create test helpers object
        const testHelpers: TestHelpers = {
            selectTrek: (id: string) => {
                const trek = treks.find(t => t.id === id);
                if (trek) {
                    onSelectTrek(trek);
                    return true;
                }
                return false;
            },
            getTreks: () => treks.map(t => ({ id: t.id, name: t.name })),
            getSelectedTrek: () => selectedTrek?.id || null,
            selectDay: (dayNumber: number) => {
                if (!selectedTrek || !onCampSelect) return false;
                const camp = currentCamps.find(c => c.dayNumber === dayNumber);
                if (camp) {
                    onCampSelect(camp);
                    return true;
                }
                return false;
            },
            getCurrentDay: () => selectedCamp?.dayNumber || null,
            getCamps: () => currentCamps.map(c => ({
                id: c.id,
                name: c.name,
                dayNumber: c.dayNumber
            })),
            getTrekDataKeys: () => Object.keys(trekDataMap),
            getTrekData: (id: string) => {
                const data = trekDataMap[id];
                if (!data) return null;
                return {
                    id: data.id,
                    name: data.name,
                    campCount: data.camps?.length || 0,
                    camps: data.camps?.map(c => ({
                        id: c.id,
                        name: c.name,
                        dayNumber: c.dayNumber,
                        elevation: c.elevation,
                        coordinates: c.coordinates
                    })) || []
                };
            },
            isMapReady: () => mapReady,
            isDataLoaded: () => !journeysLoading && treks.length > 0,
            getMapState: () => getMapStateForTesting()
        };

        // Register on window
        window.testHelpers = testHelpers;

        return () => {
            delete window.testHelpers;
        };
    }, [mapReady, treks, selectedTrek, selectedCamp, trekDataMap, onSelectTrek, onCampSelect, journeysLoading, getMapStateForTesting]);

    // Expose flyToPhoto to parent via ref
    useEffect(() => {
        if (flyToPhotoRef) {
            flyToPhotoRef.current = flyToPhoto;
        }
        return () => {
            if (flyToPhotoRef) {
                flyToPhotoRef.current = null;
            }
        };
    }, [flyToPhotoRef, flyToPhoto]);

    // Expose recenter function to parent via ref
    // Behavior:
    // - Trek view + camp selected: fly to the current camp
    // - Trek view + no camp (overview): fly to fit the full trek
    // - Globe view + trek selected: recenter on the selected trek
    // - Globe view + no selection: stop rotation and select first journey
    useEffect(() => {
        if (recenterRef) {
            recenterRef.current = () => {
                if (!mapReady) return;

                if (view === 'trek' && selectedTrek) {
                    // Trek view: fly to camp or full trek
                    flyToTrek(selectedTrek, selectedCamp);
                } else if (view === 'globe') {
                    // Globe view
                    if (treks.length === 0) return;

                    // Always stop rotation first (in case it's running)
                    stopRotation();

                    if (selectedTrek) {
                        // Recenter on the selected trek
                        flyToGlobe(selectedTrek);
                    } else {
                        // No trek selected - select the first journey
                        // (don't try to find "nearest" as it's meaningless during rotation)
                        onSelectTrek(treks[0]);
                    }
                }
            };
        }
        return () => {
            if (recenterRef) {
                recenterRef.current = null;
            }
        };
    }, [recenterRef, mapReady, view, selectedTrek, selectedCamp, treks, flyToTrek, flyToGlobe, onSelectTrek, stopRotation]);

    // Handle view transitions - camera movement
    useEffect(() => {
        console.log('[MapboxGlobe camera effect] Triggered:', {
            view,
            trek: selectedTrek?.id,
            camp: selectedCamp?.name,
            campDay: selectedCamp?.dayNumber,
            mapReady
        });
        if (!mapReady) {
            console.log('[MapboxGlobe camera effect] Map not ready');
            return;
        }

        if (view === 'trek' && selectedTrek) {
            console.log('[MapboxGlobe camera effect] Calling flyToTrek');
            flyToTrek(selectedTrek, selectedCamp);
        } else if (view === 'globe') {
            console.log('[MapboxGlobe camera effect] Calling flyToGlobe');
            flyToGlobe(selectedTrek);
        }
    }, [view, selectedTrek, selectedCamp, mapReady, flyToGlobe, flyToTrek]);

    // Handle globe rotation - separate effect
    // Uses isRotating state from useMapbox to track actual rotation state
    // This ensures rotation restarts after user interaction stops it
    useEffect(() => {
        if (!mapReady) return;

        // Should rotate: globe view with no trek selected
        const shouldRotate = view === 'globe' && !selectedTrek;

        if (shouldRotate && !isRotating && !rotationTimerRef.current) {
            // Schedule rotation if:
            // 1. We should be rotating (globe view, no selection)
            // 2. Not currently rotating (isRotating is false)
            // 3. No timer already pending
            rotationTimerRef.current = setTimeout(() => {
                rotationTimerRef.current = null;
                startRotation();
            }, ROTATION_START_DELAY_MS);
        } else if (!shouldRotate) {
            // Stop rotation and clear any pending timer
            if (rotationTimerRef.current) {
                clearTimeout(rotationTimerRef.current);
                rotationTimerRef.current = null;
            }
            stopRotation();
        }

        return () => {
            if (rotationTimerRef.current) {
                clearTimeout(rotationTimerRef.current);
                rotationTimerRef.current = null;
            }
        };
    }, [view, selectedTrek, mapReady, isRotating, startRotation, stopRotation]);

    // Update photo markers when photos, selected camp, or editMode changes
    // Native Mapbox layers are GPU-accelerated - no delays needed
    useEffect(() => {
        if (!mapReady || view !== 'trek') return;
        updatePhotoMarkers(photos, selectedCamp?.id || null);
    }, [mapReady, view, photos, selectedCamp, updatePhotoMarkers, editMode]);

    // Hide photo markers when leaving trek view
    useEffect(() => {
        if (!mapReady) return;
        if (view !== 'trek') {
            updatePhotoMarkers([], null);
        }
    }, [mapReady, view, updatePhotoMarkers]);

    // Update camp markers when trek or camp selection changes
    useEffect(() => {
        if (!mapReady || view !== 'trek') return;
        updateCampMarkers(camps, selectedCamp?.id || null);
    }, [mapReady, view, camps, selectedCamp, updateCampMarkers]);

    // Hide camp markers when leaving trek view
    useEffect(() => {
        if (!mapReady) return;
        if (view !== 'trek') {
            updateCampMarkers([], null);
        }
    }, [mapReady, view, updateCampMarkers]);

    // Update POI markers when trek changes
    useEffect(() => {
        if (!mapReady || view !== 'trek') return;
        updatePOIMarkers(pois);
    }, [mapReady, view, pois, updatePOIMarkers]);

    // Hide POI markers when leaving trek view
    useEffect(() => {
        if (!mapReady) return;
        if (view !== 'trek') {
            updatePOIMarkers([]);
        }
    }, [mapReady, view, updatePOIMarkers]);

    if (error) {
        return <MapErrorFallback error={error} />;
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Static starfield background */}
            <div style={starfieldStyle} />
            {/* Map container */}
            <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', zIndex: 1 }} />

            {/* POI Info Popup */}
            {poiInfo && view === 'trek' && (
                <div
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        ...glassFloating,
                        borderRadius: radius.lg,
                        padding: '20px 24px',
                        zIndex: 100,
                        minWidth: 240,
                        maxWidth: 320,
                        animation: 'popupIn 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                >
                    {/* Close button */}
                    <button
                        onClick={() => setPOIInfo(null)}
                        style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            background: 'none',
                            border: 'none',
                            color: colors.text.subtle,
                            cursor: 'pointer',
                            padding: 4,
                            fontSize: 16,
                            lineHeight: 1
                        }}
                    >
                        ×
                    </button>

                    {/* Category badge */}
                    <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 12,
                        background: (POI_CATEGORY_INFO[poiInfo.category]?.color || colors.glass.medium).replace('0.8', '0.15'),
                        marginBottom: 12
                    }}>
                        <span style={{ fontSize: 12 }}>
                            {POI_CATEGORY_INFO[poiInfo.category]?.icon || '•'}
                        </span>
                        <span style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: POI_CATEGORY_INFO[poiInfo.category]?.color || colors.text.secondary
                        }}>
                            {POI_CATEGORY_INFO[poiInfo.category]?.label || poiInfo.category}
                        </span>
                    </div>

                    {/* POI Name */}
                    <h3 style={{
                        fontSize: 18,
                        fontWeight: 500,
                        color: colors.text.primary,
                        marginBottom: 8,
                        marginTop: 0
                    }}>
                        {poiInfo.name}
                    </h3>

                    {/* Elevation & Distance */}
                    <div style={{
                        display: 'flex',
                        gap: 16,
                        marginBottom: 12
                    }}>
                        {poiInfo.elevation && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                color: colors.text.secondary,
                                fontSize: 12
                            }}>
                                <span style={{ opacity: 0.6 }}>⛰</span>
                                <span>{poiInfo.elevation.toLocaleString()}m</span>
                            </div>
                        )}
                        {poiInfo.routeDistanceKm !== undefined && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                color: colors.text.secondary,
                                fontSize: 12
                            }}>
                                <span style={{ opacity: 0.6 }}>📍</span>
                                <span>{poiInfo.routeDistanceKm.toFixed(1)} km from start</span>
                            </div>
                        )}
                    </div>

                    {/* Description */}
                    {poiInfo.description && (
                        <p style={{
                            fontSize: 13,
                            color: colors.text.tertiary,
                            lineHeight: 1.5,
                            marginBottom: 12,
                            marginTop: 0
                        }}>
                            {poiInfo.description}
                        </p>
                    )}

                    {/* Tips */}
                    {poiInfo.tips && poiInfo.tips.length > 0 && (
                        <div style={{
                            padding: '10px 12px',
                            background: colors.glass.subtle,
                            borderRadius: radius.sm,
                            marginBottom: 12
                        }}>
                            <div style={{
                                fontSize: 10,
                                color: colors.text.subtle,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                marginBottom: 6
                            }}>
                                Tips
                            </div>
                            <ul style={{
                                margin: 0,
                                paddingLeft: 16,
                                fontSize: 12,
                                color: colors.text.secondary
                            }}>
                                {poiInfo.tips.map((tip, i) => (
                                    <li key={i} style={{ marginBottom: 4 }}>{tip}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Fly to POI button */}
                    <button
                        onClick={() => {
                            flyToPOI(poiInfo);
                            setPOIInfo(null);
                        }}
                        style={{
                            ...glassButton,
                            width: '100%',
                            padding: '12px 16px',
                            borderRadius: radius.sm,
                            fontSize: 13,
                            fontWeight: 500,
                            color: colors.text.primary,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8
                        }}
                    >
                        View on Map
                    </button>
                </div>
            )}
        </div>
    );
}
