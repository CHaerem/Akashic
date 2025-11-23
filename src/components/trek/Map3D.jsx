import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import CampMarker from './CampMarker';
import LoadingSpinner from '../common/LoadingSpinner';

export default function Map3D({ routeData }) {
    const mapContainer = useRef(null);
    const [map, setMap] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!routeData) return;

        mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

        const newMap = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/outdoors-v12',
            center: routeData.stats.highestPoint.coordinates,
            zoom: 11,
            pitch: 60,
            bearing: 0,
            interactive: true
        });

        newMap.on('load', () => {
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

            newMap.addLayer({
                id: 'route',
                type: 'line',
                source: 'route',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#FF6B35',
                    'line-width': 4,
                    'line-opacity': 0.8
                }
            });

            setIsLoaded(true);
            setMap(newMap);
        });

        // Add navigation controls
        newMap.addControl(new mapboxgl.NavigationControl());

        return () => newMap.remove();
    }, [routeData]);

    return (
        <div className="relative w-full h-full">
            <div ref={mapContainer} className="w-full h-full" />

            {/* Loading State */}
            {!isLoaded && (
                <div className="absolute inset-0 bg-mountain-50/80 backdrop-blur-sm z-10 flex items-center justify-center">
                    <LoadingSpinner />
                </div>
            )}

            {/* Render Markers */}
            {isLoaded && map && routeData.camps.map(camp => (
                <CampMarker key={camp.id} camp={camp} map={map} />
            ))}
        </div>
    );
}
