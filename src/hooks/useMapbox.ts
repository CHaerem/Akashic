/**
 * Custom hook for Mapbox map initialization and management
 */

import { useState, useRef, useEffect, useCallback, type RefObject, type MutableRefObject } from 'react';
import mapboxgl from 'mapbox-gl';
import { treks, trekDataMap, getTrekConfig } from '../data/trekConfig';
import { calculateBearing, findCoordIndex } from '../utils/geography';
import type { TrekConfig, TrekData, Camp } from '../types/trek';

interface UseMapboxOptions {
    containerRef: RefObject<HTMLDivElement | null>;
    onTrekSelect: (trek: TrekConfig) => void;
}

interface UseMapboxReturn {
    map: MutableRefObject<mapboxgl.Map | null>;
    mapReady: boolean;
    error: string | null;
    flyToGlobe: (selectedTrek?: TrekConfig | null) => void;
    flyToTrek: (selectedTrek: TrekConfig, selectedCamp?: Camp | null) => void;
    highlightSegment: (trekData: TrekData, selectedCamp: Camp) => void;
}

/**
 * Initialize Mapbox map with globe projection and terrain
 */
export function useMapbox({ containerRef, onTrekSelect }: UseMapboxOptions): UseMapboxReturn {
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const [mapReady, setMapReady] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store callbacks in refs to avoid dependency issues
    const onTrekSelectRef = useRef(onTrekSelect);
    useEffect(() => {
        onTrekSelectRef.current = onTrekSelect;
    }, [onTrekSelect]);

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
                // Set atmosphere fog
                map.setFog({
                    'range': [1, 12],
                    'color': 'rgb(186, 210, 235)',
                    'high-color': 'rgb(36, 92, 223)',
                    'horizon-blend': 0.02,
                    'space-color': 'rgb(11, 11, 25)',
                    'star-intensity': 0.15
                });

                // Add terrain source
                map.addSource('mapbox-dem', {
                    type: 'raster-dem',
                    url: 'mapbox://mapbox.terrain-rgb',
                    tileSize: 512,
                    maxzoom: 16
                });
                map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });

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

                // Add trek markers
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

                // Trek marker layers
                map.addLayer({
                    id: 'trek-markers-circle',
                    type: 'circle',
                    source: 'trek-markers',
                    paint: {
                        'circle-color': '#ffffff',
                        'circle-radius': 6,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': 'rgba(0,0,0,0.2)',
                        'circle-emissive-strength': 1
                    }
                });

                map.addLayer({
                    id: 'trek-markers-glow',
                    type: 'circle',
                    source: 'trek-markers',
                    paint: {
                        'circle-color': '#ffffff',
                        'circle-radius': 12,
                        'circle-opacity': 0.3,
                        'circle-blur': 0.5,
                        'circle-emissive-strength': 1
                    },
                    beforeId: 'trek-markers-circle'
                });

                // Preload all trek routes
                Object.values(trekDataMap).forEach((trekData: TrekData) => {
                    if (!trekData.route) return;

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
                });

                // Active segment source & layers
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

                setMapReady(true);
            });

            // Interaction handlers
            map.on('mouseenter', 'trek-markers-circle', () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', 'trek-markers-circle', () => {
                map.getCanvas().style.cursor = '';
            });

            map.on('click', 'trek-markers-circle', (e) => {
                if (e.features && e.features.length > 0) {
                    const trekProps = e.features[0].properties as TrekConfig;
                    const trek = treks.find(t => t.id === trekProps.id);
                    if (trek && onTrekSelectRef.current) {
                        onTrekSelectRef.current(trek);
                    }
                    e.originalEvent.stopPropagation();
                }
            });

        } catch (err) {
            setError((err as Error).message);
            console.error('Error initializing map:', err);
        }

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [containerRef]);

    // Fly to globe view
    const flyToGlobe = useCallback((selectedTrek: TrekConfig | null = null) => {
        const map = mapRef.current;
        if (!map || !mapReady) return;

        // Set globe atmosphere
        map.setFog({
            'range': [1, 12],
            'color': 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.02,
            'space-color': 'rgb(11, 11, 25)',
            'star-intensity': 0.15
        });

        // Hide all routes
        Object.keys(trekDataMap).forEach(id => {
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

        const trekData = trekDataMap[selectedTrek.id as keyof typeof trekDataMap];
        const trekConfig = getTrekConfig(selectedTrek.id);
        if (!trekData || !trekConfig) return;

        // Set day mode atmosphere
        map.setFog({
            'range': [0.5, 10],
            'color': 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.02,
            'space-color': 'rgb(11, 11, 25)',
            'star-intensity': 0.0
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });

        // Show selected route, hide others
        Object.keys(trekDataMap).forEach(id => {
            if (map.getLayer(`route-${id}`)) {
                const visibility = id === selectedTrek.id ? 'visible' : 'none';
                map.setLayoutProperty(`route-${id}`, 'visibility', visibility);
                map.setLayoutProperty(`route-glow-${id}`, 'visibility', visibility);
            }
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

    return {
        map: mapRef,
        mapReady,
        error,
        flyToGlobe,
        flyToTrek,
        highlightSegment
    };
}
