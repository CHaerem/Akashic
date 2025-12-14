/**
 * Custom hook for Mapbox map initialization and management
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { useJourneys } from '../../contexts/JourneysContext';
import { calculateBearing, findNearestCoordIndex, getDistanceFromLatLonInKm } from '../../utils/geography';
import type { TrekConfig, TrekData, Camp, Photo, PointOfInterest } from '../../types/trek';
import type { UseMapboxOptions, UseMapboxReturn, PlaybackState, RouteClickInfo } from './types';
import { GLOBE_CENTER } from './types';
import {
    GLOBE_FOG_CONFIG,
    TREK_FOG_CONFIG,
    PHOTO_CLUSTER_GLOW_PAINT,
    PHOTO_CLUSTER_CIRCLE_PAINT,
    PHOTO_MARKER_GLOW_PAINT,
    PHOTO_MARKER_CIRCLE_PAINT,
    CAMP_MARKER_GLOW_PAINT,
    CAMP_MARKER_CIRCLE_PAINT,
    CAMP_MARKER_LABEL_PAINT,
    POI_CATEGORY_COLORS,
    POI_CATEGORY_ICONS,
    TREK_MARKER_CIRCLE_PAINT,
    TREK_MARKER_GLOW_PAINT,
    ROUTE_GLOW_PAINT,
    ROUTE_LINE_PAINT,
    ACTIVE_SEGMENT_GLOW_PAINT,
    ACTIVE_SEGMENT_LINE_PAINT,
} from './layerConfigs';

// Re-export types for backwards compatibility
export type { RouteClickInfo, PlaybackState };

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
    const campMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
    const selectedTrekRef = useRef<string | null>(null);
    const pendingHighlightCampIdRef = useRef<string | null>(null); // Track pending highlight to prevent stale updates on rapid day switching
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
    const [mapReady, setMapReady] = useState(false);
    const [dataLayersReady, setDataLayersReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Playback state - use ref for progress to avoid re-renders on every frame
    const playbackProgressRef = useRef(0);
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
                map.setFog(GLOBE_FOG_CONFIG);

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
                    paint: ACTIVE_SEGMENT_GLOW_PAINT
                });

                map.addLayer({
                    id: 'active-segment-line',
                    type: 'line',
                    source: 'active-segment',
                    layout: { 'visibility': 'none', 'line-join': 'round', 'line-cap': 'round' },
                    paint: ACTIVE_SEGMENT_LINE_PAINT
                });

                // Photo markers source & layers (with clustering)
                map.addSource('photo-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                    cluster: true,
                    clusterMaxZoom: 14,
                    clusterRadius: 50
                });

                // Cluster circles - outer glow
                map.addLayer({
                    id: 'photo-clusters-glow',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['has', 'point_count'],
                    layout: { 'visibility': 'none' },
                    paint: PHOTO_CLUSTER_GLOW_PAINT as mapboxgl.CirclePaint
                });

                // Cluster circles - main
                map.addLayer({
                    id: 'photo-clusters-circle',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['has', 'point_count'],
                    layout: { 'visibility': 'none' },
                    paint: PHOTO_CLUSTER_CIRCLE_PAINT as mapboxgl.CirclePaint
                });

                // Cluster count labels
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

                // Photo marker glow
                map.addLayer({
                    id: 'photo-markers-glow',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['!', ['has', 'point_count']],
                    layout: { 'visibility': 'none' },
                    paint: PHOTO_MARKER_GLOW_PAINT as mapboxgl.CirclePaint
                });

                // Photo marker circles
                map.addLayer({
                    id: 'photo-markers-circle',
                    type: 'circle',
                    source: 'photo-markers',
                    filter: ['!', ['has', 'point_count']],
                    layout: { 'visibility': 'none' },
                    paint: PHOTO_MARKER_CIRCLE_PAINT as mapboxgl.CirclePaint
                });

                // Camp markers source & layers
                map.addSource('camp-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });

                map.addLayer({
                    id: 'camp-markers-glow',
                    type: 'circle',
                    source: 'camp-markers',
                    layout: { 'visibility': 'none' },
                    paint: CAMP_MARKER_GLOW_PAINT as mapboxgl.CirclePaint
                });

                map.addLayer({
                    id: 'camp-markers-circle',
                    type: 'circle',
                    source: 'camp-markers',
                    layout: { 'visibility': 'none' },
                    paint: CAMP_MARKER_CIRCLE_PAINT as mapboxgl.CirclePaint
                });

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
                    paint: CAMP_MARKER_LABEL_PAINT as mapboxgl.SymbolPaint
                });

                // POI markers source & layers
                map.addSource('poi-markers', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });

                // Build POI match expressions from config
                const poiGlowColorMatch = [
                    'match', ['get', 'category'],
                    ...Object.entries(POI_CATEGORY_COLORS.glow)
                        .filter(([k]) => k !== 'default')
                        .flatMap(([k, v]) => [k, v]),
                    POI_CATEGORY_COLORS.glow.default
                ];

                const poiFillColorMatch = [
                    'match', ['get', 'category'],
                    ...Object.entries(POI_CATEGORY_COLORS.fill)
                        .filter(([k]) => k !== 'default')
                        .flatMap(([k, v]) => [k, v]),
                    POI_CATEGORY_COLORS.fill.default
                ];

                const poiStrokeColorMatch = [
                    'match', ['get', 'category'],
                    ...Object.entries(POI_CATEGORY_COLORS.stroke)
                        .filter(([k]) => k !== 'default')
                        .flatMap(([k, v]) => [k, v]),
                    POI_CATEGORY_COLORS.stroke.default
                ];

                const poiIconMatch = [
                    'match', ['get', 'category'],
                    ...Object.entries(POI_CATEGORY_ICONS)
                        .filter(([k]) => k !== 'default')
                        .flatMap(([k, v]) => [k, v]),
                    POI_CATEGORY_ICONS.default
                ];

                map.addLayer({
                    id: 'poi-markers-glow',
                    type: 'circle',
                    source: 'poi-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': poiGlowColorMatch as mapboxgl.ExpressionSpecification,
                        'circle-radius': 12,
                        'circle-opacity': 0.4,
                        'circle-blur': 0.5
                    }
                });

                map.addLayer({
                    id: 'poi-markers-circle',
                    type: 'circle',
                    source: 'poi-markers',
                    layout: { 'visibility': 'none' },
                    paint: {
                        'circle-color': poiFillColorMatch as mapboxgl.ExpressionSpecification,
                        'circle-radius': 8,
                        'circle-stroke-width': 1.5,
                        'circle-stroke-color': poiStrokeColorMatch as mapboxgl.ExpressionSpecification
                    }
                });

                map.addLayer({
                    id: 'poi-markers-label',
                    type: 'symbol',
                    source: 'poi-markers',
                    layout: {
                        'visibility': 'none',
                        'text-field': poiIconMatch as mapboxgl.ExpressionSpecification,
                        'text-size': 12,
                        'text-allow-overlap': true,
                        'text-offset': [0, -1.8]
                    },
                    paint: {
                        'text-color': 'rgba(255, 255, 255, 0.95)'
                    }
                });

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

            // Setup interaction handlers
            setupInteractionHandlers(map);

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

            // Clean up HTML camp markers
            for (const marker of campMarkersRef.current.values()) {
                marker.remove();
            }
            campMarkersRef.current.clear();

            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [containerRef]);

    // Helper function to setup map interaction handlers
    function setupInteractionHandlers(map: mapboxgl.Map) {
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
                    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
                        if (err) {
                            console.error('[MapInteraction] Failed to get cluster expansion zoom:', err);
                            return;
                        }

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

        // Trek marker handlers
        map.on('mouseenter', 'trek-markers-circle', () => {
            map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'trek-markers-circle', () => {
            map.getCanvas().style.cursor = '';
        });

        const handleTrekSelect = (e: mapboxgl.MapMouseEvent & { features?: mapboxgl.GeoJSONFeature[] }) => {
            if (e.features && e.features.length > 0) {
                const trekProps = e.features[0].properties as TrekConfig;
                const trek = treksRef.current.find(t => t.id === trekProps.id);
                if (trek && onTrekSelectRef.current) {
                    onTrekSelectRef.current(trek);
                }
                e.originalEvent.stopPropagation();
            }
        };

        map.on('click', 'trek-markers-circle', handleTrekSelect);
        map.on('dblclick', 'trek-markers-circle', handleTrekSelect);
    }

    // Auto-recenter globe when flyTo is interrupted
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const handleUserInteraction = () => {
            if (isFlyingToGlobeRef.current) {
                isFlyingToGlobeRef.current = false;
                skipRecenterRef.current = false;
                needsGlobeRecenterRef.current = true;
            }
        };

        const handleMoveEnd = () => {
            if (!mapRef.current) return;

            const getExpectedCenter = (): [number, number] => {
                if (targetCenterRef.current) return targetCenterRef.current;
                if (selectedTrekRef.current) {
                    const trek = treksRef.current.find(t => t.id === selectedTrekRef.current);
                    if (trek) return [trek.lng, trek.lat];
                }
                return GLOBE_CENTER;
            };

            if (needsGlobeRecenterRef.current && isGlobeViewRef.current) {
                needsGlobeRecenterRef.current = false;
                skipRecenterRef.current = true;

                const isMobile = window.matchMedia('(max-width: 768px)').matches;
                const targetZoom = selectedTrekRef.current
                    ? (isMobile ? 3 : 3.5)
                    : (isMobile ? 1.2 : 1.5);

                const expectedCenter = getExpectedCenter();

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

                setTimeout(() => {
                    skipRecenterRef.current = false;
                }, 2500);
            }
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

            map.addLayer({
                id: 'trek-markers-circle',
                type: 'circle',
                source: 'trek-markers',
                paint: TREK_MARKER_CIRCLE_PAINT
            });

            map.addLayer({
                id: 'trek-markers-glow',
                type: 'circle',
                source: 'trek-markers',
                paint: TREK_MARKER_GLOW_PAINT
            }, 'trek-markers-circle');
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
                paint: ROUTE_GLOW_PAINT
            });

            map.addLayer({
                id: `route-${trekData.id}`,
                type: 'line',
                source: `route-${trekData.id}`,
                layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' },
                paint: ROUTE_LINE_PAINT
            });

            // Route click handler
            map.on('click', `route-glow-${trekData.id}`, (e) => {
                if (!onRouteClickRef.current) return;
                handleRouteClick(e, trekData);
            });

            map.on('mouseenter', `route-glow-${trekData.id}`, () => {
                map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', `route-glow-${trekData.id}`, () => {
                map.getCanvas().style.cursor = '';
            });
        });

        setDataLayersReady(true);
    }, [mapReady, treks, trekDataMap, dataLayersReady]);

    // Helper function for route click handling
    function handleRouteClick(e: mapboxgl.MapMouseEvent, trekData: TrekData) {
        const coords = e.lngLat;
        const routeCoords = trekData.route.coordinates;
        const camps = trekData.camps;

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

        let distFromStart = 0;
        for (let i = 1; i <= nearestIdx; i++) {
            const prev = routeCoords[i - 1];
            const curr = routeCoords[i];
            distFromStart += getDistanceFromLatLonInKm(prev[1], prev[0], curr[1], curr[0]);
        }

        let totalDistance = distFromStart;
        for (let i = nearestIdx + 1; i < routeCoords.length; i++) {
            const prev = routeCoords[i - 1];
            const curr = routeCoords[i];
            totalDistance += getDistanceFromLatLonInKm(prev[1], prev[0], curr[1], curr[0]);
        }

        const nearestCoord = routeCoords[nearestIdx];
        const elevation = nearestCoord[2] !== undefined ? nearestCoord[2] : null;

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

        const routeClickInfo: RouteClickInfo = {
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
        };

        onRouteClickRef.current!(routeClickInfo);
        e.originalEvent.stopPropagation();
    }

    // Fly to globe view
    const flyToGlobe = useCallback((selectedTrek: TrekConfig | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        if (!map.isStyleLoaded()) {
            const onStyleLoad = () => {
                map.off('style.load', onStyleLoad);
                flyToGlobe(selectedTrek);
            };
            map.once('style.load', onStyleLoad);
            setTimeout(() => {
                if (map.isStyleLoaded()) {
                    map.off('style.load', onStyleLoad);
                    flyToGlobe(selectedTrek);
                }
            }, 100);
            return;
        }

        isGlobeViewRef.current = true;
        isFlyingToGlobeRef.current = true;
        skipRecenterRef.current = true;

        map.setFog(GLOBE_FOG_CONFIG);

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
                easing: (t) => 1 - Math.pow(1 - t, 3)
            });
        } else {
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

        const animationDuration = selectedTrek ? 2500 : 3000;
        setTimeout(() => {
            isFlyingToGlobeRef.current = false;
            skipRecenterRef.current = false;
        }, animationDuration + 500);
    }, [mapReady]);

    // Highlight trek segment
    const highlightSegment = useCallback((trekData: TrekData, selectedCamp: Camp) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
        if (campIndex === -1) return;

        const routeCoords = trekData.route.coordinates;
        if (!routeCoords || routeCoords.length === 0) return;

        const startCoord = campIndex === 0
            ? routeCoords[0]
            : trekData.camps[campIndex - 1].coordinates;
        const endCoord = selectedCamp.coordinates;

        const startIndex = findNearestCoordIndex(routeCoords, startCoord as [number, number]);
        const endIndex = findNearestCoordIndex(routeCoords, endCoord as [number, number]);

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
        if (!map || !mapReady || !selectedTrek) return;

        if (!map.isStyleLoaded()) {
            const onStyleLoad = () => {
                map.off('style.load', onStyleLoad);
                flyToTrek(selectedTrek, selectedCamp);
            };
            map.once('style.load', onStyleLoad);
            setTimeout(() => {
                if (map.isStyleLoaded()) {
                    map.off('style.load', onStyleLoad);
                    flyToTrek(selectedTrek, selectedCamp);
                }
            }, 100);
            return;
        }

        isGlobeViewRef.current = false;
        selectedTrekRef.current = selectedTrek.id;
        // Track which camp we're highlighting to prevent stale updates on rapid day switching
        const currentCampId = selectedCamp?.id ?? null;
        pendingHighlightCampIdRef.current = currentCampId;

        const trekData = trekDataMapRef.current[selectedTrek.id];
        const trekConfig = treksRef.current.find(t => t.id === selectedTrek.id);
        if (!trekData || !trekConfig) return;

        const isMobileForTerrain = window.matchMedia('(max-width: 768px)').matches;
        const scheduleMapUpdates = () => {
            if (isMobileForTerrain) {
                map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.0 });
            }

            map.setFog(TREK_FOG_CONFIG);

            Object.keys(trekDataMapRef.current).forEach(id => {
                if (map.getLayer(`route-${id}`)) {
                    const visibility = id === selectedTrek.id ? 'visible' : 'none';
                    map.setLayoutProperty(`route-${id}`, 'visibility', visibility);
                    map.setLayoutProperty(`route-glow-${id}`, 'visibility', visibility);
                }
            });
        };

        if ('requestIdleCallback' in window) {
            setTimeout(() => {
                (window as typeof window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(scheduleMapUpdates);
            }, 1800);
        } else {
            setTimeout(scheduleMapUpdates, 1800);
        }

        if (isMobileForTerrain) {
            map.setTerrain(null);
        }

        requestAnimationFrame(() => {
            if (!mapRef.current) return;

            if (selectedCamp) {
                let bearing = trekConfig.preferredBearing;
                const pitch = selectedCamp.pitch || 55;
                const routeCoords = trekData.route.coordinates;
                const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);

                if (campIndex !== -1 && routeCoords && routeCoords.length > 0) {
                    const startCoord = campIndex === 0
                        ? routeCoords[0]
                        : trekData.camps[campIndex - 1].coordinates;
                    const endCoord = selectedCamp.coordinates;

                    const startIndex = findNearestCoordIndex(routeCoords, startCoord as [number, number]);
                    const endIndex = findNearestCoordIndex(routeCoords, endCoord as [number, number]);

                    const actualStart = Math.min(startIndex, endIndex);
                    const actualEnd = Math.max(startIndex, endIndex);

                    if (selectedCamp.bearing !== undefined) {
                        bearing = selectedCamp.bearing;
                    } else if (endIndex > 5) {
                        const lookBackIndex = endIndex - 5;
                        const prevCoord = routeCoords[lookBackIndex];
                        const currentCoord = selectedCamp.coordinates;
                        bearing = calculateBearing(prevCoord[1], prevCoord[0], currentCoord[1], currentCoord[0]);
                    } else if (campIndex > 0) {
                        const prevCampCoord = trekData.camps[campIndex - 1].coordinates;
                        const currentCoord = selectedCamp.coordinates;
                        bearing = calculateBearing(prevCampCoord[1], prevCampCoord[0], currentCoord[1], currentCoord[0]);
                    }

                    if (actualEnd > actualStart) {
                        const segmentCoords = routeCoords.slice(actualStart, actualEnd + 1);
                        let minLng = segmentCoords[0][0], maxLng = segmentCoords[0][0];
                        let minLat = segmentCoords[0][1], maxLat = segmentCoords[0][1];

                        for (const coord of segmentCoords) {
                            if (coord[0] < minLng) minLng = coord[0];
                            if (coord[0] > maxLng) maxLng = coord[0];
                            if (coord[1] < minLat) minLat = coord[1];
                            if (coord[1] > maxLat) maxLat = coord[1];
                        }

                        const bounds = new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
                        const isMobileCamp = window.matchMedia('(max-width: 768px)').matches;

                        map.fitBounds(bounds, {
                            padding: isMobileCamp
                                ? { top: 100, bottom: 300, left: 50, right: 50 }
                                : { top: 120, bottom: 150, left: 120, right: 400 },
                            pitch: pitch,
                            bearing: bearing,
                            duration: 2200,
                            maxZoom: 16,
                            essential: true
                        });

                        // Only highlight if this is still the current selection (prevents stale updates on rapid switching)
                        if (pendingHighlightCampIdRef.current === currentCampId) {
                            highlightSegment(trekData, selectedCamp);
                        }
                        return;
                    }
                }

                if (selectedCamp.bearing !== undefined) {
                    bearing = selectedCamp.bearing;
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

                // Only highlight if this is still the current selection (prevents stale updates on rapid switching)
                if (pendingHighlightCampIdRef.current === currentCampId) {
                    highlightSegment(trekData, selectedCamp);
                }
            } else {
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
                    duration: isMobileFit ? 2000 : 2500,
                    essential: true,
                    easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
                });

                if (map.getLayer('active-segment-line')) {
                    map.setLayoutProperty('active-segment-line', 'visibility', 'none');
                    map.setLayoutProperty('active-segment-glow', 'visibility', 'none');
                }
            }
        });
    }, [mapReady, highlightSegment]);

    // Stop rotation
    const stopRotation = useCallback(() => {
        const wasRotating = rotationAnimationRef.current !== null;

        if (rotationAnimationRef.current) {
            cancelAnimationFrame(rotationAnimationRef.current);
            rotationAnimationRef.current = null;
        }

        if (wasRotating) {
            setIsRotating(false);
        }

        const map = mapRef.current;
        const listener = interactionListenerRef.current;
        if (map && listener) {
            const canvas = map.getCanvas();
            canvas.removeEventListener('mousedown', listener);
            canvas.removeEventListener('touchstart', listener);
            canvas.removeEventListener('wheel', listener);
            map.off('dragstart', listener);
            map.off('zoomstart', listener);
            map.off('rotatestart', listener);
            map.off('pitchstart', listener);
            interactionListenerRef.current = null;
        }
    }, []);

    // Start rotation
    const startRotation = useCallback(() => {
        const map = mapRef.current;
        if (!map || rotationAnimationRef.current) return;

        stopRotation();

        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const targetFps = isMobile ? 30 : 60;
        const frameInterval = 1000 / targetFps;

        let lastTime = performance.now();
        let lastFrameTime = performance.now();
        const rotationSpeed = isMobile ? 1.5 : 2;

        const onInteraction = () => stopRotation();
        interactionListenerRef.current = onInteraction;

        const canvas = map.getCanvas();
        canvas.addEventListener('mousedown', onInteraction, { passive: true });
        canvas.addEventListener('touchstart', onInteraction, { passive: true });
        canvas.addEventListener('wheel', onInteraction, { passive: true });

        map.on('dragstart', onInteraction);
        map.on('zoomstart', onInteraction);
        map.on('rotatestart', onInteraction);
        map.on('pitchstart', onInteraction);

        const animate = (currentTime: number) => {
            if (!mapRef.current || !rotationAnimationRef.current) return;

            if (currentTime - lastFrameTime < frameInterval) {
                rotationAnimationRef.current = requestAnimationFrame(animate);
                return;
            }

            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;
            lastFrameTime = currentTime;

            const center = mapRef.current.getCenter();
            mapRef.current.setCenter([center.lng - rotationSpeed * deltaTime, center.lat]);

            rotationAnimationRef.current = requestAnimationFrame(animate);
        };

        rotationAnimationRef.current = requestAnimationFrame(animate);
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
    const photoGroupsRef = useRef<Map<string, { photos: Photo[]; marker: mapboxgl.Marker }>>(new Map());
    const markerUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastGroupingZoomRef = useRef<number | null>(null);

    // Group photos by spatial grid cell
    const groupPhotosByLocation = useCallback((photos: Photo[], zoom: number) => {
        const cellSize = 0.1 / Math.pow(2, zoom - 8);
        const groups = new Map<string, Photo[]>();

        for (const photo of photos) {
            if (!photo.coordinates || photo.coordinates.length !== 2) continue;
            const [lng, lat] = photo.coordinates;
            const cellX = Math.floor(lng / cellSize);
            const cellY = Math.floor(lat / cellSize);
            const key = `${cellX},${cellY}`;

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(photo);
        }

        return Array.from(groups.entries()).map(([key, groupPhotos]) => ({
            key,
            photos: groupPhotos,
            representative: groupPhotos[0],
            count: groupPhotos.length,
            center: [
                groupPhotos.reduce((sum, p) => sum + (p.coordinates as [number, number])[0], 0) / groupPhotos.length,
                groupPhotos.reduce((sum, p) => sum + (p.coordinates as [number, number])[1], 0) / groupPhotos.length
            ] as [number, number]
        }));
    }, []);

    // Update photo markers on the map
    const updatePhotoMarkers = useCallback((photos: Photo[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        photosRef.current = photos;
        selectedCampIdRef.current = selectedCampId;

        // Hide native Mapbox layers
        map.setLayoutProperty('photo-markers-circle', 'visibility', 'none');
        map.setLayoutProperty('photo-markers-glow', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-circle', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-glow', 'visibility', 'none');
        map.setLayoutProperty('photo-clusters-count', 'visibility', 'none');

        const source = map.getSource('photo-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }

        if (markerUpdateTimerRef.current) {
            clearTimeout(markerUpdateTimerRef.current);
        }

        const delay = photos.length > 0 ? 2600 : 0;
        markerUpdateTimerRef.current = setTimeout(() => {
            if (mapRef.current && !mapRef.current.isMoving()) {
                updateThumbnailMarkers();
            } else if (mapRef.current) {
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

        const roundedZoom = Math.round(zoom);

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

        const groups = groupPhotosByLocation(visiblePhotos, roundedZoom);
        const processedIds = new Set<string>();

        for (const group of groups) {
            const stableKey = group.representative.id;
            processedIds.add(stableKey);

            const existingGroup = photoGroupsRef.current.get(stableKey);

            if (existingGroup) {
                existingGroup.marker.setLngLat(group.center);
                existingGroup.photos = group.photos;
                continue;
            }

            const isHighlighted = selectedCampId
                ? group.photos.some(p => p.waypoint_id === selectedCampId)
                : false;

            const el = document.createElement('div');
            el.className = 'photo-thumbnail-marker photo-stack' + (isHighlighted ? ' photo-marker-highlighted' : '');

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
            img.onerror = () => {
                // Show fallback styling on load failure
                img.style.display = 'none';
                imgContainer.style.background = 'rgba(255,255,255,0.2)';
            };
            const photoUrl = group.representative.thumbnail_url || group.representative.url;
            img.src = getMediaUrl ? getMediaUrl(photoUrl) : photoUrl;
            imgContainer.appendChild(img);
            el.appendChild(imgContainer);

            const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                .setLngLat(group.center)
                .addTo(map);

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onPhotoClickRef.current) {
                    onPhotoClickRef.current(group.representative);
                }
            });

            photoGroupsRef.current.set(stableKey, { photos: group.photos, marker });
        }

        for (const [key, groupData] of photoGroupsRef.current.entries()) {
            if (!processedIds.has(key)) {
                groupData.marker.remove();
                photoGroupsRef.current.delete(key);
            }
        }

        lastGroupingZoomRef.current = roundedZoom;
    }, [mapReady, groupPhotosByLocation, getMediaUrl]);

    // Listen for zoom/move changes to regroup photos
    useEffect(() => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

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

    // Update camp markers on the map (HTML DOM markers with Liquid Glass styling)
    const updateCampMarkers = useCallback((camps: Camp[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        campsRef.current = camps;

        // Hide native Mapbox layers - we use HTML markers instead
        map.setLayoutProperty('camp-markers-circle', 'visibility', 'none');
        map.setLayoutProperty('camp-markers-glow', 'visibility', 'none');
        map.setLayoutProperty('camp-markers-label', 'visibility', 'none');

        // Clear the GeoJSON source
        const source = map.getSource('camp-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }

        // Track which camps we've processed
        const processedIds = new Set<string>();

        // Create/update HTML markers for each camp
        for (const camp of camps) {
            processedIds.add(camp.id);
            const isSelected = camp.id === selectedCampId;

            // Check if marker already exists
            const existingMarker = campMarkersRef.current.get(camp.id);
            if (existingMarker) {
                // Update position and selection state
                existingMarker.setLngLat(camp.coordinates as [number, number]);
                const el = existingMarker.getElement();
                if (isSelected) {
                    el.classList.add('camp-marker-selected');
                } else {
                    el.classList.remove('camp-marker-selected');
                }
                continue;
            }

            // Create new marker element
            const el = document.createElement('div');
            el.className = 'camp-marker' + (isSelected ? ' camp-marker-selected' : '');

            // Day number badge
            const badge = document.createElement('span');
            badge.className = 'camp-marker-badge';
            badge.textContent = camp.dayNumber.toString();
            el.appendChild(badge);

            // Create Mapbox marker
            const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
                .setLngLat(camp.coordinates as [number, number])
                .addTo(map);

            // Click handler
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                if (onCampClickRef.current) {
                    onCampClickRef.current(camp);
                }
            });

            campMarkersRef.current.set(camp.id, marker);
        }

        // Remove markers for camps no longer in the list
        for (const [id, marker] of campMarkersRef.current.entries()) {
            if (!processedIds.has(id)) {
                marker.remove();
                campMarkersRef.current.delete(id);
            }
        }
    }, [mapReady]);

    // Update POI markers on the map
    const updatePOIMarkers = useCallback((pois: PointOfInterest[]) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        poisRef.current = pois;

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

        stopPlayback();

        const camps = trekData.camps;
        const routeCoords = trekData.route.coordinates;
        const totalPoints = routeCoords.length;

        playbackCallbackRef.current = onCampReached || null;

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
        const daysCount = trekData.stats.duration || camps.length || 1;
        const duration = Math.max(daysCount * 3000, 5000);

        playbackProgressRef.current = 0;
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

            const nextIdx = Math.min(currentIndex + 10, totalPoints - 1);
            const nextCoord = routeCoords[nextIdx];
            const bearing = calculateBearing(coord[1], coord[0], nextCoord[1], nextCoord[0]);

            map.easeTo({
                center: [coord[0], coord[1]],
                zoom: 14,
                pitch: 60,
                bearing: bearing,
                duration: 50,
                easing: (t) => t
            });

            // Track progress in ref (no re-render)
            playbackProgressRef.current = progress * 100;

            // Only update state when camp changes (avoids re-render every frame)
            const campReached = campIndices.findIndex(idx => currentIndex >= idx);
            if (campReached > lastCampIndex && campReached < camps.length) {
                lastCampIndex = campReached;
                if (playbackCallbackRef.current) {
                    playbackCallbackRef.current(camps[campReached]);
                }
                // Update state only when camp changes
                setPlaybackState({
                    isPlaying: true,
                    progress: progress * 100,
                    currentCampIndex: lastCampIndex
                });
            }

            if (progress < 1) {
                playbackAnimationRef.current = requestAnimationFrame(animate);
            } else {
                playbackProgressRef.current = 100;
                setPlaybackState({
                    isPlaying: false,
                    progress: 100,
                    currentCampIndex: camps.length - 1
                });
                playbackAnimationRef.current = null;
            }
        };

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
