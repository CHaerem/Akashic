/**
 * Mapbox Globe component with 3D terrain visualization
 */

import { useRef, useEffect } from 'react';
import { useMapbox } from '../hooks/useMapbox';
import { MapErrorFallback } from './common/ErrorBoundary';

export function MapboxGlobe({ selectedTrek, selectedCamp, onSelectTrek, view }) {
    const containerRef = useRef(null);

    const { mapReady, error, flyToGlobe, flyToTrek } = useMapbox({
        containerRef,
        onTrekSelect: onSelectTrek
    });

    // Handle view transitions
    useEffect(() => {
        if (!mapReady) return;

        if (view === 'trek' && selectedTrek) {
            flyToTrek(selectedTrek, selectedCamp);
        } else if (view === 'globe') {
            flyToGlobe(selectedTrek);
        }
    }, [view, selectedTrek, selectedCamp, mapReady, flyToGlobe, flyToTrek]);

    if (error) {
        return <MapErrorFallback error={error} />;
    }

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
