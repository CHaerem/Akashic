/**
 * Photos tab for viewing and uploading journey photos
 * Allows family members to collaboratively add photos to journeys
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { TrekData, Photo } from '../../types/trek';
import type { UploadResult } from '../../lib/media';
import { useMedia } from '../../hooks/useMedia';
import { fetchPhotos, createPhoto, deletePhoto, getJourneyIdBySlug, updatePhoto } from '../../lib/journeys';
import { PhotoUpload } from './PhotoUpload';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { PhotoEditModal } from './PhotoEditModal';
import { colors, radius } from '../../styles/liquidGlass';

interface PhotosTabProps {
    trekData: TrekData;
    isMobile: boolean;
    editMode?: boolean;
    onViewPhotoOnMap?: (photo: Photo) => void;
}

export function PhotosTab({ trekData, isMobile, editMode = false, onViewPhotoOnMap }: PhotosTabProps) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [journeyDbId, setJourneyDbId] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const dragTimeoutRef = useRef<number | null>(null);
    const { getMediaUrl, loading: tokenLoading } = useMedia();

    // Get the database ID for this journey (needed for creating photos)
    useEffect(() => {
        async function loadJourneyId() {
            const id = await getJourneyIdBySlug(trekData.id);
            setJourneyDbId(id);
        }
        loadJourneyId();
    }, [trekData.id]);

    // Load photos for this journey
    useEffect(() => {
        async function loadPhotos() {
            if (!journeyDbId) return;

            setLoading(true);
            try {
                const data = await fetchPhotos(journeyDbId);
                setPhotos(data);
            } catch (err) {
                console.error('Error loading photos:', err);
                setError('Failed to load photos');
            } finally {
                setLoading(false);
            }
        }

        loadPhotos();
    }, [journeyDbId]);

    const handleUploadComplete = useCallback(async (result: UploadResult) => {
        if (!journeyDbId) return;

        try {
            // Create photo record in database with extracted metadata
            const photo = await createPhoto({
                journey_id: journeyDbId,
                url: result.path,
                coordinates: result.coordinates,
                taken_at: result.takenAt?.toISOString(),
            });

            if (photo) {
                setPhotos(prev => [...prev, photo]);
            }
        } catch (err) {
            console.error('Error saving photo:', err);
            setError('Photo uploaded but failed to save record');
        }
    }, [journeyDbId]);

    const handleUploadError = useCallback((errorMsg: string) => {
        setError(errorMsg);
        // Clear error after 5 seconds
        setTimeout(() => setError(null), 5000);
    }, []);

    const handlePhotoClick = useCallback((index: number) => {
        setLightboxIndex(index);
    }, []);

    const closeLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    const handleDeletePhoto = useCallback(async (photo: Photo) => {
        try {
            await deletePhoto(photo.id);
            setPhotos(prev => prev.filter(p => p.id !== photo.id));
            // Lightbox will handle index adjustment
        } catch (err) {
            console.error('Error deleting photo:', err);
            setError('Failed to delete photo');
        }
    }, []);

    const handleEditPhoto = useCallback((photo: Photo) => {
        setEditingPhoto(photo);
    }, []);

    const handlePhotoUpdated = useCallback((updatedPhoto: Photo) => {
        setPhotos(prev => prev.map(p =>
            p.id === updatedPhoto.id ? updatedPhoto : p
        ));
    }, []);

    // Drag and drop handlers for reordering
    const handleDragStart = useCallback((index: number) => {
        setDraggedIndex(index);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== index) {
            setDragOverIndex(index);
        }
    }, [draggedIndex]);

    const handleDragLeave = useCallback(() => {
        // Small delay to prevent flickering
        if (dragTimeoutRef.current) {
            clearTimeout(dragTimeoutRef.current);
        }
        dragTimeoutRef.current = window.setTimeout(() => {
            setDragOverIndex(null);
        }, 50);
    }, []);

    const handleDrop = useCallback(async (targetIndex: number) => {
        if (draggedIndex === null || draggedIndex === targetIndex) {
            setDraggedIndex(null);
            setDragOverIndex(null);
            return;
        }

        // Reorder photos locally
        const newPhotos = [...photos];
        const [draggedPhoto] = newPhotos.splice(draggedIndex, 1);
        newPhotos.splice(targetIndex, 0, draggedPhoto);

        // Update sort_order for all affected photos
        const updatedPhotos = newPhotos.map((photo, index) => ({
            ...photo,
            sort_order: index
        }));

        setPhotos(updatedPhotos);
        setDraggedIndex(null);
        setDragOverIndex(null);

        // Save to database
        try {
            await Promise.all(
                updatedPhotos.map((photo, index) =>
                    updatePhoto(photo.id, { sort_order: index })
                )
            );
        } catch (err) {
            console.error('Error saving photo order:', err);
            setError('Failed to save photo order');
        }
    }, [draggedIndex, photos]);

    const handleDragEnd = useCallback(() => {
        setDraggedIndex(null);
        setDragOverIndex(null);
    }, []);

    if (loading || tokenLoading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 40,
                color: 'rgba(255,255,255,0.4)'
            }}>
                Loading photos...
            </div>
        );
    }

    return (
        <div>
            {/* Error message */}
            {error && (
                <div style={{
                    background: 'rgba(255,100,100,0.1)',
                    border: '1px solid rgba(255,100,100,0.3)',
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 16,
                    color: 'rgba(255,150,150,0.9)',
                    fontSize: 13
                }}>
                    {error}
                </div>
            )}

            {/* Upload section - only show in edit mode */}
            {editMode && journeyDbId && (
                <div style={{ marginBottom: 24 }}>
                    <h3 style={{
                        color: 'rgba(255,255,255,0.9)',
                        fontSize: 14,
                        fontWeight: 500,
                        marginBottom: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em'
                    }}>
                        Add Photos
                    </h3>
                    <PhotoUpload
                        journeyId={journeyDbId}
                        onUploadComplete={handleUploadComplete}
                        onUploadError={handleUploadError}
                    />
                </div>
            )}

            {/* Photo grid */}
            {photos.length > 0 && (
                <div>
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 12
                    }}>
                        <h3 style={{
                            color: 'rgba(255,255,255,0.9)',
                            fontSize: 14,
                            fontWeight: 500,
                            margin: 0,
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em'
                        }}>
                            Journey Photos ({photos.length})
                        </h3>
                        {editMode && photos.length > 1 && (
                            <span style={{
                                fontSize: 11,
                                color: colors.text.tertiary
                            }}>
                                Drag to reorder
                            </span>
                        )}
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                        gap: 8
                    }}>
                        {photos.map((photo, index) => (
                            <div
                                key={photo.id}
                                onClick={() => handlePhotoClick(index)}
                                draggable={editMode}
                                onDragStart={() => editMode && handleDragStart(index)}
                                onDragOver={(e) => editMode && handleDragOver(e, index)}
                                onDragLeave={() => editMode && handleDragLeave()}
                                onDrop={() => editMode && handleDrop(index)}
                                onDragEnd={() => editMode && handleDragEnd()}
                                style={{
                                    aspectRatio: '1',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    cursor: editMode ? 'grab' : 'pointer',
                                    background: 'rgba(255,255,255,0.05)',
                                    position: 'relative',
                                    border: photo.is_hero
                                        ? '2px solid #fbbf24'
                                        : dragOverIndex === index
                                            ? '2px solid #3b82f6'
                                            : 'none',
                                    opacity: draggedIndex === index ? 0.5 : 1,
                                    transform: dragOverIndex === index ? 'scale(1.02)' : 'scale(1)',
                                    transition: 'transform 0.15s ease, opacity 0.15s ease, border 0.15s ease'
                                }}
                            >
                                <img
                                    src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                    alt={photo.caption || 'Journey photo'}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover'
                                    }}
                                    loading="lazy"
                                />

                                {/* Hero badge */}
                                {photo.is_hero && (
                                    <div style={{
                                        position: 'absolute',
                                        top: 6,
                                        left: 6,
                                        background: '#fbbf24',
                                        color: '#000',
                                        fontSize: 9,
                                        fontWeight: 600,
                                        padding: '2px 6px',
                                        borderRadius: 4,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em'
                                    }}>
                                        Hero
                                    </div>
                                )}

                                {/* Edit button in edit mode */}
                                {editMode && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditPhoto(photo);
                                        }}
                                        style={{
                                            position: 'absolute',
                                            top: 6,
                                            right: 6,
                                            background: colors.glass.medium,
                                            border: 'none',
                                            borderRadius: radius.sm,
                                            padding: '6px 10px',
                                            color: colors.text.primary,
                                            fontSize: 11,
                                            cursor: 'pointer',
                                            opacity: 0.9
                                        }}
                                    >
                                        Edit
                                    </button>
                                )}

                                {/* Location indicator */}
                                {photo.coordinates && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: photo.caption ? 32 : 6,
                                        right: 6,
                                        background: 'rgba(0,0,0,0.5)',
                                        borderRadius: '50%',
                                        width: 24,
                                        height: 24,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                                            <circle cx="12" cy="10" r="3"/>
                                        </svg>
                                    </div>
                                )}

                                {photo.caption && (
                                    <div style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        right: 0,
                                        background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                        padding: '20px 8px 8px',
                                        fontSize: 11,
                                        color: 'rgba(255,255,255,0.9)'
                                    }}>
                                        {photo.caption}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {photos.length === 0 && !loading && (
                <div style={{
                    textAlign: 'center',
                    padding: 40,
                    color: 'rgba(255,255,255,0.4)'
                }}>
                    <p style={{ margin: 0, marginBottom: 8 }}>No photos yet</p>
                    <p style={{ margin: 0, fontSize: 12 }}>
                        Be the first to add photos to this journey!
                    </p>
                </div>
            )}

            {/* Lightbox */}
            <PhotoLightbox
                photos={photos}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                getMediaUrl={getMediaUrl}
                onDelete={editMode ? handleDeletePhoto : undefined}
                editMode={editMode}
                onViewOnMap={onViewPhotoOnMap}
                onEdit={editMode ? handleEditPhoto : undefined}
            />

            {/* Photo edit modal */}
            {editingPhoto && (
                <PhotoEditModal
                    photo={editingPhoto}
                    trekData={trekData}
                    isOpen={true}
                    onClose={() => setEditingPhoto(null)}
                    onSave={handlePhotoUpdated}
                    getMediaUrl={getMediaUrl}
                    isMobile={isMobile}
                />
            )}
        </div>
    );
}
