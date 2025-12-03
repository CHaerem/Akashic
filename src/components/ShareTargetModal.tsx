/**
 * Modal for handling photos shared via PWA Share Target
 * Shows photo previews with metadata and lets user select a journey
 */

import { useState, useEffect, useCallback } from 'react';
import { getPendingSharedFiles, clearSharedFiles, type SharedFile } from '../lib/shareTarget';
import { extractPhotoMetadata, type PhotoMetadata } from '../lib/exif';
import { uploadPhoto, type UploadResult } from '../lib/media';
import { createPhoto, getJourneyIdBySlug } from '../lib/journeys';
import { useJourneys } from '../contexts/JourneysContext';
import { colors, radius, transitions } from '../styles/liquidGlass';

interface PhotoPreview {
    sharedFile: SharedFile;
    previewUrl: string;
    metadata: PhotoMetadata;
}

interface ShareTargetModalProps {
    isOpen: boolean;
    onClose: () => void;
    onUploadComplete?: () => void;
}

export function ShareTargetModal({ isOpen, onClose, onUploadComplete }: ShareTargetModalProps) {
    const { journeys } = useJourneys();
    const [photos, setPhotos] = useState<PhotoPreview[]>([]);
    const [selectedJourney, setSelectedJourney] = useState<string>('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Load shared files and extract metadata
    useEffect(() => {
        if (!isOpen) return;

        async function loadSharedFiles() {
            try {
                const sharedFiles = await getPendingSharedFiles();

                // Process each file: create preview and extract metadata
                const previews = await Promise.all(
                    sharedFiles.map(async (sf) => {
                        const previewUrl = URL.createObjectURL(sf.file);
                        const metadata = await extractPhotoMetadata(sf.file);
                        return { sharedFile: sf, previewUrl, metadata };
                    })
                );

                setPhotos(previews);

                // Auto-select first journey if only one exists
                if (journeys.length === 1) {
                    setSelectedJourney(journeys[0].id);
                }
            } catch (err) {
                console.error('Failed to load shared files:', err);
                setError('Failed to load shared photos');
            }
        }

        loadSharedFiles();

        // Cleanup preview URLs on unmount
        return () => {
            photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
        };
    }, [isOpen, journeys]);

    const handleUpload = useCallback(async () => {
        if (!selectedJourney || photos.length === 0) return;

        setUploading(true);
        setError(null);
        setUploadProgress({ current: 0, total: photos.length });

        try {
            // Get the database ID for the selected journey
            const journeyDbId = await getJourneyIdBySlug(selectedJourney);
            if (!journeyDbId) {
                throw new Error('Journey not found');
            }

            // Upload each photo
            for (let i = 0; i < photos.length; i++) {
                const photo = photos[i];
                setUploadProgress({ current: i + 1, total: photos.length });

                // Upload to R2
                const result: UploadResult = await uploadPhoto(journeyDbId, photo.sharedFile.file);

                // Create photo record in database with metadata
                await createPhoto({
                    journey_id: journeyDbId,
                    url: result.path,
                    coordinates: photo.metadata.coordinates,
                    taken_at: photo.metadata.takenAt?.toISOString(),
                });
            }

            // Clear shared files from IndexedDB
            await clearSharedFiles();

            // Cleanup preview URLs
            photos.forEach(p => URL.revokeObjectURL(p.previewUrl));

            // Notify completion
            onUploadComplete?.();
            onClose();
        } catch (err) {
            console.error('Upload failed:', err);
            setError(err instanceof Error ? err.message : 'Upload failed');
        } finally {
            setUploading(false);
            setUploadProgress(null);
        }
    }, [selectedJourney, photos, onClose, onUploadComplete]);

    const handleCancel = useCallback(async () => {
        // Clear shared files
        await clearSharedFiles();
        // Cleanup preview URLs
        photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
        onClose();
    }, [photos, onClose]);

    const formatDate = (date?: Date) => {
        if (!date) return 'Unknown date';
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0, 0, 0, 0.8)',
                backdropFilter: 'blur(8px)',
                padding: 16,
            }}
            onClick={(e) => e.target === e.currentTarget && !uploading && handleCancel()}
        >
            <div
                style={{
                    background: colors.glass.medium,
                    borderRadius: radius.xl,
                    border: `1px solid ${colors.glass.border}`,
                    width: '100%',
                    maxWidth: 500,
                    maxHeight: '90vh',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '20px 24px',
                        borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                    }}
                >
                    <h2
                        style={{
                            margin: 0,
                            fontSize: 18,
                            fontWeight: 600,
                            color: colors.text.primary,
                        }}
                    >
                        Upload Shared Photos
                    </h2>
                    <p
                        style={{
                            margin: '8px 0 0',
                            fontSize: 13,
                            color: colors.text.tertiary,
                        }}
                    >
                        {photos.length} photo{photos.length !== 1 ? 's' : ''} ready to upload
                    </p>
                </div>

                {/* Photo previews */}
                <div
                    style={{
                        flex: 1,
                        overflow: 'auto',
                        padding: 16,
                    }}
                >
                    {error && (
                        <div
                            style={{
                                background: 'rgba(255, 100, 100, 0.1)',
                                border: '1px solid rgba(255, 100, 100, 0.3)',
                                borderRadius: radius.md,
                                padding: 12,
                                marginBottom: 16,
                                color: 'rgba(255, 150, 150, 0.9)',
                                fontSize: 13,
                            }}
                        >
                            {error}
                        </div>
                    )}

                    {/* Journey selector */}
                    <div style={{ marginBottom: 16 }}>
                        <label
                            style={{
                                display: 'block',
                                fontSize: 12,
                                fontWeight: 500,
                                color: colors.text.secondary,
                                marginBottom: 8,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                            }}
                        >
                            Select Journey
                        </label>
                        <select
                            value={selectedJourney}
                            onChange={(e) => setSelectedJourney(e.target.value)}
                            disabled={uploading}
                            style={{
                                width: '100%',
                                padding: '12px 16px',
                                fontSize: 14,
                                background: 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${colors.glass.border}`,
                                borderRadius: radius.md,
                                color: colors.text.primary,
                                cursor: uploading ? 'not-allowed' : 'pointer',
                                opacity: uploading ? 0.6 : 1,
                            }}
                        >
                            <option value="">Choose a journey...</option>
                            {journeys.map((journey) => (
                                <option key={journey.id} value={journey.id}>
                                    {journey.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Photo grid */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                            gap: 8,
                        }}
                    >
                        {photos.map((photo, index) => (
                            <div
                                key={photo.sharedFile.id}
                                style={{
                                    position: 'relative',
                                    aspectRatio: '1',
                                    borderRadius: radius.md,
                                    overflow: 'hidden',
                                    background: 'rgba(255, 255, 255, 0.05)',
                                }}
                            >
                                <img
                                    src={photo.previewUrl}
                                    alt={`Photo ${index + 1}`}
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                />

                                {/* Metadata indicators */}
                                <div
                                    style={{
                                        position: 'absolute',
                                        bottom: 0,
                                        left: 0,
                                        right: 0,
                                        padding: 4,
                                        background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                                        display: 'flex',
                                        gap: 4,
                                        justifyContent: 'flex-end',
                                    }}
                                >
                                    {/* Location indicator */}
                                    {photo.metadata.coordinates && (
                                        <div
                                            style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: '50%',
                                                background: 'rgba(59, 130, 246, 0.8)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                            title="Has GPS location"
                                        >
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                                                <circle cx="12" cy="10" r="3" />
                                            </svg>
                                        </div>
                                    )}

                                    {/* Date indicator */}
                                    {photo.metadata.takenAt && (
                                        <div
                                            style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: '50%',
                                                background: 'rgba(34, 197, 94, 0.8)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                            title={formatDate(photo.metadata.takenAt)}
                                        >
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                                <line x1="16" y1="2" x2="16" y2="6" />
                                                <line x1="8" y1="2" x2="8" y2="6" />
                                                <line x1="3" y1="10" x2="21" y2="10" />
                                            </svg>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Metadata summary */}
                    {photos.length > 0 && (
                        <div
                            style={{
                                marginTop: 16,
                                padding: 12,
                                background: 'rgba(255, 255, 255, 0.03)',
                                borderRadius: radius.md,
                                fontSize: 12,
                                color: colors.text.tertiary,
                            }}
                        >
                            <div style={{ display: 'flex', gap: 16 }}>
                                <span>
                                    <span style={{ color: 'rgba(59, 130, 246, 0.9)' }}>
                                        {photos.filter(p => p.metadata.coordinates).length}
                                    </span>{' '}
                                    with GPS
                                </span>
                                <span>
                                    <span style={{ color: 'rgba(34, 197, 94, 0.9)' }}>
                                        {photos.filter(p => p.metadata.takenAt).length}
                                    </span>{' '}
                                    with date
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div
                    style={{
                        padding: '16px 24px',
                        borderTop: `1px solid ${colors.glass.borderSubtle}`,
                        display: 'flex',
                        gap: 12,
                        justifyContent: 'flex-end',
                    }}
                >
                    <button
                        onClick={handleCancel}
                        disabled={uploading}
                        style={{
                            padding: '10px 20px',
                            fontSize: 14,
                            fontWeight: 500,
                            background: 'transparent',
                            border: `1px solid ${colors.glass.border}`,
                            borderRadius: radius.md,
                            color: colors.text.secondary,
                            cursor: uploading ? 'not-allowed' : 'pointer',
                            opacity: uploading ? 0.5 : 1,
                            transition: `all ${transitions.fast}`,
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={!selectedJourney || uploading || photos.length === 0}
                        style={{
                            padding: '10px 24px',
                            fontSize: 14,
                            fontWeight: 500,
                            background: selectedJourney && !uploading
                                ? 'rgba(59, 130, 246, 0.8)'
                                : 'rgba(255, 255, 255, 0.1)',
                            border: 'none',
                            borderRadius: radius.md,
                            color: selectedJourney && !uploading
                                ? '#fff'
                                : colors.text.tertiary,
                            cursor: !selectedJourney || uploading ? 'not-allowed' : 'pointer',
                            transition: `all ${transitions.fast}`,
                        }}
                    >
                        {uploading
                            ? `Uploading ${uploadProgress?.current}/${uploadProgress?.total}...`
                            : `Upload ${photos.length} Photo${photos.length !== 1 ? 's' : ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
