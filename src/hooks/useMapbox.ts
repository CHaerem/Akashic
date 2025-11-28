/**
 * Custom hook for Mapbox map initialization and management
 */

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateBearing, findCoordIndex, getDistanceFromLatLonInKm } from '../utils/geography';
import { buildMediaUrl, getAccessToken } from '../lib/media';
import type { TrekConfig, TrekData, Camp, Photo } from '../types/trek';

// Route click information
export interface RouteClickInfo {
    coordinates: [number, number];
    distanceFromStart: number; // in km
    elevation: number | null;
    nearestCamp: Camp | null;
    distanceToNearestCamp: number | null; // km
}

interface UseMapboxOptions {
    containerRef: RefObject<HTMLDivElement | null>;
    onTrekSelect: (trek: TrekConfig) => void;
    onPhotoClick?: (photo: Photo) => void;
    onRouteClick?: (info: RouteClickInfo) => void;
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
    flyToPhoto: (photo: Photo) => void;
    startRotation: () => void;
    stopRotation: () => void;
    // Playback controls
    startPlayback: (trekData: TrekData, onCampReached?: (camp: Camp) => void) => void;
    stopPlayback: () => void;
    playbackState: PlaybackState;
}

/**
 * Initialize Mapbox map with globe projection and terrain
 */
export function useMapbox({ containerRef, onTrekSelect, onPhotoClick, onRouteClick }: UseMapboxOptions): UseMapboxReturn {
    const { treks, trekDataMap } = useJourneys();
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const rotationAnimationRef = useRef<number | null>(null);
    const interactionListenerRef = useRef<(() => void) | null>(null);
    const photosRef = useRef<Photo[]>([]);
    const photoMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
    const authTokenRef = useRef<string | null>(null);
    const selectedTrekRef = useRef<string | null>(null);
    const playbackAnimationRef = useRef<number | null>(null);
    const playbackCallbackRef = useRef<((camp: Camp) => void) | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [dataLayersReady, setDataLayersReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>({
        isPlaying: false,
        progress: 0,
        currentCampIndex: 0
    });

    // Store callbacks and data in refs to avoid dependency issues
    const onTrekSelectRef = useRef(onTrekSelect);
    const onPhotoClickRef = useRef(onPhotoClick);
    const onRouteClickRef = useRef(onRouteClick);
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

    // Fetch auth token for media URLs
    useEffect(() => {
        getAccessToken().then(token => {
            authTokenRef.current = token;
        });
    }, []);

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

                onRouteClickRef.current({
                    coordinates: [coords.lng, coords.lat],
                    distanceFromStart: Math.round(distFromStart * 10) / 10, // 1 decimal
                    elevation: elevation !== null ? Math.round(elevation) : null,
                    nearestCamp,
                    distanceToNearestCamp: nearestCamp ? Math.round(distToNearestCamp * 10) / 10 : null
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
        if (!map || !mapReady) return;

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
            map.flyTo({
                center: [selectedTrek.lng, selectedTrek.lat],
                zoom: isMobile ? 3 : 3.5,
                pitch: 0,
                bearing: 0,
                duration: 2500,
                essential: true,
                curve: 1.2,
                easing: (t) => 1 - Math.pow(1 - t, 3) // ease-out cubic
            });
        } else {
            map.flyTo({
                center: [30, 15],
                zoom: isMobile ? 1.2 : 1.5,
                pitch: 0,
                bearing: 0,
                duration: 3000,
                essential: true,
                curve: 1.5,
                easing: (t) => 1 - Math.pow(1 - t, 3)
            });
        }
    }, [mapReady]);

    // Highlight trek segment (defined before flyToTrek which uses it)
    const highlightSegment = useCallback((trekData: TrekData, selectedCamp: Camp) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
        if (campIndex === -1) return;

        const routeCoords = trekData.route.coordinates;
        const startCoord = campIndex === 0 ? routeCoords[0] : trekData.camps[campIndex - 1].coordinates;
        const endCoord = selectedCamp.coordinates;

        const startIndex = findCoordIndex(routeCoords, startCoord as [number, number]);
        const endIndex = findCoordIndex(routeCoords, endCoord as [number, number]);

        if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
            const segmentCoords = routeCoords.slice(startIndex, endIndex + 1);
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

        const trekData = trekDataMapRef.current[selectedTrek.id];
        const trekConfig = treksRef.current.find(t => t.id === selectedTrek.id);
        if (!trekData || !trekConfig) return;

        // Defer non-critical updates to avoid blocking the UI during transition
        // This allows the camera animation to start immediately
        requestAnimationFrame(() => {
            // Set day mode atmosphere (terrain already enabled on init)
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
        });

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
                    const endIndex = findCoordIndex(routeCoords, currentCoord as [number, number]);

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
            const coordinates = trekData.route.coordinates;
            const bounds = coordinates.reduce((b, coord) => {
                return b.extend(coord as [number, number]);
            }, new mapboxgl.LngLatBounds(coordinates[0] as [number, number], coordinates[0] as [number, number]));

            const isMobileFit = window.matchMedia('(max-width: 768px)').matches;
            map.fitBounds(bounds, {
                padding: isMobileFit
                    ? { top: 80, bottom: 280, left: 40, right: 40 }
                    : { top: 100, bottom: 100, left: 100, right: 450 },
                pitch: trekConfig.preferredPitch,
                bearing: trekConfig.preferredBearing,
                duration: 2500,
                essential: true,
                easing: (t) => 1 - Math.pow(1 - t, 3)
            });

            // Hide highlight
            if (map.getLayer('active-segment-line')) {
                map.setLayoutProperty('active-segment-line', 'visibility', 'none');
                map.setLayoutProperty('active-segment-glow', 'visibility', 'none');
            }
        }
    }, [mapReady, highlightSegment]);

    // Stop rotation - defined first so startRotation can reference it
    const stopRotation = useCallback(() => {
        // Cancel animation
        if (rotationAnimationRef.current) {
            cancelAnimationFrame(rotationAnimationRef.current);
            rotationAnimationRef.current = null;
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
    }, [stopRotation]);

    // Cleanup rotation on unmount
    useEffect(() => {
        return () => {
            stopRotation();
        };
    }, [stopRotation]);

    // Update photo markers on the map - uses HTML thumbnail markers
    const updatePhotoMarkers = useCallback((photos: Photo[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Store photos for click handler reference
        photosRef.current = photos;

        // Filter photos with coordinates
        const photosWithCoords = photos.filter(p => p.coordinates && p.coordinates.length === 2);

        // Create GeoJSON features for clustering
        const features: GeoJSON.Feature[] = photosWithCoords.map(photo => {
            const isHighlighted = selectedCampId ? photo.waypoint_id === selectedCampId : false;
            return {
                type: 'Feature',
                properties: {
                    id: photo.id,
                    highlighted: isHighlighted,
                    waypoint_id: photo.waypoint_id || null,
                    url: photo.thumbnail_url || photo.url
                },
                geometry: {
                    type: 'Point',
                    coordinates: photo.coordinates as [number, number]
                }
            };
        });

        const source = map.getSource('photo-markers') as mapboxgl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features
            });

            // Show/hide cluster layers based on whether we have photos
            const visibility = features.length > 0 ? 'visible' : 'none';
            // Hide the old circle layers - we use HTML markers now
            map.setLayoutProperty('photo-markers-circle', 'visibility', 'none');
            map.setLayoutProperty('photo-markers-glow', 'visibility', 'none');
            // Cluster layers (still use native circles)
            map.setLayoutProperty('photo-clusters-circle', 'visibility', visibility);
            map.setLayoutProperty('photo-clusters-glow', 'visibility', visibility);
            map.setLayoutProperty('photo-clusters-count', 'visibility', visibility);
        }

        // Remove old HTML markers that are no longer needed
        const currentPhotoIds = new Set(photosWithCoords.map(p => p.id));
        for (const [photoId, marker] of photoMarkersRef.current.entries()) {
            if (!currentPhotoIds.has(photoId)) {
                marker.remove();
                photoMarkersRef.current.delete(photoId);
            }
        }

        // Create or update HTML markers for each photo
        const token = authTokenRef.current;
        photosWithCoords.forEach(photo => {
            const isHighlighted = selectedCampId ? photo.waypoint_id === selectedCampId : false;
            const existingMarker = photoMarkersRef.current.get(photo.id);

            if (existingMarker) {
                // Update existing marker's highlight state
                const el = existingMarker.getElement();
                if (isHighlighted) {
                    el.classList.add('photo-marker-highlighted');
                } else {
                    el.classList.remove('photo-marker-highlighted');
                }
            } else {
                // Create new HTML marker with thumbnail
                const el = document.createElement('div');
                el.className = 'photo-thumbnail-marker' + (isHighlighted ? ' photo-marker-highlighted' : '');

                // Build authenticated URL
                const photoUrl = photo.thumbnail_url || photo.url;
                const imgUrl = buildMediaUrl(photoUrl, token);

                // Create image element
                const img = document.createElement('img');
                img.src = imgUrl;
                img.alt = photo.caption || 'Photo';
                img.draggable = false;
                el.appendChild(img);

                // Create marker
                const marker = new mapboxgl.Marker({
                    element: el,
                    anchor: 'center'
                })
                    .setLngLat(photo.coordinates as [number, number])
                    .addTo(map);

                // Click handler
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (onPhotoClickRef.current) {
                        onPhotoClickRef.current(photo);
                    }
                });

                photoMarkersRef.current.set(photo.id, marker);
            }
        });
    }, [mapReady]);

    // Update camp markers on the map
    const updateCampMarkers = useCallback((camps: Camp[], selectedCampId: string | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

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

    return {
        map: mapRef,
        mapReady,
        error,
        flyToGlobe,
        flyToTrek,
        highlightSegment,
        updatePhotoMarkers,
        updateCampMarkers,
        flyToPhoto,
        startRotation,
        stopRotation,
        startPlayback,
        stopPlayback,
        playbackState
    };
}
