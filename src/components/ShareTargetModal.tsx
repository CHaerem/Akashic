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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from './ui/select';

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
    const { treks } = useJourneys();
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
                if (treks.length === 1) {
                    setSelectedJourney(treks[0].id);
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
    }, [isOpen, treks]);

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

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !uploading && handleCancel()}>
            <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Upload Shared Photos</DialogTitle>
                    <DialogDescription>
                        {photos.length} photo{photos.length !== 1 ? 's' : ''} ready to upload
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    {error && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                            {error}
                        </div>
                    )}

                    {/* Journey selector */}
                    <div className="space-y-2">
                        <Label>Select Journey</Label>
                        <Select
                            value={selectedJourney}
                            onValueChange={setSelectedJourney}
                            disabled={uploading}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Choose a journey..." />
                            </SelectTrigger>
                            <SelectContent>
                                {treks.map((trek) => (
                                    <SelectItem key={trek.id} value={trek.id}>
                                        {trek.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Photo grid */}
                    <div className="grid grid-cols-3 gap-2">
                        {photos.map((photo, index) => (
                            <div
                                key={photo.sharedFile.id}
                                className="relative aspect-square rounded-lg overflow-hidden bg-white/5"
                            >
                                <img
                                    src={photo.previewUrl}
                                    alt={`Photo ${index + 1}`}
                                    className="w-full h-full object-cover"
                                />

                                {/* Metadata indicators */}
                                <div className="absolute bottom-0 left-0 right-0 p-1 bg-gradient-to-t from-black/70 to-transparent flex gap-1 justify-end">
                                    {/* Location indicator */}
                                    {photo.metadata.coordinates && (
                                        <div
                                            className="w-5 h-5 rounded-full bg-blue-500/80 flex items-center justify-center"
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
                                            className="w-5 h-5 rounded-full bg-green-500/80 flex items-center justify-center"
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
                        <div className="p-3 rounded-lg bg-white/5 light:bg-black/5 text-xs text-white/50 light:text-slate-500">
                            <div className="flex gap-4">
                                <span>
                                    <span className="text-blue-400">
                                        {photos.filter(p => p.metadata.coordinates).length}
                                    </span>{' '}
                                    with GPS
                                </span>
                                <span>
                                    <span className="text-green-400">
                                        {photos.filter(p => p.metadata.takenAt).length}
                                    </span>{' '}
                                    with date
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="subtle"
                        onClick={handleCancel}
                        disabled={uploading}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleUpload}
                        disabled={!selectedJourney || uploading || photos.length === 0}
                    >
                        {uploading
                            ? `Uploading ${uploadProgress?.current}/${uploadProgress?.total}...`
                            : `Upload ${photos.length} Photo${photos.length !== 1 ? 's' : ''}`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
