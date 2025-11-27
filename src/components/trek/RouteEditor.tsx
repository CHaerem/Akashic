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
import { colors, radius, transitions, effects, shadows, glassFloating, glassPanel, glassButton, typography } from '../../styles/liquidGlass';
import { findNearestPointOnRoute, haversineDistance, type RouteCoordinate, type Coordinate } from '../../utils/routeUtils';
import { processDrawnSegment as processWithMapMatching, snapRouteToTrails } from '../../lib/mapMatching';
import { updateWaypoint, createWaypoint, deleteWaypoint, getJourneyIdBySlug, updateJourneyRoute } from '../../lib/journeys';

type EditorMode = 'camps' | 'route';
type RouteSubMode = 'edit' | 'draw' | 'select';

// Reusable mode toggle button with hover state
const ModeToggleButton = memo(function ModeToggleButton({
    label,
    isActive,
    onClick
}: {
    label: string;
    isActive: boolean;
    onClick: () => void;
}) {
    const [isHovered, setIsHovered] = useState(false);

    const baseStyle: React.CSSProperties = {
        padding: '10px 18px',
        borderRadius: radius.lg,
        fontSize: 11,
        fontWeight: isActive ? 500 : 400,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: `all ${transitions.smooth}`,
    };

    const stateStyle: React.CSSProperties = isActive
        ? {
            ...glassButton,
            color: colors.text.primary,
        }
        : isHovered
        ? {
            background: 'rgba(255, 255, 255, 0.06)',
            border: `1px solid ${colors.glass.borderSubtle}`,
            color: colors.text.secondary,
        }
        : {
            background: 'transparent',
            border: '1px solid transparent',
            color: colors.text.tertiary,
        };

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ ...baseStyle, ...stateStyle }}
        >
            {label}
        </button>
    );
});

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
    const [selectedRoutePoints, setSelectedRoutePoints] = useState<Set<number>>(new Set());
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null); // For shift+click range selection
    const [routeHasChanges, setRouteHasChanges] = useState(false);

    // Route sub-mode state (edit existing points vs draw new segments)
    const [routeSubMode, setRouteSubMode] = useState<RouteSubMode>('edit');

    // Drawing state
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
    const [isProcessingDraw, setIsProcessingDraw] = useState(false);

    // Snap to trail state
    const [isSnapping, setIsSnapping] = useState(false);
    const [snapProgress, setSnapProgress] = useState(0);

    // Rectangle selection state
    const [isSelecting, setIsSelecting] = useState(false);
    const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);

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
            } else if (e.key === 'Escape') {
                // ESC to deselect all
                e.preventDefault();
                setSelectedRoutePoints(new Set());
                setLastSelectedIndex(null);
                setSelectedCampId(null);
            } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedRoutePoints.size > 0) {
                // Backspace/Delete to delete selected route points
                e.preventDefault();
                // Check we're in route mode
                if (mode === 'route') {
                    const remainingCount = routeCoordinates.length - selectedRoutePoints.size;
                    if (remainingCount < 2) {
                        setError('Route must have at least 2 points');
                        return;
                    }
                    // Remove markers for deleted points
                    selectedRoutePoints.forEach(index => {
                        const marker = routeMarkersRef.current.get(index);
                        if (marker) {
                            marker.remove();
                            routeMarkersRef.current.delete(index);
                        }
                    });
                    // Remove points from coordinates
                    setRouteCoordinates(prev => prev.filter((_, index) => !selectedRoutePoints.has(index)));
                    setSelectedRoutePoints(new Set());
                    setLastSelectedIndex(null);
                    setRouteHasChanges(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleUndo, handleRedo, selectedRoutePoints, mode, routeCoordinates.length]);

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
            setSelectedRoutePoints(new Set());
            setLastSelectedIndex(null);
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

            // Add drawing preview layer (initially empty)
            map.addSource('drawing-preview', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: []
                    }
                }
            });

            // Drawing preview glow
            map.addLayer({
                id: 'drawing-preview-glow',
                type: 'line',
                source: 'drawing-preview',
                paint: {
                    'line-color': 'rgba(52, 211, 153, 0.5)',
                    'line-width': 10,
                    'line-blur': 5
                }
            });

            // Drawing preview line (dashed)
            map.addLayer({
                id: 'drawing-preview-line',
                type: 'line',
                source: 'drawing-preview',
                paint: {
                    'line-color': '#34d399',
                    'line-width': 4,
                    'line-dasharray': [2, 2]
                }
            });
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

                // Handle click with shift for range selection
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleRoutePointClick(pointIndex, e.shiftKey);
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
                updateRoutePointMarkerStyle(el, pointIndex, selectedRoutePoints.has(pointIndex));
            }
        });
    }, [routeCoordinates, visibleRoutePointIndices, selectedRoutePoints, isOpen, mapLoaded, mode]);

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
    // When dragging a visible marker, interpolate all intermediate points
    // between adjacent visible markers so the route follows the drag smoothly
    const handleRoutePointDragged = useCallback((pointIndex: number, newCoords: [number, number]) => {
        // Save state before making changes
        pushToHistory();

        // Find previous and next visible marker indices
        const visibleIndices = visibleRoutePointIndices;
        const currentVisibleIdx = visibleIndices.indexOf(pointIndex);

        // Get the previous and next visible point indices
        const prevVisiblePointIndex = currentVisibleIdx > 0
            ? visibleIndices[currentVisibleIdx - 1]
            : 0;
        const nextVisiblePointIndex = currentVisibleIdx < visibleIndices.length - 1
            ? visibleIndices[currentVisibleIdx + 1]
            : routeCoordinates.length - 1;

        // Get elevation from nearby visible points (interpolate)
        const prevVisibleCoord = routeCoordinates[prevVisiblePointIndex];
        const nextVisibleCoord = routeCoordinates[nextVisiblePointIndex];
        let elevation = routeCoordinates[pointIndex]?.[2] || 0;

        // Simple interpolation for the dragged point's elevation
        if (prevVisibleCoord && nextVisibleCoord && pointIndex !== prevVisiblePointIndex && pointIndex !== nextVisiblePointIndex) {
            elevation = (prevVisibleCoord[2] + nextVisibleCoord[2]) / 2;
        } else if (prevVisibleCoord && pointIndex !== prevVisiblePointIndex) {
            elevation = prevVisibleCoord[2];
        } else if (nextVisibleCoord && pointIndex !== nextVisiblePointIndex) {
            elevation = nextVisibleCoord[2];
        }

        setRouteCoordinates(prev => {
            const updated = [...prev];

            // Update the dragged point
            const newCoords3D: RouteCoordinate = [newCoords[0], newCoords[1], elevation];
            updated[pointIndex] = newCoords3D;

            // Interpolate points between previous visible marker and current point
            if (pointIndex > prevVisiblePointIndex + 1) {
                const startCoord = prev[prevVisiblePointIndex];
                const endCoord = newCoords3D;
                const segmentLength = pointIndex - prevVisiblePointIndex;

                for (let i = prevVisiblePointIndex + 1; i < pointIndex; i++) {
                    const t = (i - prevVisiblePointIndex) / segmentLength;
                    const interpLng = startCoord[0] + t * (endCoord[0] - startCoord[0]);
                    const interpLat = startCoord[1] + t * (endCoord[1] - startCoord[1]);
                    const interpElev = startCoord[2] + t * (endCoord[2] - startCoord[2]);
                    updated[i] = [interpLng, interpLat, interpElev];
                }
            }

            // Interpolate points between current point and next visible marker
            if (nextVisiblePointIndex > pointIndex + 1) {
                const startCoord = newCoords3D;
                const endCoord = prev[nextVisiblePointIndex];
                const segmentLength = nextVisiblePointIndex - pointIndex;

                for (let i = pointIndex + 1; i < nextVisiblePointIndex; i++) {
                    const t = (i - pointIndex) / segmentLength;
                    const interpLng = startCoord[0] + t * (endCoord[0] - startCoord[0]);
                    const interpLat = startCoord[1] + t * (endCoord[1] - startCoord[1]);
                    const interpElev = startCoord[2] + t * (endCoord[2] - startCoord[2]);
                    updated[i] = [interpLng, interpLat, interpElev];
                }
            }

            return updated;
        });

        setRouteHasChanges(true);
    }, [routeCoordinates, pushToHistory, visibleRoutePointIndices]);

    // Handle route point click with shift for range selection
    const handleRoutePointClick = useCallback((pointIndex: number, shiftKey: boolean) => {
        if (shiftKey && lastSelectedIndex !== null) {
            // Range selection: select all points between lastSelectedIndex and pointIndex
            const start = Math.min(lastSelectedIndex, pointIndex);
            const end = Math.max(lastSelectedIndex, pointIndex);
            const newSelection = new Set<number>();
            for (let i = start; i <= end; i++) {
                newSelection.add(i);
            }
            setSelectedRoutePoints(newSelection);
        } else {
            // Toggle single selection
            setSelectedRoutePoints(prev => {
                const newSet = new Set(prev);
                if (newSet.has(pointIndex)) {
                    newSet.delete(pointIndex);
                } else {
                    newSet.add(pointIndex);
                }
                return newSet;
            });
            setLastSelectedIndex(pointIndex);
        }
    }, [lastSelectedIndex]);

    // Delete selected route points (supports multiple)
    const handleDeleteRoutePoints = useCallback(() => {
        if (selectedRoutePoints.size === 0) return;

        const remainingCount = routeCoordinates.length - selectedRoutePoints.size;
        if (remainingCount < 2) {
            setError('Route must have at least 2 points');
            return;
        }

        // Save state before making changes
        pushToHistory();

        // Remove markers for deleted points
        selectedRoutePoints.forEach(index => {
            const marker = routeMarkersRef.current.get(index);
            if (marker) {
                marker.remove();
                routeMarkersRef.current.delete(index);
            }
        });

        // Remove points from coordinates (in reverse order to maintain indices)
        setRouteCoordinates(prev => {
            return prev.filter((_, index) => !selectedRoutePoints.has(index));
        });

        setSelectedRoutePoints(new Set());
        setLastSelectedIndex(null);
        setRouteHasChanges(true);
    }, [selectedRoutePoints, routeCoordinates.length, pushToHistory]);

    // Select a range of route points (for UI input)
    const handleSelectRange = useCallback((startIndex: number, endIndex: number) => {
        const start = Math.max(0, Math.min(startIndex, endIndex));
        const end = Math.min(routeCoordinates.length - 1, Math.max(startIndex, endIndex));
        const newSelection = new Set<number>();
        for (let i = start; i <= end; i++) {
            newSelection.add(i);
        }
        setSelectedRoutePoints(newSelection);
        setLastSelectedIndex(end);
    }, [routeCoordinates.length]);

    // Clear selection
    const handleClearSelection = useCallback(() => {
        setSelectedRoutePoints(new Set());
        setLastSelectedIndex(null);
    }, []);

    // Select all visible route points
    const handleSelectAllVisible = useCallback(() => {
        setSelectedRoutePoints(new Set(visibleRoutePointIndices));
        if (visibleRoutePointIndices.length > 0) {
            setLastSelectedIndex(visibleRoutePointIndices[visibleRoutePointIndices.length - 1]);
        }
    }, [visibleRoutePointIndices]);

    // Rectangle selection handlers
    const handleSelectionStart = useCallback((e: MouseEvent | TouchEvent) => {
        if (mode !== 'route' || routeSubMode !== 'select') return;

        const map = mapRef.current;
        if (!map) return;

        e.preventDefault();
        e.stopPropagation();

        // Get screen coordinates
        const point = 'touches' in e
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : { x: e.clientX, y: e.clientY };

        // Get map container offset
        const rect = map.getContainer().getBoundingClientRect();
        const screenPoint = {
            x: point.x - rect.left,
            y: point.y - rect.top
        };

        setIsSelecting(true);
        setSelectionStart(screenPoint);
        setSelectionEnd(screenPoint);
    }, [mode, routeSubMode]);

    const handleSelectionMove = useCallback((e: MouseEvent | TouchEvent) => {
        if (!isSelecting || mode !== 'route' || routeSubMode !== 'select') return;

        const map = mapRef.current;
        if (!map) return;

        e.preventDefault();

        const point = 'touches' in e
            ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
            : { x: e.clientX, y: e.clientY };

        const rect = map.getContainer().getBoundingClientRect();
        const screenPoint = {
            x: point.x - rect.left,
            y: point.y - rect.top
        };

        setSelectionEnd(screenPoint);
    }, [isSelecting, mode, routeSubMode]);

    const handleSelectionEnd = useCallback(() => {
        if (!isSelecting || !selectionStart || !selectionEnd) {
            setIsSelecting(false);
            return;
        }

        const map = mapRef.current;
        if (!map) {
            setIsSelecting(false);
            return;
        }

        // Calculate bounding box in screen coordinates
        const minX = Math.min(selectionStart.x, selectionEnd.x);
        const maxX = Math.max(selectionStart.x, selectionEnd.x);
        const minY = Math.min(selectionStart.y, selectionEnd.y);
        const maxY = Math.max(selectionStart.y, selectionEnd.y);

        // Only process if box is big enough (at least 10px)
        if (maxX - minX < 10 || maxY - minY < 10) {
            setIsSelecting(false);
            setSelectionStart(null);
            setSelectionEnd(null);
            return;
        }

        // Find all route points within the selection box
        const newSelection = new Set<number>();
        routeCoordinates.forEach((coord, index) => {
            const point = map.project([coord[0], coord[1]]);
            if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
                newSelection.add(index);
            }
        });

        // Add to existing selection (or replace if no shift key - but we'll always add for simplicity)
        setSelectedRoutePoints(prev => {
            const combined = new Set(prev);
            newSelection.forEach(i => combined.add(i));
            return combined;
        });

        if (newSelection.size > 0) {
            const indices = Array.from(newSelection);
            setLastSelectedIndex(indices[indices.length - 1]);
        }

        setIsSelecting(false);
        setSelectionStart(null);
        setSelectionEnd(null);
    }, [isSelecting, selectionStart, selectionEnd, routeCoordinates]);

    // Snap only selected portion to trail
    const handleSnapSelectedToTrail = useCallback(async () => {
        if (selectedRoutePoints.size < 2 || isSnapping) return;

        // Get indices in order
        const indices = Array.from(selectedRoutePoints).sort((a, b) => a - b);
        const minIndex = indices[0];
        const maxIndex = indices[indices.length - 1];

        // Check if selection is contiguous (for best results)
        const isContiguous = maxIndex - minIndex + 1 === indices.length;
        if (!isContiguous) {
            setError('Please select a contiguous range for best results');
            return;
        }

        setIsSnapping(true);
        setSnapProgress(0);
        setError(null);

        try {
            pushToHistory();

            const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

            // Extract the selected portion
            const selectedPortion = routeCoordinates.slice(minIndex, maxIndex + 1);

            const result = await snapRouteToTrails(
                selectedPortion,
                mapboxToken,
                (progress) => setSnapProgress(progress)
            );

            if (result.coordinates.length > 0) {
                // Replace the selected portion with snapped version
                setRouteCoordinates(prev => [
                    ...prev.slice(0, minIndex),
                    ...result.coordinates,
                    ...prev.slice(maxIndex + 1)
                ]);
                setRouteHasChanges(true);

                const successRate = Math.round((result.snappedSegments / result.totalSegments) * 100);
                const confidence = Math.round(result.averageConfidence * 100);
                setDrawFeedback(
                    `Snapped selection (${successRate}% success, ${confidence}% confidence)`
                );
                setTimeout(() => setDrawFeedback(null), 5000);

                // Clear selection after snapping
                setSelectedRoutePoints(new Set());
                setLastSelectedIndex(null);
            } else {
                setError('Could not snap selected portion to trails');
            }
        } catch (err) {
            console.error('Error snapping selection:', err);
            setError('Failed to snap selected portion');
        } finally {
            setIsSnapping(false);
            setSnapProgress(0);
        }
    }, [selectedRoutePoints, routeCoordinates, isSnapping, pushToHistory]);

    // Set up selection event listeners
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapLoaded || mode !== 'route' || routeSubMode !== 'select') return;

        const canvas = map.getCanvas();

        // Disable map drag during selection
        map.dragPan.disable();

        canvas.addEventListener('mousedown', handleSelectionStart);
        canvas.addEventListener('mousemove', handleSelectionMove);
        canvas.addEventListener('mouseup', handleSelectionEnd);
        canvas.addEventListener('touchstart', handleSelectionStart, { passive: false });
        canvas.addEventListener('touchmove', handleSelectionMove, { passive: false });
        canvas.addEventListener('touchend', handleSelectionEnd);

        return () => {
            map.dragPan.enable();
            canvas.removeEventListener('mousedown', handleSelectionStart);
            canvas.removeEventListener('mousemove', handleSelectionMove);
            canvas.removeEventListener('mouseup', handleSelectionEnd);
            canvas.removeEventListener('touchstart', handleSelectionStart);
            canvas.removeEventListener('touchmove', handleSelectionMove);
            canvas.removeEventListener('touchend', handleSelectionEnd);
        };
    }, [mapLoaded, mode, routeSubMode, handleSelectionStart, handleSelectionMove, handleSelectionEnd]);

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

    // === DRAWING MODE HANDLERS ===

    // Calculate distance between two points in meters (approximate)
    const getDistanceMeters = useCallback((p1: [number, number], p2: [number, number]) => {
        const R = 6371000; // Earth radius in meters
        const dLat = (p2[1] - p1[1]) * Math.PI / 180;
        const dLon = (p2[0] - p1[0]) * Math.PI / 180;
        const lat1 = p1[1] * Math.PI / 180;
        const lat2 = p2[1] * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }, []);

    // Handle drawing start (mousedown/touchstart)
    const handleDrawStart = useCallback((coords: [number, number]) => {
        if (mode !== 'route' || routeSubMode !== 'draw') return;
        setIsDrawing(true);
        setDrawingPoints([coords]);
    }, [mode, routeSubMode]);

    // Handle drawing move (mousemove/touchmove)
    const handleDrawMove = useCallback((coords: [number, number]) => {
        if (!isDrawing || mode !== 'route' || routeSubMode !== 'draw') return;

        setDrawingPoints(prev => {
            // Only add point if distance from last point is > 5 meters (reduce noise)
            const lastPoint = prev[prev.length - 1];
            if (lastPoint && getDistanceMeters(lastPoint, coords) < 5) {
                return prev;
            }
            return [...prev, coords];
        });
    }, [isDrawing, mode, routeSubMode, getDistanceMeters]);

    // Feedback state for drawing
    const [drawFeedback, setDrawFeedback] = useState<string | null>(null);

    // Find nearest route point index within threshold
    const findNearestRoutePointIndex = useCallback((coord: Coordinate, thresholdKm: number = 0.05): number | null => {
        if (routeCoordinates.length === 0) return null;

        let nearestIndex: number | null = null;
        let nearestDist = Infinity;

        for (let i = 0; i < routeCoordinates.length; i++) {
            const dist = haversineDistance(coord, routeCoordinates[i]);
            if (dist < nearestDist && dist < thresholdKm) {
                nearestDist = dist;
                nearestIndex = i;
            }
        }

        return nearestIndex;
    }, [routeCoordinates]);

    // Process drawn segment - replace/insert/append with intelligent snapping
    const processDrawnSegment = useCallback(async (points: [number, number][]) => {
        if (points.length < 2) return;

        setIsProcessingDraw(true);
        setDrawFeedback(null);

        try {
            // Save state before making changes
            pushToHistory();

            // Get Mapbox token
            const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

            // Process with intelligent snapping (Map Matching + fallback to simplified)
            const result = await processWithMapMatching(
                points as Coordinate[],
                mapboxToken
            );

            if (result.coordinates.length === 0) {
                setError('Could not process drawn segment');
                return;
            }

            // Find if draw start/end are near existing route points (50m threshold)
            const drawStart = points[0];
            const drawEnd = points[points.length - 1];
            const startIndex = findNearestRoutePointIndex(drawStart, 0.05);
            const endIndex = findNearestRoutePointIndex(drawEnd, 0.05);

            // Get elevation from nearest route point (or 0 if no route)
            const getBaseElevation = (index: number | null): number => {
                if (index !== null && routeCoordinates[index]) {
                    return routeCoordinates[index][2];
                }
                if (routeCoordinates.length > 0) {
                    return routeCoordinates[routeCoordinates.length - 1][2];
                }
                return 0;
            };

            const baseElevation = getBaseElevation(startIndex ?? endIndex);

            // Add elevation to new points
            const newPoints: RouteCoordinate[] = result.coordinates.map(p => [
                p[0],
                p[1],
                p[2] || baseElevation
            ]);

            let feedbackMessage = '';

            // Determine merge strategy based on start/end positions
            if (startIndex !== null && endIndex !== null && startIndex < endIndex) {
                // Replace segment: drawing connects two points on the route
                // Keep route before startIndex, add new points, keep route after endIndex
                setRouteCoordinates(prev => [
                    ...prev.slice(0, startIndex),
                    ...newPoints,
                    ...prev.slice(endIndex + 1)
                ]);
                feedbackMessage = `Replaced segment (points ${startIndex}-${endIndex})`;
            } else if (startIndex !== null && endIndex !== null && endIndex < startIndex) {
                // Drawing goes backward - replace in reverse direction
                // Keep route before endIndex, add new points (reversed), keep route after startIndex
                const reversedPoints = [...newPoints].reverse();
                setRouteCoordinates(prev => [
                    ...prev.slice(0, endIndex),
                    ...reversedPoints,
                    ...prev.slice(startIndex + 1)
                ]);
                feedbackMessage = `Replaced segment (points ${endIndex}-${startIndex})`;
            } else if (startIndex !== null && endIndex === null) {
                // Started on route, ended off - replace from startIndex to end
                setRouteCoordinates(prev => [
                    ...prev.slice(0, startIndex),
                    ...newPoints
                ]);
                feedbackMessage = `Extended from point ${startIndex}`;
            } else if (startIndex === null && endIndex !== null) {
                // Started off route, ended on route - prepend to endIndex
                setRouteCoordinates(prev => [
                    ...newPoints,
                    ...prev.slice(endIndex + 1)
                ]);
                feedbackMessage = `Prepended to point ${endIndex}`;
            } else {
                // Neither on route - append to end (original behavior)
                setRouteCoordinates(prev => [...prev, ...newPoints]);
                feedbackMessage = `Added ${newPoints.length} points`;
            }

            setRouteHasChanges(true);

            // Show feedback with snapping info
            if (result.wasSnapped) {
                setDrawFeedback(`${feedbackMessage} • Snapped to trail (${Math.round(result.confidence * 100)}%)`);
            } else {
                setDrawFeedback(feedbackMessage);
            }

            // Clear feedback after 3 seconds
            setTimeout(() => setDrawFeedback(null), 3000);

        } catch (err) {
            console.error('Error processing drawn segment:', err);
            setError('Failed to process drawn segment');
        } finally {
            setIsProcessingDraw(false);
            setDrawingPoints([]);
        }
    }, [routeCoordinates, pushToHistory, findNearestRoutePointIndex]);

    // Handle drawing end (mouseup/touchend)
    const handleDrawEnd = useCallback(() => {
        if (!isDrawing) return;
        setIsDrawing(false);

        if (drawingPoints.length >= 2) {
            processDrawnSegment(drawingPoints);
        } else {
            setDrawingPoints([]);
        }
    }, [isDrawing, drawingPoints, processDrawnSegment]);

    // Handle snap entire route to trails
    const handleSnapToTrail = useCallback(async () => {
        if (routeCoordinates.length < 2 || isSnapping) return;

        setIsSnapping(true);
        setSnapProgress(0);
        setError(null);

        try {
            // Save state before making changes
            pushToHistory();

            const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

            const result = await snapRouteToTrails(
                routeCoordinates,
                mapboxToken,
                (progress) => setSnapProgress(progress)
            );

            if (result.coordinates.length > 0) {
                setRouteCoordinates(result.coordinates);
                setRouteHasChanges(true);

                // Show feedback
                const successRate = Math.round((result.snappedSegments / result.totalSegments) * 100);
                const confidence = Math.round(result.averageConfidence * 100);
                setDrawFeedback(
                    `Snapped ${result.snappedSegments}/${result.totalSegments} segments (${successRate}% success, ${confidence}% confidence)`
                );
                setTimeout(() => setDrawFeedback(null), 5000);
            } else {
                setError('Could not snap route to trails');
            }
        } catch (err) {
            console.error('Error snapping route:', err);
            setError('Failed to snap route to trails');
        } finally {
            setIsSnapping(false);
            setSnapProgress(0);
        }
    }, [routeCoordinates, isSnapping, pushToHistory]);

    // Set up drawing event listeners on the map
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapLoaded || mode !== 'route' || routeSubMode !== 'draw') return;

        const canvas = map.getCanvas();

        // Convert event to coordinates
        const eventToCoords = (e: MouseEvent | Touch): [number, number] => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const lngLat = map.unproject([x, y]);
            return [lngLat.lng, lngLat.lat];
        };

        // Mouse handlers
        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return; // Only left click
            handleDrawStart(eventToCoords(e));
        };

        const onMouseMove = (e: MouseEvent) => {
            handleDrawMove(eventToCoords(e));
        };

        const onMouseUp = () => {
            handleDrawEnd();
        };

        // Touch handlers
        let activeTouchId: number | null = null;

        const onTouchStart = (e: TouchEvent) => {
            // Only track single finger for drawing (two fingers = pan/zoom)
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            activeTouchId = touch.identifier;
            handleDrawStart(eventToCoords(touch));
            // Prevent default to avoid pan during draw
            e.preventDefault();
        };

        const onTouchMove = (e: TouchEvent) => {
            if (activeTouchId === null) return;
            const touch = Array.from(e.touches).find(t => t.identifier === activeTouchId);
            if (!touch) return;
            handleDrawMove(eventToCoords(touch));
            e.preventDefault();
        };

        const onTouchEnd = (e: TouchEvent) => {
            if (activeTouchId === null) return;
            const wasOurTouch = !Array.from(e.touches).some(t => t.identifier === activeTouchId);
            if (wasOurTouch) {
                activeTouchId = null;
                handleDrawEnd();
            }
        };

        // Disable map interactions during draw mode
        map.dragPan.disable();
        map.dragRotate.disable();
        canvas.style.cursor = 'crosshair';

        // Add listeners
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseUp);
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd);
        canvas.addEventListener('touchcancel', onTouchEnd);

        return () => {
            // Re-enable map interactions
            map.dragPan.enable();
            map.dragRotate.enable();
            canvas.style.cursor = '';

            // Remove listeners
            canvas.removeEventListener('mousedown', onMouseDown);
            canvas.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('mouseup', onMouseUp);
            canvas.removeEventListener('mouseleave', onMouseUp);
            canvas.removeEventListener('touchstart', onTouchStart);
            canvas.removeEventListener('touchmove', onTouchMove);
            canvas.removeEventListener('touchend', onTouchEnd);
            canvas.removeEventListener('touchcancel', onTouchEnd);
        };
    }, [mapLoaded, mode, routeSubMode, handleDrawStart, handleDrawMove, handleDrawEnd]);

    // Update drawing preview layer
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapLoaded) return;

        const source = map.getSource('drawing-preview') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: drawingPoints
                }
            });
        }
    }, [drawingPoints, mapLoaded]);

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

            {/* Header - using glassPanel preset */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: isMobile ? 0 : 320,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: isMobile ? '12px 16px' : '16px 24px',
                ...glassPanel,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                borderRadius: 0,
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
                        fontWeight: 500
                    }}>
                        {trekData.name}
                    </h1>
                </div>

                {/* Mode toggle - using ModeToggleButton component */}
                <div style={{
                    display: 'flex',
                    gap: 4,
                    padding: 4,
                    background: colors.glass.subtle,
                    borderRadius: radius.xl,
                    border: `1px solid ${colors.glass.borderSubtle}`
                }}>
                    <ModeToggleButton
                        label="Camps"
                        isActive={mode === 'camps'}
                        onClick={() => setMode('camps')}
                    />
                    <ModeToggleButton
                        label="Route"
                        isActive={mode === 'route'}
                        onClick={() => setMode('route')}
                    />
                </div>

                {/* Route sub-mode toggle (only visible in Route mode) */}
                {mode === 'route' && (
                    <div style={{
                        display: 'flex',
                        gap: 4,
                        padding: 4,
                        background: colors.glass.subtle,
                        borderRadius: radius.xl,
                        border: `1px solid ${colors.glass.borderSubtle}`
                    }}>
                        <ModeToggleButton
                            label="Edit"
                            isActive={routeSubMode === 'edit'}
                            onClick={() => setRouteSubMode('edit')}
                        />
                        <ModeToggleButton
                            label="Select"
                            isActive={routeSubMode === 'select'}
                            onClick={() => setRouteSubMode('select')}
                        />
                        <ModeToggleButton
                            label="Draw"
                            isActive={routeSubMode === 'draw'}
                            onClick={() => setRouteSubMode('draw')}
                        />
                    </div>
                )}

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
                ) : routeSubMode === 'edit' ? (
                    <>
                        <strong>Drag</strong> route points to adjust path<br />
                        <strong>Click</strong> on route to add new point
                    </>
                ) : routeSubMode === 'select' ? (
                    isSelecting ? (
                        <span style={{ color: '#60a5fa' }}>
                            <strong>Selecting...</strong> Release to select points
                        </span>
                    ) : drawFeedback ? (
                        <span style={{ color: '#34d399' }}>
                            {drawFeedback}
                        </span>
                    ) : (
                        <>
                            <strong style={{ color: '#60a5fa' }}>Drag</strong> to draw selection box<br />
                            <span style={{ fontSize: 11, color: colors.text.tertiary }}>
                                Select points, then snap or delete • Shift+click for range
                            </span>
                        </>
                    )
                ) : isProcessingDraw ? (
                    <span style={{ color: colors.accent.primary }}>Processing...</span>
                ) : isDrawing ? (
                    <span style={{ color: '#34d399' }}>
                        <strong>Drawing...</strong> Lift to finish
                    </span>
                ) : drawFeedback ? (
                    <span style={{ color: '#34d399' }}>
                        {drawFeedback}
                    </span>
                ) : (
                    <>
                        <strong style={{ color: '#34d399' }}>Draw</strong> on map to add or replace route<br />
                        <span style={{ fontSize: 11, color: colors.text.tertiary }}>
                            Start/end near route to replace • Two fingers to pan
                        </span>
                    </>
                )}
            </div>

            {/* Selection rectangle overlay */}
            {isSelecting && selectionStart && selectionEnd && (
                <div
                    style={{
                        position: 'absolute',
                        left: Math.min(selectionStart.x, selectionEnd.x),
                        top: Math.min(selectionStart.y, selectionEnd.y),
                        width: Math.abs(selectionEnd.x - selectionStart.x),
                        height: Math.abs(selectionEnd.y - selectionStart.y),
                        background: 'rgba(96, 165, 250, 0.15)',
                        border: '2px solid rgba(96, 165, 250, 0.8)',
                        borderRadius: 4,
                        pointerEvents: 'none',
                        zIndex: 10
                    }}
                />
            )}

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

            {/* Sidebar - using glassPanel preset */}
            <div style={{
                position: 'absolute',
                top: isMobile ? 'auto' : 0,
                right: 0,
                bottom: 0,
                left: isMobile ? 0 : 'auto',
                width: isMobile ? '100%' : 320,
                height: isMobile ? '40vh' : '100%',
                ...glassPanel,
                borderLeft: isMobile ? 'none' : `1px solid ${colors.glass.border}`,
                borderTop: isMobile ? `1px solid ${colors.glass.border}` : 'none',
                borderBottom: 'none',
                borderRight: 'none',
                borderRadius: isMobile ? `${radius.xxl}px ${radius.xxl}px 0 0` : 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
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
                            {/* Selected route points actions */}
                            {selectedRoutePoints.size > 0 && (
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
                                                {selectedRoutePoints.size === 1
                                                    ? `Route Point #${Array.from(selectedRoutePoints)[0] + 1}`
                                                    : `${selectedRoutePoints.size} Points Selected`
                                                }
                                            </div>
                                            {selectedRoutePoints.size === 1 && (
                                                <>
                                                    <div style={{
                                                        fontSize: 13,
                                                        color: colors.text.secondary,
                                                        marginTop: 4
                                                    }}>
                                                        {routeCoordinates[Array.from(selectedRoutePoints)[0]]?.[2]?.toFixed(0) || 0}m elevation
                                                    </div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        color: colors.text.tertiary,
                                                        marginTop: 2
                                                    }}>
                                                        {routeCoordinates[Array.from(selectedRoutePoints)[0]]?.[1]?.toFixed(5)}, {routeCoordinates[Array.from(selectedRoutePoints)[0]]?.[0]?.toFixed(5)}
                                                    </div>
                                                </>
                                            )}
                                            {selectedRoutePoints.size > 1 && (
                                                <div style={{
                                                    fontSize: 12,
                                                    color: colors.text.tertiary,
                                                    marginTop: 4
                                                }}>
                                                    Points {Math.min(...selectedRoutePoints) + 1} - {Math.max(...selectedRoutePoints) + 1}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        {selectedRoutePoints.size === 1 && (
                                            <GlassButton
                                                variant="subtle"
                                                size="sm"
                                                onClick={() => {
                                                    const coord = routeCoordinates[Array.from(selectedRoutePoints)[0]];
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
                                        )}
                                        <GlassButton
                                            variant="subtle"
                                            size="sm"
                                            onClick={handleClearSelection}
                                        >
                                            Clear
                                        </GlassButton>
                                        {selectedRoutePoints.size >= 2 && (
                                            <GlassButton
                                                variant="subtle"
                                                size="sm"
                                                onClick={handleSnapSelectedToTrail}
                                                disabled={isSnapping}
                                                style={{ color: '#60a5fa' }}
                                            >
                                                {isSnapping ? `Snapping ${Math.round(snapProgress * 100)}%` : '🛤️ Snap'}
                                            </GlassButton>
                                        )}
                                        <GlassButton
                                            variant="subtle"
                                            size="sm"
                                            onClick={handleDeleteRoutePoints}
                                            style={{ color: '#ef4444' }}
                                        >
                                            Delete {selectedRoutePoints.size > 1 ? `(${selectedRoutePoints.size})` : ''}
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
                                    color: colors.text.tertiary,
                                    marginBottom: 12
                                }}>
                                    Drag markers to adjust the route path. Click on the route line to add new points.
                                </div>

                                {/* Snap to Trail button */}
                                <GlassButton
                                    variant="subtle"
                                    size="sm"
                                    onClick={handleSnapToTrail}
                                    disabled={isSnapping || routeCoordinates.length < 2}
                                    style={{ width: '100%' }}
                                >
                                    {isSnapping ? (
                                        <>Snapping... {Math.round(snapProgress * 100)}%</>
                                    ) : (
                                        <>🛤️ Snap Route to Trails</>
                                    )}
                                </GlassButton>
                                <div style={{
                                    fontSize: 11,
                                    color: colors.text.tertiary,
                                    marginTop: 8,
                                    lineHeight: 1.4
                                }}>
                                    Automatically align the entire route to nearby hiking trails using Mapbox.
                                </div>
                            </div>

                            {/* Selection tools */}
                            <div style={{
                                padding: 16,
                                borderBottom: `1px solid ${colors.glass.borderSubtle}`
                            }}>
                                <div style={{
                                    fontSize: 11,
                                    color: colors.text.tertiary,
                                    marginBottom: 12,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em'
                                }}>
                                    Selection Tools
                                </div>

                                {/* Quick select buttons */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                    <GlassButton
                                        variant="subtle"
                                        size="sm"
                                        onClick={handleSelectAllVisible}
                                        style={{ flex: 1 }}
                                    >
                                        Select Visible
                                    </GlassButton>
                                    {selectedRoutePoints.size > 0 && (
                                        <GlassButton
                                            variant="subtle"
                                            size="sm"
                                            onClick={handleClearSelection}
                                        >
                                            Clear
                                        </GlassButton>
                                    )}
                                </div>

                                {/* Range select inputs */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8
                                }}>
                                    <input
                                        type="number"
                                        min={1}
                                        max={routeCoordinates.length}
                                        placeholder="Start"
                                        style={{
                                            flex: 1,
                                            padding: '8px 10px',
                                            borderRadius: radius.sm,
                                            border: `1px solid ${colors.glass.border}`,
                                            background: colors.glass.subtle,
                                            color: colors.text.primary,
                                            fontSize: 13,
                                            width: 60
                                        }}
                                        id="range-start"
                                    />
                                    <span style={{ color: colors.text.tertiary }}>to</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={routeCoordinates.length}
                                        placeholder="End"
                                        style={{
                                            flex: 1,
                                            padding: '8px 10px',
                                            borderRadius: radius.sm,
                                            border: `1px solid ${colors.glass.border}`,
                                            background: colors.glass.subtle,
                                            color: colors.text.primary,
                                            fontSize: 13,
                                            width: 60
                                        }}
                                        id="range-end"
                                    />
                                    <GlassButton
                                        variant="subtle"
                                        size="sm"
                                        onClick={() => {
                                            const startInput = document.getElementById('range-start') as HTMLInputElement;
                                            const endInput = document.getElementById('range-end') as HTMLInputElement;
                                            const start = parseInt(startInput?.value || '0') - 1;
                                            const end = parseInt(endInput?.value || '0') - 1;
                                            if (!isNaN(start) && !isNaN(end) && start >= 0 && end >= 0) {
                                                handleSelectRange(start, end);
                                            }
                                        }}
                                    >
                                        Select
                                    </GlassButton>
                                </div>

                                <div style={{
                                    fontSize: 11,
                                    color: colors.text.tertiary,
                                    marginTop: 8,
                                    lineHeight: 1.4
                                }}>
                                    Shift+click markers to select a range. Delete to remove selected portion.
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
