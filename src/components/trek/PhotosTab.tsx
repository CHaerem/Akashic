/**
 * Media tab for browsing journey photos and videos.
 *
 * Read-only. Uploading, reordering, captioning and deleting all ran through stubbed
 * CloudKit writes that returned `false`, and this tab updated its own state anyway — so a
 * reorder looked saved until the next fetch put it back (LEG-07). Adding media is
 * native-only; edit mode shows a `NativeOnlyNotice` here instead.
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { TrekData, Photo, Camp, MediaType } from '../../types/trek';
import { useMedia } from '../../hooks/useMedia';
import { usePhotoDay } from '../../hooks/usePhotoDay';
import { fetchPhotos, getJourneyIdBySlug } from '../../lib/journeys';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { NativeOnlyNotice } from '../common/NativeOnlyNotice';
import { SkeletonPhotoGrid } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type DayFilter = 'all' | 'unassigned' | number; // 'all', 'unassigned', or a day number
type MediaTypeFilter = 'all' | MediaType;
type LocationFilter = 'any' | 'geotagged';
type SortOrder = 'journey' | 'captured';
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
    getMediaUrl: (path: string) => string;
    onPhotoClick: (index: number) => void;
}

const PhotoGridItem = memo(function PhotoGridItem({
    photo,
    index,
    getMediaUrl,
    onPhotoClick,
}: PhotoGridItemProps) {
    const isVideo = photo.media_type === 'video';
    const mediaLabel = isVideo ? 'Video' : 'Photo';
    const label = photo.caption
        ? `${mediaLabel} ${index + 1}: ${photo.caption}${photo.is_hero ? ' (hero image)' : ''}`
        : `${mediaLabel} ${index + 1}${photo.is_hero ? ' (hero image)' : ''}`;

    return (
        <div
            onClick={() => onPhotoClick(index)}
            role="button"
            tabIndex={0}
            aria-label={label}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPhotoClick(index);
                }
            }}
            className={cn(
                "aspect-square rounded-lg overflow-hidden relative bg-white/5 light:bg-black/5 group",
                "transition-all duration-150 m-2", // margin for iOS Safari gap compatibility
                "cursor-pointer",
                photo.is_hero && "ring-2 ring-amber-400"
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
    /**
     * Unused since the edit affordances went away (LEG-07); the grid is responsive by
     * breakpoint. Kept so the two call sites in `BottomSheetContent` need no change.
     */
    isMobile?: boolean;
    /**
     * True when a signed-in family member has edit mode on. Used only to explain that
     * media is added in the app — this tab offers no writes (LEG-07).
     */
    editMode?: boolean;
    onViewPhotoOnMap?: (photo: Photo) => void;
    mapViewportBounds?: MapBounds;
    mapViewportPhotoIds?: string[] | null;
}

export function PhotosTab({ trekData, editMode = false, onViewPhotoOnMap, mapViewportBounds = null, mapViewportPhotoIds = null }: PhotosTabProps) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [journeyDbId, setJourneyDbId] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [dayFilter, setDayFilter] = useState<DayFilter>('all');
    const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>('all');
    const [locationFilter, setLocationFilter] = useState<LocationFilter>('any');
    const [sortOrder, setSortOrder] = useState<SortOrder>('journey');
    const [searchQuery, setSearchQuery] = useState('');
    const [mapScopeEnabled, setMapScopeEnabled] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PHOTOS_PER_PAGE);
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

        if (sortOrder === 'journey') {
            return withIndex
                .sort((a, b) => {
                    const orderA = a.photo.sort_order ?? a.index;
                    const orderB = b.photo.sort_order ?? b.index;
                    return orderA - orderB;
                })
                .map(item => item.photo);
        }

        const getTimestamp = (photo: Photo) => {
            const dateStr = photo.taken_at || photo.created_at;
            return dateStr ? new Date(dateStr).getTime() : 0;
        };

        return withIndex
            .sort((a, b) => {
                const timeDiff = getTimestamp(a.photo) - getTimestamp(b.photo);
                if (timeDiff !== 0) return timeDiff;
                const orderA = a.photo.sort_order ?? a.index;
                const orderB = b.photo.sort_order ?? b.index;
                return orderA - orderB;
            })
            .map(item => item.photo);
    }, [sortOrder]);

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

    // Filter photos based on selected day and other filters
    const filteredPhotos = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        const filtered = dayScopedPhotos.filter(photo => {
            const matchesType = mediaTypeFilter === 'all'
                ? true
                : (photo.media_type || 'image') === mediaTypeFilter;

            const matchesLocation = locationFilter === 'any'
                ? true
                : Boolean(photo.coordinates && photo.coordinates.length === 2);

            const matchesSearch = query.length === 0
                ? true
                : (photo.caption || '').toLowerCase().includes(query);

            const matchesMap = !mapScopeEnabled || !mapViewportBounds
                ? true
                : mapViewportPhotoIdSet
                    ? mapViewportPhotoIdSet.has(photo.id)
                    : isWithinBounds(photo.coordinates, mapViewportBounds);

            return matchesType && matchesLocation && matchesSearch && matchesMap;
        });

        return sortPhotos(filtered);
    }, [dayScopedPhotos, isWithinBounds, locationFilter, mapScopeEnabled, mapViewportBounds, mapViewportPhotoIdSet, mediaTypeFilter, searchQuery, sortPhotos]);

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(PHOTOS_PER_PAGE);
    }, [dayFilter, mediaTypeFilter, locationFilter, sortOrder, searchQuery, mapScopeEnabled]);

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

    const handlePhotoClick = useCallback((index: number) => {
        setLightboxIndex(index);
    }, []);

    const closeLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    const baseCount = dayScopedPhotos.length;
    const countLabel = filteredPhotos.length === baseCount
        ? `${filteredPhotos.length}`
        : `${filteredPhotos.length} of ${baseCount}`;

    const trimmedSearchQuery = searchQuery.trim();

    const hasActiveFilters = mediaTypeFilter !== 'all'
        || locationFilter !== 'any'
        || trimmedSearchQuery.length > 0
        || sortOrder === 'captured'
        || mapScopeEnabled;

    const hasNonDefaultView = dayFilter !== 'all' || hasActiveFilters;

    const filterSummary = useMemo(() => {
        const parts: string[] = [
            mapScopeEnabled ? 'In current map view' : '',
            mediaTypeFilter !== 'all' ? (mediaTypeFilter === 'image' ? 'Photos' : 'Videos') : '',
            locationFilter === 'geotagged' ? 'Map-ready only' : '',
            sortOrder === 'captured' ? 'Captured timeline' : '',
            trimmedSearchQuery.length > 0 ? `Search: “${trimmedSearchQuery}”` : '',
        ].filter(Boolean);

        if (parts.length === 0) return null;

        parts.push(`Showing ${countLabel}`);
        return parts.join(' • ');
    }, [countLabel, locationFilter, mapScopeEnabled, mediaTypeFilter, sortOrder, trimmedSearchQuery]);

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

    const filterPillClasses = useMemo(() => {
        const base = "px-2.5 py-1 rounded-full text-xs font-medium transition-all";
        const inactive = "border border-white/10 bg-white/[0.02] text-white/65 light:border-black/10 light:text-slate-600";
        const activeBase = "border-white/30 bg-white/10 text-white/90";

        const activeWithShadow = (shadow: string) => cn(activeBase, shadow);

        return {
            base,
            inactive,
            activeWithShadow,
        };
    }, []);

    const resetView = useCallback(() => {
        setDayFilter('all');
        setMediaTypeFilter('all');
        setLocationFilter('any');
        setSortOrder('journey');
        setSearchQuery('');
        setMapScopeEnabled(false);
    }, []);

    const topControls = (
        <>
            {/* Error message */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-300 text-[13px]">
                    {error}
                </div>
            )}

            {/* Where the uploader used to be. It threw on every file; the record it would
                have created was a stubbed write anyway. */}
            {editMode && (
                <NativeOnlyNotice
                    what="Adding, captioning, reordering and deleting media"
                    className="mb-6"
                />
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

                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 light:border-black/10 light:bg-black/[0.02]">
                        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60 light:text-slate-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-white/40 shadow-[0_0_0_4px_rgba(255,255,255,0.04)]" />
                            Filters
                        </div>
                        {hasNonDefaultView && (
                            <button
                                type="button"
                                onClick={resetView}
                                className={cn(
                                    "px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] transition-all",
                                    "border border-white/10 bg-white/[0.02] text-white/55 hover:text-white/85 hover:border-white/20 hover:bg-white/[0.04]",
                                    "light:border-black/10 light:text-slate-600 light:hover:text-slate-900 light:hover:border-black/20"
                                )}
                                aria-label="Reset filters"
                            >
                                Reset
                            </button>
                        )}

                        <div className="flex gap-1.5">
                            <button
                                type="button"
                                onClick={() => setMediaTypeFilter('all')}
                                className={cn(
                                    filterPillClasses.base,
                                    filterPillClasses.inactive,
                                    mediaTypeFilter === 'all' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(59,130,246,0.8)]")
                                )}
                            >
                                All media
                            </button>
                            <button
                                type="button"
                                onClick={() => setMediaTypeFilter('image')}
                                className={cn(
                                    filterPillClasses.base,
                                    filterPillClasses.inactive,
                                    mediaTypeFilter === 'image' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(59,130,246,0.8)]")
                                )}
                            >
                                Photos
                            </button>
                            <button
                                type="button"
                                onClick={() => setMediaTypeFilter('video')}
                                className={cn(
                                    filterPillClasses.base,
                                    filterPillClasses.inactive,
                                    mediaTypeFilter === 'video' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(59,130,246,0.8)]")
                                )}
                            >
                                Videos
                            </button>
                        </div>

                    <div className="h-6 w-px bg-white/10 light:bg-black/10" />

                    <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-white/50 light:text-slate-600">
                        Location
                    </div>
                        <div className="flex gap-1.5">
                            <button
                                type="button"
                                onClick={() => setLocationFilter('any')}
                                className={cn(
                                    filterPillClasses.base,
                                    filterPillClasses.inactive,
                                    locationFilter === 'any' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(52,211,153,0.7)]")
                                )}
                            >
                                All
                            </button>
                            <button
                                type="button"
                                onClick={() => setLocationFilter('geotagged')}
                                className={cn(
                                    filterPillClasses.base,
                                    filterPillClasses.inactive,
                                    locationFilter === 'geotagged' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(52,211,153,0.7)]")
                                )}
                            >
                                Map-ready
                            </button>
                        </div>

                    <div className="h-6 w-px bg-white/10 light:bg-black/10" />

                    <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-white/50 light:text-slate-600">
                        Map
                    </div>
                    <button
                        type="button"
                        disabled={!mapViewportBounds}
                        onClick={() => mapViewportBounds && setMapScopeEnabled(prev => !prev)}
                        aria-pressed={mapScopeEnabled}
                        title={!mapViewportBounds ? 'Open the map to enable map filtering' : undefined}
                        className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1",
                            "border border-white/10 bg-white/[0.02] text-white/65 light:border-black/10 light:text-slate-600",
                            mapScopeEnabled && "border-white/30 bg-white/10 text-white/90 shadow-[0_10px_30px_-18px_rgba(96,165,250,0.8)]",
                            !mapViewportBounds && "opacity-40 cursor-not-allowed"
                        )}
                    >
                        <span
                            className={cn(
                                "inline-flex h-2 w-2 rounded-full",
                                mapScopeEnabled ? "bg-blue-300/70" : "bg-white/25",
                                !mapViewportBounds && "bg-white/15"
                            )}
                            aria-hidden
                        />
                        {mapViewportBounds ? 'Follow map view' : 'Open map to enable'}
                    </button>

                    <div className="h-6 w-px bg-white/10 light:bg-black/10" />

                    <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] text-white/50 light:text-slate-600">
                        Order
                    </div>
                    <div className="flex gap-1.5">
                        <button
                            type="button"
                            onClick={() => setSortOrder('journey')}
                            className={cn(
                                filterPillClasses.base,
                                filterPillClasses.inactive,
                                sortOrder === 'journey' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(167,139,250,0.8)]")
                            )}
                        >
                            Curated
                        </button>
                        <button
                            type="button"
                            onClick={() => setSortOrder('captured')}
                            className={cn(
                                filterPillClasses.base,
                                filterPillClasses.inactive,
                                sortOrder === 'captured' && filterPillClasses.activeWithShadow("shadow-[0_10px_30px_-18px_rgba(167,139,250,0.8)]")
                            )}
                        >
                            Captured timeline
                        </button>
                    </div>

                    <div className="ml-auto flex-1 min-w-[200px]">
                        <label className="sr-only" htmlFor="media-search">Search media</label>
                        <div className="relative">
                            <input
                                id="media-search"
                                type="search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search captions"
                                className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 light:bg-white light:text-slate-900 light:placeholder:text-slate-400 light:border-black/10"
                            />
                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] uppercase tracking-[0.08em] text-white/30 light:text-slate-400">Find</span>
                        </div>
                    </div>
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
                                    getMediaUrl={getMediaUrl}
                                    onPhotoClick={handlePhotoClick}
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
                        {mapScopeEnabled && mapViewportBounds
                            ? 'No media in this map view yet'
                            : dayFilter === 'unassigned'
                                ? 'No unassigned media'
                                : dayFilter !== 'all'
                                    ? `No media for Day ${dayFilter}`
                                    : 'Nothing matches these filters'
                        }
                    </p>
                    <p className="m-0 text-xs">
                        {mapScopeEnabled && mapViewportBounds
                            ? 'Pan or zoom the map to explore nearby media.'
                            : 'Adjust the filters to widen what is shown.'
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
                        Photos added in the Akashic app for iPhone show up here.
                    </p>
                </div>
            )}

            {/* Lightbox - uses filtered photos for navigation within selected day.
                No onEdit/onDelete: both were stubbed writes, so the lightbox keeps only
                viewing and "show on map". */}
            {/* Key prop forces remount when clicking different photo, ensuring correct initial index */}
            <PhotoLightbox
                key={lightboxIndex !== null ? `lightbox-${lightboxIndex}` : 'lightbox-closed'}
                photos={filteredPhotos}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                getMediaUrl={getMediaUrl}
                onViewOnMap={onViewPhotoOnMap}
                journeySlug={trekData.id}
            />
        </div>
    );
}
