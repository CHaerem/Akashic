import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import CampMarker from './CampMarker';

export default function Map3D({ routeData }) {
    const mapContainer = useRef(null);
    const [map, setMap] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!routeData) return;

        mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

        const newMap = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/dark-v11',
            center: routeData.stats.highestPoint.coordinates,
            zoom: 11,
            pitch: 60,
            bearing: -20,
            interactive: true
        });

        newMap.on('style.load', () => {
            // Add atmosphere
            newMap.setFog({
                color: 'rgb(10, 10, 15)',
                'high-color': 'rgb(30, 30, 50)',
                'horizon-blend': 0.05,
            });

            // Add 3D terrain
            newMap.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.terrain-rgb'
            });
            newMap.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

            // Add route line
            newMap.addSource('route', {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    properties: {},
                    geometry: routeData.route
                }
            });

            // Route glow
            newMap.addLayer({
                id: 'route-glow',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': 'rgba(255, 255, 255, 0.2)',
                    'line-width': 12,
                    'line-blur': 8
                }
            });

            // Route line
            newMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': 'rgba(255, 255, 255, 0.8)',
                    'line-width': 2
                }
            });

            setIsLoaded(true);
            setMap(newMap);
        });

        // Minimal navigation controls
        newMap.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');

        return () => newMap.remove();
    }, [routeData]);

    return (
        <div className="relative w-full h-full bg-[#0a0a0f]">
            <div ref={mapContainer} className="w-full h-full" />

            {/* Custom control styles */}
            <style>{`
                .mapboxgl-ctrl-group {
                    background: rgba(10, 10, 15, 0.8) !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    border-radius: 4px !important;
                }
                .mapboxgl-ctrl-group button {
                    background-color: transparent !important;
                    width: 30px !important;
                    height: 30px !important;
                }
                .mapboxgl-ctrl-group button + button {
                    border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
                }
                .mapboxgl-ctrl-icon {
                    filter: invert(1) opacity(0.6);
                }
                .mapboxgl-ctrl-group button:hover .mapboxgl-ctrl-icon {
                    filter: invert(1) opacity(1);
                }
            `}</style>

            {/* Loading State */}
            {!isLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-6 h-6 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}

            {/* Render Markers */}
            {isLoaded && map && routeData.camps.map(camp => (
                <CampMarker key={camp.id} camp={camp} map={map} />
            ))}
        </div>
    );
}
