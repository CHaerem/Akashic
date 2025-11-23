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

    const position = latLngToVector3(trek.lat, trek.lng, 2.02);

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
                }}
                onPointerOut={(e) => {
                    e.stopPropagation();
                    setHovered(false);
                    onLeave();
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onClick(trek);
                }}
            >
                <sphereGeometry args={[0.05, 16, 16]} />
                <meshStandardMaterial
                    color={trek.color}
                    emissive={trek.color}
                    emissiveIntensity={hovered ? 1 : 0.5}
                />
            </mesh>

            {/* Glow ring when hovered */}
            {hovered && (
                <mesh>
                    <ringGeometry args={[0.08, 0.12, 32]} />
                    <meshBasicMaterial
                        color={trek.color}
                        transparent
                        opacity={0.6}
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
            earthRef.current.rotation.y += 0.001;
        }
    });

    return (
        <group ref={earthRef}>
            {/* Earth Sphere */}
            <mesh>
                <sphereGeometry args={[2, 64, 64]} />
                <meshStandardMaterial
                    color="#1e3a5f"
                    roughness={0.8}
                    metalness={0.2}
                />
            </mesh>

            {/* Atmosphere Glow */}
            <mesh scale={1.05}>
                <sphereGeometry args={[2, 64, 64]} />
                <meshBasicMaterial
                    color="#4a90e2"
                    transparent
                    opacity={0.1}
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
        <div className="relative w-full h-screen bg-gradient-to-b from-mountain-900 to-black">
            {/* Title Overlay */}
            <div className="absolute top-20 left-0 right-0 z-10 text-center pointer-events-none">
                <h1 className="font-display text-6xl md:text-8xl font-bold text-white mb-4 animate-fade-in">
                    Akashic Records
                </h1>
                <p className="text-xl md:text-2xl text-gray-300 animate-fade-in-delay">
                    Click a location to explore
                </p>
            </div>

            {/* Hover Tooltip */}
            {hoveredTrek && (
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                    <div className="bg-white/90 backdrop-blur-sm rounded-xl px-6 py-4 shadow-2xl">
                        <h3 className="font-display text-2xl font-bold text-mountain-900">
                            {hoveredTrek.name}
                        </h3>
                        <p className="text-mountain-600">{hoveredTrek.country}</p>
                    </div>
                </div>
            )}

            {/* 3D Canvas */}
            <Canvas
                camera={{ position: [0, 0, 5], fov: 45 }}
                style={{ background: 'transparent' }}
            >
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} />
                <Stars radius={300} depth={60} count={5000} factor={7} fade speed={1} />

                <Earth
                    onMarkerHover={setHoveredTrek}
                    onMarkerLeave={() => setHoveredTrek(null)}
                    onMarkerClick={handleMarkerClick}
                />

                <OrbitControls
                    enableZoom={true}
                    enablePan={false}
                    minDistance={3}
                    maxDistance={8}
                    autoRotate
                    autoRotateSpeed={0.5}
                />
            </Canvas>

            {/* Instructions */}
            <div className="absolute bottom-10 left-0 right-0 z-10 text-center pointer-events-none">
                <p className="text-white/60 text-sm">
                    Drag to rotate • Scroll to zoom • Click markers to explore
                </p>
            </div>
        </div>
    );
}
