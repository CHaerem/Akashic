/**
 * Modal for editing photo properties: caption, location, hero status
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Photo, TrekData } from '../../types/trek';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, transitions, glassPanel } from '../../styles/liquidGlass';
import { updatePhoto } from '../../lib/journeys';

interface PhotoEditModalProps {
    photo: Photo;
    trekData: TrekData;
    isOpen: boolean;
    onClose: () => void;
    onSave: (updatedPhoto: Photo) => void;
    getMediaUrl: (path: string) => string;
    isMobile: boolean;
}

export const PhotoEditModal = memo(function PhotoEditModal({
    photo,
    trekData,
    isOpen,
    onClose,
    onSave,
    getMediaUrl,
    isMobile
}: PhotoEditModalProps) {
    const [caption, setCaption] = useState(photo.caption || '');
    const [coordinates, setCoordinates] = useState<[number, number] | null>(
        photo.coordinates || null
    );
    const [isHero, setIsHero] = useState(photo.is_hero || false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showMap, setShowMap] = useState(false);

    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const markerRef = useRef<mapboxgl.Marker | null>(null);

    // Reset state when photo changes
    useEffect(() => {
        if (isOpen) {
            setCaption(photo.caption || '');
            setCoordinates(photo.coordinates || null);
            setIsHero(photo.is_hero || false);
            setError(null);
            setShowMap(false);
        }
    }, [isOpen, photo]);

    // Initialize map when showing location picker
    useEffect(() => {
        if (!showMap || !mapContainerRef.current || mapRef.current) return;

        const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
        if (!token) return;

        mapboxgl.accessToken = token;

        // Start at photo coordinates, or route center, or default
        const startCoords = coordinates ||
            (trekData.route?.coordinates?.[Math.floor(trekData.route.coordinates.length / 2)] as [number, number]) ||
            [0, 0];

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            center: [startCoords[0], startCoords[1]],
            zoom: coordinates ? 14 : 10
        });

        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        mapRef.current = map;

        map.on('load', () => {
            // Add route line for context
            if (trekData.route?.coordinates) {
                map.addSource('route', {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                            type: 'LineString',
                            coordinates: trekData.route.coordinates.map(c => [c[0], c[1]])
                        }
                    }
                });

                map.addLayer({
                    id: 'route-line',
                    type: 'line',
                    source: 'route',
                    paint: {
                        'line-color': 'rgba(255,255,255,0.6)',
                        'line-width': 3
                    }
                });
            }

            // Add marker if coordinates exist
            if (coordinates) {
                markerRef.current = new mapboxgl.Marker({ color: '#3b82f6' })
                    .setLngLat(coordinates)
                    .addTo(map);
            }
        });

        // Click to set location
        map.on('click', (e) => {
            const newCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            setCoordinates(newCoords);

            // Update or create marker
            if (markerRef.current) {
                markerRef.current.setLngLat(newCoords);
            } else {
                markerRef.current = new mapboxgl.Marker({ color: '#3b82f6' })
                    .setLngLat(newCoords)
                    .addTo(map);
            }
        });

        return () => {
            markerRef.current?.remove();
            markerRef.current = null;
            map.remove();
            mapRef.current = null;
        };
    }, [showMap, coordinates, trekData.route]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);

        try {
            await updatePhoto(photo.id, {
                caption: caption || null,
                coordinates: coordinates,
                is_hero: isHero
            });

            const updatedPhoto: Photo = {
                ...photo,
                caption: caption || null,
                coordinates,
                is_hero: isHero
            };

            onSave(updatedPhoto);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [photo, caption, coordinates, isHero, onSave, onClose]);

    const handleClearLocation = useCallback(() => {
        setCoordinates(null);
        if (markerRef.current) {
            markerRef.current.remove();
            markerRef.current = null;
        }
    }, []);

    if (!isOpen) return null;

    return createPortal(
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.8)',
                backdropFilter: 'blur(8px)',
                zIndex: 1000,
                display: 'flex',
                alignItems: isMobile ? 'flex-end' : 'center',
                justifyContent: 'center',
                padding: isMobile ? 0 : 32,
                paddingBottom: isMobile ? 0 : 32
            }}
            onClick={onClose}
        >
            <div
                style={{
                    ...glassPanel,
                    maxWidth: isMobile ? '100%' : 600,
                    width: '100%',
                    maxHeight: isMobile ? '95vh' : '90vh',
                    overflow: 'auto',
                    borderRadius: isMobile ? `${radius.lg}px ${radius.lg}px 0 0` : radius.lg,
                    padding: isMobile ? 20 : 28,
                    paddingBottom: isMobile ? 'max(20px, env(safe-area-inset-bottom))' : 28
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 24
                }}>
                    <h2 style={{
                        margin: 0,
                        fontSize: 20,
                        fontWeight: 600,
                        color: colors.text.primary
                    }}>
                        Edit Photo
                    </h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: colors.text.tertiary,
                            cursor: 'pointer',
                            padding: 8,
                            fontSize: 20
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Photo preview */}
                <div style={{
                    marginBottom: 24,
                    borderRadius: radius.md,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,0.3)'
                }}>
                    <img
                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                        alt="Photo preview"
                        style={{
                            width: '100%',
                            maxHeight: 200,
                            objectFit: 'contain'
                        }}
                    />
                </div>

                {/* Error message */}
                {error && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: radius.sm,
                        padding: 12,
                        marginBottom: 20,
                        color: '#f87171',
                        fontSize: 13
                    }}>
                        {error}
                    </div>
                )}

                {/* Caption */}
                <div style={{ marginBottom: 20 }}>
                    <label style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: colors.text.secondary,
                        marginBottom: 8,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                    }}>
                        Caption
                    </label>
                    <textarea
                        value={caption}
                        onChange={e => setCaption(e.target.value)}
                        placeholder="Add a caption for this photo..."
                        rows={3}
                        style={{
                            width: '100%',
                            padding: 12,
                            background: colors.glass.subtle,
                            border: `1px solid ${colors.glass.border}`,
                            borderRadius: radius.sm,
                            color: colors.text.primary,
                            fontSize: 14,
                            resize: 'vertical',
                            fontFamily: 'inherit'
                        }}
                    />
                </div>

                {/* Location */}
                <div style={{ marginBottom: 20 }}>
                    <label style={{
                        display: 'block',
                        fontSize: 12,
                        fontWeight: 500,
                        color: colors.text.secondary,
                        marginBottom: 8,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                    }}>
                        Location
                    </label>

                    {!showMap ? (
                        <div style={{
                            display: 'flex',
                            flexDirection: isMobile ? 'column' : 'row',
                            gap: 8,
                            alignItems: isMobile ? 'stretch' : 'center'
                        }}>
                            <div style={{
                                flex: 1,
                                padding: 12,
                                background: colors.glass.subtle,
                                border: `1px solid ${colors.glass.border}`,
                                borderRadius: radius.sm,
                                color: coordinates ? colors.text.primary : colors.text.tertiary,
                                fontSize: 13
                            }}>
                                {coordinates
                                    ? `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`
                                    : 'No location set'}
                            </div>
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                flexShrink: 0
                            }}>
                                <GlassButton
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => setShowMap(true)}
                                    style={isMobile ? { flex: 1 } : undefined}
                                >
                                    {coordinates ? 'Change' : 'Set Location'}
                                </GlassButton>
                                {coordinates && (
                                    <GlassButton
                                        variant="subtle"
                                        size="sm"
                                        onClick={handleClearLocation}
                                        style={{ color: colors.accent.error, ...(isMobile ? { flex: 1 } : {}) }}
                                    >
                                        Clear
                                    </GlassButton>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div
                                ref={mapContainerRef}
                                style={{
                                    height: isMobile ? 200 : 250,
                                    borderRadius: radius.md,
                                    overflow: 'hidden',
                                    marginBottom: 8
                                }}
                            />
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <span style={{
                                    fontSize: 12,
                                    color: colors.text.tertiary
                                }}>
                                    Click on map to set location
                                </span>
                                <GlassButton
                                    variant="subtle"
                                    size="sm"
                                    onClick={() => setShowMap(false)}
                                >
                                    Done
                                </GlassButton>
                            </div>
                        </div>
                    )}
                </div>

                {/* Hero toggle */}
                <div style={{
                    marginBottom: 24,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 16,
                    background: colors.glass.subtle,
                    borderRadius: radius.md,
                    border: `1px solid ${colors.glass.border}`
                }}>
                    <div>
                        <div style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.text.primary,
                            marginBottom: 4
                        }}>
                            Hero Image
                        </div>
                        <div style={{
                            fontSize: 12,
                            color: colors.text.tertiary
                        }}>
                            Use as the main image for this journey
                        </div>
                    </div>
                    <button
                        onClick={() => setIsHero(!isHero)}
                        style={{
                            width: 48,
                            height: 28,
                            borderRadius: 14,
                            border: 'none',
                            background: isHero ? '#3b82f6' : colors.glass.medium,
                            cursor: 'pointer',
                            position: 'relative',
                            transition: `background ${transitions.normal}`
                        }}
                    >
                        <div style={{
                            width: 22,
                            height: 22,
                            borderRadius: '50%',
                            background: 'white',
                            position: 'absolute',
                            top: 3,
                            left: isHero ? 23 : 3,
                            transition: `left ${transitions.normal}`,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                        }} />
                    </button>
                </div>

                {/* Actions */}
                <div style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column-reverse' : 'row',
                    gap: 12,
                    justifyContent: 'flex-end'
                }}>
                    <GlassButton
                        variant="subtle"
                        size="md"
                        onClick={onClose}
                        disabled={saving}
                        style={isMobile ? { width: '100%' } : undefined}
                    >
                        Cancel
                    </GlassButton>
                    <GlassButton
                        variant="primary"
                        size="md"
                        onClick={handleSave}
                        disabled={saving}
                        style={isMobile ? { width: '100%' } : undefined}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </GlassButton>
                </div>
            </div>
        </div>,
        document.body
    );
});
