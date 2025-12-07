/**
 * Custom hook for Mapbox map initialization and management
 */

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateBearing, findNearestCoordIndex, getDistanceFromLatLonInKm } from '../utils/geography';
import type { TrekConfig, TrekData, Camp, Photo, PointOfInterest, POICategory } from '../types/trek';

// Route click information
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

interface UseMapboxOptions {
    containerRef: RefObject<HTMLDivElement | null>;
    onTrekSelect: (trek: TrekConfig) => void;
    onPhotoClick?: (photo: Photo) => void;
    onRouteClick?: (info: RouteClickInfo) => void;
    onPOIClick?: (poi: PointOfInterest) => void;
    onCampClick?: (camp: Camp) => void;
    getMediaUrl?: (path: string) => string;
}

// Playback state for journey animation
export interface PlaybackState {
    isPlaying: boolean;
    progress: number; // 0-100 percentage
    currentCampIndex: number;
}

interface UseMapboxReturn {
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
}

/**
 * Initialize Mapbox map with globe projection and terrain
 */
export function useMapbox({ containerRef, onTrekSelect, onPhotoClick, onRouteClick, onPOIClick, onCampClick, getMediaUrl }: UseMapboxOptions): UseMapboxReturn {
    const { treks, trekDataMap } = useJourneys();
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const rotationAnimationRef = useRef<number | null>(null);
    const interactionListenerRef = useRef<(() => void) | null>(null);
    const photosRef = useRef<Photo[]>([]);
    const poisRef = useRef<PointOfInterest[]>([]);
    const campsRef = useRef<Camp[]>([]);
    const photoMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
    const selectedTrekRef = useRef<string | null>(null);
    const playbackAnimationRef = useRef<number | null>(null);
    const playbackCallbackRef = useRef<((camp: Camp) => void) | null>(null);
    // Track if we're in globe view mode (for auto-recentering)
    const isGlobeViewRef = useRef<boolean>(true);
    // Track if we're currently flying to globe (animation in progress)
    const isFlyingToGlobeRef = useRef<boolean>(false);
    // Track if we should skip the next recenter (to avoid conflicts with flyToGlobe)
    const skipRecenterRef = useRef<boolean>(false);
    // Track if a flyToGlobe was interrupted and needs to be resumed
    const needsGlobeRecenterRef = useRef<boolean>(false);
    // Track the target center for current/interrupted flyToGlobe animation
    const targetCenterRef = useRef<[number, number] | null>(null);
    // Default globe center coordinates (when no trek selected)
    const GLOBE_CENTER: [number, number] = [30, 15];
    const [mapReady, setMapReady] = useState(false);
    const [dataLayersReady, setDataLayersReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>({
        isPlaying: false,
        progress: 0,
        currentCampIndex: 0
    });
    const [isRotating, setIsRotating] = useState(false);

    // Store callbacks and data in refs to avoid dependency issues
    const onTrekSelectRef = useRef(onTrekSelect);
    const onPhotoClickRef = useRef(onPhotoClick);
    const onRouteClickRef = useRef(onRouteClick);
    const onPOIClickRef = useRef(onPOIClick);
    const onCampClickRef = useRef(onCampClick);
    const treksRef = useRef(treks);
    const trekDataMapRef = useRef(trekDataMap);

    useEffect(() => {
        onTrekSelectRef.current = onTrekSelect;
    }, [onTrekSelect]);

    useEffect(() => {
        onPhotoClickRef.current = onPhotoClick;
    }, [onPhotoClick]);

    useEffect(() => {
        onRouteClickRef.current = onRouteClick;
    }, [onRouteClick]);

    useEffect(() => {
        onPOIClickRef.current = onPOIClick;
    }, [onPOIClick]);

    useEffect(() => {
        onCampClickRef.current = onCampClick;
    }, [onCampClick]);

    useEffect(() => {
        treksRef.current = treks;
        trekDataMapRef.current = trekDataMap;
    }, [treks, trekDataMap]);

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
        if (!token) {
            setError('Mapbox token not found');
            console.error('Mapbox token not found');
            return;
        }

        mapboxgl.accessToken = token;

        // Detect mobile for touch optimizations
        const isMobile = window.matchMedia('(max-width: 768px)').matches;

        try {
            const map = new mapboxgl.Map({
                container: containerRef.current,
                style: 'mapbox://styles/mapbox/satellite-v9',
                projection: 'globe',
                zoom: isMobile ? 1.2 : 1.5,
                center: [30, 15],
                pitch: 0,
                // Smoother interactions
                dragRotate: true,
                touchZoomRotate: true,
                touchPitch: true,
                // Smoother zoom
                scrollZoom: {
                    around: 'center'
                },
                // Better animation defaults
                fadeDuration: 300
            });

            // Configure touch gestures for mobile
            if (isMobile) {
                map.touchZoomRotate.enableRotation();
                map.touchPitch.enable();
            }

            mapRef.current = map;

            map.on('style.load', () => {
                // Add glyphs source for text rendering (satellite style doesn't include this)
                const style = map.getStyle();
                if (style && !style.glyphs) {
                    style.glyphs = 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf';
                    map.setStyle(style);
                    return; // Style will reload, this handler will fire again
                }

                // Set atmosphere fog - transparent space so CSS starfield shows through
                map.setFog({
                    'range': [1, 12],
                    'color': 'rgb(186, 210, 235)',
                    'high-color': 'rgb(36, 92, 223)',
                    'horizon-blend': 0.02,
                    'space-color': 'rgba(0, 0, 0, 0)', // Transparent - CSS stars show through
                    'star-intensity': 0 // Disable Mapbox stars
                });

                // Add terrain source - use smaller tiles on mobile for better performance
                map.addSource('mapbox-dem', {
                    type: 'raster-dem',
                    url: 'mapbox://mapbox.terrain-rgb',
                    tileSize: isMobile ? 256 : 512,
                    maxzoom: isMobile ? 14 : 16
                });
                map.setTerrain({ source: 'mapbox-dem', exaggeration: isMobile ? 1.0 : 1.2 });

                // Add sky layer
                map.addLayer({
                    'id': 'sky',
                    'type': 'sky',
                    'paint': {
                        'sky-type': 'atmosphere',
                        'sky-atmosphere-sun': [0.0, 0.0],
                        'sky-atmosphere-sun-intensity': 3
                    }
                });

                // Active segment source & layers (always needed)
                map.addSource('active-segment', {
                    type: 'geojson',
                    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
                });

                map.addLayer({
                    id: 'active-segment-glow',
                    type: 'line',
                    source: 'active-segment',
                    layout: { 'visibility': 'none', 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#00ffff', 'line-width': 15, 'line-blur': 10, 'line-opacity': 0.5 }
                });

                map.addLayer({
                    id: 'active-segment-line',
                    type: 'line',
                    source: 'active-segment',
                    layout: { 'visibility': 'none', 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#00ffff', 'line-width': 4 }
                });

                // Photo markers source & layers (with clustering)
                map.addSource('photo-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                    cluster: true,
                    clusterMaxZoom: 14, // Max zoom to cluster points
                    clusterRadius: 50 // Radius of each cluster in pixels
                });

                // Cluster circles - outer glow (cool blue tint - distinct from warm camps)
                map.addLayer({
                    id: 'photo-clusters-glow',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['has', 'point_count'],
                    layout: { 'visibility': 'none' },
                    paint: {
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
                    }
                });

                // Cluster circles - main (cool blue-tinted glass)
                map.addLayer({
                    id: 'photo-clusters-circle',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['has', 'point_count'],
                    layout: { 'visibility': 'none' },
                    paint: {
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
                    }
                });

                // Cluster count labels (blue-tinted text)
                map.addLayer({
                    id: 'photo-clusters-count',
                    type: 'symbol',
                    source: 'photo-markers',
                    filter: ['has', 'point_count'],
                    layout: {
                        'visibility': 'none',
                        'text-field': ['get', 'point_count_abbreviated'],
                        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                        'text-size': 10,
                        'text-allow-overlap': true
                    },
                    paint: {
                        'text-color': 'rgba(30, 64, 175, 0.9)',
                        'text-halo-color': 'rgba(219, 234, 254, 0.5)',
                        'text-halo-width': 1
                    }
                });

                // Photo marker glow (cool blue starlight)
                map.addLayer({
                    id: 'photo-markers-glow',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['!', ['has', 'point_count']],
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': ['case', ['get', 'highlighted'], 'rgba(96, 165, 250, 0.8)', 'rgba(147, 197, 253, 0.6)'],
                        'circle-radius': ['case', ['get', 'highlighted'], 10, 6],
                        'circle-opacity': ['case', ['get', 'highlighted'], 0.5, 0.3],
                        'circle-blur': 0.7
                    }
                });

                // Photo marker circles - blue-tinted crystalline dots
                map.addLayer({
                    id: 'photo-markers-circle',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['!', ['has', 'point_count']],
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': ['case', ['get', 'highlighted'], 'rgba(219, 234, 254, 0.98)', 'rgba(241, 245, 249, 0.9)'],
                        'circle-radius': ['case', ['get', 'highlighted'], 5, 3],
                        'circle-stroke-width': ['case', ['get', 'highlighted'], 1.5, 0.5],
                        'circle-stroke-color': ['case', ['get', 'highlighted'], 'rgba(59, 130, 246, 0.7)', 'rgba(147, 197, 253, 0.5)']
                    }
                });

                // Camp markers source & layers
                map.addSource('camp-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });

                // Camp marker outer glow (warm amber tint - clearly distinct from photos)
                map.addLayer({
                    id: 'camp-markers-glow',
                    type: 'circle',
                    source: 'camp-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': ['case', ['get', 'selected'], 'rgba(251, 191, 36, 0.8)', 'rgba(253, 224, 168, 0.7)'],
                        'circle-radius': ['case', ['get', 'selected'], 18, 14],
                        'circle-opacity': ['case', ['get', 'selected'], 0.5, 0.35],
                        'circle-blur': 0.6
                    }
                });

                // Camp marker circles (warm cream/amber glass - distinct from cool photo markers)
                map.addLayer({
                    id: 'camp-markers-circle',
                    type: 'circle',
                    source: 'camp-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': ['case', ['get', 'selected'], 'rgba(254, 243, 199, 0.95)', 'rgba(254, 249, 235, 0.9)'],
                        'circle-radius': ['case', ['get', 'selected'], 12, 9],
                        'circle-stroke-width': ['case', ['get', 'selected'], 2, 1.5],
                        'circle-stroke-color': ['case', ['get', 'selected'], 'rgba(251, 191, 36, 0.7)', 'rgba(253, 211, 106, 0.5)']
                    }
                });

                // Camp marker labels (day number with warm styling)
                map.addLayer({
                    id: 'camp-markers-label',
                    type: 'symbol',
                    source: 'camp-markers',
                    layout: {
                        'visibility': 'none',
                        'text-field': ['get', 'dayNumber'],
                        'text-size': ['case', ['get', 'selected'], 11, 9],
                        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                        'text-allow-overlap': true
                    },
                    paint: {
                        'text-color': ['case', ['get', 'selected'], 'rgba(120, 53, 15, 0.95)', 'rgba(146, 64, 14, 0.85)'],
                        'text-halo-color': 'rgba(254, 243, 199, 0.6)',
                        'text-halo-width': 1
                    }
                });

                // POI (Points of Interest) markers source & layers
                map.addSource('poi-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });

                // POI marker outer glow - color varies by category
                map.addLayer({
                    id: 'poi-markers-glow',
                    type: 'circle',
                    source: 'poi-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': [
                            'match', ['get', 'category'],
                            'viewpoint', 'rgba(168, 85, 247, 0.7)',     // Purple for viewpoints
                            'water', 'rgba(59, 130, 246, 0.7)',         // Blue for water
                            'landmark', 'rgba(234, 179, 8, 0.7)',       // Yellow for landmarks
                            'shelter', 'rgba(34, 197, 94, 0.7)',        // Green for shelters
                            'warning', 'rgba(239, 68, 68, 0.7)',        // Red for warnings
                            'summit', 'rgba(251, 146, 60, 0.7)',        // Orange for summits
                            'wildlife', 'rgba(20, 184, 166, 0.7)',      // Teal for wildlife
                            'photo_spot', 'rgba(236, 72, 153, 0.7)',    // Pink for photo spots
                            'rest_area', 'rgba(132, 204, 22, 0.7)',     // Lime for rest areas
                            'rgba(148, 163, 184, 0.7)'                  // Default gray
                        ],
                        'circle-radius': 12,
                        'circle-opacity': 0.4,
                        'circle-blur': 0.5
                    }
                });

                // POI marker circles - distinct icon-like appearance
                map.addLayer({
                    id: 'poi-markers-circle',
                    type: 'circle',
                    source: 'poi-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': [
                            'match', ['get', 'category'],
                            'viewpoint', 'rgba(233, 213, 255, 0.95)',   // Light purple
                            'water', 'rgba(219, 234, 254, 0.95)',       // Light blue
                            'landmark', 'rgba(254, 249, 195, 0.95)',    // Light yellow
                            'shelter', 'rgba(220, 252, 231, 0.95)',     // Light green
                            'warning', 'rgba(254, 226, 226, 0.95)',     // Light red
                            'summit', 'rgba(255, 237, 213, 0.95)',      // Light orange
                            'wildlife', 'rgba(204, 251, 241, 0.95)',    // Light teal
                            'photo_spot', 'rgba(252, 231, 243, 0.95)',  // Light pink
                            'rest_area', 'rgba(236, 252, 203, 0.95)',   // Light lime
                            'rgba(241, 245, 249, 0.95)'                 // Default light gray
                        ],
                        'circle-radius': 8,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-color': [
                            'match', ['get', 'category'],
                            'viewpoint', 'rgba(168, 85, 247, 0.8)',
                            'water', 'rgba(59, 130, 246, 0.8)',
                            'landmark', 'rgba(234, 179, 8, 0.8)',
                            'shelter', 'rgba(34, 197, 94, 0.8)',
                            'warning', 'rgba(239, 68, 68, 0.8)',
                            'summit', 'rgba(251, 146, 60, 0.8)',
                            'wildlife', 'rgba(20, 184, 166, 0.8)',
                            'photo_spot', 'rgba(236, 72, 153, 0.8)',
                            'rest_area', 'rgba(132, 204, 22, 0.8)',
                            'rgba(148, 163, 184, 0.8)'
                        ]
                    }
                });

                // POI marker labels with category icon
                map.addLayer({
                    id: 'poi-markers-label',
                    type: 'symbol',
                    source: 'poi-markers',
                    layout: {
                        'visibility': 'none',
                        'text-field': [
                            'match', ['get', 'category'],
                            'viewpoint', '👁',
                            'water', '💧',
                            'landmark', '🏔',
                            'shelter', '🏠',
                            'warning', '⚠',
                            'summit', '⛰',
                            'wildlife', '🦌',
                            'photo_spot', '📷',
                            'rest_area', '🪑',
                            'info', 'ℹ',
                            '•'
                        ],
                        'text-size': 12,
                        'text-allow-overlap': true,
                        'text-offset': [0, -1.8]
                    },
                    paint: {
                        'text-color': 'rgba(255, 255, 255, 0.95)'
                    }
                });

                // POI name labels (shown on hover/zoom)
                map.addLayer({
                    id: 'poi-markers-name',
                    type: 'symbol',
                    source: 'poi-markers',
                    layout: {
                        'visibility': 'none',
                        'text-field': ['get', 'name'],
                        'text-size': 10,
                        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
                        'text-offset': [0, 1.5],
                        'text-anchor': 'top'
                    },
                    paint: {
                        'text-color': 'rgba(255, 255, 255, 0.9)',
                        'text-halo-color': 'rgba(0, 0, 0, 0.7)',
                        'text-halo-width': 1
                    }
                });

                setMapReady(true);
            });

            // Photo marker interaction handlers
            map.on('mouseenter', 'photo-markers-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'photo-markers-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('click', 'photo-markers-circle', (e) => {
                if (e.features && e.features.length > 0) {
                    const photoId = e.features[0].properties?.id;
                    if (photoId && onPhotoClickRef.current) {
                        const photo = photosRef.current.find(p => p.id === photoId);
                        if (photo) {
                            onPhotoClickRef.current(photo);
                        }
                    }
                    e.originalEvent.stopPropagation();
                }
            });

            // Cluster interaction handlers - zoom in on click
            map.on('mouseenter', 'photo-clusters-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'photo-clusters-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('click', 'photo-clusters-circle', (e) => {
                if (e.features && e.features.length > 0) {
                    const clusterId = e.features[0].properties?.cluster_id;
                    const source = map.getSource('photo-markers') as mapboxgl.GeoJSONSource;

                    if (source && clusterId !== undefined) {
                        // Get cluster expansion zoom level
                        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                            if (err) return;

                            const geometry = e.features![0].geometry as GeoJSON.Point;
                            map.easeTo({
                                center: geometry.coordinates as [number, number],
                                zoom: zoom || 15,
                                duration: 500
                            });
                        });
                    }
                    e.originalEvent.stopPropagation();
                }
            });

            // POI marker interaction handlers
            map.on('mouseenter', 'poi-markers-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'poi-markers-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('click', 'poi-markers-circle', (e) => {
                if (e.features && e.features.length > 0) {
                    const poiId = e.features[0].properties?.id;
                    if (poiId && onPOIClickRef.current) {
                        const poi = poisRef.current.find(p => p.id === poiId);
                        if (poi) {
                            onPOIClickRef.current(poi);
                        }
                    }
                    e.originalEvent.stopPropagation();
                }
            });

            // Camp marker interaction handlers
            map.on('mouseenter', 'camp-markers-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'camp-markers-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('click', 'camp-markers-circle', (e) => {
                if (e.features && e.features.length > 0) {
                    const campId = e.features[0].properties?.id;
                    if (campId && onCampClickRef.current) {
                        const camp = campsRef.current.find(c => c.id === campId);
                        if (camp) {
                            onCampClickRef.current(camp);
                        }
                    }
                    e.originalEvent.stopPropagation();
                }
            });

            // Interaction handlers
            map.on('mouseenter', 'trek-markers-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'trek-markers-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            // Handler for selecting a trek marker
            const handleTrekSelect = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapGeoJSONFeature[] }) => {
                if (e.features && e.features.length > 0) {
                    const trekProps = e.features[0].properties as TrekConfig;
                    const trek = treksRef.current.find(t => t.id === trekProps.id);
                    if (trek && onTrekSelectRef.current) {
                        onTrekSelectRef.current(trek);
                    }
                    e.originalEvent.stopPropagation();
                }
            };

            // Both click and double-click select the journey
            map.on('click', 'trek-markers-circle', handleTrekSelect);
            map.on('dblclick', 'trek-markers-circle', handleTrekSelect);

        } catch (err) {
            setError((err as Error).message);
            console.error('Error initializing map:', err);
        }

        return () => {
            // Clean up HTML photo markers
            for (const marker of photoMarkersRef.current.values()) {
                marker.remove();
            }
            photoMarkersRef.current.clear();

            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [containerRef]);

    // Auto-recenter globe when flyTo is interrupted or when zooming back out
    // This fixes the issue where clicking "back to globe" and then manually
    // zooming/panning leaves the globe off-center
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Handler for when user interrupts a flyTo animation
        const handleUserInteraction = () => {
            if (isFlyingToGlobeRef.current) {
                // User interrupted flyToGlobe animation
                isFlyingToGlobeRef.current = false;
                skipRecenterRef.current = false;
                // Mark that we need to complete the flyToGlobe after user stops
                needsGlobeRecenterRef.current = true;
            }
        };

        // Handler for when movement ends - check if we should recenter
        const handleMoveEnd = () => {
            if (!mapRef.current) return;

            // Determine expected center: use stored target, or derive from selected trek
            const getExpectedCenter = (): [number, number] => {
                if (targetCenterRef.current) return targetCenterRef.current;
                if (selectedTrekRef.current) {
                    const trek = treksRef.current.find(t => t.id === selectedTrekRef.current);
                    if (trek) return [trek.lng, trek.lat];
                }
                return GLOBE_CENTER;
            };

            // If flyToGlobe was interrupted, complete it now
            if (needsGlobeRecenterRef.current && isGlobeViewRef.current) {
                needsGlobeRecenterRef.current = false;
                skipRecenterRef.current = true; // Skip the next moveend check

                const isMobile = window.matchMedia('(max-width: 768px)').matches;
                const targetZoom = selectedTrekRef.current
                    ? (isMobile ? 3 : 3.5)
                    : (isMobile ? 1.2 : 1.5);

                const expectedCenter = getExpectedCenter();

                // Complete the flyToGlobe animation to the correct center
                mapRef.current.flyTo({
                    center: expectedCenter,
                    zoom: targetZoom,
                    pitch: 0,
                    bearing: 0,
                    duration: 2000,
                    essential: true,
                    curve: 1.2,
                    easing: (t) => 1 - Math.pow(1 - t, 3)
                });

                // Reset skip flag after animation
                setTimeout(() => {
                    skipRecenterRef.current = false;
                }, 2500);
                return;
            }

            // Note: We intentionally do NOT auto-recenter when the user manually
            // pans/rotates the globe. The only auto-recenter is for interrupted
            // flyToGlobe animations (handled above with needsGlobeRecenterRef).
            // This allows users to freely explore the globe without being snapped back.
        };

        map.on('dragstart', handleUserInteraction);
        map.on('wheel', handleUserInteraction);
        map.on('touchstart', handleUserInteraction);
        map.on('moveend', handleMoveEnd);

        return () => {
            map.off('dragstart', handleUserInteraction);
            map.off('wheel', handleUserInteraction);
            map.off('touchstart', handleUserInteraction);
            map.off('moveend', handleMoveEnd);
        };
    }, [mapReady]);

    // Add trek markers and routes when data is available
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady || treks.length === 0 || dataLayersReady) return;

        // Add trek markers
        if (!map.getSource('trek-markers')) {
            map.addSource('trek-markers', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: treks.map(trek => ({
                        type: 'Feature' as const,
                        properties: trek,
                        geometry: {
                            type: 'Point' as const,
                            coordinates: [trek.lng, trek.lat]
                        }
                    }))
                }
            });

            // Trek marker layers (Apple Liquid Glass - luminous glass beads)
            map.addLayer({
                id: 'trek-markers-circle',
                type: 'circle',
                source: 'trek-markers',
                paint: {
                    'circle-color': 'rgba(255, 255, 255, 0.92)',
                    'circle-radius': 6,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': 'rgba(255, 255, 255, 0.35)',
                    'circle-emissive-strength': 1
                }
            });

            map.addLayer({
                id: 'trek-markers-glow',
                type: 'circle',
                source: 'trek-markers',
                paint: {
                    'circle-color': 'rgba(255, 255, 255, 0.75)',
                    'circle-radius': 12,
                    'circle-opacity': 0.25,
                    'circle-blur': 0.75,
                    'circle-emissive-strength': 1
                },
                beforeId: 'trek-markers-circle'
            });
        }

        // Preload all trek routes
        Object.values(trekDataMap).forEach((trekData: TrekData) => {
            if (!trekData.route) return;
            if (map.getSource(`route-${trekData.id}`)) return;

            map.addSource(`route-${trekData.id}`, {
                type: 'geojson',
                data: { type: 'Feature', properties: {}, geometry: trekData.route }
            });

            map.addLayer({
                id: `route-glow-${trekData.id}`,
                type: 'line',
                source: `route-${trekData.id}`,
                layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' },
                paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 12, 'line-blur': 8 }
            });

            map.addLayer({
                id: `route-${trekData.id}`,
                type: 'line',
                source: `route-${trekData.id}`,
                layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' },
                paint: { 'line-color': 'rgba(255,255,255,0.8)', 'line-width': 2 }
            });

            // Route click handler - use the glow layer (wider, easier to click)
            map.on('click', `route-glow-${trekData.id}`, (e) => {
                if (!onRouteClickRef.current) return;

                const coords = e.lngLat;
                const routeCoords = trekData.route.coordinates;
                const camps = trekData.camps;

                // Find nearest point on route and calculate distance
                let minDist = Infinity;
                let nearestIdx = 0;
                for (let i = 0; i < routeCoords.length; i++) {
                    const c = routeCoords[i];
                    const d = getDistanceFromLatLonInKm(coords.lat, coords.lng, c[1], c[0]);
                    if (d < minDist) {
                        minDist = d;
                        nearestIdx = i;
                    }
                }

                // Calculate distance from start to this point
                let distFromStart = 0;
                for (let i = 1; i <= nearestIdx; i++) {
                    const prev = routeCoords[i - 1];
                    const curr = routeCoords[i];
                    distFromStart += getDistanceFromLatLonInKm(prev[1], prev[0], curr[1], curr[0]);
                }

                // Calculate total route distance
                let totalDistance = distFromStart;
                for (let i = nearestIdx + 1; i < routeCoords.length; i++) {
                    const prev = routeCoords[i - 1];
                    const curr = routeCoords[i];
                    totalDistance += getDistanceFromLatLonInKm(prev[1], prev[0], curr[1], curr[0]);
                }

                // Get elevation at this point
                const nearestCoord = routeCoords[nearestIdx];
                const elevation = nearestCoord[2] !== undefined ? nearestCoord[2] : null;

                // Find nearest camp
                let nearestCamp: Camp | null = null;
                let distToNearestCamp = Infinity;
                camps.forEach(camp => {
                    const d = getDistanceFromLatLonInKm(
                        coords.lat, coords.lng,
                        camp.coordinates[1], camp.coordinates[0]
                    );
                    if (d < distToNearestCamp) {
                        distToNearestCamp = d;
                        nearestCamp = camp;
                    }
                });

                // Find previous and next camps along route
                // Sort camps by their route distance
                const sortedCamps = [...camps].sort((a, b) => {
                    const distA = a.routeDistanceKm ?? 0;
                    const distB = b.routeDistanceKm ?? 0;
                    return distA - distB;
                });

                let previousCamp: Camp | null = null;
                let nextCamp: Camp | null = null;
                let distToPreviousCamp: number | null = null;
                let distToNextCamp: number | null = null;

                for (let i = 0; i < sortedCamps.length; i++) {
                    const campDist = sortedCamps[i].routeDistanceKm ?? 0;
                    if (campDist <= distFromStart) {
                        previousCamp = sortedCamps[i];
                        distToPreviousCamp = distFromStart - campDist;
                    } else if (!nextCamp) {
                        nextCamp = sortedCamps[i];
                        distToNextCamp = campDist - distFromStart;
                    }
                }

                onRouteClickRef.current({
                    coordinates: [coords.lng, coords.lat],
                    distanceFromStart: Math.round(distFromStart * 10) / 10,
                    elevation: elevation !== null ? Math.round(elevation) : null,
                    nearestCamp,
                    distanceToNearestCamp: nearestCamp ? Math.round(distToNearestCamp * 10) / 10 : null,
                    totalDistance: Math.round(totalDistance * 10) / 10,
                    progressPercent: totalDistance > 0 ? Math.round((distFromStart / totalDistance) * 100) : 0,
                    previousCamp,
                    nextCamp,
                    distanceToPreviousCamp: distToPreviousCamp !== null ? Math.round(distToPreviousCamp * 10) / 10 : null,
                    distanceToNextCamp: distToNextCamp !== null ? Math.round(distToNextCamp * 10) / 10 : null
                });

                e.originalEvent.stopPropagation();
            });

            // Cursor on route hover
            map.on('mouseenter', `route-glow-${trekData.id}`, () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', `route-glow-${trekData.id}`, () => {
                map.getCanvas().style.cursor = '';
            });
        });

        setDataLayersReady(true);
    }, [mapReady, treks, trekDataMap, dataLayersReady]);

    // Fly to globe view
    const flyToGlobe = useCallback((selectedTrek: TrekConfig | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady || !map.isStyleLoaded()) return;

        // Mark that we're in globe view mode and flying
        isGlobeViewRef.current = true;
        isFlyingToGlobeRef.current = true;
        // Skip the next auto-recenter since flyToGlobe handles centering
        skipRecenterRef.current = true;

        // Set globe atmosphere - transparent space so CSS starfield shows through
        map.setFog({
            'range': [1, 12],
            'color': 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.02,
            'space-color': 'rgba(0, 0, 0, 0)',
            'star-intensity': 0
        });

        // Hide all routes
        Object.keys(trekDataMapRef.current).forEach(id => {
            if (map.getLayer(`route-${id}`)) {
                map.setLayoutProperty(`route-${id}`, 'visibility', 'none');
                map.setLayoutProperty(`route-glow-${id}`, 'visibility', 'none');
            }
        });

        // Hide active segment
        if (map.getLayer('active-segment-line')) {
            map.setLayoutProperty('active-segment-line', 'visibility', 'none');
            map.setLayoutProperty('active-segment-glow', 'visibility', 'none');
        }

        const isMobile = window.matchMedia('(max-width: 768px)').matches;

        if (selectedTrek) {
            // When focused on a trek at globe level, use trek position
            selectedTrekRef.current = selectedTrek.id;
            const trekCenter: [number, number] = [selectedTrek.lng, selectedTrek.lat];
            targetCenterRef.current = trekCenter;
            map.flyTo({
                center: trekCenter,
                zoom: isMobile ? 3 : 3.5,
                pitch: 0,
                bearing: 0,
                duration: 2500,
                essential: true,
                curve: 1.2,
                easing: (t) => 1 - Math.pow(1 - t, 3) // ease-out cubic
            });
        } else {
            // No trek selected - fly to default globe center
            selectedTrekRef.current = null;
            targetCenterRef.current = GLOBE_CENTER;
            map.flyTo({
                center: GLOBE_CENTER,
                zoom: isMobile ? 1.2 : 1.5,
                pitch: 0,
                bearing: 0,
                duration: 3000,
                essential: true,
                curve: 1.5,
                easing: (t) => 1 - Math.pow(1 - t, 3)
            });
        }

        // Reset flags after animation completes
        const animationDuration = selectedTrek ? 2500 : 3000;
        setTimeout(() => {
            isFlyingToGlobeRef.current = false;
            skipRecenterRef.current = false;
        }, animationDuration + 500);
    }, [mapReady]);

    // Highlight trek segment (defined before flyToTrek which uses it)
    const highlightSegment = useCallback((trekData: TrekData, selectedCamp: Camp) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
        if (campIndex === -1) return;

        const routeCoords = trekData.route.coordinates;
        if (!routeCoords || routeCoords.length === 0) return;

        // Get start and end coordinates for this day's segment
        const startCoord = campIndex === 0
            ? routeCoords[0]
            : trekData.camps[campIndex - 1].coordinates;
        const endCoord = selectedCamp.coordinates;

        // Use nearest point matching instead of exact matching
        // This ensures segments work even if camp coords don't exactly match route points
        const startIndex = findNearestCoordIndex(routeCoords, startCoord as [number, number]);
        const endIndex = findNearestCoordIndex(routeCoords, endCoord as [number, number]);

        // Ensure we have a valid segment (start before end)
        const actualStart = Math.min(startIndex, endIndex);
        const actualEnd = Math.max(startIndex, endIndex);

        if (actualEnd > actualStart) {
            const segmentCoords = routeCoords.slice(actualStart, actualEnd + 1);
            const segmentGeoJSON: GeoJSON.Feature = {
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates: segmentCoords }
            };

            const source = map.getSource('active-segment') as mapboxgl.GeoJSONSource;
            if (source) {
                source.setData(segmentGeoJSON);
                map.setLayoutProperty('active-segment-line', 'visibility', 'visible');
                map.setLayoutProperty('active-segment-glow', 'visibility', 'visible');
            }
        }
    }, [mapReady]);

    // Fly to trek view
    const flyToTrek = useCallback((selectedTrek: TrekConfig, selectedCamp: Camp | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady || !map.isStyleLoaded() || !selectedTrek) return;

        // Mark that we're NOT in globe view mode (we're viewing a trek)
        isGlobeViewRef.current = false;
        selectedTrekRef.current = selectedTrek.id;

        const trekData = trekDataMapRef.current[selectedTrek.id];
        const trekConfig = treksRef.current.find(t => t.id === selectedTrek.id);
        if (!trekData || !trekConfig) return;

        // Defer fog/route updates until animation is nearly complete
        // Animation is 2000-2500ms, delay updates until 1800ms to avoid jank
        const isMobileForTerrain = window.matchMedia('(max-width: 768px)').matches;
        const scheduleMapUpdates = () => {
            // Re-enable terrain after animation (was disabled on mobile for smooth animation)
            if (isMobileForTerrain) {
                map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });
            }

            // Set day mode atmosphere
            map.setFog({
                'range': [0.5, 10],
                'color': 'rgb(186, 210, 235)',
                'high-color': 'rgb(36, 92, 223)',
                'horizon-blend': 0.02,
                'space-color': 'rgb(11, 11, 25)',
                'star-intensity': 0.0
            });

            // Show selected route, hide others
            Object.keys(trekDataMapRef.current).forEach(id => {
                if (map.getLayer(`route-${id}`)) {
                    const visibility = id === selectedTrek.id ? 'visible' : 'none';
                    map.setLayoutProperty(`route-${id}`, 'visibility', visibility);
                    map.setLayoutProperty(`route-glow-${id}`, 'visibility', visibility);
                }
            });
        };

        // Use requestIdleCallback if available for lowest priority, fallback to setTimeout
        if ('requestIdleCallback' in window) {
            // Wait 1800ms then schedule during idle time
            setTimeout(() => {
                (window as typeof window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(scheduleMapUpdates);
            }, 1800);
        } else {
            setTimeout(scheduleMapUpdates, 1800);
        }

        // Temporarily disable terrain during camera animation for smooth performance
        // Terrain rendering is expensive during camera movement; re-enable after animation
        if (isMobileForTerrain) {
            map.setTerrain(null);
        }

        // Defer camera animation to next frame to let React settle
        // This prevents jank from overlapping React commits with Mapbox animation
        requestAnimationFrame(() => {
            // Verify map still exists (component might have unmounted)
            if (!mapRef.current) return;

            if (selectedCamp) {
                // Calculate camera settings
                let bearing = trekConfig.preferredBearing;
                const pitch = selectedCamp.pitch || 55;

            if (selectedCamp.bearing !== undefined) {
                bearing = selectedCamp.bearing;
            } else {
                // Smart bearing: look along path of arrival
                const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
                if (campIndex !== -1) {
                    const routeCoords = trekData.route.coordinates;
                    const currentCoord = selectedCamp.coordinates;
                    // Use nearest point matching for reliable bearing calculation
                    const endIndex = findNearestCoordIndex(routeCoords, currentCoord as [number, number]);

                    if (endIndex > 5) {
                        const lookBackIndex = endIndex - 5;
                        const prevCoord = routeCoords[lookBackIndex];
                        bearing = calculateBearing(prevCoord[1], prevCoord[0], currentCoord[1], currentCoord[0]);
                    } else if (campIndex > 0) {
                        const prevCampCoord = trekData.camps[campIndex - 1].coordinates;
                        bearing = calculateBearing(prevCampCoord[1], prevCampCoord[0], currentCoord[1], currentCoord[0]);
                    }
                }
            }

            const isMobileCamp = window.matchMedia('(max-width: 768px)').matches;
            map.flyTo({
                center: selectedCamp.coordinates as [number, number],
                zoom: isMobileCamp ? 14.5 : 15,
                pitch: pitch,
                bearing: bearing,
                duration: 2200,
                essential: true,
                curve: 1.3,
                easing: (t) => 1 - Math.pow(1 - t, 3)
            });

            // Highlight segment
            highlightSegment(trekData, selectedCamp);
        } else {
            // Fit bounds to whole route
            // Optimized bounds calculation - only sample every Nth point for large routes
            const coordinates = trekData.route.coordinates;
            const sampleRate = coordinates.length > 500 ? Math.ceil(coordinates.length / 100) : 1;

            let minLng = coordinates[0][0], maxLng = coordinates[0][0];
            let minLat = coordinates[0][1], maxLat = coordinates[0][1];

            for (let i = 0; i < coordinates.length; i += sampleRate) {
                const coord = coordinates[i];
                if (coord[0] < minLng) minLng = coord[0];
                if (coord[0] > maxLng) maxLng = coord[0];
                if (coord[1] < minLat) minLat = coord[1];
                if (coord[1] > maxLat) maxLat = coord[1];
            }
            // Always include last point
            const last = coordinates[coordinates.length - 1];
            if (last[0] < minLng) minLng = last[0];
            if (last[0] > maxLng) maxLng = last[0];
            if (last[1] < minLat) minLat = last[1];
            if (last[1] > maxLat) maxLat = last[1];

            const bounds = new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);

            const isMobileFit = window.matchMedia('(max-width: 768px)').matches;
            map.fitBounds(bounds, {
                padding: isMobileFit
                    ? { top: 80, bottom: 280, left: 40, right: 40 }
                    : { top: 100, bottom: 100, left: 100, right: 450 },
                pitch: trekConfig.preferredPitch,
                bearing: trekConfig.preferredBearing,
                duration: isMobileFit ? 2000 : 2500, // Shorter animation on mobile
                essential: true,
                // Simpler easing for smoother animation
                easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
            });

            // Hide highlight
            if (map.getLayer('active-segment-line')) {
                map.setLayoutProperty('active-segment-line', 'visibility', 'none');
                map.setLayoutProperty('active-segment-glow', 'visibility', 'none');
            }
        }
        }); // Close requestAnimationFrame
    }, [mapReady, highlightSegment]);

    // Stop rotation - defined first so startRotation can reference it
    const stopRotation = useCallback(() => {
        // Only update state if we're actually stopping an animation
        const wasRotating = rotationAnimationRef.current !== null;

        // Cancel animation
        if (rotationAnimationRef.current) {
            cancelAnimationFrame(rotationAnimationRef.current);
            rotationAnimationRef.current = null;
        }

        // Only update state if we were actually rotating (avoids unnecessary re-renders)
        if (wasRotating) {
            setIsRotating(false);
        }

        // Remove interaction listeners
        const map = mapRef.current;
        const listener = interactionListenerRef.current;
        if (map && listener) {
            // Remove canvas listeners
            const canvas = map.getCanvas();
            canvas.removeEventListener('mousedown', listener);
            canvas.removeEventListener('touchstart', listener);
            canvas.removeEventListener('wheel', listener);
            // Remove Mapbox listeners
            map.off('dragstart', listener);
            map.off('zoomstart', listener);
            map.off('rotatestart', listener);
            map.off('pitchstart', listener);
            interactionListenerRef.current = null;
        }
    }, []);

    // Globe spin animation - rotates globe on its axis (Earth spins, space stays fixed)
    const startRotation = useCallback(() => {
        const map = mapRef.current;
        if (!map || rotationAnimationRef.current) return;

        // Clean up any existing listeners first
        stopRotation();

        // Throttle on mobile to save battery (30fps instead of 60fps)
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const targetFps = isMobile ? 30 : 60;
        const frameInterval = 1000 / targetFps;

        let lastTime = performance.now();
        let lastFrameTime = performance.now();
        const rotationSpeed = isMobile ? 1.5 : 2; // Slower on mobile

        // Create and store the interaction listener
        const onInteraction = () => stopRotation();
        interactionListenerRef.current = onInteraction;

        // Listen for early interaction signals (before Mapbox's drag/zoom events)
        // Use passive: true for better mobile scroll performance
        const canvas = map.getCanvas();
        canvas.addEventListener('mousedown', onInteraction, { passive: true });
        canvas.addEventListener('touchstart', onInteraction, { passive: true });
        canvas.addEventListener('wheel', onInteraction, { passive: true });

        // Also listen for Mapbox events as backup
        map.on('dragstart', onInteraction);
        map.on('zoomstart', onInteraction);
        map.on('rotatestart', onInteraction);
        map.on('pitchstart', onInteraction);

        const animate = (currentTime: number) => {
            if (!mapRef.current || !rotationAnimationRef.current) return;

            // Throttle frame rate on mobile
            if (currentTime - lastFrameTime < frameInterval) {
                rotationAnimationRef.current = requestAnimationFrame(animate);
                return;
            }

            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;
            lastFrameTime = currentTime;

            // Spin globe by moving center longitude
            // Decrease longitude = Earth appears to rotate eastward (natural direction)
            const center = mapRef.current.getCenter();
            mapRef.current.setCenter([center.lng - rotationSpeed * deltaTime, center.lat]);

            rotationAnimationRef.current = requestAnimationFrame(animate);
        };

        rotationAnimationRef.current = requestAnimationFrame(animate);
        // Update state to indicate rotation started
        setIsRotating(true);
    }, [stopRotation]);

    // Cleanup rotation on unmount
    useEffect(() => {
        return () => {
            stopRotation();
        };
    }, [stopRotation]);

    // Track current selected camp for thumbnail updates
    const selectedCampIdRef = useRef<string | null>(null);
    // Track current photo groups by representative photo ID to avoid recreating markers
    const photoGroupsRef = useRef<Map<string, { photos: Photo[]; marker: mapboxgl.Marker }>>(new Map());
    // Debounce timer for marker updates during animation
    const markerUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Track last zoom level used for grouping (round to avoid regrouping on minor zoom changes)
    const lastGroupingZoomRef = useRef<number | null>(null);

    // Group photos by spatial grid cell based on zoom level
    // Returns groups with a representative photo (most recent) and count
    const groupPhotosByLocation = useCallback((photos: Photo[], zoom: number) => {
        // Grid cell size in degrees - smaller at higher zoom
        // At zoom 10: ~0.05 degrees (~5km), at zoom 15: ~0.002 degrees (~200m)
        const cellSize = 0.1 / Math.pow(2, zoom - 8);

        const groups = new Map<string, Photo[]>();

        for (const photo of photos) {
            if (!photo.coordinates || photo.coordinates.length !== 2) continue;
            const [lng, lat] = photo.coordinates;

            // Calculate grid cell key
            const cellX = Math.floor(lng / cellSize);
            const cellY = Math.floor(lat / cellSize);
            const key = `${cellX},${cellY}`;

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(photo);
        }

        // Convert to array of group objects, sorted by photo count (largest first)
        return Array.from(groups.entries()).map(([key, groupPhotos]) => ({
            key,
            photos: groupPhotos,
            // Use first photo as representative (could sort by date if available)
            representative: groupPhotos[0],
            count: groupPhotos.length,
            // Center of the group
            center: [
                groupPhotos.reduce((sum, p) => sum + (p.coordinates as [number, number])[0], 0) / groupPhotos.length,
                groupPhotos.reduce((sum, p) => sum + (p.coordinates as [number, number])[1], 0) / groupPhotos.length
            ] as [number, number]
        }));
    }, []);

    // Update photo markers on the map
    // Uses smart grouping based on zoom level for performance
    const updatePhotoMarkers = useCallback((photos: Photo[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Store for reference
        photosRef.current = photos;
        selectedCampIdRef.current = selectedCampId;

        // Hide native Mapbox layers - we use custom thumbnail markers
        map.setLayoutProperty('photo-markers-circle', 'visibility', 'none');
        map.setLayoutProperty('photo-markers-glow', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-circle', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-glow', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-count', 'visibility', 'none');

        // Clear existing source data
        const source = map.getSource('photo-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }

        // Debounce marker updates to prevent lag during animations
        if (markerUpdateTimerRef.current) {
            clearTimeout(markerUpdateTimerRef.current);
        }

        // Delay marker creation until after camera animation settles
        // flyToTrek takes 2000-2500ms, wait until animation completes to avoid jank
        // Use 2600ms to ensure animation is fully done before creating markers
        const delay = photos.length > 0 ? 2600 : 0;
        markerUpdateTimerRef.current = setTimeout(() => {
            // Only create markers if map is not moving (animation complete)
            if (mapRef.current && !mapRef.current.isMoving()) {
                updateThumbnailMarkers();
            } else if (mapRef.current) {
                // If still moving, wait for moveend event
                const onMoveEnd = () => {
                    mapRef.current?.off('moveend', onMoveEnd);
                    updateThumbnailMarkers();
                };
                mapRef.current.once('moveend', onMoveEnd);
            }
        }, delay);
    }, [mapReady]);

    // Create/update thumbnail stack markers
    const updateThumbnailMarkers = useCallback(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const photos = photosRef.current;
        const selectedCampId = selectedCampIdRef.current;

        // Remove all markers if no photos
        if (photos.length === 0) {
            for (const group of photoGroupsRef.current.values()) {
                group.marker.remove();
            }
            photoGroupsRef.current.clear();
            lastGroupingZoomRef.current = null;
            return;
        }

        const zoom = map.getZoom();
        const bounds = map.getBounds();
        if (!bounds) return;

        // Round zoom to avoid regrouping on minor changes (only regroup on whole zoom levels)
        const roundedZoom = Math.round(zoom);

        // Filter to viewport with buffer
        const buffer = 0.05;
        const west = bounds.getWest() - buffer;
        const east = bounds.getEast() + buffer;
        const south = bounds.getSouth() - buffer;
        const north = bounds.getNorth() + buffer;

        const visiblePhotos = photos.filter(photo => {
            if (!photo.coordinates || photo.coordinates.length !== 2) return false;
            const [lng, lat] = photo.coordinates;
            return lng >= west && lng <= east && lat >= south && lat <= north;
        });

        // Group photos by location at current zoom
        const groups = groupPhotosByLocation(visiblePhotos, roundedZoom);

        // Use representative photo ID as key for stability during panning
        const processedIds = new Set<string>();

        // Update or create markers for each group
        for (const group of groups) {
            // Use the representative photo ID as the stable key
            const stableKey = group.representative.id;
            processedIds.add(stableKey);

            const existingGroup = photoGroupsRef.current.get(stableKey);

            // If marker exists for this photo, just update position - don't recreate
            if (existingGroup) {
                // Update marker position (may have changed due to regrouping center)
                existingGroup.marker.setLngLat(group.center);
                // Update the stored photos for the group
                existingGroup.photos = group.photos;
                continue;
            }

            const isHighlighted = selectedCampId
                ? group.photos.some(p => p.waypoint_id === selectedCampId)
                : false;

            // Create marker element with stack appearance
            const el = document.createElement('div');
            el.className = 'photo-thumbnail-marker photo-stack' + (isHighlighted ? ' photo-marker-highlighted' : '');

            // Stack effect - show offset backgrounds for stacks of 2+
            if (group.count >= 3) {
                const bg2 = document.createElement('div');
                bg2.className = 'photo-stack-bg photo-stack-bg-2';
                el.appendChild(bg2);
            }
            if (group.count >= 2) {
                const bg1 = document.createElement('div');
                bg1.className = 'photo-stack-bg photo-stack-bg-1';
                el.appendChild(bg1);
            }

            // Main thumbnail
            const imgContainer = document.createElement('div');
            imgContainer.className = 'photo-stack-main';

            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.alt = group.representative.caption || 'Photo';
            img.draggable = false;
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.2s ease-out';
            img.onload = () => { img.style.opacity = '1'; };
            const photoUrl = group.representative.thumbnail_url || group.representative.url;
            img.src = getMediaUrl ? getMediaUrl(photoUrl) : photoUrl;
            imgContainer.appendChild(img);
            el.appendChild(imgContainer);

            // Create Mapbox marker
            const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                .setLngLat(group.center)
                .addTo(map);

            // Click handler - open first photo in group
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onPhotoClickRef.current) {
                    onPhotoClickRef.current(group.representative);
                }
            });

            photoGroupsRef.current.set(stableKey, { photos: group.photos, marker });
        }

        // Remove markers for groups no longer visible
        for (const [key, groupData] of photoGroupsRef.current.entries()) {
            if (!processedIds.has(key)) {
                groupData.marker.remove();
                photoGroupsRef.current.delete(key);
            }
        }

        // Update last grouping zoom
        lastGroupingZoomRef.current = roundedZoom;
    }, [mapReady, groupPhotosByLocation, getMediaUrl]);

    // Listen for zoom/move changes to regroup photos
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Throttle updates during continuous zoom/pan
        let updateScheduled = false;
        const scheduleUpdate = () => {
            if (updateScheduled) return;
            updateScheduled = true;
            requestAnimationFrame(() => {
                updateThumbnailMarkers();
                updateScheduled = false;
            });
        };

        map.on('zoomend', scheduleUpdate);
        map.on('moveend', scheduleUpdate);

        return () => {
            map.off('zoomend', scheduleUpdate);
            map.off('moveend', scheduleUpdate);
        };
    }, [mapReady, updateThumbnailMarkers]);

    // Update camp markers on the map
    const updateCampMarkers = useCallback((camps: Camp[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Store camps in ref for click handler
        campsRef.current = camps;

        // Create GeoJSON features for camps
        const features: GeoJSON.Feature[] = camps.map(camp => ({
            type: 'Feature',
            properties: {
                id: camp.id,
                name: camp.name,
                dayNumber: camp.dayNumber.toString(),
                elevation: camp.elevation,
                selected: camp.id === selectedCampId
            },
            geometry: {
                type: 'Point',
                coordinates: camp.coordinates as [number, number]
            }
        }));

        const source = map.getSource('camp-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features
            });

            // Show/hide camp markers based on whether we have camps
            const visibility = features.length > 0 ? 'visible' : 'none';
            map.setLayoutProperty('camp-markers-circle', 'visibility', visibility);
            map.setLayoutProperty('camp-markers-glow', 'visibility', visibility);
            map.setLayoutProperty('camp-markers-label', 'visibility', visibility);
        }
    }, [mapReady]);

    // Update POI markers on the map
    const updatePOIMarkers = useCallback((pois: PointOfInterest[]) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Store in ref for click handler
        poisRef.current = pois;

        // Create GeoJSON features for POIs
        const features: GeoJSON.Feature[] = pois.map(poi => ({
            type: 'Feature',
            properties: {
                id: poi.id,
                name: poi.name,
                category: poi.category,
                elevation: poi.elevation || 0,
                description: poi.description || '',
                routeDistanceKm: poi.routeDistanceKm || 0
            },
            geometry: {
                type: 'Point',
                coordinates: poi.coordinates as [number, number]
            }
        }));

        const source = map.getSource('poi-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features
            });

            // Show/hide POI markers based on whether we have POIs
            const visibility = features.length > 0 ? 'visible' : 'none';
            map.setLayoutProperty('poi-markers-circle', 'visibility', visibility);
            map.setLayoutProperty('poi-markers-glow', 'visibility', visibility);
            map.setLayoutProperty('poi-markers-label', 'visibility', visibility);
            map.setLayoutProperty('poi-markers-name', 'visibility', visibility);
        }
    }, [mapReady]);

    // Fly to a POI's location
    const flyToPOI = useCallback((poi: PointOfInterest) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        map.flyTo({
            center: poi.coordinates as [number, number],
            zoom: 16,
            pitch: 50,
            duration: 1500,
            essential: true,
            easing: (t) => 1 - Math.pow(1 - t, 3)
        });
    }, [mapReady]);

    // Fly to a photo's location
    const flyToPhoto = useCallback((photo: Photo) => {
        const map = mapRef.current;
        if (!map || !mapReady || !photo.coordinates) return;

        map.flyTo({
            center: photo.coordinates as [number, number],
            zoom: 16,
            pitch: 45,
            duration: 1500,
            essential: true,
            easing: (t) => 1 - Math.pow(1 - t, 3)
        });
    }, [mapReady]);

    // Stop playback animation
    const stopPlayback = useCallback(() => {
        if (playbackAnimationRef.current) {
            cancelAnimationFrame(playbackAnimationRef.current);
            playbackAnimationRef.current = null;
        }
        playbackCallbackRef.current = null;
        setPlaybackState({
            isPlaying: false,
            progress: 0,
            currentCampIndex: 0
        });
    }, []);

    // Start playback - animate through the journey
    const startPlayback = useCallback((trekData: TrekData, onCampReached?: (camp: Camp) => void) => {
        const map = mapRef.current;
        if (!map || !mapReady || !trekData.route?.coordinates) return;

        // Stop any existing playback
        stopPlayback();

        const camps = trekData.camps;
        const routeCoords = trekData.route.coordinates;
        const totalPoints = routeCoords.length;

        // Store callback
        playbackCallbackRef.current = onCampReached || null;

        // Calculate camp positions as route indices
        const campIndices: number[] = camps.map(camp => {
            let minDist = Infinity;
            let nearestIdx = 0;
            for (let i = 0; i < routeCoords.length; i++) {
                const c = routeCoords[i];
                const d = getDistanceFromLatLonInKm(camp.coordinates[1], camp.coordinates[0], c[1], c[0]);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }
            return nearestIdx;
        }).sort((a, b) => a - b);

        let currentIndex = 0;
        let lastCampIndex = -1;
        const startTime = performance.now();
        // 3 seconds per day, minimum 5 seconds total
        const daysCount = trekData.stats.duration || camps.length || 1;
        const duration = Math.max(daysCount * 3000, 5000);

        setPlaybackState({
            isPlaying: true,
            progress: 0,
            currentCampIndex: 0
        });

        const animate = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            currentIndex = Math.floor(progress * (totalPoints - 1));
            const coord = routeCoords[currentIndex];

            // Calculate bearing to next point for smooth camera orientation
            const nextIdx = Math.min(currentIndex + 10, totalPoints - 1);
            const nextCoord = routeCoords[nextIdx];
            const bearing = calculateBearing(coord[1], coord[0], nextCoord[1], nextCoord[0]);

            // Move camera
            map.easeTo({
                center: [coord[0], coord[1]],
                zoom: 14,
                pitch: 60,
                bearing: bearing,
                duration: 50,
                easing: (t) => t
            });

            // Check if we reached a camp
            const campReached = campIndices.findIndex(idx => currentIndex >= idx);
            if (campReached > lastCampIndex && campReached < camps.length) {
                lastCampIndex = campReached;
                if (playbackCallbackRef.current) {
                    playbackCallbackRef.current(camps[campReached]);
                }
            }

            // Update state
            setPlaybackState({
                isPlaying: true,
                progress: progress * 100,
                currentCampIndex: lastCampIndex >= 0 ? lastCampIndex : 0
            });

            // Continue or finish
            if (progress < 1) {
                playbackAnimationRef.current = requestAnimationFrame(animate);
            } else {
                // Finished - reset state
                setPlaybackState({
                    isPlaying: false,
                    progress: 100,
                    currentCampIndex: camps.length - 1
                });
                playbackAnimationRef.current = null;
            }
        };

        // Start animation
        playbackAnimationRef.current = requestAnimationFrame(animate);
    }, [mapReady, stopPlayback]);

    // Get current map center coordinates
    const getMapCenter = useCallback((): [number, number] | null => {
        if (!mapRef.current) return null;
        const center = mapRef.current.getCenter();
        return [center.lng, center.lat];
    }, []);

    return {
        map: mapRef,
        mapReady,
        error,
        flyToGlobe,
        flyToTrek,
        highlightSegment,
        updatePhotoMarkers,
        updateCampMarkers,
        updatePOIMarkers,
        flyToPhoto,
        flyToPOI,
        startRotation,
        stopRotation,
        isRotating,
        getMapCenter,
        startPlayback,
        stopPlayback,
        playbackState
    };
}
