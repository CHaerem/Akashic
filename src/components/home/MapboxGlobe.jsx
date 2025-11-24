import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const treks = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        coordinates: [37.3556, -3.0674],
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        elevation: '5,199m',
        coordinates: [37.3084, -0.1521],
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        elevation: '4,215m',
        coordinates: [-72.5450, -13.1631],
    }
];

export default function MapboxGlobe() {
    const mapContainer = useRef(null);
    const map = useRef(null);
    const navigate = useNavigate();
    const [selectedTrek, setSelectedTrek] = useState(null);
    const [hoveredTrek, setHoveredTrek] = useState(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const isRotating = useRef(true);

    const handleMarkerClick = useCallback((trek) => {
        if (selectedTrek?.id === trek.id) {
            navigate(`/trek/${trek.id}`);
        } else {
            setSelectedTrek(trek);
            isRotating.current = false;

            map.current?.flyTo({
                center: trek.coordinates,
                zoom: 6,
                pitch: 45,
                bearing: 30,
                duration: 2000,
                essential: true
            });
        }
    }, [selectedTrek, navigate]);

    useEffect(() => {
        if (map.current) return;

        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) {
            console.error('Mapbox token not found');
            return;
        }

        mapboxgl.accessToken = token;

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/dark-v11',
                center: [20, 5],
                zoom: 1.8,
                projection: 'globe',
            });

            map.current.on('load', () => {
                // Set fog/atmosphere
                map.current.setFog({
                    color: 'rgb(15, 15, 20)',
                    'high-color': 'rgb(30, 30, 50)',
                    'horizon-blend': 0.1,
                    'space-color': 'rgb(8, 8, 12)',
                    'star-intensity': 0.6
                });

                // Add markers
                treks.forEach((trek) => {
                    const el = document.createElement('div');
                    el.className = 'trek-marker';
                    el.innerHTML = `
                        <div class="marker-dot"></div>
                        <div class="marker-pulse"></div>
                    `;

                    new mapboxgl.Marker({ element: el, anchor: 'center' })
                        .setLngLat(trek.coordinates)
                        .addTo(map.current);

                    el.addEventListener('mouseenter', () => setHoveredTrek(trek));
                    el.addEventListener('mouseleave', () => setHoveredTrek(null));
                    el.addEventListener('click', () => handleMarkerClick(trek));
                });

                setIsLoaded(true);

                // Start rotation
                const rotate = () => {
                    if (!map.current || !isRotating.current) return;
                    const center = map.current.getCenter();
                    center.lng -= 0.015;
                    map.current.setCenter(center);
                    requestAnimationFrame(rotate);
                };
                rotate();
            });

        } catch (error) {
            console.error('Error initializing map:', error);
        }

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, [handleMarkerClick]);

    const handleBack = () => {
        setSelectedTrek(null);
        isRotating.current = true;

        map.current?.flyTo({
            center: [20, 5],
            zoom: 1.8,
            pitch: 0,
            bearing: 0,
            duration: 2000,
            essential: true
        });

        // Restart rotation after flyTo
        setTimeout(() => {
            const rotate = () => {
                if (!map.current || !isRotating.current) return;
                const center = map.current.getCenter();
                center.lng -= 0.015;
                map.current.setCenter(center);
                requestAnimationFrame(rotate);
            };
            rotate();
        }, 2000);
    };

    const handleExplore = () => {
        if (selectedTrek) {
            map.current?.flyTo({
                center: selectedTrek.coordinates,
                zoom: 10,
                pitch: 60,
                duration: 1500,
                essential: true
            });

            setTimeout(() => {
                navigate(`/trek/${selectedTrek.id}`);
            }, 1300);
        }
    };

    return (
        <div className="relative w-full h-screen bg-[#0a0a0f] overflow-hidden">
            {/* Map Container */}
            <div ref={mapContainer} className="w-full h-full" />

            {/* Custom Marker Styles */}
            <style>{`
                .trek-marker {
                    cursor: pointer;
                    width: 24px;
                    height: 24px;
                    position: relative;
                }
                .marker-dot {
                    width: 10px;
                    height: 10px;
                    background: white;
                    border-radius: 50%;
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    transition: transform 0.3s ease;
                    box-shadow: 0 0 10px rgba(255,255,255,0.5);
                }
                .marker-pulse {
                    width: 24px;
                    height: 24px;
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 50%;
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    animation: pulse 2s infinite;
                }
                .trek-marker:hover .marker-dot {
                    transform: translate(-50%, -50%) scale(1.4);
                }
                @keyframes pulse {
                    0% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
                    100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
                }
            `}</style>

            {/* Loading */}
            {!isLoaded && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-[#0a0a0f]">
                    <div className="w-8 h-8 border border-white/20 border-t-white/60 rounded-full animate-spin" />
                </div>
            )}

            {/* Hover Label */}
            {hoveredTrek && !selectedTrek && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                    <p className="text-white/80 text-sm tracking-[0.2em] uppercase">
                        {hoveredTrek.name}
                    </p>
                </div>
            )}

            {/* Selected Trek Panel */}
            {selectedTrek && (
                <div className="absolute left-6 lg:left-12 bottom-12 z-20 animate-fade-in">
                    <button
                        onClick={handleBack}
                        className="text-white/40 hover:text-white text-xs tracking-[0.15em] uppercase mb-8 transition-colors flex items-center gap-2"
                    >
                        <span>&larr;</span>
                        <span>Back</span>
                    </button>

                    <div className="text-white">
                        <p className="text-white/40 text-[10px] tracking-[0.2em] uppercase mb-3">
                            {selectedTrek.country}
                        </p>
                        <h2 className="text-3xl lg:text-4xl font-light tracking-wide mb-2">
                            {selectedTrek.name}
                        </h2>
                        <p className="text-white/30 text-sm tracking-wider mb-10">
                            {selectedTrek.elevation}
                        </p>

                        <button
                            onClick={handleExplore}
                            className="group flex items-center gap-4 text-xs tracking-[0.2em] uppercase text-white/60 hover:text-white transition-colors"
                        >
                            <span>Explore Journey</span>
                            <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Hint */}
            <div className={`absolute bottom-6 right-6 z-10 transition-all duration-500 ${selectedTrek ? 'opacity-0' : 'opacity-100'}`}>
                <p className="text-white/20 text-[10px] tracking-[0.15em] uppercase">
                    Drag to explore
                </p>
            </div>
        </div>
    );
}
