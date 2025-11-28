/**
 * Mapbox Globe component with 3D terrain visualization
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { useMapbox, type RouteClickInfo } from '../hooks/useMapbox';
import { useJourneys } from '../contexts/JourneysContext';
import { MapErrorFallback } from './common/ErrorBoundary';
import { colors, radius, glassFloating, glassButton } from '../styles/liquidGlass';
import type { TrekConfig, Camp, ViewMode, Photo } from '../types/trek';

// Check if running in E2E test mode
const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

// Test helpers interface for E2E testing
interface TestHelpers {
    selectTrek: (id: string) => boolean;
    getTreks: () => Array<{ id: string; name: string }>;
    getSelectedTrek: () => string | null;
    isMapReady: () => boolean;
    isDataLoaded: () => boolean;
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
    onCampSelect?: (camp: Camp) => void;
    getMediaUrl?: (path: string) => string;
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

export function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view, photos = [], onPhotoClick, flyToPhotoRef, onCampSelect, getMediaUrl }: MapboxGlobeProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { treks, trekDataMap, loading: journeysLoading } = useJourneys();
    const [routeInfo, setRouteInfo] = useState<RouteClickInfo | null>(null);

    // Get camps for the selected trek
    const camps = selectedTrek ? trekDataMap[selectedTrek.id]?.camps || [] : [];

    // Handle photo click from map marker
    const handlePhotoClick = useCallback((photo: Photo) => {
        if (onPhotoClick) {
            const index = photos.findIndex(p => p.id === photo.id);
            onPhotoClick(photo, index >= 0 ? index : 0);
        }
    }, [photos, onPhotoClick]);

    // Handle route click - show info popup
    const handleRouteClick = useCallback((info: RouteClickInfo) => {
        setRouteInfo(info);
    }, []);

    // Clear route info when clicking elsewhere or changing trek
    useEffect(() => {
        setRouteInfo(null);
    }, [selectedTrek, selectedCamp]);

    const { mapReady, error, flyToGlobe, flyToTrek, updatePhotoMarkers, updateCampMarkers, flyToPhoto, startRotation, stopRotation } = useMapbox({
        containerRef,
        onTrekSelect: onSelectTrek,
        onPhotoClick: handlePhotoClick,
        onRouteClick: handleRouteClick,
        getMediaUrl
    });

    // Expose test helpers for E2E testing
    useEffect(() => {
        if (!isE2ETestMode) return;

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
            isMapReady: () => mapReady,
            isDataLoaded: () => !journeysLoading && treks.length > 0
        };

        // Register on window
        window.testHelpers = testHelpers;

        return () => {
            delete window.testHelpers;
        };
    }, [mapReady, treks, selectedTrek, onSelectTrek, journeysLoading]);

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

    // Handle view transitions
    useEffect(() => {
        if (!mapReady) return;

        if (view === 'trek' && selectedTrek) {
            stopRotation();
            flyToTrek(selectedTrek, selectedCamp);
        } else if (view === 'globe') {
            flyToGlobe(selectedTrek);
            // Start rotation only when no trek is selected (idle globe)
            if (!selectedTrek) {
                // Small delay to let the flyTo animation complete
                const timer = setTimeout(() => startRotation(), 3500);
                return () => clearTimeout(timer);
            } else {
                stopRotation();
            }
        }
    }, [view, selectedTrek, selectedCamp, mapReady, flyToGlobe, flyToTrek, startRotation, stopRotation]);

    // Update photo markers when photos or selected camp changes
    // Native Mapbox layers are GPU-accelerated - no delays needed
    useEffect(() => {
        if (!mapReady || view !== 'trek') return;
        updatePhotoMarkers(photos, selectedCamp?.id || null);
    }, [mapReady, view, photos, selectedCamp, updatePhotoMarkers]);

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

    if (error) {
        return <MapErrorFallback error={error} />;
    }

    // Handle clicking the nearest camp from route info
    const handleGoToNearestCamp = useCallback(() => {
        if (routeInfo?.nearestCamp && onCampSelect) {
            onCampSelect(routeInfo.nearestCamp);
            setRouteInfo(null);
        }
    }, [routeInfo, onCampSelect]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Static starfield background */}
            <div style={starfieldStyle} />
            {/* Map container */}
            <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', zIndex: 1 }} />

            {/* Route Info Popup */}
            {routeInfo && view === 'trek' && (
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
                        minWidth: 200,
                        animation: 'popupIn 0.25s cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                >
                    <style>{`@keyframes popupIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }`}</style>

                    {/* Close button */}
                    <button
                        onClick={() => setRouteInfo(null)}
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

                    <div style={{ fontSize: 11, color: colors.text.subtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                        Route Point
                    </div>

                    <div style={{ display: 'grid', gap: 12 }}>
                        <div>
                            <div style={{ fontSize: 24, fontWeight: 500, color: colors.text.primary }}>
                                {routeInfo.distanceFromStart} km
                            </div>
                            <div style={{ fontSize: 12, color: colors.text.tertiary }}>from start</div>
                        </div>

                        {routeInfo.elevation !== null && (
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 500, color: colors.text.primary }}>
                                    {routeInfo.elevation.toLocaleString()}m
                                </div>
                                <div style={{ fontSize: 12, color: colors.text.tertiary }}>elevation</div>
                            </div>
                        )}

                        {routeInfo.nearestCamp && (
                            <div style={{ marginTop: 8, paddingTop: 12, borderTop: `1px solid ${colors.glass.borderSubtle}` }}>
                                <div style={{ fontSize: 12, color: colors.text.tertiary, marginBottom: 8 }}>
                                    Nearest: {routeInfo.nearestCamp.name} ({routeInfo.distanceToNearestCamp} km)
                                </div>
                                {onCampSelect && (
                                    <button
                                        onClick={handleGoToNearestCamp}
                                        style={{
                                            ...glassButton,
                                            width: '100%',
                                            padding: '10px 16px',
                                            borderRadius: radius.sm,
                                            fontSize: 13,
                                            fontWeight: 500,
                                            color: colors.text.primary,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Go to Day {routeInfo.nearestCamp.dayNumber}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
