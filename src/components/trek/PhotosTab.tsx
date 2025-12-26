/**
 * Media tab for viewing and uploading journey photos and videos
 * Allows family members to collaboratively add media to journeys
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { TrekData, Photo, Camp, MediaType } from '../../types/trek';
import type { UploadResult } from '../../lib/media';
import { useMedia } from '../../hooks/useMedia';
import { usePhotoDay } from '../../hooks/usePhotoDay';
import { fetchPhotos, createPhoto, deletePhoto, getJourneyIdBySlug, updatePhoto } from '../../lib/journeys';
import { PhotoUpload } from './PhotoUpload';
import { UnifiedPhotoViewer } from '../common/UnifiedPhotoViewer';
import { PhotoEditModal } from './PhotoEditModal';
import { SkeletonPhotoGrid } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type DayFilter = 'all' | 'unassigned' | number; // 'all', 'unassigned', or a day number
type MediaTypeFilter = 'all' | MediaType;
type MapBounds = mapboxgl.LngLatBoundsLike | null;

// Pagination settings
const PHOTOS_PER_PAGE = 24; // Show 24 photos at a time (6 rows of 4)

function toLngLatTuple(value: unknown): [number, number] | null {
    if (!value) return null;
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        return [value[0], value[1]];
    }
    if (typeof value === 'object' && value !== null && 'lng' in value && 'lat' in value) {
        const lng = (value as { lng: unknown }).lng;
        const lat = (value as { lat: unknown }).lat;
        if (typeof lng === 'number' && typeof lat === 'number') return [lng, lat];
    }
    return null;
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
                "transition-all duration-150 m-2", // margin for iOS Safari gap compatibility
                editMode ? "cursor-grab" : "cursor-pointer",
                photo.is_hero && "ring-2 ring-amber-400",
                isDragOver && "ring-2 ring-blue-500 scale-[1.02]",
                isDragged && "opacity-50"
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
    mapViewportBounds?: MapBounds;
    mapViewportPhotoIds?: string[] | null;
}

export function PhotosTab({ trekData, isMobile, editMode = false, onViewPhotoOnMap, mapViewportBounds = null, mapViewportPhotoIds = null }: PhotosTabProps) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [journeyDbId, setJourneyDbId] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [editingPhoto, setEditingPhoto] = useState<Photo | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>('all');
    const [visibleCount, setVisibleCount] = useState(PHOTOS_PER_PAGE);
    const dragTimeoutRef = useRef<number | null>(null);
    const gridContainerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const { getMediaUrl, loading: tokenLoading } = useMedia();

    const mapViewportPhotoIdSet = useMemo(() => {
        if (!mapViewportPhotoIds) return null;
        return new Set(mapViewportPhotoIds);
    }, [mapViewportPhotoIds]);

    // Use shared photo-day matching hook
    const { photosByDay } = usePhotoDay(trekData, photos);

    const dayScopedPhotos = useMemo(() => {
        if (dayFilter === 'all') return photos;
        if (dayFilter === 'unassigned') return photosByDay.unassigned || [];
        return photosByDay[dayFilter] || [];
    }, [dayFilter, photos, photosByDay]);

    const sortPhotos = useCallback((list: Photo[]): Photo[] => {
        const withIndex = list.map((photo, index) => ({ photo, index }));

        // Always use journey order (respects manual reordering from edit mode)
        return withIndex
            .sort((a, b) => {
                const orderA = a.photo.sort_order ?? a.index;
                const orderB = b.photo.sort_order ?? b.index;
                return orderA - orderB;
            })
            .map(item => item.photo);
    }, []);

    const isWithinBounds = useCallback((coords: number[] | null | undefined, bounds: MapBounds) => {
        if (!coords || coords.length !== 2 || !bounds) return false;

        const [lng, lat] = coords;
        const isLngInRange = (west: number, east: number) => {
            if (west <= east) return lng >= west && lng <= east;
            // Crossing antimeridian
            return lng >= west || lng <= east;
        };

        if (Array.isArray(bounds) && bounds.length === 2) {
            const sw = toLngLatTuple(bounds[0]);
            const ne = toLngLatTuple(bounds[1]);
            if (!sw || !ne) return false;

            const [west, south] = sw;
            const [east, north] = ne;
            return isLngInRange(west, east) && lat >= south && lat <= north;
        }

        const boundsObj = bounds as mapboxgl.LngLatBounds;
        if (typeof boundsObj.getWest === 'function') {
            return isLngInRange(boundsObj.getWest(), boundsObj.getEast())
                && lat >= boundsObj.getSouth()
                && lat <= boundsObj.getNorth();
        }

        return false;
    }, []);

    // Filter photos based on selected day and media type
    const filteredPhotos = useMemo(() => {
        const filtered = dayScopedPhotos.filter(photo => {
            // 1. Media type filter
            const matchesType = mediaTypeFilter === 'all'
                ? true
                : (photo.media_type || 'image') === mediaTypeFilter;

            // 2. Map viewport filter (automatic when map is open with photos)
            const matchesMap = !mapViewportBounds
                ? true
                : mapViewportPhotoIdSet
                    ? mapViewportPhotoIdSet.has(photo.id)
                    : isWithinBounds(photo.coordinates, mapViewportBounds);

            return matchesType && matchesMap;
        });

        return sortPhotos(filtered);
    }, [dayScopedPhotos, isWithinBounds, mapViewportBounds, mapViewportPhotoIdSet, mediaTypeFilter, sortPhotos]);

    // All photos sorted (for sequential mode)
    const sortedPhotos = useMemo(() => {
        return sortPhotos(photos);
    }, [photos, sortPhotos]);

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(PHOTOS_PER_PAGE);
    }, [dayFilter, mediaTypeFilter]);

    // Paginated photos for rendering (limits DOM elements for performance)
    const visiblePhotos = useMemo(() => {
        return filteredPhotos.slice(0, visibleCount);
    }, [filteredPhotos, visibleCount]);

    const hasMorePhotos = visibleCount < filteredPhotos.length;

    const loadMorePhotos = useCallback(() => {
        setVisibleCount(prev => Math.min(prev + PHOTOS_PER_PAGE, filteredPhotos.length));
    }, [filteredPhotos.length]);

    // Get counts for each day
    const dayCounts = useMemo(() => {
        const counts: Record<string, number> = {
            all: photos.length,
            unassigned: photosByDay.unassigned?.length || 0,
        };
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

    const baseCount = dayScopedPhotos.length;
    const countLabel = filteredPhotos.length === baseCount
        ? `${filteredPhotos.length}`
        : `${filteredPhotos.length} of ${baseCount}`;

    const hasNonDefaultView = dayFilter !== 'all' || mediaTypeFilter !== 'all';

    const filterSummary = useMemo(() => {
        if (!hasNonDefaultView) return null;

        const parts: string[] = [];

        if (mediaTypeFilter !== 'all') {
            parts.push(mediaTypeFilter === 'image' ? 'Photos' : 'Videos');
        }

        if (dayFilter !== 'all') {
            parts.push(dayFilter === 'unassigned' ? 'Unassigned' : `Day ${dayFilter}`);
        }

        parts.push(`Showing ${countLabel}`);
        return parts.join(' • ');
    }, [countLabel, dayFilter, hasNonDefaultView, mediaTypeFilter]);

    const dayTabClasses = useMemo(() => {
        const base = "flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all";
        const allBase = "border border-white/10 bg-white/[0.03] text-white/70 light:border-black/10 light:bg-black/[0.02] light:text-slate-700";
        const dayBase = "border border-white/10 bg-white/[0.02] text-white/60 light:border-black/10 light:bg-black/[0.02] light:text-slate-600";
        const activeBlue = "border-white/30 text-white/90 shadow-[0_12px_40px_-18px_rgba(59,130,246,0.8)] light:border-black/30";
        const unassignedBase = "border border-white/10 bg-amber-400/5 text-amber-200 light:border-amber-500/30 light:text-amber-700";
        const activeAmber = "border-amber-300/60 text-amber-50 shadow-[0_10px_30px_-18px_rgba(251,191,36,0.9)]";

        return {
            base,
            all: (active: boolean) => cn(base, allBase, active && activeBlue),
            day: (active: boolean, hasMedia: boolean) => cn(
                base,
                "whitespace-nowrap",
                dayBase,
                active && activeBlue,
                !hasMedia && "opacity-40"
            ),
            unassigned: (active: boolean, hasAny: boolean) => cn(
                base,
                unassignedBase,
                active && activeAmber,
                !hasAny && "opacity-40"
            ),
        };
    }, []);

    const resetView = useCallback(() => {
        setDayFilter('all');
        setMediaTypeFilter('all');
    }, []);

    const topControls = (
        <>
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

            {/* Day filter tabs and media filters */}
            <div className="mb-5 space-y-3">
                {(trekData.camps.length > 0 || dayCounts.unassigned > 0 || dayFilter === 'unassigned') && (
                    <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
                        {/* All photos tab */}
                        <button
                            onClick={() => setDayFilter('all')}
                            className={dayTabClasses.all(dayFilter === 'all')}
                        >
                            All ({dayCounts.all})
                        </button>

                        {/* Day tabs */}
                        {trekData.camps.map((camp: Camp) => {
                            const count = dayCounts[camp.dayNumber] || 0;
                            const hasMedia = count > 0;
                            return (
                                <button
                                    key={camp.dayNumber}
                                    onClick={() => setDayFilter(camp.dayNumber)}
                                    className={dayTabClasses.day(dayFilter === camp.dayNumber, hasMedia)}
                                >
                                    Day {camp.dayNumber} {hasMedia && `(${count})`}
                                </button>
                            );
                        })}

                        {/* Unassigned tab - keep visible if selected */}
                        {(dayCounts.unassigned > 0 || dayFilter === 'unassigned') && (
                            <button
                                onClick={() => setDayFilter('unassigned')}
                                className={dayTabClasses.unassigned(dayFilter === 'unassigned', dayCounts.unassigned > 0)}
                            >
                                Unassigned ({dayCounts.unassigned})
                            </button>
                        )}
                    </div>
                )}

                    {/* Media type filter - Simplified calm design */}
                    <div className="flex justify-center gap-1.5 py-3">
                        <button
                            type="button"
                            onClick={() => setMediaTypeFilter('all')}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '12px',
                                border: `1px solid ${mediaTypeFilter === 'all' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                background: mediaTypeFilter === 'all' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
                                color: mediaTypeFilter === 'all' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
                                fontSize: '13px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: mediaTypeFilter === 'all' ? '0 10px 30px -18px rgba(139,92,246,0.7)' : 'none',
                            }}
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={() => setMediaTypeFilter('image')}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '12px',
                                border: `1px solid ${mediaTypeFilter === 'image' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                background: mediaTypeFilter === 'image' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
                                color: mediaTypeFilter === 'image' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
                                fontSize: '13px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: mediaTypeFilter === 'image' ? '0 10px 30px -18px rgba(139,92,246,0.7)' : 'none',
                            }}
                        >
                            Photos
                        </button>
                        <button
                            type="button"
                            onClick={() => setMediaTypeFilter('video')}
                            style={{
                                padding: '8px 16px',
                                borderRadius: '12px',
                                border: `1px solid ${mediaTypeFilter === 'video' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                                background: mediaTypeFilter === 'video' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.02)',
                                color: mediaTypeFilter === 'video' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)',
                                fontSize: '13px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: mediaTypeFilter === 'video' ? '0 10px 30px -18px rgba(139,92,246,0.7)' : 'none',
                            }}
                        >
                            Videos
                        </button>
                    </div>
            </div>
        </>
    );

    if (loading || tokenLoading) {
        return (
            <div>
                {topControls}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
                    </div>
                    <SkeletonPhotoGrid count={6} columns={3} />
                </div>
            </div>
        );
    }

    return (
        <div>
            {topControls}

            <div ref={gridContainerRef}>
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <h3 className="text-white/90 light:text-slate-900 text-sm font-medium m-0 uppercase tracking-[0.1em]">
                            {dayFilter === 'all'
                                ? `Journey Media (${countLabel})`
                                : dayFilter === 'unassigned'
                                    ? `Unassigned Media (${countLabel})`
                                    : `Day ${dayFilter} Media (${countLabel})`
                            }
                        </h3>
                        {filterSummary && (
                            <p className="m-0 mt-1 text-[11px] text-white/50 light:text-slate-500">
                                {filterSummary}
                            </p>
                        )}
                    </div>
                    {editMode && filteredPhotos.length > 1 && (
                        <span className="text-[11px] text-white/40 light:text-slate-400">
                            Drag to reorder
                        </span>
                    )}
                </div>

                {filteredPhotos.length > 0 && (
                    <div
                        ref={scrollContainerRef}
                        className="max-h-[70vh] overflow-y-auto overflow-x-hidden scrollbar-thin"
                    >
                        <div className={cn(
                            "grid",
                            "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
                            "-m-2" // Negative margin to offset item padding
                        )}>
                            {visiblePhotos.map((photo, index) => (
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
                            ))}
                        </div>

                        {/* Load more button */}
                        {hasMorePhotos && (
                            <div className="flex justify-center pt-6 pb-2">
                                <button
                                    type="button"
                                    onClick={loadMorePhotos}
                                    className={cn(
                                        "px-6 py-2.5 rounded-full text-sm font-medium transition-all",
                                        "border border-white/20 bg-white/[0.05] text-white/80",
                                        "hover:bg-white/[0.10] hover:text-white hover:border-white/30",
                                        "light:border-black/15 light:bg-black/[0.03] light:text-slate-700",
                                        "light:hover:bg-black/[0.06] light:hover:text-slate-900"
                                    )}
                                >
                                    Load more ({filteredPhotos.length - visibleCount} remaining)
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Empty state for filtered views */}
            {photos.length > 0 && filteredPhotos.length === 0 && (
                <div className="text-center py-10 text-white/40 light:text-slate-400">
                    <p className="m-0 mb-2">
                        {mapViewportBounds
                            ? 'No media in this map view yet'
                            : dayFilter === 'unassigned'
                                ? 'No unassigned media'
                                : dayFilter !== 'all'
                                    ? `No media for Day ${dayFilter}`
                                    : 'Nothing matches these filters'
                        }
                    </p>
                    <p className="m-0 text-xs">
                        {mapViewportBounds
                            ? 'Pan or zoom the map to explore nearby uploads.'
                            : 'Adjust the filters or add new uploads to fill this space.'
                        }
                    </p>
                    {hasNonDefaultView && (
                        <button
                            type="button"
                            onClick={resetView}
                            className={cn(
                                "mt-4 inline-flex items-center rounded-lg px-3 py-2 text-xs font-medium transition-all",
                                "border border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.06] hover:text-white/90",
                                "light:border-black/10 light:bg-black/[0.02] light:text-slate-700 light:hover:bg-black/[0.05] light:hover:text-slate-900"
                            )}
                        >
                            Clear filters
                        </button>
                    )}
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

            {/* Unified Photo Viewer - always sequential mode for immersive journey walkthrough */}
            {/* Key prop forces remount when clicking different photo, ensuring correct initial index */}
            <UnifiedPhotoViewer
                key={lightboxIndex !== null ? `viewer-${lightboxIndex}` : 'viewer-closed'}
                photos={sortedPhotos}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                getMediaUrl={getMediaUrl}
                trekData={trekData}
                mode="sequential"
                initialDay={typeof dayFilter === 'number' ? dayFilter : 1}
                enableDayNavigation={true}
                showDayProgress={true}
                showCampInfo={true}
                editMode={editMode}
                onViewOnMap={onViewPhotoOnMap}
                onDelete={editMode ? handleDeletePhoto : undefined}
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
