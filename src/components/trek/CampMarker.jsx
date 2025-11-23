import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

export default function CampMarker({ camp, map }) {
    const markerRef = useRef(null);

    useEffect(() => {
        if (!map) return;

        // Create marker element
        const el = document.createElement('div');
        el.className = 'camp-marker';
        el.innerHTML = `
      <div class="w-6 h-6 bg-orange-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-110 transition-transform">
        <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      </div>
    `;

        // Create popup
        const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
      <div class="p-2">
        <h3 class="font-bold text-mountain-900">${camp.name}</h3>
        <p class="text-sm text-gray-600">Day ${camp.dayNumber} • ${camp.elevation}m</p>
      </div>
    `);

        // Add marker to map
        markerRef.current = new mapboxgl.Marker(el)
            .setLngLat(camp.coordinates)
            .setPopup(popup)
            .addTo(map);

        return () => {
            markerRef.current?.remove();
        };
    }, [map, camp]);

    return null;
}
