import { useState, useRef, useEffect, useCallback } from 'react';
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

// Trek markers on globe
const treks = [
    { id: 'kilimanjaro', name: 'Kilimanjaro', country: 'Tanzania', elevation: '5,895m', lat: -3.0674, lng: 37.3556 },
    { id: 'mount-kenya', name: 'Mount Kenya', country: 'Kenya', elevation: '5,199m', lat: -0.1521, lng: 37.3084 },
    { id: 'inca-trail', name: 'Inca Trail', country: 'Peru', elevation: '4,215m', lat: -13.1631, lng: -72.5450 }
];

function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view, setView }) {
    const mapContainer = useRef(null);
    const map = useRef(null);

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
                color: 'rgb(10, 10, 15)', // Lower atmosphere
                'high-color': 'rgb(30, 30, 50)', // Upper atmosphere
                'horizon-blend': 0.05, // Atmosphere thickness (default 0.2 at low zooms)
                'space-color': 'rgb(10, 10, 15)', // Background color
                'star-intensity': 0.6 // Background star brightness (default 0.35 at low zooms )
            });

            // Add terrain source
            newMap.addSource('mapbox-dem', {
                type: 'raster-dem',
                url: 'mapbox://mapbox.terrain-rgb',
                tileSize: 512,
                maxzoom: 14
            });
            newMap.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

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
        if (!map.current) return;

        if (view === 'trek' && selectedTrek) {
            const trekData = trekDataMap[selectedTrek.id];

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
                // Fly to specific camp
                map.current.flyTo({
                    center: selectedCamp.coordinates,
                    zoom: 13,
                    pitch: 70,
                    bearing: -20,
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
                    pitch: 60,
                    bearing: -20,
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

            // Fly back to globe view
            map.current.flyTo({
                center: [30, 15],
                zoom: 1.5,
                pitch: 0,
                bearing: 0,
                duration: 3000,
                essential: true
            });
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
                                <div style={{
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: 8,
                                    padding: 20,
                                    marginBottom: 24
                                }}>
                                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Summit</p>
                                    <p style={{ color: 'white', fontSize: 28, fontWeight: 300 }}>{trekData.stats.highestPoint.elevation}m</p>
                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>{trekData.stats.highestPoint.name}</p>
                                </div>

                                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                                    Elevation Profile
                                </p>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
                                    {trekData.camps.map((camp, i) => (
                                        <div
                                            key={i}
                                            style={{
                                                flex: 1,
                                                background: 'rgba(255,255,255,0.2)',
                                                borderRadius: 2,
                                                height: `${(camp.elevation / trekData.stats.highestPoint.elevation) * 100}%`
                                            }}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
