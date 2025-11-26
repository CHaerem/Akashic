/**
 * Mapbox Globe component with 3D terrain visualization
 */

import { useRef, useEffect } from 'react';
import { useMapbox } from '../hooks/useMapbox';
import { MapErrorFallback } from './common/ErrorBoundary';
import type { TrekConfig, Camp, ViewMode } from '../types/trek';

interface MapboxGlobeProps {
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    onSelectTrek: (trek: TrekConfig) => void;
    view: ViewMode;
}

// Generate realistic starfield - seeded positions for consistency
// Optimized for mobile with fewer stars while maintaining visual quality
function generateStarfield(isMobile: boolean): string {
    const stars: string[] = [];

    // Seed-based pseudo-random for consistent star positions
    const seededRandom = (seed: number) => {
        const x = Math.sin(seed * 9999) * 10000;
        return x - Math.floor(x);
    };

    // Adjust star counts for mobile performance
    const dimCount = isMobile ? 80 : 200;
    const mediumCount = isMobile ? 35 : 80;
    const brightCount = isMobile ? 15 : 30;
    const veryBrightCount = isMobile ? 8 : 12;

    // Dim background stars (magnitude 5-6, barely visible)
    for (let i = 0; i < dimCount; i++) {
        const x = seededRandom(i * 1.1) * 100;
        const y = seededRandom(i * 2.2) * 100;
        const opacity = 0.15 + seededRandom(i * 3.3) * 0.15;
        stars.push(`radial-gradient(0.5px 0.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`);
    }

    // Medium stars (magnitude 3-4)
    for (let i = 0; i < mediumCount; i++) {
        const x = seededRandom(i * 4.4 + 100) * 100;
        const y = seededRandom(i * 5.5 + 100) * 100;
        const opacity = 0.3 + seededRandom(i * 6.6) * 0.3;
        stars.push(`radial-gradient(1px 1px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(255,255,255,${opacity.toFixed(2)}), transparent)`);
    }

    // Brighter stars (magnitude 2-3)
    for (let i = 0; i < brightCount; i++) {
        const x = seededRandom(i * 7.7 + 200) * 100;
        const y = seededRandom(i * 8.8 + 200) * 100;
        const opacity = 0.6 + seededRandom(i * 9.9) * 0.3;
        // Slight color variation - some stars slightly blue or yellow
        const colorVar = seededRandom(i * 10.1);
        let color = '255,255,255';
        if (colorVar < 0.2) color = '200,220,255'; // Blue-white
        else if (colorVar > 0.8) color = '255,250,230'; // Yellow-white
        stars.push(`radial-gradient(1.5px 1.5px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},${opacity.toFixed(2)}), transparent)`);
    }

    // Bright stars (magnitude 1-2) - fewer, larger
    for (let i = 0; i < veryBrightCount; i++) {
        const x = seededRandom(i * 11.1 + 300) * 100;
        const y = seededRandom(i * 12.2 + 300) * 100;
        const colorVar = seededRandom(i * 13.3);
        let color = '255,255,255';
        if (colorVar < 0.25) color = '180,200,255'; // Blue (like Rigel)
        else if (colorVar > 0.75) color = '255,220,180'; // Orange (like Betelgeuse)
        stars.push(`radial-gradient(2px 2px at ${x.toFixed(2)}% ${y.toFixed(2)}%, rgba(${color},0.9), transparent)`);
    }

    // Very bright stars (magnitude 0 or brighter) - just a few prominent ones
    const prominentStars = [
        { x: 23, y: 15, color: '180,200,255' },  // Blue giant
        { x: 67, y: 42, color: '255,255,255' },  // White
        { x: 82, y: 78, color: '255,210,170' },  // Orange
        { x: 12, y: 65, color: '255,255,240' },  // Yellow-white
        { x: 91, y: 23, color: '200,220,255' },  // Blue-white
    ];

    prominentStars.forEach(star => {
        stars.push(`radial-gradient(2.5px 2.5px at ${star.x}% ${star.y}%, rgba(${star.color},1), rgba(${star.color},0.3) 50%, transparent)`);
    });

    return stars.join(',\n        ');
}

// Check if mobile at module load time (for initial render)
const isMobileDevice = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

// Static starfield CSS - stars won't move when globe rotates
// Generated once at load time for performance
const starfieldStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'rgb(11, 11, 25)',
    backgroundImage: generateStarfield(isMobileDevice),
    pointerEvents: 'none',
    zIndex: 0
};

export function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view }: MapboxGlobeProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    const { mapReady, error, flyToGlobe, flyToTrek, startRotation, stopRotation } = useMapbox({
        containerRef,
        onTrekSelect: onSelectTrek
    });

    // Handle view transitions
    useEffect(() => {
        if (!mapReady) return;

        if (view === 'trek' && selectedTrek) {
            stopRotation();
            flyToTrek(selectedTrek, selectedCamp);
        } else if (view === 'globe') {
            flyToGlobe(selectedTrek);
            // Start rotation only when no trek is selected (idle globe)
            if (!selectedTrek) {
                // Small delay to let the flyTo animation complete
                const timer = setTimeout(() => startRotation(), 3500);
                return () => clearTimeout(timer);
            } else {
                stopRotation();
            }
        }
    }, [view, selectedTrek, selectedCamp, mapReady, flyToGlobe, flyToTrek, startRotation, stopRotation]);

    if (error) {
        return <MapErrorFallback error={error} />;
    }

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            {/* Static starfield background */}
            <div style={starfieldStyle} />
            {/* Map container */}
            <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', zIndex: 1 }} />
        </div>
    );
}
