import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';

// Trek locations in lat/long
const treks = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        lat: -3.0674,
        lng: 37.3556,
        color: '#f97316'
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        lat: -0.1521,
        lng: 37.3084,
        color: '#f97316'
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        lat: -13.1631,
        lng: -72.5450,
        color: '#f97316'
    }
];

// Convert lat/lng to 3D coordinates on sphere
function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
}

function TrekMarker({ trek, onHover, onLeave, onClick }) {
    const meshRef = useRef();
    const [hovered, setHovered] = useState(false);

    const position = latLngToVector3(trek.lat, trek.lng, 2.05);

    useFrame((state) => {
        if (meshRef.current && hovered) {
            meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 3) * 0.2);
        }
    });

    return (
        <group position={position}>
            {/* Marker Pin */}
            <mesh
                ref={meshRef}
                onPointerOver={(e) => {
                    e.stopPropagation();
                    setHovered(true);
                    onHover(trek);
                    document.body.style.cursor = 'pointer';
                }}
                onPointerOut={(e) => {
                    e.stopPropagation();
                    setHovered(false);
                    onLeave();
                    document.body.style.cursor = 'default';
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick(trek);
                }}
            >
                <sphereGeometry args={[0.08, 16, 16]} />
                <meshStandardMaterial
                    color={trek.color}
                    emissive={trek.color}
                    emissiveIntensity={hovered ? 2 : 1}
                    metalness={0.5}
                    roughness={0.2}
                />
            </mesh>

            {/* Glow ring when hovered */}
            {hovered && (
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.12, 0.18, 32]} />
                    <meshBasicMaterial
                        color={trek.color}
                        transparent
                        opacity={0.8}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            )}
        </group>
    );
}

function Earth({ onMarkerHover, onMarkerLeave, onMarkerClick }) {
    const earthRef = useRef();

    useFrame(() => {
        if (earthRef.current) {
            earthRef.current.rotation.y += 0.002;
        }
    });

    return (
        <group ref={earthRef}>
            {/* Earth Sphere - Much brighter and more visible */}
            <mesh>
                <sphereGeometry args={[2, 64, 64]} />
                <meshStandardMaterial
                    color="#60a5fa"
                    emissive="#3b82f6"
                    emissiveIntensity={0.6}
                    roughness={0.5}
                    metalness={0.3}
                />
            </mesh>

            {/* Atmosphere Glow */}
            <mesh scale={1.08}>
                <sphereGeometry args={[2, 64, 64]} />
                <meshBasicMaterial
                    color="#93c5fd"
                    transparent
                    opacity={0.3}
                    side={THREE.BackSide}
                />
            </mesh>

            {/* Trek Markers */}
            {treks.map((trek) => (
                <TrekMarker
                    key={trek.id}
                    trek={trek}
                    onHover={onMarkerHover}
                    onLeave={onMarkerLeave}
                    onClick={onMarkerClick}
                />
            ))}
        </group>
    );
}

export default function Globe3D() {
    const navigate = useNavigate();
    const [hoveredTrek, setHoveredTrek] = useState(null);

    const handleMarkerClick = (trek) => {
        navigate(`/trek/${trek.id}`);
    };

    return (
        <div className="relative w-full h-screen bg-gradient-to-b from-gray-900 via-blue-950 to-black overflow-hidden">
            {/* Title Overlay */}
            <div className="absolute top-24 left-0 right-0 z-10 text-center pointer-events-none">
                <h1 className="font-display text-5xl md:text-7xl font-bold text-white mb-4 drop-shadow-2xl animate-fade-in">
                    Akashic Records
                </h1>
                <p className="text-lg md:text-xl text-blue-200 animate-fade-in-delay drop-shadow-lg">
                    Explore epic mountain journeys around the world
                </p>
            </div>

            {/* Hover Tooltip */}
            {hoveredTrek && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                    <div className="bg-white rounded-2xl px-8 py-5 shadow-2xl border-2 border-accent-400">
                        <h3 className="font-display text-3xl font-bold text-mountain-900 mb-1">
                            {hoveredTrek.name}
                        </h3>
                        <p className="text-mountain-600 text-lg">{hoveredTrek.country}</p>
                        <p className="text-accent-600 text-sm mt-2 font-semibold">Click to explore →</p>
                    </div>
                </div>
            )}

            {/* 3D Canvas */}
            <Canvas
                camera={{ position: [0, 0, 5], fov: 50 }}
                gl={{ antialias: true, alpha: true }}
            >
                {/* Lighting */}
                <ambientLight intensity={0.8} />
                <directionalLight position={[5, 3, 5]} intensity={1.5} />
                <pointLight position={[-5, -3, -5]} intensity={0.5} color="#4a90e2" />

                {/* Stars Background */}
                <Stars
                    radius={300}
                    depth={60}
                    count={3000}
                    factor={4}
                    fade
                    speed={0.5}
                />

                <Earth
                    onMarkerHover={setHoveredTrek}
                    onMarkerLeave={() => setHoveredTrek(null)}
                    onMarkerClick={handleMarkerClick}
                />

                <OrbitControls
                    enableZoom={true}
                    enablePan={false}
                    minDistance={3.5}
                    maxDistance={10}
                    autoRotate
                    autoRotateSpeed={0.3}
                    enableDamping
                    dampingFactor={0.05}
                />
            </Canvas>

            {/* Instructions */}
            <div className="absolute bottom-12 left-0 right-0 z-10 text-center pointer-events-none">
                <div className="bg-white/10 backdrop-blur-md rounded-full px-8 py-3 inline-block">
                    <p className="text-white text-sm font-medium">
                        🖱️ Drag to rotate • 🔍 Scroll to zoom • 📍 Click markers to explore
                    </p>
                </div>
            </div>
        </div>
    );
}
