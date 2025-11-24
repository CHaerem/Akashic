import { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';

const treks = [
    {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        lat: -3.0674,
        lng: 37.3556,
    },
    {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        elevation: '5,199m',
        lat: -0.1521,
        lng: 37.3084,
    },
    {
        id: 'inca-trail',
        name: 'Inca Trail',
        country: 'Peru',
        elevation: '4,215m',
        lat: -13.1631,
        lng: -72.5450,
    }
];

function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
}

function getCameraPositionForTrek(lat, lng, distance = 3.8) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -(distance * Math.sin(phi) * Math.cos(theta)),
        distance * Math.cos(phi),
        distance * Math.sin(phi) * Math.sin(theta)
    );
}

function CameraController({ targetPosition, onAnimationComplete }) {
    const { camera } = useThree();
    const progress = useRef(0);
    const start = useRef(new THREE.Vector3());
    const animating = useRef(false);

    useEffect(() => {
        if (targetPosition) {
            start.current.copy(camera.position);
            progress.current = 0;
            animating.current = true;
        }
    }, [targetPosition, camera]);

    useFrame((_, delta) => {
        if (animating.current && targetPosition) {
            progress.current += delta * 1.2;
            const t = Math.min(progress.current, 1);
            const eased = 1 - Math.pow(1 - t, 4);
            camera.position.lerpVectors(start.current, targetPosition, eased);
            camera.lookAt(0, 0, 0);
            if (t >= 1) {
                animating.current = false;
                onAnimationComplete?.();
            }
        }
    });

    return null;
}

function TrekMarker({ trek, onHover, onLeave, onClick, isSelected, isAnySelected }) {
    const ref = useRef();
    const [hovered, setHovered] = useState(false);
    const position = latLngToVector3(trek.lat, trek.lng, 2.01);

    useFrame((state) => {
        if (ref.current) {
            const active = hovered || isSelected;
            const scale = active ? 1.4 + Math.sin(state.clock.elapsedTime * 3) * 0.1 : 1;
            ref.current.scale.setScalar(scale);
        }
    });

    // Fade out non-selected markers
    const opacity = isAnySelected ? (isSelected ? 1 : 0) : (hovered ? 1 : 0.85);

    return (
        <mesh
            ref={ref}
            position={position}
            visible={!isAnySelected || isSelected}
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
            <sphereGeometry args={[0.035, 16, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={opacity} />
        </mesh>
    );
}

function Earth({ onMarkerHover, onMarkerLeave, onMarkerClick, selectedTrek, isZoomed }) {
    const earthRef = useRef();

    const [dayMap, bumpMap, specularMap] = useLoader(THREE.TextureLoader, [
        '/Akashic/textures/earth-day.jpg',
        '/Akashic/textures/earth-topology.png',
        '/Akashic/textures/earth-water.png'
    ]);

    useMemo(() => {
        [dayMap, bumpMap, specularMap].forEach(t => {
            t.colorSpace = THREE.SRGBColorSpace;
        });
    }, [dayMap, bumpMap, specularMap]);

    useFrame((_, delta) => {
        if (earthRef.current && !isZoomed) {
            earthRef.current.rotation.y += delta * 0.06;
        }
    });

    return (
        <group ref={earthRef}>
            <mesh>
                <sphereGeometry args={[2, 64, 64]} />
                <meshPhongMaterial
                    map={dayMap}
                    bumpMap={bumpMap}
                    bumpScale={0.04}
                    specularMap={specularMap}
                    specular={new THREE.Color('#111111')}
                    shininess={3}
                />
            </mesh>

            {/* Subtle atmosphere */}
            <mesh scale={1.015}>
                <sphereGeometry args={[2, 64, 64]} />
                <meshBasicMaterial
                    color="#4a9eff"
                    transparent
                    opacity={0.06}
                    side={THREE.BackSide}
                />
            </mesh>

            {treks.map((trek) => (
                <TrekMarker
                    key={trek.id}
                    trek={trek}
                    onHover={onMarkerHover}
                    onLeave={onMarkerLeave}
                    onClick={onMarkerClick}
                    isSelected={selectedTrek?.id === trek.id}
                    isAnySelected={!!selectedTrek}
                />
            ))}
        </group>
    );
}

function LoadingGlobe() {
    const ref = useRef();
    useFrame((_, delta) => {
        if (ref.current) ref.current.rotation.y += delta * 0.5;
    });

    return (
        <mesh ref={ref}>
            <sphereGeometry args={[2, 24, 24]} />
            <meshBasicMaterial color="#0f172a" wireframe />
        </mesh>
    );
}

function Scene({ onMarkerHover, onMarkerLeave, onMarkerClick, selectedTrek, cameraTarget, onZoomComplete }) {
    const controlsRef = useRef();
    const isZoomed = !!selectedTrek;

    useEffect(() => {
        if (controlsRef.current) {
            controlsRef.current.autoRotate = !isZoomed;
        }
    }, [isZoomed]);

    return (
        <>
            <ambientLight intensity={0.35} />
            <directionalLight position={[5, 3, 5]} intensity={1.6} />
            <pointLight position={[-10, -5, -10]} intensity={0.2} color="#6366f1" />

            <Stars radius={300} depth={50} count={1500} factor={2.5} fade speed={0.15} />

            <Suspense fallback={<LoadingGlobe />}>
                <Earth
                    onMarkerHover={onMarkerHover}
                    onMarkerLeave={onMarkerLeave}
                    onMarkerClick={onMarkerClick}
                    selectedTrek={selectedTrek}
                    isZoomed={isZoomed}
                />
            </Suspense>

            <CameraController targetPosition={cameraTarget} onAnimationComplete={onZoomComplete} />

            <OrbitControls
                ref={controlsRef}
                enableZoom={true}
                enablePan={false}
                minDistance={3.2}
                maxDistance={10}
                autoRotate={!isZoomed}
                autoRotateSpeed={0.35}
                enableDamping
                dampingFactor={0.05}
                enabled={!cameraTarget}
            />
        </>
    );
}

export default function Globe3D() {
    const navigate = useNavigate();
    const [hoveredTrek, setHoveredTrek] = useState(null);
    const [selectedTrek, setSelectedTrek] = useState(null);
    const [cameraTarget, setCameraTarget] = useState(null);
    const [showDetails, setShowDetails] = useState(false);

    const handleMarkerClick = (trek) => {
        if (selectedTrek?.id === trek.id) {
            navigate(`/trek/${trek.id}`);
        } else {
            setSelectedTrek(trek);
            setShowDetails(false);
            setCameraTarget(getCameraPositionForTrek(trek.lat, trek.lng));
        }
    };

    const handleBack = () => {
        setSelectedTrek(null);
        setCameraTarget(new THREE.Vector3(0, 0, 5));
        setShowDetails(false);
    };

    return (
        <div className="relative w-full h-screen bg-[#0a0a0f] overflow-hidden">
            {/* Hover label */}
            {hoveredTrek && !selectedTrek && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                    <p className="text-white/70 text-xs tracking-[0.2em] uppercase">
                        {hoveredTrek.name}
                    </p>
                </div>
            )}

            {/* Selected trek panel */}
            {selectedTrek && showDetails && (
                <div className="absolute left-6 lg:left-12 bottom-12 z-20">
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
                            onClick={() => navigate(`/trek/${selectedTrek.id}`)}
                            className="group flex items-center gap-4 text-xs tracking-[0.2em] uppercase text-white/60 hover:text-white transition-colors"
                        >
                            <span>Explore Journey</span>
                            <span className="group-hover:translate-x-1 transition-transform">&rarr;</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Canvas */}
            <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: true }}>
                <Scene
                    onMarkerHover={setHoveredTrek}
                    onMarkerLeave={() => setHoveredTrek(null)}
                    onMarkerClick={handleMarkerClick}
                    selectedTrek={selectedTrek}
                    cameraTarget={cameraTarget}
                    onZoomComplete={() => { setCameraTarget(null); setShowDetails(true); }}
                />
            </Canvas>

            {/* Minimal hint */}
            <div className={`absolute bottom-6 right-6 z-10 transition-all duration-500 ${selectedTrek ? 'opacity-0' : 'opacity-100'}`}>
                <p className="text-white/20 text-[10px] tracking-[0.15em] uppercase">
                    Drag to explore
                </p>
            </div>
        </div>
    );
}
