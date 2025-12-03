import { memo, useState, useCallback, useEffect } from 'react';
import { assignPhotoToWaypoint } from '../../lib/journeys';
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
import { cn } from '@/lib/utils';

interface PhotoAssignModalProps {
    camp: Camp;
    photos: Photo[];
    isOpen: boolean;
    onClose: () => void;
    onAssign: () => void;
    isMobile: boolean;
    getMediaUrl: (path: string) => string;
}

export const PhotoAssignModal = memo(function PhotoAssignModal({
    camp,
    photos,
    isOpen,
    onClose,
    onAssign,
    isMobile,
    getMediaUrl
}: PhotoAssignModalProps) {
    const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Photos not assigned to any waypoint, or assigned to this one
    const availablePhotos = photos.filter(p => !p.waypoint_id || p.waypoint_id === camp.id);
    const alreadyAssigned = photos.filter(p => p.waypoint_id === camp.id);

    // Initialize selection with already assigned photos when modal opens
    useEffect(() => {
        if (isOpen) {
            setSelectedPhotos(new Set(alreadyAssigned.map(p => p.id)));
            setError(null);
        }
    }, [isOpen, camp.id]);

    const togglePhoto = useCallback((photoId: string) => {
        setSelectedPhotos(prev => {
            const next = new Set(prev);
            if (next.has(photoId)) {
                next.delete(photoId);
            } else {
                next.add(photoId);
            }
            return next;
        });
    }, []);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setError(null);

        try {
            // Get photos that need to be assigned (newly selected)
            const toAssign = availablePhotos.filter(p =>
                selectedPhotos.has(p.id) && p.waypoint_id !== camp.id
            );

            // Get photos that need to be unassigned (were assigned but now unselected)
            const toUnassign = alreadyAssigned.filter(p => !selectedPhotos.has(p.id));

            // Assign new photos
            await Promise.all(toAssign.map(p => assignPhotoToWaypoint(p.id, camp.id)));

            // Unassign removed photos
            await Promise.all(toUnassign.map(p => assignPhotoToWaypoint(p.id, null)));

            onAssign();
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to assign photos');
        } finally {
            setSaving(false);
        }
    }, [availablePhotos, alreadyAssigned, selectedPhotos, camp.id, onAssign, onClose]);

    const formContent = (
        <div className="flex flex-col gap-4">
            {/* Subtitle */}
            <p className="text-white/50 light:text-slate-500 text-sm -mt-2">
                {camp.name}
            </p>

            {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                    {error}
                </div>
            )}

            {availablePhotos.length === 0 ? (
                <div className="text-center py-10">
                    <p className="text-white/50 light:text-slate-500">No photos available to assign.</p>
                    <p className="text-white/35 light:text-slate-400 text-sm mt-2">
                        Upload photos in the Photos tab first.
                    </p>
                </div>
            ) : (
                <>
                    <p className="text-white/50 light:text-slate-500 text-sm">
                        Tap photos to select/deselect. Selected photos will be assigned to this day.
                    </p>
                    <div className={cn(
                        "grid gap-2",
                        isMobile ? "grid-cols-3" : "grid-cols-4"
                    )}>
                        {availablePhotos.map(photo => {
                            const isSelected = selectedPhotos.has(photo.id);
                            return (
                                <div
                                    key={photo.id}
                                    onClick={() => togglePhoto(photo.id)}
                                    className={cn(
                                        "aspect-square rounded-lg overflow-hidden relative cursor-pointer",
                                        "transition-all duration-200",
                                        isSelected
                                            ? "ring-3 ring-blue-500 opacity-100"
                                            : "ring-3 ring-transparent opacity-60 hover:opacity-80"
                                    )}
                                >
                                    <img
                                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                        alt={photo.caption || 'Photo'}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                    {isSelected && (
                                        <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm shadow-lg">
                                            ✓
                                        </div>
                                    )}
                                    {photo.taken_at && (
                                        <div className="absolute bottom-0 left-0 right-0 px-1.5 pt-4 pb-1.5 bg-gradient-to-t from-black/60 to-transparent text-white text-[10px]">
                                            {new Date(photo.taken_at).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric'
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );

    const footerContent = (
        <div className="flex items-center justify-between w-full">
            <span className="text-white/50 light:text-slate-500 text-sm">
                {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex gap-3">
                <Button variant="subtle" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : 'Assign Photos'}
                </Button>
            </div>
        </div>
    );

    // Use Sheet for mobile, Dialog for desktop
    if (isMobile) {
        return (
            <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
                <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Assign Photos to Day {camp.dayNumber}</SheetTitle>
                    </SheetHeader>
                    <div className="px-6 py-4 overflow-y-auto">
                        {formContent}
                    </div>
                    <SheetFooter className="flex-row justify-between">
                        {footerContent}
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Assign Photos to Day {camp.dayNumber}</DialogTitle>
                </DialogHeader>
                {formContent}
                <DialogFooter className="flex-row justify-between sm:justify-between">
                    {footerContent}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
});
