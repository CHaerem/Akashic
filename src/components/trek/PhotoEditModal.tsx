/**
 * Modal for editing photo properties: caption, location, hero status
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Photo, TrekData } from '../../types/trek';
import { updatePhoto } from '../../lib/journeys';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '../ui/dialog';
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { Card } from '../ui/card';
import { cn } from '@/lib/utils';

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

    const formContent = (
        <div className="flex flex-col gap-5">
            {/* Photo preview */}
            <div className="rounded-xl overflow-hidden bg-black/30">
                <img
                    src={getMediaUrl(photo.thumbnail_url || photo.url)}
                    alt="Photo preview"
                    className="w-full max-h-48 object-contain"
                />
            </div>

            {/* Error message */}
            {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                </div>
            )}

            {/* Caption */}
            <div className="space-y-2">
                <Label>Caption</Label>
                <Textarea
                    value={caption}
                    onChange={e => setCaption(e.target.value)}
                    placeholder="Add a caption for this photo..."
                    rows={3}
                />
            </div>

            {/* Location */}
            <div className="space-y-2">
                <Label>Location</Label>

                {!showMap ? (
                    <div className={cn(
                        "flex gap-2",
                        isMobile ? "flex-col" : "flex-row items-center"
                    )}>
                        <div className={cn(
                            "flex-1 px-4 py-3 rounded-xl text-sm",
                            "bg-black/30 border border-white/10",
                            "light:bg-white/90 light:border-black/10",
                            coordinates ? "text-white/95 light:text-slate-900" : "text-white/40 light:text-slate-400"
                        )}>
                            {coordinates
                                ? `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`
                                : 'No location set'}
                        </div>
                        <div className={cn("flex gap-2", isMobile && "w-full")}>
                            <Button
                                variant="subtle"
                                size="sm"
                                onClick={() => setShowMap(true)}
                                className={isMobile ? "flex-1" : undefined}
                            >
                                {coordinates ? 'Change' : 'Set Location'}
                            </Button>
                            {coordinates && (
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={handleClearLocation}
                                    className={isMobile ? "flex-1" : undefined}
                                >
                                    Clear
                                </Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div>
                        <div
                            ref={mapContainerRef}
                            className={cn(
                                "rounded-xl overflow-hidden mb-2",
                                isMobile ? "h-48" : "h-64"
                            )}
                        />
                        <div className="flex justify-between items-center">
                            <span className="text-xs text-white/40 light:text-slate-400">
                                Click on map to set location
                            </span>
                            <Button
                                variant="subtle"
                                size="sm"
                                onClick={() => setShowMap(false)}
                            >
                                Done
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Hero toggle */}
            <Card variant="subtle" className="p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-white/95 light:text-slate-900 mb-1">
                            Hero Image
                        </div>
                        <div className="text-xs text-white/40 light:text-slate-400">
                            Use as the main image for this journey
                        </div>
                    </div>
                    <button
                        onClick={() => setIsHero(!isHero)}
                        className={cn(
                            "relative w-12 h-7 rounded-full transition-colors duration-200",
                            isHero
                                ? "bg-blue-500"
                                : "bg-white/20 light:bg-black/10"
                        )}
                    >
                        <div className={cn(
                            "absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200",
                            isHero ? "left-6" : "left-1"
                        )} />
                    </button>
                </div>
            </Card>
        </div>
    );

    const footerContent = (
        <>
            <Button variant="subtle" onClick={onClose} disabled={saving}>
                Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
            </Button>
        </>
    );

    // Use Sheet for mobile, Dialog for desktop
    if (isMobile) {
        return (
            <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Edit Photo</SheetTitle>
                    </SheetHeader>
                    <div className="px-6 py-4 overflow-y-auto">
                        {formContent}
                    </div>
                    <SheetFooter>
                        {footerContent}
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Photo</DialogTitle>
                </DialogHeader>
                {formContent}
                <DialogFooter>
                    {footerContent}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});
