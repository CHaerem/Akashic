/**
 * Route Editor - Fullscreen editor for camp positions and route geometry
 *
 * Two modes:
 * 1. CAMPS MODE - Drag camp markers along the route
 *    - Numbers (1, 2, 3...) show ORDER along the route
 *    - When you drag a camp past another, numbers re-sort by route distance
 *    - Click on route to add new camp
 *
 * 2. ROUTE MODE - Edit the actual route line
 *    - Shows editable route points as smaller markers
 *    - Drag points to adjust route path
 *    - Click on route to insert new points
 *    - Select and delete points
 *    - Simplify tool to reduce point count
 */

import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { TrekData, Camp, Route } from '../../types/trek';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, transitions, effects, shadows, glassFloating, typography } from '../../styles/liquidGlass';
import { findNearestPointOnRoute, calculateRouteDistances, type RouteCoordinate } from '../../utils/routeUtils';
import { updateWaypoint, createWaypoint, deleteWaypoint, getJourneyIdBySlug, updateJourneyRoute } from '../../lib/journeys';

type EditorMode = 'camps' | 'route';

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
    const routeMarkersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());

    // Editor mode state
    const [mode, setMode] = useState<EditorMode>('camps');

    // Camp editing state
    const [camps, setCamps] = useState<EditableCamp[]>([]);
    const [selectedCampId, setSelectedCampId] = useState<string | null>(null);

    // Route editing state
    const [routeCoordinates, setRouteCoordinates] = useState<RouteCoordinate[]>([]);
    const [selectedRoutePointIndex, setSelectedRoutePointIndex] = useState<number | null>(null);
    const [routeHasChanges, setRouteHasChanges] = useState(false);

    // Shared state
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState(false);
    const [mapLoaded, setMapLoaded] = useState(false);

    // Undo/redo history state
    interface HistoryState {
        camps: EditableCamp[];
        routeCoordinates: RouteCoordinate[];
    }
    const [undoStack, setUndoStack] = useState<HistoryState[]>([]);
    const [redoStack, setRedoStack] = useState<HistoryState[]>([]);
    const maxHistorySize = 50;

    // Push current state to undo stack (call before making changes)
    const pushToHistory = useCallback(() => {
        setUndoStack(prev => {
            const newState: HistoryState = {
                camps: camps.map(c => ({ ...c })),
                routeCoordinates: [...routeCoordinates]
            };
            const updated = [...prev, newState];
            // Limit history size
            if (updated.length > maxHistorySize) {
                return updated.slice(-maxHistorySize);
            }
            return updated;
        });
        // Clear redo stack when new action is performed
        setRedoStack([]);
    }, [camps, routeCoordinates]);

    // Undo action
    const handleUndo = useCallback(() => {
        if (undoStack.length === 0) return;

        const prevState = undoStack[undoStack.length - 1];

        // Push current state to redo stack
        setRedoStack(prev => [...prev, {
            camps: camps.map(c => ({ ...c })),
            routeCoordinates: [...routeCoordinates]
        }]);

        // Restore previous state
        setCamps(prevState.camps);
        setRouteCoordinates(prevState.routeCoordinates);

        // Remove from undo stack
        setUndoStack(prev => prev.slice(0, -1));

        // Update change flags based on restored state
        const originalCamps = trekData.camps || [];
        const originalRoute = trekData.route?.coordinates || [];
        const campsChanged = JSON.stringify(prevState.camps) !== JSON.stringify(originalCamps.map(c => ({ ...c })));
        const routeChanged = JSON.stringify(prevState.routeCoordinates) !== JSON.stringify(originalRoute);
        setHasChanges(campsChanged);
        setRouteHasChanges(routeChanged);
    }, [undoStack, camps, routeCoordinates, trekData.camps, trekData.route]);

    // Redo action
    const handleRedo = useCallback(() => {
        if (redoStack.length === 0) return;

        const nextState = redoStack[redoStack.length - 1];

        // Push current state to undo stack
        setUndoStack(prev => [...prev, {
            camps: camps.map(c => ({ ...c })),
            routeCoordinates: [...routeCoordinates]
        }]);

        // Restore next state
        setCamps(nextState.camps);
        setRouteCoordinates(nextState.routeCoordinates);

        // Remove from redo stack
        setRedoStack(prev => prev.slice(0, -1));

        // Update change flags
        const originalCamps = trekData.camps || [];
        const originalRoute = trekData.route?.coordinates || [];
        const campsChanged = JSON.stringify(nextState.camps) !== JSON.stringify(originalCamps.map(c => ({ ...c })));
        const routeChanged = JSON.stringify(nextState.routeCoordinates) !== JSON.stringify(originalRoute);
        setHasChanges(campsChanged);
        setRouteHasChanges(routeChanged);
    }, [redoStack, camps, routeCoordinates, trekData.camps, trekData.route]);

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Use metaKey for Mac (Cmd), ctrlKey for others
            const modKey = e.metaKey || e.ctrlKey;

            if (modKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
            } else if (modKey && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                handleRedo();
            } else if (modKey && e.key === 'y') {
                e.preventDefault();
                handleRedo();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleUndo, handleRedo]);

    // Sample rate for route points (show every Nth point to avoid performance issues)
    const getRoutePointSampleRate = useCallback((totalPoints: number) => {
        if (totalPoints < 100) return 1;
        if (totalPoints < 500) return 5;
        if (totalPoints < 2000) return 10;
        return Math.ceil(totalPoints / 200);
    }, []);

    // Get visible route point indices based on sample rate
    const visibleRoutePointIndices = useMemo(() => {
        if (routeCoordinates.length === 0) return [];
        const sampleRate = getRoutePointSampleRate(routeCoordinates.length);
        const indices: number[] = [];
        for (let i = 0; i < routeCoordinates.length; i += sampleRate) {
            indices.push(i);
        }
        // Always include the last point
        if (indices[indices.length - 1] !== routeCoordinates.length - 1) {
            indices.push(routeCoordinates.length - 1);
        }
        return indices;
    }, [routeCoordinates.length, getRoutePointSampleRate]);

    // Initialize camps and route from trekData
    useEffect(() => {
        if (isOpen) {
            // Initialize camps
            if (trekData.camps) {
                setCamps(trekData.camps.map(c => ({ ...c })));
            }
            // Initialize route coordinates
            if (trekData.route?.coordinates) {
                setRouteCoordinates([...trekData.route.coordinates] as RouteCoordinate[]);
            }
            setHasChanges(false);
            setRouteHasChanges(false);
            setError(null);
            setMapLoaded(false);
            setSelectedCampId(null);
            setSelectedRoutePointIndex(null);
        }
    }, [isOpen, trekData.camps, trekData.route]);

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

                // Add click handler for route - behavior depends on mode
                map.on('click', 'route-line', (e) => {
                    if (e.lngLat) {
                        // Store click handler reference that can check current mode
                        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
                        // We'll dispatch to the right handler based on mode state
                        // Using a custom event to allow mode-aware handling
                        window.dispatchEvent(new CustomEvent('route-editor-route-click', {
                            detail: { coords }
                        }));
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
            routeMarkersRef.current.forEach(marker => marker.remove());
            routeMarkersRef.current.clear();
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
    }, [camps, selectedCampId, isOpen, mapLoaded, sortCamps, mode]);

    // Update route point markers when in route editing mode
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !isOpen || !mapLoaded || mode !== 'route') {
            // Clear route markers when not in route mode
            routeMarkersRef.current.forEach(marker => marker.remove());
            routeMarkersRef.current.clear();
            return;
        }

        const existingMarkers = routeMarkersRef.current;
        const visibleIndices = new Set(visibleRoutePointIndices);

        // Remove markers that are no longer visible
        existingMarkers.forEach((marker, index) => {
            if (!visibleIndices.has(index)) {
                marker.remove();
                existingMarkers.delete(index);
            }
        });

        // Add/update markers for visible route points
        visibleRoutePointIndices.forEach((pointIndex) => {
            const coord = routeCoordinates[pointIndex];
            if (!coord) return;

            let marker = existingMarkers.get(pointIndex);

            if (!marker) {
                // Create new route point marker
                const el = createRoutePointMarkerElement(pointIndex);
                marker = new mapboxgl.Marker({
                    element: el,
                    draggable: true,
                    anchor: 'center'
                })
                    .setLngLat([coord[0], coord[1]])
                    .addTo(map);

                // Handle drag end
                marker.on('dragend', () => {
                    const lngLat = marker!.getLngLat();
                    handleRoutePointDragged(pointIndex, [lngLat.lng, lngLat.lat]);
                });

                // Handle click
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setSelectedRoutePointIndex(pointIndex === selectedRoutePointIndex ? null : pointIndex);
                });

                existingMarkers.set(pointIndex, marker);
            } else {
                // Update position if needed
                const currentPos = marker.getLngLat();
                if (currentPos.lng !== coord[0] || currentPos.lat !== coord[1]) {
                    marker.setLngLat([coord[0], coord[1]]);
                }
                // Update element styling
                const el = marker.getElement();
                updateRoutePointMarkerStyle(el, pointIndex, pointIndex === selectedRoutePointIndex);
            }
        });
    }, [routeCoordinates, visibleRoutePointIndices, selectedRoutePointIndex, isOpen, mapLoaded, mode]);

    // Create route point marker element
    function createRoutePointMarkerElement(index: number): HTMLDivElement {
        const el = document.createElement('div');
        updateRoutePointMarkerStyle(el, index, false);
        return el;
    }

    // Update route point marker styling - smaller than camp markers
    function updateRoutePointMarkerStyle(el: HTMLElement, index: number, isSelected: boolean) {
        const size = isSelected ? 16 : 10;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.borderRadius = '50%';
        el.style.background = isSelected
            ? '#f59e0b'
            : 'rgba(255, 255, 255, 0.8)';
        el.style.border = isSelected ? '2px solid white' : '2px solid rgba(0,0,0,0.5)';
        el.style.boxShadow = isSelected
            ? '0 2px 8px rgba(245, 158, 11, 0.6)'
            : '0 1px 4px rgba(0,0,0,0.3)';
        el.style.cursor = 'grab';
        // Only transition visual properties, NOT transform (which Mapbox uses for positioning)
        el.style.transition = 'background 0.15s ease, border 0.15s ease, box-shadow 0.15s ease, width 0.15s ease, height 0.15s ease';
    }

    // Handle route point dragged to new position
    const handleRoutePointDragged = useCallback((pointIndex: number, newCoords: [number, number]) => {
        // Save state before making changes
        pushToHistory();

        // Get elevation from nearby points (interpolate)
        const prevCoord = routeCoordinates[pointIndex - 1];
        const nextCoord = routeCoordinates[pointIndex + 1];
        let elevation = routeCoordinates[pointIndex]?.[2] || 0;

        // Simple interpolation if we have neighbors
        if (prevCoord && nextCoord) {
            elevation = (prevCoord[2] + nextCoord[2]) / 2;
        } else if (prevCoord) {
            elevation = prevCoord[2];
        } else if (nextCoord) {
            elevation = nextCoord[2];
        }

        setRouteCoordinates(prev => {
            const newCoords3D: RouteCoordinate = [newCoords[0], newCoords[1], elevation];
            const updated = [...prev];
            updated[pointIndex] = newCoords3D;
            return updated;
        });

        setRouteHasChanges(true);
    }, [routeCoordinates, pushToHistory]);

    // Delete selected route point
    const handleDeleteRoutePoint = useCallback(() => {
        if (selectedRoutePointIndex === null) return;
        if (routeCoordinates.length <= 2) {
            setError('Route must have at least 2 points');
            return;
        }

        // Save state before making changes
        pushToHistory();

        // Remove the marker
        const marker = routeMarkersRef.current.get(selectedRoutePointIndex);
        if (marker) {
            marker.remove();
            routeMarkersRef.current.delete(selectedRoutePointIndex);
        }

        setRouteCoordinates(prev => {
            const updated = [...prev];
            updated.splice(selectedRoutePointIndex, 1);
            return updated;
        });

        setSelectedRoutePointIndex(null);
        setRouteHasChanges(true);
    }, [selectedRoutePointIndex, routeCoordinates.length, pushToHistory]);

    // Insert a point into the route (click on route line in route mode)
    const handleRouteLineClick = useCallback((coords: [number, number]) => {
        if (mode !== 'route') return;

        // Save state before making changes
        pushToHistory();

        // Find nearest segment to insert point
        let nearestIndex = 0;
        let nearestDistance = Infinity;

        for (let i = 0; i < routeCoordinates.length - 1; i++) {
            const start = routeCoordinates[i];
            const end = routeCoordinates[i + 1];

            // Calculate distance from click to segment midpoint (simplified)
            const midLng = (start[0] + end[0]) / 2;
            const midLat = (start[1] + end[1]) / 2;
            const dist = Math.sqrt(
                Math.pow(coords[0] - midLng, 2) +
                Math.pow(coords[1] - midLat, 2)
            );

            if (dist < nearestDistance) {
                nearestDistance = dist;
                nearestIndex = i + 1; // Insert after this segment's start
            }
        }

        // Interpolate elevation from neighbors
        const prevCoord = routeCoordinates[nearestIndex - 1];
        const nextCoord = routeCoordinates[nearestIndex];
        const elevation = prevCoord && nextCoord
            ? (prevCoord[2] + nextCoord[2]) / 2
            : prevCoord?.[2] || nextCoord?.[2] || 0;

        const newPoint: RouteCoordinate = [coords[0], coords[1], elevation];

        setRouteCoordinates(prev => {
            const updated = [...prev];
            updated.splice(nearestIndex, 0, newPoint);
            return updated;
        });

        setRouteHasChanges(true);
    }, [mode, routeCoordinates, pushToHistory]);

    // Update map route line when coordinates change
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapLoaded) return;

        const source = map.getSource('route') as mapboxgl.GeoJSONSource;
        if (source && routeCoordinates.length > 0) {
            source.setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: routeCoordinates.map(c => [c[0], c[1]])
                }
            });
        }
    }, [routeCoordinates, mapLoaded]);

    // Create camp marker element - larger for easier interaction
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

        // Save state before making changes
        pushToHistory();

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
    }, [trekData.route, pushToHistory]);

    // Handle click on route to add new camp
    const handleRouteClick = useCallback((coords: [number, number]) => {
        const route = trekData.route?.coordinates as RouteCoordinate[] | undefined;
        if (!route) return;

        // Save state before making changes
        pushToHistory();

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
    }, [camps, trekData.route, pushToHistory]);

    // Handle route click events based on current mode
    // Note: This useEffect must be after handleRouteClick and handleRouteLineClick are defined
    useEffect(() => {
        const handleRouteClickEvent = (e: Event) => {
            const customEvent = e as CustomEvent<{ coords: [number, number] }>;
            const { coords } = customEvent.detail;
            if (mode === 'camps') {
                handleRouteClick(coords);
            } else {
                handleRouteLineClick(coords);
            }
        };

        window.addEventListener('route-editor-route-click', handleRouteClickEvent);
        return () => {
            window.removeEventListener('route-editor-route-click', handleRouteClickEvent);
        };
    }, [mode, handleRouteClick, handleRouteLineClick]);

    // Delete selected camp
    const handleDeleteCamp = useCallback(() => {
        if (!selectedCampId) return;

        // Save state before making changes
        pushToHistory();

        setCamps(prev => prev.filter(c => c.id !== selectedCampId));
        setSelectedCampId(null);
        setHasChanges(true);
    }, [selectedCampId, pushToHistory]);

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

            // Save route changes if any
            if (routeHasChanges && routeCoordinates.length > 0) {
                const updatedRoute: Route = {
                    type: 'LineString',
                    coordinates: routeCoordinates
                };
                await updateJourneyRoute(trekData.id, updatedRoute);
            }

            // Save camp changes if any
            if (hasChanges) {
                // Sort camps by route order to assign correct day numbers
                const sortedCamps = sortCamps(camps);

                // Process each camp with correct day number based on route order
                for (let i = 0; i < sortedCamps.length; i++) {
                    const camp = sortedCamps[i];
                    const newDayNumber = i + 1;

                    if (camp.id.startsWith('new-')) {
                        // Create new waypoint
                        await createWaypoint({
                            journey_id: journeyId,
                            name: camp.name,
                            day_number: newDayNumber,
                            coordinates: camp.coordinates,
                            elevation: camp.elevation,
                            description: camp.notes,
                            route_distance_km: camp.routeDistanceKm || undefined,
                            route_point_index: camp.routePointIndex || undefined,
                            sort_order: newDayNumber
                        });
                    } else {
                        // Update existing waypoint - always update day_number to match route order
                        await updateWaypoint(camp.id, {
                            coordinates: camp.coordinates,
                            elevation: camp.elevation,
                            route_distance_km: camp.routeDistanceKm,
                            route_point_index: camp.routePointIndex,
                            day_number: newDayNumber
                        });
                    }
                }

                // Delete removed camps
                const currentIds = new Set(camps.map(c => c.id));
                for (const originalCamp of trekData.camps) {
                    if (!currentIds.has(originalCamp.id)) {
                        await deleteWaypoint(originalCamp.id);
                    }
                }
            }

            onSave();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save changes');
        } finally {
            setSaving(false);
        }
    }, [camps, trekData, onSave, onClose, sortCamps, routeHasChanges, routeCoordinates, hasChanges]);

    const selectedCamp = camps.find(c => c.id === selectedCampId);

    if (!isOpen) return null;

    return createPortal(
        <div
            data-testid="route-editor"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1000
            }}
        >
            {/* Map fills entire viewport */}
            <div
                ref={mapContainerRef}
                style={{
                    position: 'absolute',
                    inset: 0
                }}
            />

            {/* Header - Liquid Glass floating over map */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: isMobile ? 0 : 320,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: isMobile ? '12px 16px' : '16px 24px',
                background: 'rgba(12, 12, 18, 0.7)',
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                borderBottom: `1px solid ${colors.glass.border}`,
                boxShadow: `
                    0 4px 20px rgba(0, 0, 0, 0.25),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1)
                `,
                flexWrap: 'wrap',
                gap: 12,
                zIndex: 10
            }}>
                <div style={{ flex: '1 1 auto', minWidth: 150 }}>
                    <p style={{
                        ...typography.label,
                        fontSize: 10,
                        letterSpacing: '0.2em',
                        color: colors.text.subtle,
                        margin: '0 0 4px 0'
                    }}>
                        ROUTE EDITOR
                    </p>
                    <h1 style={{
                        ...typography.display,
                        margin: 0,
                        fontSize: isMobile ? 18 : 22,
                        fontWeight: 500,
                        color: colors.text.primary
                    }}>
                        {trekData.name}
                    </h1>
                </div>

                {/* Mode toggle - Liquid Glass pill tabs */}
                <div style={{
                    display: 'flex',
                    gap: 6,
                    padding: 4,
                    background: `linear-gradient(
                        180deg,
                        rgba(255, 255, 255, 0.04) 0%,
                        transparent 100%
                    )`,
                    borderRadius: radius.xl,
                    border: `1px solid ${colors.glass.borderSubtle}`
                }}>
                    <button
                        onClick={() => setMode('camps')}
                        style={{
                            padding: '10px 18px',
                            borderRadius: radius.lg,
                            background: mode === 'camps'
                                ? `linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.08) 100%)`
                                : 'transparent',
                            backdropFilter: mode === 'camps' ? 'blur(8px) saturate(180%)' : 'none',
                            WebkitBackdropFilter: mode === 'camps' ? 'blur(8px) saturate(180%)' : 'none',
                            border: mode === 'camps'
                                ? `1px solid ${colors.glass.border}`
                                : '1px solid transparent',
                            boxShadow: mode === 'camps'
                                ? `0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15)`
                                : 'none',
                            color: mode === 'camps' ? colors.text.primary : colors.text.tertiary,
                            fontSize: 11,
                            fontWeight: mode === 'camps' ? 500 : 400,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase' as const,
                            cursor: 'pointer',
                            transition: `all ${transitions.smooth}`
                        }}
                    >
                        Camps
                    </button>
                    <button
                        onClick={() => setMode('route')}
                        style={{
                            padding: '10px 18px',
                            borderRadius: radius.lg,
                            background: mode === 'route'
                                ? `linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.08) 100%)`
                                : 'transparent',
                            backdropFilter: mode === 'route' ? 'blur(8px) saturate(180%)' : 'none',
                            WebkitBackdropFilter: mode === 'route' ? 'blur(8px) saturate(180%)' : 'none',
                            border: mode === 'route'
                                ? `1px solid ${colors.glass.border}`
                                : '1px solid transparent',
                            boxShadow: mode === 'route'
                                ? `0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15)`
                                : 'none',
                            color: mode === 'route' ? colors.text.primary : colors.text.tertiary,
                            fontSize: 11,
                            fontWeight: mode === 'route' ? 500 : 400,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase' as const,
                            cursor: 'pointer',
                            transition: `all ${transitions.smooth}`
                        }}
                    >
                        Route
                    </button>
                </div>

                {/* Undo/Redo buttons */}
                <div style={{ display: 'flex', gap: 8 }}>
                    <GlassButton
                        variant="subtle"
                        size="sm"
                        onClick={handleUndo}
                        disabled={undoStack.length === 0 || saving}
                        title="Undo (⌘Z)"
                    >
                        ↶ Undo
                    </GlassButton>
                    <GlassButton
                        variant="subtle"
                        size="sm"
                        onClick={handleRedo}
                        disabled={redoStack.length === 0 || saving}
                        title="Redo (⌘⇧Z)"
                    >
                        ↷ Redo
                    </GlassButton>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                    <GlassButton variant="subtle" size="md" onClick={onClose} disabled={saving}>
                        Cancel
                    </GlassButton>
                    <GlassButton
                        variant="primary"
                        size="md"
                        onClick={handleSave}
                        disabled={saving || (!hasChanges && !routeHasChanges)}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </GlassButton>
                </div>
            </div>

            {/* Instructions overlay - floating over map */}
            <div style={{
                position: 'absolute',
                top: isMobile ? 80 : 100,
                left: isMobile ? 8 : 16,
                ...glassFloating,
                borderRadius: radius.lg,
                padding: isMobile ? '10px 14px' : '12px 16px',
                maxWidth: isMobile ? 'calc(100% - 80px)' : 280,
                fontSize: isMobile ? 12 : 13,
                color: colors.text.primary,
                lineHeight: 1.5,
                zIndex: 5
            }}>
                {mode === 'camps' ? (
                    <>
                        <strong>Drag</strong> markers to reposition camps<br />
                        <strong>Click</strong> on route to add new camp
                    </>
                ) : (
                    <>
                        <strong>Drag</strong> route points to adjust path<br />
                        <strong>Click</strong> on route to add new point
                    </>
                )}
            </div>

            {/* Error message - floating over map */}
            {error && (
                <div style={{
                    position: 'absolute',
                    bottom: isMobile ? 'auto' : 16,
                    top: isMobile ? 'auto' : 'auto',
                    left: 16,
                    right: isMobile ? 16 : 336,
                    background: `linear-gradient(135deg, rgba(239, 68, 68, 0.9) 0%, rgba(185, 28, 28, 0.85) 100%)`,
                    backdropFilter: effects.blur.medium,
                    WebkitBackdropFilter: effects.blur.medium,
                    borderRadius: radius.lg,
                    padding: '12px 16px',
                    color: 'white',
                    fontSize: 13,
                    boxShadow: shadows.drop.md,
                    border: `1px solid rgba(255, 255, 255, 0.15)`,
                    zIndex: 5
                }}>
                    {error}
                </div>
            )}

            {/* Sidebar - Liquid Glass floating panel (like InfoPanel) */}
            <div style={{
                position: 'absolute',
                top: isMobile ? 'auto' : 0,
                right: 0,
                bottom: 0,
                left: isMobile ? 0 : 'auto',
                width: isMobile ? '100%' : 320,
                height: isMobile ? '40vh' : '100%',
                background: `linear-gradient(
                    ${isMobile ? '180deg' : '135deg'},
                    rgba(255, 255, 255, 0.1) 0%,
                    rgba(255, 255, 255, 0.05) 30%,
                    rgba(10, 10, 15, 0.85) 100%
                )`,
                backdropFilter: 'blur(32px) saturate(180%)',
                WebkitBackdropFilter: 'blur(32px) saturate(180%)',
                borderLeft: isMobile ? 'none' : `1px solid ${colors.glass.border}`,
                borderTop: isMobile ? `1px solid ${colors.glass.border}` : 'none',
                borderRadius: isMobile ? `${radius.xxl}px ${radius.xxl}px 0 0` : 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: isMobile
                    ? `0 -16px 48px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 2px 20px rgba(255, 255, 255, 0.05)`
                    : `-8px 0 40px rgba(0, 0, 0, 0.3), inset 1px 0 0 rgba(255, 255, 255, 0.1)`,
                zIndex: 10
            }}>
                    {mode === 'camps' ? (
                        <>
                    {/* Selected camp actions */}
                    {selectedCamp && (
                        <div style={{
                            padding: 16,
                            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                            background: `linear-gradient(180deg, ${colors.glass.light} 0%, ${colors.glass.subtle} 100%)`,
                            boxShadow: shadows.inset.subtle
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
                                        color: colors.accent.warning,
                                        background: `linear-gradient(135deg, rgba(251, 191, 36, 0.25) 0%, rgba(245, 158, 11, 0.15) 100%)`,
                                        padding: '4px 10px',
                                        borderRadius: radius.sm,
                                        fontWeight: 500,
                                        border: '1px solid rgba(251, 191, 36, 0.3)',
                                        backdropFilter: effects.blur.subtle
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
                        ...typography.label,
                        fontSize: 11,
                        color: colors.text.tertiary,
                        borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)`
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
                            background: `linear-gradient(180deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.08) 100%)`,
                            borderTop: `1px solid rgba(251, 191, 36, 0.3)`,
                            fontSize: 13,
                            color: colors.accent.warning,
                            textAlign: 'center',
                            fontWeight: 500
                        }}>
                            You have unsaved changes
                        </div>
                    )}
                        </>
                    ) : (
                        <>
                            {/* Route editing mode sidebar */}
                            {/* Selected route point actions */}
                            {selectedRoutePointIndex !== null && (
                                <div style={{
                                    padding: 16,
                                    borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                                    background: `linear-gradient(180deg, ${colors.glass.light} 0%, ${colors.glass.subtle} 100%)`,
                                    boxShadow: shadows.inset.subtle
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
                                                Route Point #{selectedRoutePointIndex + 1}
                                            </div>
                                            <div style={{
                                                fontSize: 13,
                                                color: colors.text.secondary,
                                                marginTop: 4
                                            }}>
                                                {routeCoordinates[selectedRoutePointIndex]?.[2]?.toFixed(0) || 0}m elevation
                                            </div>
                                            <div style={{
                                                fontSize: 12,
                                                color: colors.text.tertiary,
                                                marginTop: 2
                                            }}>
                                                {routeCoordinates[selectedRoutePointIndex]?.[1]?.toFixed(5)}, {routeCoordinates[selectedRoutePointIndex]?.[0]?.toFixed(5)}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <GlassButton
                                            variant="subtle"
                                            size="sm"
                                            onClick={() => {
                                                const coord = routeCoordinates[selectedRoutePointIndex];
                                                if (coord && mapRef.current) {
                                                    mapRef.current.flyTo({
                                                        center: [coord[0], coord[1]],
                                                        zoom: 15,
                                                        duration: 1000
                                                    });
                                                }
                                            }}
                                            style={{ flex: 1 }}
                                        >
                                            Zoom To
                                        </GlassButton>
                                        <GlassButton
                                            variant="subtle"
                                            size="sm"
                                            onClick={handleDeleteRoutePoint}
                                            style={{ color: '#ef4444' }}
                                        >
                                            Delete
                                        </GlassButton>
                                    </div>
                                </div>
                            )}

                            {/* Route info header */}
                            <div style={{
                                padding: '12px 16px',
                                ...typography.label,
                                fontSize: 11,
                                color: colors.text.tertiary,
                                borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                                background: `linear-gradient(180deg, rgba(255, 255, 255, 0.03) 0%, transparent 100%)`
                            }}>
                                Route Points ({routeCoordinates.length})
                            </div>

                            {/* Route stats */}
                            <div style={{
                                padding: 16,
                                borderBottom: `1px solid ${colors.glass.borderSubtle}`
                            }}>
                                <div style={{
                                    fontSize: 13,
                                    color: colors.text.secondary,
                                    marginBottom: 8
                                }}>
                                    Visible markers: {visibleRoutePointIndices.length}
                                </div>
                                <div style={{
                                    fontSize: 12,
                                    color: colors.text.tertiary
                                }}>
                                    Drag markers to adjust the route path. Click on the route line to add new points.
                                </div>
                            </div>

                            {/* Route changes indicator */}
                            {routeHasChanges && (
                                <div style={{
                                    padding: '12px 16px',
                                    background: `linear-gradient(180deg, rgba(251, 191, 36, 0.15) 0%, rgba(251, 191, 36, 0.08) 100%)`,
                                    borderTop: `1px solid rgba(251, 191, 36, 0.3)`,
                                    fontSize: 13,
                                    color: colors.accent.warning,
                                    textAlign: 'center',
                                    fontWeight: 500,
                                    marginTop: 'auto'
                                }}>
                                    Route has unsaved changes
                                </div>
                            )}
                        </>
                    )}
                </div>
        </div>,
        document.body
    );
});
