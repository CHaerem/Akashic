import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

export default function CampMarker({ camp, map }) {
    const markerRef = useRef(null);

    useEffect(() => {
        if (!map) return;

        // Create marker element
        const el = document.createElement('div');
        el.className = 'camp-marker';
        el.style.cssText = `
            width: 12px;
            height: 12px;
            cursor: pointer;
            position: relative;
        `;
        el.innerHTML = `
            <div style="
                width: 8px;
                height: 8px;
                background: white;
                border-radius: 50%;
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                transition: transform 0.2s ease;
            "></div>
        `;

        // Hover effect
        el.addEventListener('mouseenter', () => {
            el.querySelector('div').style.transform = 'translate(-50%, -50%) scale(1.5)';
        });
        el.addEventListener('mouseleave', () => {
            el.querySelector('div').style.transform = 'translate(-50%, -50%) scale(1)';
        });

        // Create popup with dark styling
        const popup = new mapboxgl.Popup({
            offset: 15,
            closeButton: false,
            className: 'dark-popup'
        }).setHTML(`
            <div style="
                background: rgba(10, 10, 15, 0.95);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.1);
            ">
                <p style="
                    font-size: 10px;
                    letter-spacing: 0.15em;
                    text-transform: uppercase;
                    color: rgba(255, 255, 255, 0.4);
                    margin-bottom: 4px;
                ">Day ${camp.dayNumber}</p>
                <p style="
                    font-size: 14px;
                    color: rgba(255, 255, 255, 0.9);
                    margin-bottom: 2px;
                ">${camp.name}</p>
                <p style="
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.4);
                ">${camp.elevation}m</p>
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
