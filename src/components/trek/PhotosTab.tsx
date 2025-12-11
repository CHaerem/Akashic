/**
 * Media tab for viewing and uploading journey photos and videos
 * Allows family members to collaboratively add media to journeys
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

// Hook to track responsive column count
function useColumnCount(containerRef: React.RefObject<HTMLDivElement | null>) {
    const [columns, setColumns] = useState(2);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateColumns = () => {
            const width = container.offsetWidth;
            // Match Tailwind breakpoints: grid-cols-2 sm:grid-cols-3 lg:grid-cols-4
            if (width >= 1024) setColumns(4);       // lg
            else if (width >= 640) setColumns(3);  // sm
            else setColumns(2);                     // default
        };

        updateColumns();

        const resizeObserver = new ResizeObserver(updateColumns);
        resizeObserver.observe(container);

        return () => resizeObserver.disconnect();
    }, [containerRef]);

    return columns;
}

// Play icon SVG component for video thumbnails
function PlayIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

// Memoized photo grid item to prevent re-renders when selection/drag state changes
interface PhotoGridItemProps {
    photo: Photo;
    index: number;
    editMode: boolean;
    isDragOver: boolean;
    isDragged: boolean;
    stagger?: boolean; // Offset down for zigzag effect
    getMediaUrl: (path: string) => string;
    onPhotoClick: (index: number) => void;
    onDragStart: (index: number) => void;
    onDragOver: (e: React.DragEvent, index: number) => void;
    onDragLeave: () => void;
    onDrop: (index: number) => void;
    onDragEnd: () => void;
    onEditPhoto: (photo: Photo) => void;
}

const PhotoGridItem = memo(function PhotoGridItem({
    photo,
    index,
    editMode,
    isDragOver,
    isDragged,
    stagger = false,
    getMediaUrl,
    onPhotoClick,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    onEditPhoto,
}: PhotoGridItemProps) {
    const isVideo = photo.media_type === 'video';
    const mediaLabel = isVideo ? 'Video' : 'Photo';
    const label = photo.caption
        ? `${mediaLabel} ${index + 1}: ${photo.caption}${photo.is_hero ? ' (hero image)' : ''}`
        : `${mediaLabel} ${index + 1}${photo.is_hero ? ' (hero image)' : ''}`;

    return (
        <div
            onClick={() => onPhotoClick(index)}
            draggable={editMode}
            onDragStart={() => editMode && onDragStart(index)}
            onDragOver={(e) => editMode && onDragOver(e, index)}
            onDragLeave={() => editMode && onDragLeave()}
            onDrop={() => editMode && onDrop(index)}
            onDragEnd={() => editMode && onDragEnd()}
            role="button"
            tabIndex={0}
            aria-label={editMode ? `${label}. Drag to reorder.` : label}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPhotoClick(index);
                }
            }}
            className={cn(
                "aspect-square rounded-lg overflow-hidden relative bg-white/5 light:bg-black/5 group",
                "transition-all duration-150",
                editMode ? "cursor-grab" : "cursor-pointer",
                photo.is_hero && "ring-2 ring-amber-400",
                isDragOver && "ring-2 ring-blue-500 scale-[1.02]",
                isDragged && "opacity-50",
                stagger && "mt-4" // Zigzag offset for even columns
            )}
        >
            <img
                src={getMediaUrl(photo.thumbnail_url || photo.url)}
                alt={photo.caption || (isVideo ? 'Journey video' : 'Journey photo')}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                fetchPriority={photo.is_hero ? 'high' : undefined}
                style={photo.rotation ? { transform: `rotate(${photo.rotation}deg)` } : undefined}
            />

            {/* Video play icon overlay */}
            {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                        <PlayIcon className="w-6 h-6 text-white ml-0.5" />
                    </div>
                </div>
            )}

            {/* Hero badge */}
            {photo.is_hero && (
                <div className="absolute top-1.5 left-1.5 bg-amber-400 text-black text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide">
                    Hero
                </div>
            )}

            {/* Edit button in edit mode - subtle icon */}
            {editMode && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onEditPhoto(photo);
                    }}
                    className="absolute top-1.5 right-1.5 w-7 h-7 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white/80 cursor-pointer hover:bg-black/60 hover:text-white transition-colors z-10"
                    aria-label="Edit photo"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
            )}

            {/* Location indicator */}
            {photo.coordinates && !isVideo && (
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
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-5 pb-2 text-[11px] text-white/90 z-10">
                    {photo.caption}
                </div>
            )}
        </div>
    );
});

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
    const gridContainerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const { getMediaUrl, loading: tokenLoading } = useMedia();

    // Track responsive column count for virtualization
    const columns = useColumnCount(gridContainerRef);

    // Use shared photo-day matching hook
    const { photosByDay } = usePhotoDay(trekData, photos);

    // Filter photos based on selected day
    const filteredPhotos = useMemo(() => {
        if (dayFilter === 'all') return photos;
        return photosByDay[dayFilter] || [];
    }, [photos, photosByDay, dayFilter]);

    // Calculate rows for virtualization
    const rowCount = useMemo(() =>
        Math.ceil(filteredPhotos.length / columns),
        [filteredPhotos.length, columns]
    );

    // Virtual row size: square aspect ratio + row gap
    // Estimate based on container width / columns
    const getRowHeight = useCallback(() => {
        const container = gridContainerRef.current;
        if (!container) return 166; // fallback
        const horizontalGap = 16; // gap-x-4 = 16px
        const rowGap = 16; // pb-4 = 16px
        const itemWidth = (container.offsetWidth - horizontalGap * (columns - 1)) / columns;
        return itemWidth + rowGap; // square photo + gap to next row
    }, [columns]);

    // Set up virtualizer for rows
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollContainerRef.current,
        estimateSize: getRowHeight,
        overscan: 2, // Render 2 extra rows above/below viewport
    });

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

            {/* Photo grid - virtualized for performance */}
            {filteredPhotos.length > 0 && (
                <div ref={gridContainerRef}>
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-white/90 light:text-slate-900 text-sm font-medium m-0 uppercase tracking-[0.1em]">
                            {dayFilter === 'all'
                                ? `Journey Media (${photos.length})`
                                : dayFilter === ('unassigned' as unknown as number)
                                    ? `Unassigned Media (${filteredPhotos.length})`
                                    : `Day ${dayFilter} Media (${filteredPhotos.length})`
                            }
                        </h3>
                        {editMode && filteredPhotos.length > 1 && (
                            <span className="text-[11px] text-white/40 light:text-slate-400">
                                Drag to reorder
                            </span>
                        )}
                    </div>

                    {/* Virtualized grid - only renders visible rows */}
                    <div
                        ref={scrollContainerRef}
                        className="max-h-[70vh] overflow-y-auto overflow-x-hidden scrollbar-thin"
                    >
                        <div
                            style={{
                                height: `${rowVirtualizer.getTotalSize()}px`,
                                width: '100%',
                                position: 'relative',
                            }}
                        >
                            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                const rowStartIndex = virtualRow.index * columns;
                                const rowPhotos = filteredPhotos.slice(
                                    rowStartIndex,
                                    rowStartIndex + columns
                                );

                                return (
                                    <div
                                        key={virtualRow.key}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: `${virtualRow.size}px`,
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                    >
                                        <div className={cn(
                                            "grid gap-4",
                                            "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                                        )}>
                                            {rowPhotos.map((photo, colIndex) => {
                                                const index = rowStartIndex + colIndex;
                                                return (
                                                    <PhotoGridItem
                                                        key={photo.id}
                                                        photo={photo}
                                                        index={index}
                                                        editMode={editMode}
                                                        isDragOver={dragOverIndex === index}
                                                        isDragged={draggedIndex === index}
                                                        getMediaUrl={getMediaUrl}
                                                        onPhotoClick={handlePhotoClick}
                                                        onDragStart={handleDragStart}
                                                        onDragOver={handleDragOver}
                                                        onDragLeave={handleDragLeave}
                                                        onDrop={handleDrop}
                                                        onDragEnd={handleDragEnd}
                                                        onEditPhoto={handleEditPhoto}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
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
            {/* Key prop forces remount when clicking different photo, ensuring correct initial index */}
            <PhotoLightbox
                key={lightboxIndex !== null ? `lightbox-${lightboxIndex}` : 'lightbox-closed'}
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
                    onDelete={editMode ? (photoId) => {
                        setPhotos(prev => prev.filter(p => p.id !== photoId));
                        setEditingPhoto(null);
                    } : undefined}
                    getMediaUrl={getMediaUrl}
                    isMobile={isMobile}
                />
            )}
        </div>
    );
}
