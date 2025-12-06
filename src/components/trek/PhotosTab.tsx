/**
 * Photos tab for viewing and uploading journey photos
 * Allows family members to collaboratively add photos to journeys
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { TrekData, Photo, Camp } from '../../types/trek';
import type { UploadResult } from '../../lib/media';
import { useMedia } from '../../hooks/useMedia';
import { usePhotoDay } from '../../hooks/usePhotoDay';
import { fetchPhotos, createPhoto, deletePhoto, getJourneyIdBySlug, updatePhoto } from '../../lib/journeys';
import { PhotoUpload } from './PhotoUpload';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { PhotoEditModal } from './PhotoEditModal';
import { SkeletonPhotoGrid } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type DayFilter = 'all' | number; // 'all' or day number

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
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const dragTimeoutRef = useRef<number | null>(null);
    const { getMediaUrl, loading: tokenLoading } = useMedia();

    // Use shared photo-day matching hook
    const { photosByDay } = usePhotoDay(trekData, photos);

    // Filter photos based on selected day
    const filteredPhotos = useMemo(() => {
        if (dayFilter === 'all') return photos;
        return photosByDay[dayFilter] || [];
    }, [photos, photosByDay, dayFilter]);

    // Get counts for each day
    const dayCounts = useMemo(() => {
        const counts: Record<string, number> = { all: photos.length };
        Object.entries(photosByDay).forEach(([key, dayPhotos]) => {
            counts[key] = dayPhotos.length;
        });
        return counts;
    }, [photos.length, photosByDay]);

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
            // Create photo record in database with extracted metadata and thumbnail
            const photo = await createPhoto({
                journey_id: journeyDbId,
                url: result.path,
                thumbnail_url: result.thumbnailPath,
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

        const newPhotos = [...photos];
        const [draggedPhoto] = newPhotos.splice(draggedIndex, 1);
        newPhotos.splice(targetIndex, 0, draggedPhoto);

        const updatedPhotos = newPhotos.map((photo, index) => ({
            ...photo,
            sort_order: index
        }));

        setPhotos(updatedPhotos);
        setDraggedIndex(null);
        setDragOverIndex(null);

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
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
                </div>
                <SkeletonPhotoGrid count={6} columns={3} />
            </div>
        );
    }

    return (
        <div>
            {/* Error message */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-300 text-[13px]">
                    {error}
                </div>
            )}

            {/* Upload section - only show in edit mode */}
            {editMode && journeyDbId && (
                <div className="mb-6">
                    <h3 className="text-white/90 light:text-slate-900 text-sm font-medium mb-3 uppercase tracking-[0.1em]">
                        Add Photos
                    </h3>
                    <PhotoUpload
                        journeyId={journeyDbId}
                        onUploadComplete={handleUploadComplete}
                        onUploadError={handleUploadError}
                        isMobile={isMobile}
                    />
                </div>
            )}

            {/* Day filter tabs */}
            {photos.length > 0 && trekData.camps.length > 1 && (
                <div className="mb-4">
                    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
                        {/* All photos tab */}
                        <button
                            onClick={() => setDayFilter('all')}
                            className={cn(
                                "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                                dayFilter === 'all'
                                    ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                    : "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10"
                            )}
                        >
                            All ({dayCounts.all})
                        </button>

                        {/* Day tabs */}
                        {trekData.camps.map((camp: Camp) => {
                            const count = dayCounts[camp.dayNumber] || 0;
                            return (
                                <button
                                    key={camp.dayNumber}
                                    onClick={() => setDayFilter(camp.dayNumber)}
                                    className={cn(
                                        "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap",
                                        dayFilter === camp.dayNumber
                                            ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                                            : count > 0
                                                ? "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10"
                                                : "bg-white/[0.02] text-white/30 border border-white/5"
                                    )}
                                >
                                    Day {camp.dayNumber} {count > 0 && `(${count})`}
                                </button>
                            );
                        })}

                        {/* Unassigned tab - only show if there are unassigned photos */}
                        {dayCounts.unassigned > 0 && (
                            <button
                                onClick={() => setDayFilter('unassigned' as unknown as number)}
                                className={cn(
                                    "flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                                    dayFilter === ('unassigned' as unknown as number)
                                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                        : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                                )}
                            >
                                Unassigned ({dayCounts.unassigned})
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Photo grid */}
            {filteredPhotos.length > 0 && (
                <div>
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-white/90 light:text-slate-900 text-sm font-medium m-0 uppercase tracking-[0.1em]">
                            {dayFilter === 'all'
                                ? `Journey Photos (${photos.length})`
                                : dayFilter === ('unassigned' as unknown as number)
                                    ? `Unassigned Photos (${filteredPhotos.length})`
                                    : `Day ${dayFilter} Photos (${filteredPhotos.length})`
                            }
                        </h3>
                        {editMode && filteredPhotos.length > 1 && (
                            <span className="text-[11px] text-white/40 light:text-slate-400">
                                Drag to reorder
                            </span>
                        )}
                    </div>
                    <div className={cn(
                        "grid gap-3",
                        // Responsive grid with minimum item width
                        "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                    )}>
                        {filteredPhotos.map((photo, index) => (
                            <div
                                key={photo.id}
                                onClick={() => handlePhotoClick(index)}
                                draggable={editMode}
                                onDragStart={() => editMode && handleDragStart(index)}
                                onDragOver={(e) => editMode && handleDragOver(e, index)}
                                onDragLeave={() => editMode && handleDragLeave()}
                                onDrop={() => editMode && handleDrop(index)}
                                onDragEnd={() => editMode && handleDragEnd()}
                                className={cn(
                                    "aspect-square rounded-lg overflow-hidden relative bg-white/5 light:bg-black/5",
                                    "transition-all duration-150",
                                    editMode ? "cursor-grab" : "cursor-pointer",
                                    photo.is_hero && "ring-2 ring-amber-400",
                                    dragOverIndex === index && "ring-2 ring-blue-500 scale-[1.02]",
                                    draggedIndex === index && "opacity-50"
                                )}
                            >
                                <img
                                    src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                    alt={photo.caption || 'Journey photo'}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                />

                                {/* Hero badge */}
                                {photo.is_hero && (
                                    <div className="absolute top-1.5 left-1.5 bg-amber-400 text-black text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide">
                                        Hero
                                    </div>
                                )}

                                {/* Edit button in edit mode - 44px touch target */}
                                {editMode && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleEditPhoto(photo);
                                        }}
                                        className="absolute top-1 right-1 min-w-[44px] min-h-[44px] bg-black/60 backdrop-blur-sm border border-white/20 rounded-xl flex items-center justify-center text-white/95 text-xs font-medium cursor-pointer hover:bg-black/80 transition-colors"
                                    >
                                        Edit
                                    </button>
                                )}

                                {/* Location indicator */}
                                {photo.coordinates && (
                                    <div className={cn(
                                        "absolute right-1.5 bg-black/50 rounded-full w-6 h-6 flex items-center justify-center",
                                        photo.caption ? "bottom-8" : "bottom-1.5"
                                    )}>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                                            <circle cx="12" cy="10" r="3"/>
                                        </svg>
                                    </div>
                                )}

                                {photo.caption && (
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-5 pb-2 text-[11px] text-white/90">
                                        {photo.caption}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state for filtered day */}
            {photos.length > 0 && filteredPhotos.length === 0 && dayFilter !== 'all' && (
                <div className="text-center py-10 text-white/40 light:text-slate-400">
                    <p className="m-0 mb-2">
                        {dayFilter === ('unassigned' as unknown as number)
                            ? 'No unassigned photos'
                            : `No photos for Day ${dayFilter}`
                        }
                    </p>
                    <p className="m-0 text-xs">
                        Photos will appear here when assigned to this day
                    </p>
                </div>
            )}

            {/* Empty state - no photos at all */}
            {photos.length === 0 && !loading && (
                <div className="text-center py-10 text-white/40 light:text-slate-400">
                    <p className="m-0 mb-2">No photos yet</p>
                    <p className="m-0 text-xs">
                        Be the first to add photos to this journey!
                    </p>
                </div>
            )}

            {/* Lightbox - uses filtered photos for navigation within selected day */}
            <PhotoLightbox
                photos={filteredPhotos}
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
