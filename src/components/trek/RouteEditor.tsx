/**
 * Route Editor - Fullscreen editor for camp positions along the route
 *
 * NUMBERING BEHAVIOR:
 * Numbers (1, 2, 3...) show ORDER along the route, not fixed day IDs.
 * When you drag a camp past another, numbers re-sort by route distance.
 * Example: Drag camp #2 past camp #3 → it becomes #3, old #3 becomes #2.
 * Camp NAMES stay the same, only position numbers change.
 */

import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { TrekData, Camp } from '../../types/trek';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, transitions } from '../../styles/liquidGlass';
import { findNearestPointOnRoute, calculateRouteDistances, type RouteCoordinate } from '../../utils/routeUtils';
import { updateWaypointPosition, createWaypoint, deleteWaypoint, getJourneyIdBySlug } from '../../lib/journeys';

interface RouteEditorProps {
    trekData: TrekData;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
}

interface EditableCamp extends Camp {
    isDirty?: boolean;
    routeDistanceKm?: number | null;
    routePointIndex?: number | null;
}

export const RouteEditor = memo(function RouteEditor({
    trekData,
    isOpen,
    onClose,
    onSave,
    isMobile
}: RouteEditorProps) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

    const [camps, setCamps] = useState<EditableCamp[]>([]);
    const [selectedCampId, setSelectedCampId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [mapLoaded, setMapLoaded] = useState(false);

    // Initialize camps from trekData
    useEffect(() => {
        if (isOpen && trekData.camps) {
            setCamps(trekData.camps.map(c => ({ ...c })));
            setHasChanges(false);
            setError(null);
            setMapLoaded(false);
        }
    }, [isOpen, trekData.camps]);

    // Initialize map
    useEffect(() => {
        if (!isOpen || !mapContainerRef.current || mapRef.current) return;

        const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
        if (!token) {
            setError('Mapbox token not found');
            return;
        }

        mapboxgl.accessToken = token;

        // Calculate initial bounds from route
        const route = trekData.route?.coordinates || [];
        let bounds: mapboxgl.LngLatBounds | null = null;
        if (route.length > 0) {
            bounds = new mapboxgl.LngLatBounds();
            route.forEach(coord => {
                bounds!.extend([coord[0], coord[1]]);
            });
        }

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            bounds: bounds || undefined,
            fitBoundsOptions: { padding: isMobile ? 60 : 100 }
        });

        // Add navigation controls
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        mapRef.current = map;

        map.on('load', () => {
            setMapLoaded(true);

            // Add route line
            if (trekData.route?.coordinates) {
                map.addSource('route', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: trekData.route.coordinates.map(c => [c[0], c[1]])
                        }
                    }
                });

                // Route glow (wider, more visible)
                map.addLayer({
                    id: 'route-glow',
                    type: 'line',
                    source: 'route',
                    paint: {
                        'line-color': 'rgba(96, 165, 250, 0.5)',
                        'line-width': 12,
                        'line-blur': 6
                    }
                });

                // Main route line (thicker)
                map.addLayer({
                    id: 'route-line',
                    type: 'line',
                    source: 'route',
                    paint: {
                        'line-color': '#60a5fa',
                        'line-width': 5
                    }
                });

                // Add click handler for route to add new camps
                map.on('click', 'route-line', (e) => {
                    if (e.lngLat) {
                        handleRouteClick([e.lngLat.lng, e.lngLat.lat]);
                    }
                });

                // Change cursor on route hover
                map.on('mouseenter', 'route-line', () => {
                    map.getCanvas().style.cursor = 'crosshair';
                });

                map.on('mouseleave', 'route-line', () => {
                    map.getCanvas().style.cursor = '';
                });
            }
        });

        return () => {
            // Cleanup markers
            markersRef.current.forEach(marker => marker.remove());
            markersRef.current.clear();
            map.remove();
            mapRef.current = null;
            setMapLoaded(false);
        };
    }, [isOpen, trekData.route, isMobile]);

    // Sort camps by route distance (consistent with sidebar)
    const sortCamps = useCallback((campsToSort: EditableCamp[]) => {
        return [...campsToSort].sort((a, b) => {
            // Use route distance if available, otherwise fall back to day number
            const aVal = a.routeDistanceKm != null ? a.routeDistanceKm : (a.dayNumber * 1000);
            const bVal = b.routeDistanceKm != null ? b.routeDistanceKm : (b.dayNumber * 1000);
            return aVal - bVal;
        });
    }, []);

    // Update markers when camps change
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !isOpen || !mapLoaded) return;

        const existingMarkers = markersRef.current;
        const currentIds = new Set(camps.map(c => c.id));

        // Remove markers for deleted camps
        existingMarkers.forEach((marker, id) => {
            if (!currentIds.has(id)) {
                marker.remove();
                existingMarkers.delete(id);
            }
        });

        // Sort camps consistently for marker numbering
        const sortedCamps = sortCamps(camps);

        // Add/update markers for current camps - use sorted order for index
        sortedCamps.forEach((camp, index) => {
            let marker = existingMarkers.get(camp.id);

            if (!marker) {
                // Create new marker
                const el = createMarkerElement(camp, index);
                marker = new mapboxgl.Marker({
                    element: el,
                    draggable: true,
                    anchor: 'center' // Center the marker on the coordinates
                })
                    .setLngLat(camp.coordinates)
                    .addTo(map);

                // Handle drag end
                marker.on('dragend', () => {
                    const lngLat = marker!.getLngLat();
                    handleCampDragged(camp.id, [lngLat.lng, lngLat.lat]);
                });

                // Handle click
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setSelectedCampId(camp.id === selectedCampId ? null : camp.id);
                });

                existingMarkers.set(camp.id, marker);
            } else {
                // Update position if needed
                const currentPos = marker.getLngLat();
                if (currentPos.lng !== camp.coordinates[0] || currentPos.lat !== camp.coordinates[1]) {
                    marker.setLngLat(camp.coordinates);
                }
                // Update element styling
                const el = marker.getElement();
                updateMarkerStyle(el, camp, index, camp.id === selectedCampId);
            }
        });
    }, [camps, selectedCampId, isOpen, mapLoaded, sortCamps]);

    // Create marker element - larger for easier interaction
    function createMarkerElement(camp: EditableCamp, index: number): HTMLDivElement {
        const el = document.createElement('div');
        updateMarkerStyle(el, camp, index, false);
        return el;
    }

    // Update marker styling - larger markers
    function updateMarkerStyle(el: HTMLElement, camp: EditableCamp, index: number, isSelected: boolean) {
        const size = isMobile ? 44 : 40;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = '50%';
        el.style.background = isSelected
            ? 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)'
            : camp.isDirty
                ? 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)'
                : 'linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(220,220,220,0.95) 100%)';
        el.style.border = isSelected ? '4px solid white' : '3px solid rgba(0,0,0,0.4)';
        el.style.boxShadow = isSelected
            ? '0 6px 20px rgba(59, 130, 246, 0.6), 0 0 0 2px rgba(255,255,255,0.3)'
            : '0 4px 12px rgba(0,0,0,0.4)';
        el.style.cursor = 'grab';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.fontSize = isMobile ? '16px' : '14px';
        el.style.fontWeight = '700';
        el.style.color = isSelected ? 'white' : '#333';
        // Only transition visual properties, NOT transform (which Mapbox uses for positioning)
        el.style.transition = 'background 0.2s ease, border 0.2s ease, box-shadow 0.2s ease';
        el.style.userSelect = 'none';
        el.innerHTML = `${index + 1}`;
    }

    // Handle camp dragged to new position
    const handleCampDragged = useCallback((campId: string, newCoords: [number, number]) => {
        const route = trekData.route?.coordinates as RouteCoordinate[] | undefined;
        if (!route) return;

        // Snap to nearest point on route
        const nearest = findNearestPointOnRoute(newCoords, route);
        if (!nearest) return;

        const snappedCoords: [number, number] = [nearest.coordinates[0], nearest.coordinates[1]];
        const elevation = nearest.coordinates[2];

        setCamps(prev => prev.map(c => {
            if (c.id === campId) {
                return {
                    ...c,
                    coordinates: snappedCoords,
                    elevation: Math.round(elevation),
                    routeDistanceKm: nearest.routeDistance,
                    routePointIndex: nearest.index,
                    isDirty: true
                };
            }
            return c;
        }));

        // Update marker position to snapped location
        const marker = markersRef.current.get(campId);
        if (marker) {
            marker.setLngLat(snappedCoords);
        }

        setHasChanges(true);
    }, [trekData.route]);

    // Handle click on route to add new camp
    const handleRouteClick = useCallback((coords: [number, number]) => {
        const route = trekData.route?.coordinates as RouteCoordinate[] | undefined;
        if (!route) return;

        const nearest = findNearestPointOnRoute(coords, route);
        if (!nearest) return;

        const snappedCoords: [number, number] = [nearest.coordinates[0], nearest.coordinates[1]];
        const elevation = Math.round(nearest.coordinates[2]);

        // Find day number based on position
        const sortedCamps = [...camps].sort((a, b) =>
            (a.routeDistanceKm || 0) - (b.routeDistanceKm || 0)
        );

        let dayNumber = 1;
        for (const c of sortedCamps) {
            if ((c.routeDistanceKm || 0) < nearest.routeDistance) {
                dayNumber = c.dayNumber + 1;
            }
        }

        const newCamp: EditableCamp = {
            id: `new-${Date.now()}`,
            name: `Day ${dayNumber} Camp`,
            dayNumber,
            coordinates: snappedCoords,
            elevation,
            elevationGainFromPrevious: 0,
            notes: '',
            routeDistanceKm: nearest.routeDistance,
            routePointIndex: nearest.index,
            isDirty: true
        };

        setCamps(prev => [...prev, newCamp]);
        setSelectedCampId(newCamp.id);
        setHasChanges(true);
    }, [camps, trekData.route]);

    // Delete selected camp
    const handleDeleteCamp = useCallback(() => {
        if (!selectedCampId) return;

        setCamps(prev => prev.filter(c => c.id !== selectedCampId));
        setSelectedCampId(null);
        setHasChanges(true);
    }, [selectedCampId]);

    // Fly to selected camp
    const flyToCamp = useCallback((camp: EditableCamp) => {
        const map = mapRef.current;
        if (!map) return;

        map.flyTo({
            center: camp.coordinates,
            zoom: 14,
            duration: 1000
        });
    }, []);

    // Save all changes
    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);

        try {
            const journeyId = await getJourneyIdBySlug(trekData.id);
            if (!journeyId) {
                throw new Error('Journey not found');
            }

            // Process each camp
            for (const camp of camps) {
                if (camp.id.startsWith('new-')) {
                    // Create new waypoint
                    await createWaypoint({
                        journey_id: journeyId,
                        name: camp.name,
                        day_number: camp.dayNumber,
                        coordinates: camp.coordinates,
                        elevation: camp.elevation,
                        description: camp.notes,
                        route_distance_km: camp.routeDistanceKm || undefined,
                        route_point_index: camp.routePointIndex || undefined,
                        sort_order: camp.dayNumber
                    });
                } else if (camp.isDirty) {
                    // Update existing waypoint
                    await updateWaypointPosition(
                        camp.id,
                        camp.coordinates,
                        camp.elevation,
                        camp.routeDistanceKm || null,
                        camp.routePointIndex || null
                    );
                }
            }

            // Delete removed camps
            const currentIds = new Set(camps.map(c => c.id));
            for (const originalCamp of trekData.camps) {
                if (!currentIds.has(originalCamp.id)) {
                    await deleteWaypoint(originalCamp.id);
                }
            }

            onSave();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save changes');
        } finally {
            setSaving(false);
        }
    }, [camps, trekData, onSave, onClose]);

    const selectedCamp = camps.find(c => c.id === selectedCampId);

    if (!isOpen) return null;

    return createPortal(
        <div
            data-testid="route-editor"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000,
                background: colors.background.base,
                display: 'flex',
                flexDirection: 'column'
            }}
        >
            {/* Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: isMobile ? '12px 16px' : '16px 24px',
                background: `linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)`,
                borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                flexShrink: 0
            }}>
                <div>
                    <h1 style={{
                        margin: 0,
                        fontSize: isMobile ? 18 : 22,
                        fontWeight: 600,
                        color: colors.text.primary
                    }}>
                        Edit Route & Camps
                    </h1>
                    <p style={{
                        margin: '4px 0 0',
                        fontSize: 13,
                        color: colors.text.tertiary
                    }}>
                        {trekData.name}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    <GlassButton variant="subtle" size="md" onClick={onClose} disabled={saving}>
                        Cancel
                    </GlassButton>
                    <GlassButton
                        variant="primary"
                        size="md"
                        onClick={handleSave}
                        disabled={saving || !hasChanges}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </GlassButton>
                </div>
            </div>

            {/* Main content */}
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                overflow: 'hidden'
            }}>
                {/* Map */}
                <div style={{
                    flex: 1,
                    position: 'relative',
                    minHeight: isMobile ? '50vh' : 'auto'
                }}>
                    <div
                        ref={mapContainerRef}
                        style={{
                            position: 'absolute',
                            inset: 0
                        }}
                    />

                    {/* Instructions overlay */}
                    <div style={{
                        position: 'absolute',
                        top: isMobile ? 8 : 16,
                        left: isMobile ? 8 : 16,
                        background: 'rgba(0,0,0,0.75)',
                        backdropFilter: 'blur(8px)',
                        borderRadius: radius.md,
                        padding: isMobile ? '10px 14px' : '12px 16px',
                        maxWidth: isMobile ? 'calc(100% - 80px)' : 280,
                        fontSize: isMobile ? 12 : 13,
                        color: 'rgba(255,255,255,0.9)',
                        lineHeight: 1.5
                    }}>
                        <strong>Drag</strong> markers to reposition camps<br />
                        <strong>Click</strong> on route to add new camp
                    </div>

                    {/* Error message */}
                    {error && (
                        <div style={{
                            position: 'absolute',
                            bottom: 16,
                            left: 16,
                            right: 16,
                            background: 'rgba(239, 68, 68, 0.95)',
                            borderRadius: radius.md,
                            padding: '12px 16px',
                            color: 'white',
                            fontSize: 13
                        }}>
                            {error}
                        </div>
                    )}
                </div>

                {/* Sidebar - camp list */}
                <div style={{
                    width: isMobile ? '100%' : 320,
                    height: isMobile ? 'auto' : '100%',
                    maxHeight: isMobile ? '40vh' : 'none',
                    background: `linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(10,10,15,0.95) 100%)`,
                    borderLeft: isMobile ? 'none' : `1px solid ${colors.glass.borderSubtle}`,
                    borderTop: isMobile ? `1px solid ${colors.glass.borderSubtle}` : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {/* Selected camp actions */}
                    {selectedCamp && (
                        <div style={{
                            padding: 16,
                            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                            background: colors.glass.subtle
                        }}>
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                marginBottom: 12
                            }}>
                                <div>
                                    <div style={{
                                        fontSize: 16,
                                        fontWeight: 600,
                                        color: colors.text.primary
                                    }}>
                                        {selectedCamp.name}
                                    </div>
                                    <div style={{
                                        fontSize: 13,
                                        color: colors.text.secondary,
                                        marginTop: 4
                                    }}>
                                        Day {selectedCamp.dayNumber} • {selectedCamp.elevation}m
                                    </div>
                                    {selectedCamp.routeDistanceKm != null && (
                                        <div style={{
                                            fontSize: 12,
                                            color: colors.text.tertiary,
                                            marginTop: 2
                                        }}>
                                            {selectedCamp.routeDistanceKm.toFixed(1)} km from start
                                        </div>
                                    )}
                                </div>
                                {selectedCamp.isDirty && (
                                    <span style={{
                                        fontSize: 11,
                                        color: '#f59e0b',
                                        background: 'rgba(251, 191, 36, 0.2)',
                                        padding: '4px 8px',
                                        borderRadius: 4,
                                        fontWeight: 500
                                    }}>
                                        Modified
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <GlassButton
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => flyToCamp(selectedCamp)}
                                    style={{ flex: 1 }}
                                >
                                    Zoom To
                                </GlassButton>
                                <GlassButton
                                    variant="subtle"
                                    size="sm"
                                    onClick={handleDeleteCamp}
                                    style={{ color: '#ef4444' }}
                                >
                                    Delete
                                </GlassButton>
                            </div>
                        </div>
                    )}

                    {/* Camp list header */}
                    <div style={{
                        padding: '12px 16px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: colors.text.tertiary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: `1px solid ${colors.glass.borderSubtle}`
                    }}>
                        Camps ({camps.length})
                    </div>

                    {/* Camp list */}
                    <div
                        data-testid="camp-list"
                        style={{
                            flex: 1,
                            overflowY: 'auto',
                            padding: 8
                        }}
                        className="glass-scrollbar"
                    >
                        {sortCamps(camps).map((camp, index) => (
                                <div
                                    key={camp.id}
                                    data-testid={`camp-item-${index + 1}`}
                                    data-camp-id={camp.id}
                                    data-camp-name={camp.name}
                                    data-position={index + 1}
                                    data-modified={camp.isDirty ? 'true' : 'false'}
                                    onClick={() => {
                                        setSelectedCampId(camp.id);
                                        flyToCamp(camp);
                                    }}
                                    style={{
                                        padding: '12px 14px',
                                        marginBottom: 6,
                                        background: camp.id === selectedCampId
                                            ? colors.glass.medium
                                            : 'transparent',
                                        borderRadius: radius.md,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        border: camp.isDirty
                                            ? '1px solid rgba(251, 191, 36, 0.4)'
                                            : `1px solid transparent`,
                                        transition: `all ${transitions.normal}`
                                    }}
                                >
                                    <div
                                        data-testid={`camp-number-${index + 1}`}
                                        style={{
                                            width: 32,
                                            height: 32,
                                            borderRadius: '50%',
                                            background: camp.isDirty
                                                ? 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)'
                                                : camp.id === selectedCampId
                                                    ? 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)'
                                                    : colors.glass.medium,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 13,
                                            fontWeight: 700,
                                            color: (camp.isDirty || camp.id === selectedCampId) ? '#fff' : colors.text.secondary,
                                            flexShrink: 0
                                        }}
                                    >
                                        {index + 1}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: colors.text.primary,
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis'
                                        }}>
                                            {camp.name}
                                        </div>
                                        <div style={{
                                            fontSize: 12,
                                            color: colors.text.tertiary,
                                            marginTop: 2
                                        }}>
                                            {camp.elevation}m
                                            {camp.routeDistanceKm != null && (
                                                <> • {camp.routeDistanceKm.toFixed(1)} km</>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                    </div>

                    {/* Has changes indicator */}
                    {hasChanges && (
                        <div style={{
                            padding: '12px 16px',
                            background: 'rgba(251, 191, 36, 0.1)',
                            borderTop: `1px solid rgba(251, 191, 36, 0.3)`,
                            fontSize: 13,
                            color: '#fbbf24',
                            textAlign: 'center'
                        }}>
                            You have unsaved changes
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
});
