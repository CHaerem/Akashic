import { memo, useState, useCallback } from 'react';
import { assignPhotoToWaypoint } from '../../lib/journeys';
import type { Camp, Photo } from '../../types/trek';
import { GlassModal, glassErrorBoxStyle } from '../common/GlassModal';
import { GlassButton } from '../common/GlassButton';
import { colors, gradients, radius, transitions } from '../../styles/liquidGlass';

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

    // Initialize selection with already assigned photos
    useState(() => {
        setSelectedPhotos(new Set(alreadyAssigned.map(p => p.id)));
    });

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

    const footer = (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span style={{ color: colors.text.tertiary, fontSize: 13 }}>
                {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} selected
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
                <GlassButton variant="subtle" onClick={onClose}>
                    Cancel
                </GlassButton>
                <GlassButton
                    variant="primary"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? 'Saving...' : 'Assign Photos'}
                </GlassButton>
            </div>
        </div>
    );

    return (
        <GlassModal
            isOpen={isOpen}
            onClose={onClose}
            title={`Assign Photos to Day ${camp.dayNumber}`}
            footer={footer}
            isMobile={isMobile}
            maxWidth={600}
        >
            {/* Subtitle */}
            <p style={{ color: colors.text.tertiary, fontSize: 13, margin: '-8px 0 16px' }}>
                {camp.name}
            </p>

            {error && (
                <div style={{ ...glassErrorBoxStyle, marginBottom: 16 }}>
                    {error}
                </div>
            )}

            {availablePhotos.length === 0 ? (
                <div style={{
                    textAlign: 'center',
                    padding: 40,
                    color: colors.text.tertiary
                }}>
                    <p style={{ margin: 0 }}>No photos available to assign.</p>
                    <p style={{ margin: '8px 0 0', fontSize: 13, color: colors.text.subtle }}>
                        Upload photos in the Photos tab first.
                    </p>
                </div>
            ) : (
                <>
                    <p style={{
                        color: colors.text.tertiary,
                        fontSize: 13,
                        marginBottom: 16
                    }}>
                        Tap photos to select/deselect. Selected photos will be assigned to this day.
                    </p>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${isMobile ? 3 : 4}, 1fr)`,
                        gap: 8
                    }}>
                        {availablePhotos.map(photo => {
                            const isSelected = selectedPhotos.has(photo.id);
                            return (
                                <div
                                    key={photo.id}
                                    onClick={() => togglePhoto(photo.id)}
                                    style={{
                                        aspectRatio: '1',
                                        borderRadius: radius.sm,
                                        overflow: 'hidden',
                                        position: 'relative',
                                        cursor: 'pointer',
                                        border: isSelected
                                            ? `3px solid ${colors.accent.primary}`
                                            : '3px solid transparent',
                                        opacity: isSelected ? 1 : 0.6,
                                        transition: `all ${transitions.normal}`
                                    }}
                                >
                                    <img
                                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                        alt={photo.caption || 'Photo'}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover'
                                        }}
                                        loading="lazy"
                                    />
                                    {isSelected && (
                                        <div style={{
                                            position: 'absolute',
                                            top: 6,
                                            right: 6,
                                            width: 24,
                                            height: 24,
                                            borderRadius: '50%',
                                            background: colors.accent.primary,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: 14,
                                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
                                        }}>
                                            ✓
                                        </div>
                                    )}
                                    {photo.taken_at && (
                                        <div style={{
                                            position: 'absolute',
                                            bottom: 0,
                                            left: 0,
                                            right: 0,
                                            padding: '16px 6px 6px',
                                            background: gradients.overlay.bottomSubtle,
                                            color: colors.text.primary,
                                            fontSize: 10
                                        }}>
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
        </GlassModal>
    );
});
