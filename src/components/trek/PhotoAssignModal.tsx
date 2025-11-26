import { memo, useState, useCallback } from 'react';
import { assignPhotoToWaypoint } from '../../lib/journeys';
import type { Camp, Photo } from '../../types/trek';

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

    if (!isOpen) return null;

    const modalStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24
    };

    const overlayStyle: React.CSSProperties = {
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)'
    };

    const contentStyle: React.CSSProperties = {
        position: 'relative',
        background: 'rgba(15, 15, 20, 0.98)',
        borderRadius: isMobile ? '20px 20px 0 0' : 16,
        width: isMobile ? '100%' : '100%',
        maxWidth: 600,
        maxHeight: isMobile ? '90dvh' : '80vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid rgba(255,255,255,0.1)'
    };

    const headerStyle: React.CSSProperties = {
        padding: isMobile ? '20px 20px 16px' : 24,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
    };

    const bodyStyle: React.CSSProperties = {
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? 20 : 24,
        WebkitOverflowScrolling: 'touch'
    };

    const footerStyle: React.CSSProperties = {
        padding: isMobile ? '16px 20px' : '16px 24px',
        paddingBottom: isMobile ? 'calc(16px + env(safe-area-inset-bottom))' : 16,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        gap: 12,
        justifyContent: 'space-between',
        alignItems: 'center'
    };

    const buttonBase: React.CSSProperties = {
        padding: '12px 24px',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        border: 'none',
        minHeight: 44,
        transition: 'opacity 0.2s'
    };

    return (
        <div style={modalStyle}>
            <div style={overlayStyle} onClick={onClose} />
            <div style={contentStyle}>
                {/* Header */}
                <div style={headerStyle}>
                    <div>
                        <h2 style={{ color: 'white', fontSize: 18, fontWeight: 500, margin: 0 }}>
                            Assign Photos to Day {camp.dayNumber}
                        </h2>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: '4px 0 0' }}>
                            {camp.name}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: 'rgba(255,255,255,0.7)',
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            cursor: 'pointer',
                            fontSize: 18
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Body */}
                <div style={bodyStyle}>
                    {error && (
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 8,
                            padding: 12,
                            marginBottom: 16,
                            color: '#ef4444',
                            fontSize: 13
                        }}>
                            {error}
                        </div>
                    )}

                    {availablePhotos.length === 0 ? (
                        <div style={{
                            textAlign: 'center',
                            padding: 40,
                            color: 'rgba(255,255,255,0.5)'
                        }}>
                            <p style={{ margin: 0 }}>No photos available to assign.</p>
                            <p style={{ margin: '8px 0 0', fontSize: 13 }}>
                                Upload photos in the Photos tab first.
                            </p>
                        </div>
                    ) : (
                        <>
                            <p style={{
                                color: 'rgba(255,255,255,0.5)',
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
                                                borderRadius: 8,
                                                overflow: 'hidden',
                                                position: 'relative',
                                                cursor: 'pointer',
                                                border: isSelected
                                                    ? '3px solid #3b82f6'
                                                    : '3px solid transparent',
                                                opacity: isSelected ? 1 : 0.6,
                                                transition: 'all 0.2s'
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
                                                    background: '#3b82f6',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    fontSize: 14
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
                                                    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                                    color: 'white',
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
                </div>

                {/* Footer */}
                <div style={footerStyle}>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                        {selectedPhotos.size} photo{selectedPhotos.size !== 1 ? 's' : ''} selected
                    </span>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button
                            onClick={onClose}
                            style={{
                                ...buttonBase,
                                background: 'rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.7)'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            style={{
                                ...buttonBase,
                                background: '#3b82f6',
                                color: 'white',
                                opacity: saving ? 0.5 : 1
                            }}
                        >
                            {saving ? 'Saving...' : 'Assign Photos'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
