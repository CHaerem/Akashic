import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

// Trek data imports
import kilimanjaroData from '../data/kilimanjaro.json';
import mountKenyaData from '../data/mountKenya.json';
import incaTrailData from '../data/incaTrail.json';

const trekDataMap = {
    'kilimanjaro': kilimanjaroData,
    'mount-kenya': mountKenyaData,
    'inca-trail': incaTrailData
};

// Trek markers on globe with preferred camera settings
const treks = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        lat: -3.0674,
        lng: 37.3556,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        elevation: '5,199m',
        lat: -0.1521,
        lng: 37.3084,
        preferredBearing: -20,
        preferredPitch: 60
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        elevation: '4,215m',
        lat: -13.1631,
        lng: -72.5450,
        preferredBearing: 45, // Looking North-East along the valley
        preferredPitch: 60
    }
];

// --- Helper Functions for Stats & Geometry ---

function deg2rad(deg) {
    return deg * (Math.PI / 180)
}

function rad2deg(rad) {
    return rad * (180 / Math.PI);
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d;
}

function calculateBearing(startLat, startLng, destLat, destLng) {
    const startLatRad = deg2rad(startLat);
    const startLngRad = deg2rad(startLng);
    const destLatRad = deg2rad(destLat);
    const destLngRad = deg2rad(destLng);

    const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
    const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
        Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
    const brng = Math.atan2(y, x);
    return (rad2deg(brng) + 360) % 360;
}

function calculateStats(trekData) {
    const duration = trekData.stats.duration;
    const distance = trekData.stats.totalDistance;
    const avgDailyDistance = (distance / duration).toFixed(1);

    let maxDailyGain = 0;
    trekData.camps.forEach(camp => {
        if (camp.elevationGainFromPrevious > maxDailyGain) {
            maxDailyGain = camp.elevationGainFromPrevious;
        }
    });

    return {
        avgDailyDistance,
        maxDailyGain,
        difficulty: 'Hard', // Could be dynamic based on data
        startElevation: trekData.route.coordinates[0][2]
    };
}

function generateElevationProfile(coordinates) {
    if (!coordinates || coordinates.length === 0) return null;

    // 1. Calculate cumulative distance and extract elevation
    let points = [];
    let totalDist = 0;
    let minEle = Infinity;
    let maxEle = -Infinity;

    for (let i = 0; i < coordinates.length; i++) {
        const coord = coordinates[i];
        const ele = coord[2];

        if (i > 0) {
            const prev = coordinates[i - 1];
            totalDist += getDistanceFromLatLonInKm(prev[1], prev[0], coord[1], coord[0]);
        }

        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;

        points.push({ dist: totalDist, ele });
    }

    // 2. Normalize to SVG viewbox (e.g., 300x100)
    const width = 300;
    const height = 120; // Increased height for labels

    // Add some padding to elevation range for better visuals
    const eleRange = maxEle - minEle;
    // Ensure we don't divide by zero if flat
    const plotMinEle = Math.max(0, minEle - (eleRange > 0 ? eleRange * 0.1 : 100));
    const plotMaxEle = maxEle + (eleRange > 0 ? eleRange * 0.1 : 100);
    const plotEleRange = plotMaxEle - plotMinEle;

    const pathPoints = points.map(p => {
        const x = (p.dist / totalDist) * width;
        const y = height - ((p.ele - plotMinEle) / plotEleRange) * height;
        return `${x},${y}`;
    });

    // 3. Generate Path
    const linePath = `M ${pathPoints.join(' L ')}`;
    const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

    return { linePath, areaPath, minEle, maxEle, totalDist, plotMinEle, plotMaxEle };
}

// --- Components ---

function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view, setView }) {
    const mapContainer = useRef(null);
    const map = useRef(null);

    const [mapReady, setMapReady] = useState(false);

    useEffect(() => {
        if (!mapContainer.current || map.current) return;

        mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

        const newMap = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            projection: 'globe', // Display as a globe
            zoom: 1.5,
            center: [30, 15],
            pitch: 0,
        });

        map.current = newMap;

        newMap.on('style.load', () => {
            newMap.setFog({
                'range': [1, 12], // Increase visibility range to reduce darkening
                'color': 'rgb(186, 210, 235)', // Lighter blue atmosphere
                'high-color': 'rgb(36, 92, 223)', // Blue sky gradient
                'horizon-blend': 0.02, // Thin atmosphere layer
                'space-color': 'rgb(11, 11, 25)', // Dark blue space
                'star-intensity': 0.15 // Subtle stars
            });

            // Add terrain source
            newMap.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.terrain-rgb',
                tileSize: 512,
                maxzoom: 14
            });
            newMap.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

            // Add Sky Layer
            newMap.addLayer({
                'id': 'sky',
                'type': 'sky',
                'paint': {
                    'sky-type': 'atmosphere',
                    'sky-atmosphere-sun': [0.0, 0.0],
                    'sky-atmosphere-sun-intensity': 3 // Low intensity for subtle glow
                }
            });

            // Add Trek Markers Source
            newMap.addSource('trek-markers', {
                type: 'geojson',
                data: {
                    type: 'FeatureCollection',
                    features: treks.map(trek => ({
                        type: 'Feature',
                        properties: trek,
                        geometry: {
                            type: 'Point',
                            coordinates: [trek.lng, trek.lat]
                        }
                    }))
                }
            });

            // Add Trek Markers Layer (Circle)
            newMap.addLayer({
                id: 'trek-markers-circle',
                type: 'circle',
                source: 'trek-markers',
                paint: {
                    'circle-color': '#ffffff',
                    'circle-radius': 6,
                    'circle-stroke-width': 2,
                    'circle-stroke-color': 'rgba(0,0,0,0.2)',
                    'circle-emissive-strength': 1 // Make them glow slightly
                }
            });

            // Add Trek Markers Glow (Halo)
            newMap.addLayer({
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
                beforeId: 'trek-markers-circle' // Render behind the main circle
            });

            // Preload all trek routes
            Object.values(trekDataMap).forEach(trekData => {
                if (!trekData.route) return;

                // Add Source
                newMap.addSource(`route-${trekData.id}`, {
                    type: 'geojson',
                    data: { type: 'Feature', properties: {}, geometry: trekData.route }
                });

                // Add Glow Layer
                newMap.addLayer({
                    id: `route-glow-${trekData.id}`,
                    type: 'line',
                    source: `route-${trekData.id}`,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                        'visibility': 'none' // Hidden by default
                    },
                    paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 12, 'line-blur': 8 }
                });

                // Add Line Layer
                newMap.addLayer({
                    id: `route-${trekData.id}`,
                    type: 'line',
                    source: `route-${trekData.id}`,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                        'visibility': 'none' // Hidden by default
                    },
                    paint: { 'line-color': 'rgba(255,255,255,0.8)', 'line-width': 2 }
                });
            });

            // Add Active Segment Source & Layers (for highlighting)
            newMap.addSource('active-segment', {
                type: 'geojson',
                data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
            });

            newMap.addLayer({
                id: 'active-segment-glow',
                type: 'line',
                source: 'active-segment',
                layout: { 'visibility': 'none', 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#00ffff', 'line-width': 15, 'line-blur': 10, 'line-opacity': 0.5 }
            });

            newMap.addLayer({
                id: 'active-segment-line',
                type: 'line',
                source: 'active-segment',
                layout: { 'visibility': 'none', 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#00ffff', 'line-width': 4 }
            });

            setMapReady(true);
        });

        // Interaction Handlers
        newMap.on('mouseenter', 'trek-markers-circle', () => {
            newMap.getCanvas().style.cursor = 'pointer';
        });

        newMap.on('mouseleave', 'trek-markers-circle', () => {
            newMap.getCanvas().style.cursor = '';
        });

        newMap.on('click', 'trek-markers-circle', (e) => {
            if (e.features.length > 0) {
                const trek = e.features[0].properties;
                // Properties come back as strings/numbers, ensure ID is correct
                onSelectTrek(treks.find(t => t.id === trek.id));
                e.originalEvent.stopPropagation();
            }
        });

        return () => {
            if (map.current) {
                map.current.remove();
                map.current = null;
            }
        };
    }, []); // Run once on mount

    // Handle View Transitions & Selection
    useEffect(() => {
        if (!map.current || !mapReady) return;

        if (view === 'trek' && selectedTrek) {
            // Transition to Day Mode
            map.current.setFog({
                'range': [0.5, 10],
                'color': 'rgb(186, 210, 235)', // Blue sky
                'high-color': 'rgb(36, 92, 223)', // Deep blue sky
                'horizon-blend': 0.02,
                'space-color': 'rgb(11, 11, 25)',
                'star-intensity': 0.0 // No stars in day
            });
            map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.8 }); // More dramatic terrain

            const trekData = trekDataMap[selectedTrek.id];
            const trekConfig = treks.find(t => t.id === selectedTrek.id);

            // Show selected route
            if (map.current.getLayer(`route-${trekData.id}`)) {
                map.current.setLayoutProperty(`route-${trekData.id}`, 'visibility', 'visible');
                map.current.setLayoutProperty(`route-glow-${trekData.id}`, 'visibility', 'visible');
            }

            // Hide others
            Object.keys(trekDataMap).forEach(id => {
                if (id !== selectedTrek.id) {
                    if (map.current.getLayer(`route-${id}`)) {
                        map.current.setLayoutProperty(`route-${id}`, 'visibility', 'none');
                        map.current.setLayoutProperty(`route-glow-${id}`, 'visibility', 'none');
                    }
                }
            });

            if (selectedCamp) {
                // 1. Determine Camera Settings
                let bearing = trekConfig.preferredBearing;
                let pitch = selectedCamp.pitch || 55; // Default pitch slightly lower to avoid occlusion

                // Manual override for bearing
                if (selectedCamp.bearing !== undefined) {
                    bearing = selectedCamp.bearing;
                } else {
                    // Automatic "Smart" Bearing: Look along the path of arrival
                    const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
                    if (campIndex !== -1) {
                        const routeCoords = trekData.route.coordinates;
                        const currentCoord = selectedCamp.coordinates;

                        // Find index of current camp in route (approximate)
                        const findCoordIndex = (target) => {
                            return routeCoords.findIndex(c =>
                                Math.abs(c[0] - target[0]) < 0.0001 &&
                                Math.abs(c[1] - target[1]) < 0.0001
                            );
                        };

                        const endIndex = findCoordIndex(currentCoord);

                        // Use the last few points before the camp to determine "arrival direction"
                        if (endIndex > 5) {
                            const lookBackIndex = endIndex - 5;
                            const prevCoord = routeCoords[lookBackIndex];
                            // Calculate bearing from a point back on the trail TO the camp
                            bearing = calculateBearing(prevCoord[1], prevCoord[0], currentCoord[1], currentCoord[0]);
                        } else if (campIndex > 0) {
                            // Fallback to previous camp if route match fails or is too short
                            const prevCampCoord = trekData.camps[campIndex - 1].coordinates;
                            bearing = calculateBearing(prevCampCoord[1], prevCampCoord[0], currentCoord[1], currentCoord[0]);
                        }
                    }
                }

                // Fly to specific camp with dynamic settings
                map.current.flyTo({
                    center: selectedCamp.coordinates,
                    zoom: 13.5, // Slightly closer
                    pitch: pitch,
                    bearing: bearing,
                    duration: 2000,
                    essential: true
                });

                // Highlight Segment
                const campIndex = trekData.camps.findIndex(c => c.id === selectedCamp.id);
                if (campIndex !== -1) {
                    const routeCoords = trekData.route.coordinates;

                    // Find start coordinate (previous camp or route start)
                    let startCoord = campIndex === 0 ? routeCoords[0] : trekData.camps[campIndex - 1].coordinates;
                    let endCoord = selectedCamp.coordinates;

                    // Helper to find index in route coordinates (approximate match for float precision)
                    const findCoordIndex = (target) => {
                        return routeCoords.findIndex(c =>
                            Math.abs(c[0] - target[0]) < 0.0001 &&
                            Math.abs(c[1] - target[1]) < 0.0001
                        );
                    };

                    const startIndex = findCoordIndex(startCoord);
                    const endIndex = findCoordIndex(endCoord);

                    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
                        const segmentCoords = routeCoords.slice(startIndex, endIndex + 1);

                        const segmentGeoJSON = {
                            type: 'Feature',
                            properties: {},
                            geometry: {
                                type: 'LineString',
                                coordinates: segmentCoords
                            }
                        };

                        if (map.current.getSource('active-segment')) {
                            map.current.getSource('active-segment').setData(segmentGeoJSON);
                            map.current.setLayoutProperty('active-segment-line', 'visibility', 'visible');
                            map.current.setLayoutProperty('active-segment-glow', 'visibility', 'visible');
                        }
                    }
                }

            } else {
                // Fit bounds to whole route
                const coordinates = trekData.route.coordinates;
                const bounds = coordinates.reduce((bounds, coord) => {
                    return bounds.extend(coord);
                }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));

                map.current.fitBounds(bounds, {
                    padding: { top: 100, bottom: 100, left: 100, right: 600 }, // Right padding for info panel
                    pitch: trekConfig.preferredPitch,
                    bearing: trekConfig.preferredBearing,
                    duration: 2000,
                    essential: true
                });

                // Hide highlight
                if (map.current.getLayer('active-segment-line')) {
                    map.current.setLayoutProperty('active-segment-line', 'visibility', 'none');
                    map.current.setLayoutProperty('active-segment-glow', 'visibility', 'none');
                }
            }

        } else if (view === 'globe') {
            // Globe view with brighter, visible atmosphere
            map.current.setFog({
                'range': [1, 12], // Increase visibility range
                'color': 'rgb(186, 210, 235)', // Lighter blue atmosphere
                'high-color': 'rgb(36, 92, 223)', // Blue sky gradient
                'horizon-blend': 0.02, // Thin atmosphere layer
                'space-color': 'rgb(11, 11, 25)', // Dark blue space
                'star-intensity': 0.15 // Subtle stars
            });
            map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 }); // Standard globe terrain

            // Hide all routes and highlights
            Object.keys(trekDataMap).forEach(id => {
                if (map.current.getLayer(`route-${id}`)) {
                    map.current.setLayoutProperty(`route-${id}`, 'visibility', 'none');
                    map.current.setLayoutProperty(`route-glow-${id}`, 'visibility', 'none');
                }
            });

            if (map.current.getLayer('active-segment-line')) {
                map.current.setLayoutProperty('active-segment-line', 'visibility', 'none');
                map.current.setLayoutProperty('active-segment-glow', 'visibility', 'none');
            }

            if (selectedTrek) {
                // Fly to selected trek on globe
                map.current.flyTo({
                    center: [selectedTrek.lng, selectedTrek.lat],
                    zoom: 3.5,
                    pitch: 0,
                    bearing: 0,
                    duration: 2000,
                    essential: true
                });
            } else {
                // Fly back to default globe view
                map.current.flyTo({
                    center: [30, 15],
                    zoom: 1.5,
                    pitch: 0,
                    bearing: 0,
                    duration: 3000,
                    essential: true
                });
            }
        }
    }, [view, selectedTrek, selectedCamp]);

    return <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />;
}

export default function AkashicApp() {
    const [view, setView] = useState('globe');
    const [selectedTrek, setSelectedTrek] = useState(null);
    const [selectedCamp, setSelectedCamp] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const trekData = selectedTrek ? trekDataMap[selectedTrek.id] : null;

    const handleExplore = useCallback(() => {
        if (!selectedTrek) return;
        setView('trek');
    }, [selectedTrek]);

    const handleBackToGlobe = useCallback(() => {
        setView('globe');
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, []);

    const handleBackToSelection = useCallback(() => {
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, []);

    const handleCampSelect = useCallback((camp) => {
        setSelectedCamp(prev => prev?.id === camp.id ? null : camp);
    }, []);

    // Memoize stats and profile
    const { extendedStats, elevationProfile } = useMemo(() => {
        if (!trekData) return { extendedStats: null, elevationProfile: null };
        return {
            extendedStats: calculateStats(trekData),
            elevationProfile: generateElevationProfile(trekData.route?.coordinates)
        };
    }, [trekData]);

    return (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0a0f' }}>

            {/* Mapbox Globe (Always mounted) */}
            <div style={{ position: 'absolute', inset: 0 }}>
                <MapboxGlobe
                    selectedTrek={selectedTrek}
                    selectedCamp={selectedCamp}
                    onSelectTrek={setSelectedTrek}
                    view={view}
                    setView={setView}
                />
            </div>

            {/* Title */}
            <div style={{
                position: 'absolute',
                top: 24,
                left: 24,
                zIndex: 100,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                cursor: 'pointer'
            }} onClick={handleBackToGlobe}>
                Akashic
            </div>

            {/* Selected Trek Panel (Globe View) */}
            {selectedTrek && view === 'globe' && (
                <div style={{
                    position: 'absolute',
                    left: 24,
                    bottom: 48,
                    zIndex: 20,
                    maxWidth: 400
                }}>
                    <button
                        onClick={handleBackToSelection}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: 11,
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            marginBottom: 24
                        }}
                    >
                        ← Back
                    </button>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 12 }}>
                        {selectedTrek.country}
                    </p>
                    <h2 style={{ color: 'white', fontSize: 36, fontWeight: 300, marginBottom: 8 }}>
                        {selectedTrek.name}
                    </h2>
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, marginBottom: 32 }}>
                        Summit: {selectedTrek.elevation}
                    </p>
                    <button
                        onClick={handleExplore}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: 11,
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                            cursor: 'pointer'
                        }}
                    >
                        Explore Journey →
                    </button>
                </div>
            )}

            {/* Hint (Globe View) */}
            {!selectedTrek && view === 'globe' && (
                <div style={{
                    position: 'absolute',
                    bottom: 24,
                    right: 24,
                    color: 'rgba(255,255,255,0.2)',
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase'
                }}>
                    Click a marker to explore
                </div>
            )}

            {/* Info Panel (Trek View) */}
            {view === 'trek' && trekData && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: '40%',
                    background: 'rgba(10, 10, 15, 0.8)',
                    backdropFilter: 'blur(20px)',
                    borderLeft: '1px solid rgba(255,255,255,0.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 20
                }}>
                    <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <button
                            onClick={handleBackToGlobe}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: 'rgba(255,255,255,0.5)',
                                fontSize: 11,
                                letterSpacing: '0.15em',
                                textTransform: 'uppercase',
                                cursor: 'pointer',
                                marginBottom: 24,
                                display: 'block'
                            }}
                        >
                            ← Globe
                        </button>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 8 }}>
                            {trekData.country}
                        </p>
                        <h1 style={{ color: 'white', fontSize: 24, fontWeight: 300 }}>
                            {trekData.name}
                        </h1>
                    </div>

                    <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '0 24px' }}>
                        {['overview', 'journey', 'stats'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    borderBottom: activeTab === tab ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                                    color: activeTab === tab ? 'white' : 'rgba(255,255,255,0.4)',
                                    fontSize: 11,
                                    letterSpacing: '0.15em',
                                    textTransform: 'uppercase',
                                    padding: '16px 16px',
                                    cursor: 'pointer',
                                    marginBottom: -1
                                }}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                        {activeTab === 'overview' && (
                            <div>
                                <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginBottom: 24 }}>
                                    {trekData.description}
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Duration</p>
                                        <p style={{ color: 'rgba(255,255,255,0.8)' }}>{trekData.stats.duration} days</p>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Distance</p>
                                        <p style={{ color: 'rgba(255,255,255,0.8)' }}>{trekData.stats.totalDistance} km</p>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Ascent</p>
                                        <p style={{ color: '#4ade80' }}>+{trekData.stats.totalElevationGain}m</p>
                                    </div>
                                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Summit</p>
                                        <p style={{ color: 'rgba(255,255,255,0.8)' }}>{trekData.stats.highestPoint.elevation}m</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'journey' && (
                            <div>
                                {trekData.camps.map((camp, i) => {
                                    const isSelected = selectedCamp?.id === camp.id;
                                    return (
                                        <div
                                            key={camp.id}
                                            onClick={() => handleCampSelect(camp)}
                                            style={{
                                                padding: '20px 0',
                                                borderBottom: i < trekData.camps.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s',
                                                background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                                                margin: '0 -24px',
                                                paddingLeft: 24,
                                                paddingRight: 24
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <span style={{ color: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                                    Day {camp.dayNumber}
                                                </span>
                                                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                                                    {camp.elevation}m
                                                </span>
                                            </div>
                                            <p style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: isSelected ? 12 : 0 }}>
                                                {camp.name}
                                            </p>

                                            {/* Expanded Details */}
                                            {isSelected && (
                                                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                                                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                                                    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                                                        {camp.notes}
                                                    </p>

                                                    {camp.highlights && (
                                                        <ul style={{ marginBottom: 20, paddingLeft: 16 }}>
                                                            {camp.highlights.map((highlight, idx) => (
                                                                <li key={idx} style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 }}>
                                                                    {highlight}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}

                                                    {/* Photo Placeholder */}
                                                    <div style={{
                                                        width: '100%',
                                                        height: 160,
                                                        background: 'rgba(255,255,255,0.05)',
                                                        border: '1px dashed rgba(255,255,255,0.1)',
                                                        borderRadius: 8,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        color: 'rgba(255,255,255,0.3)',
                                                        fontSize: 12,
                                                        letterSpacing: '0.05em'
                                                    }}>
                                                        PHOTOS COMING SOON
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {activeTab === 'stats' && (
                            <div>
                                {/* Summit Card */}
                                <div style={{
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 8,
                                    padding: 20,
                                    marginBottom: 24,
                                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)'
                                }}>
                                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Summit</p>
                                    <p style={{ color: 'white', fontSize: 28, fontWeight: 300 }}>{trekData.stats.highestPoint.elevation}m</p>
                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>{trekData.stats.highestPoint.name}</p>
                                </div>

                                {/* Detailed Elevation Profile */}
                                <div style={{ marginBottom: 32 }}>
                                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                                        Elevation Profile
                                    </p>
                                    {elevationProfile && (
                                        <div style={{ position: 'relative', height: 120, width: '100%' }}>
                                            <svg width="100%" height="100%" viewBox="0 0 300 120" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                                                <defs>
                                                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                                                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
                                                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                                                    </linearGradient>
                                                </defs>

                                                {/* Grid Lines (Optional) */}
                                                <line x1="0" y1="0" x2="300" y2="0" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                                                <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                                                <line x1="0" y1="120" x2="300" y2="120" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

                                                {/* Area Fill */}
                                                <path d={elevationProfile.areaPath} fill="url(#elevationGradient)" />

                                                {/* Line Stroke */}
                                                <path d={elevationProfile.linePath} fill="none" stroke="white" strokeWidth="1.5" />
                                            </svg>

                                            {/* Labels */}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                                                <span>0 km</span>
                                                <span>{Math.round(elevationProfile.totalDist)} km</span>
                                            </div>
                                            <div style={{ position: 'absolute', top: 0, right: -24, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                                                {Math.round(elevationProfile.maxEle)}m
                                            </div>
                                            <div style={{ position: 'absolute', bottom: 0, right: -24, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                                                {Math.round(elevationProfile.minEle)}m
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Extended Stats Grid */}
                                {extendedStats && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Avg Daily Dist</p>
                                            <p style={{ color: 'rgba(255,255,255,0.8)' }}>{extendedStats.avgDailyDistance} km</p>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Max Daily Gain</p>
                                            <p style={{ color: '#4ade80' }}>+{extendedStats.maxDailyGain}m</p>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Start Elevation</p>
                                            <p style={{ color: 'rgba(255,255,255,0.8)' }}>{extendedStats.startElevation}m</p>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
                                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Difficulty</p>
                                            <p style={{ color: '#facc15' }}>{extendedStats.difficulty}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
