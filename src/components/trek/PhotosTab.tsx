/**
 * Photos tab for viewing and uploading journey photos
 * Allows family members to collaboratively add photos to journeys
 */

import { useState, useEffect, useCallback } from 'react';
import type { TrekData, Photo } from '../../types/trek';
import type { UploadResult } from '../../lib/media';
import { useMedia } from '../../hooks/useMedia';
import { fetchPhotos, createPhoto, deletePhoto, getJourneyIdBySlug } from '../../lib/journeys';
import { PhotoUpload } from './PhotoUpload';

interface PhotosTabProps {
    trekData: TrekData;
    isMobile: boolean;
}

export function PhotosTab({ trekData, isMobile }: PhotosTabProps) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [journeyDbId, setJourneyDbId] = useState<string | null>(null);
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
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

    const handlePhotoClick = useCallback((photo: Photo) => {
        setSelectedPhoto(photo);
    }, []);

    const closeLightbox = useCallback(() => {
        setSelectedPhoto(null);
    }, []);

    const handleDeletePhoto = useCallback(async (photo: Photo) => {
        if (!confirm('Delete this photo? This cannot be undone.')) {
            return;
        }

        try {
            await deletePhoto(photo.id);
            setPhotos(prev => prev.filter(p => p.id !== photo.id));
            setSelectedPhoto(null);
        } catch (err) {
            console.error('Error deleting photo:', err);
            setError('Failed to delete photo');
        }
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

            {/* Upload section */}
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
                    journeySlug={trekData.id}
                    onUploadComplete={handleUploadComplete}
                    onUploadError={handleUploadError}
                />
            </div>

            {/* Photo grid */}
            {photos.length > 0 && (
                <div>
                    <h3 style={{
                        color: 'rgba(255,255,255,0.9)',
                        fontSize: 14,
                        fontWeight: 500,
                        marginBottom: 12,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em'
                    }}>
                        Journey Photos ({photos.length})
                    </h3>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
                        gap: 8
                    }}>
                        {photos.map(photo => (
                            <div
                                key={photo.id}
                                onClick={() => handlePhotoClick(photo)}
                                style={{
                                    aspectRatio: '1',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.05)',
                                    position: 'relative'
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
            {selectedPhoto && (
                <div
                    onClick={closeLightbox}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.95)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        cursor: 'pointer'
                    }}
                >
                    {/* Top-right buttons */}
                    <div style={{
                        position: 'absolute',
                        top: 16,
                        right: 16,
                        display: 'flex',
                        gap: 8,
                        zIndex: 1001
                    }}>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDeletePhoto(selectedPhoto);
                            }}
                            style={{
                                background: 'rgba(255,100,100,0.2)',
                                border: 'none',
                                color: 'rgba(255,150,150,0.9)',
                                width: 48,
                                height: 48,
                                borderRadius: '50%',
                                cursor: 'pointer',
                                fontSize: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                WebkitTapHighlightColor: 'transparent'
                            }}
                            title="Delete photo"
                            aria-label="Delete photo"
                        >
                            🗑
                        </button>
                        <button
                            onClick={closeLightbox}
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                border: 'none',
                                color: 'white',
                                width: 48,
                                height: 48,
                                borderRadius: '50%',
                                cursor: 'pointer',
                                fontSize: 22,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                WebkitTapHighlightColor: 'transparent'
                            }}
                            aria-label="Close"
                        >
                            ✕
                        </button>
                    </div>
                    <img
                        src={getMediaUrl(selectedPhoto.url)}
                        alt={selectedPhoto.caption || 'Journey photo'}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '90vw',
                            maxHeight: '90vh',
                            objectFit: 'contain',
                            cursor: 'default'
                        }}
                    />
                    {selectedPhoto.caption && (
                        <div style={{
                            position: 'absolute',
                            bottom: 24,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            background: 'rgba(0,0,0,0.7)',
                            padding: '12px 24px',
                            borderRadius: 8,
                            color: 'white',
                            fontSize: 14,
                            maxWidth: '80vw',
                            textAlign: 'center'
                        }}>
                            {selectedPhoto.caption}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
