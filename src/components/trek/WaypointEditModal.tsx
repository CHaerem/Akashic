import { memo, useState, useEffect, useCallback } from 'react';
import { getWaypoint, updateWaypoint, type DbWaypoint, type WaypointUpdate } from '../../lib/journeys';
import type { Camp, Photo } from '../../types/trek';
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
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';

interface WaypointEditModalProps {
    camp: Camp;
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    isMobile: boolean;
    photos?: Photo[];
    getMediaUrl?: (path: string) => string;
}

export const WaypointEditModal = memo(function WaypointEditModal({
    camp,
    isOpen,
    onClose,
    onSave,
    isMobile,
    photos = [],
    getMediaUrl = (path) => path
}: WaypointEditModalProps) {
    const [waypoint, setWaypoint] = useState<DbWaypoint | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [elevation, setElevation] = useState('');
    const [dayNumber, setDayNumber] = useState('');
    const [highlightsText, setHighlightsText] = useState('');

    // Load waypoint data
    useEffect(() => {
        if (!isOpen || !camp.id) return;

        setLoading(true);
        setError(null);

        getWaypoint(camp.id).then(data => {
            if (data) {
                setWaypoint(data);
                setName(data.name || '');
                setDescription(data.description || '');
                setElevation(data.elevation?.toString() || '');
                setDayNumber(data.day_number?.toString() || '');
                setHighlightsText((data.highlights || []).join('\n'));
            }
            setLoading(false);
        }).catch(err => {
            setError(err.message);
            setLoading(false);
        });
    }, [isOpen, camp.id]);

    const handleSave = useCallback(async () => {
        if (!waypoint) return;

        setSaving(true);
        setError(null);

        try {
            const highlights = highlightsText
                .split('\n')
                .map(h => h.trim())
                .filter(h => h.length > 0);

            const updates: WaypointUpdate = {
                name: name || waypoint.name,
                description: description || null,
                elevation: elevation ? parseInt(elevation, 10) : null,
                day_number: dayNumber ? parseInt(dayNumber, 10) : null,
                highlights: highlights.length > 0 ? highlights : null
            };

            await updateWaypoint(camp.id, updates);
            onSave();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [waypoint, camp.id, name, description, elevation, dayNumber, highlightsText, onSave, onClose]);

    // Photos assigned to this waypoint
    const assignedPhotos = photos.filter(p => p.waypoint_id === camp.id);

    const formContent = (
        <>
            {loading ? (
                <div className="text-white/50 light:text-slate-400 text-center py-10">
                    Loading...
                </div>
            ) : error ? (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                </div>
            ) : (
                <div className="flex flex-col gap-5">
                    {/* Name */}
                    <div className="space-y-2">
                        <Label>Camp/Location Name</Label>
                        <Input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="e.g., Base Camp"
                        />
                    </div>

                    {/* Day Number & Elevation */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Day Number</Label>
                            <Input
                                type="number"
                                value={dayNumber}
                                onChange={e => setDayNumber(e.target.value)}
                                placeholder="1"
                                min={1}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Elevation (m)</Label>
                            <Input
                                type="number"
                                value={elevation}
                                onChange={e => setElevation(e.target.value)}
                                placeholder="e.g., 3200"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Notes about this day..."
                            rows={3}
                        />
                    </div>

                    {/* Highlights */}
                    <div className="space-y-2">
                        <Label>Highlights (one per line)</Label>
                        <Textarea
                            value={highlightsText}
                            onChange={e => setHighlightsText(e.target.value)}
                            placeholder={`Scenic viewpoint\nWildlife sighting\nChallenging terrain`}
                            rows={3}
                        />
                    </div>

                    {/* Assigned Photos */}
                    {assignedPhotos.length > 0 && (
                        <div className="space-y-2">
                            <Label>Assigned Photos ({assignedPhotos.length})</Label>
                            <div className="grid grid-cols-4 gap-2">
                                {assignedPhotos.slice(0, 8).map(photo => (
                                    <div
                                        key={photo.id}
                                        className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-white/6 to-white/2 border border-white/10 light:border-black/5"
                                    >
                                        <img
                                            src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                            alt={photo.caption || 'Photo'}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                        />
                                    </div>
                                ))}
                            </div>
                            {assignedPhotos.length > 8 && (
                                <p className="text-white/40 light:text-slate-400 text-xs mt-1">
                                    +{assignedPhotos.length - 8} more photos
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </>
    );

    const footerContent = (
        <>
            <Button variant="subtle" onClick={onClose}>
                Cancel
            </Button>
            <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving || loading}
            >
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
                        <SheetTitle>Edit Day {camp.dayNumber}</SheetTitle>
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
                    <DialogTitle>Edit Day {camp.dayNumber}</DialogTitle>
                </DialogHeader>
                {formContent}
                <DialogFooter>
                    {footerContent}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});
