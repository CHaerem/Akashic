import { memo, useCallback, useMemo, useState } from 'react';
import type { TrekData, Camp, Photo, RouteSegment } from '../../types/trek';
import { WaypointEditModal } from './WaypointEditModal';
import { PhotoAssignModal } from './PhotoAssignModal';
import { RouteEditor } from './RouteEditor';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { calculateAllSegments, getDifficultyColor } from '../../utils/routeUtils';

/**
 * Get the actual date for a specific day number based on journey start date
 */
function getDateForDay(dateStarted: string | undefined, dayNumber: number): Date | null {
    if (!dateStarted) return null;
    const start = new Date(dateStarted);
    start.setDate(start.getDate() + (dayNumber - 1));
    return start;
}

/**
 * Format a date as "Oct 5" style
 */
function formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Check if a photo was taken on a specific date (comparing just the date, not time)
 */
function isPhotoFromDay(photo: Photo, targetDate: Date): boolean {
    if (!photo.taken_at) return false;
    const photoDate = new Date(photo.taken_at);
    return (
        photoDate.getFullYear() === targetDate.getFullYear() &&
        photoDate.getMonth() === targetDate.getMonth() &&
        photoDate.getDate() === targetDate.getDate()
    );
}

interface DayPhotosProps {
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    isMobile: boolean;
    onPhotoClick: (index: number) => void;
}

const DayPhotos = memo(function DayPhotos({ photos, getMediaUrl, isMobile, onPhotoClick }: DayPhotosProps) {
    if (photos.length === 0) {
        return null;
    }

    const maxVisible = isMobile ? 6 : 8;

    return (
        <div className={cn(
            "grid gap-1.5",
            isMobile ? "grid-cols-3" : "grid-cols-4"
        )}>
            {photos.slice(0, maxVisible).map((photo, index) => (
                <div
                    key={photo.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(index);
                    }}
                    className="aspect-square rounded-lg overflow-hidden bg-white/5 light:bg-black/5 cursor-pointer"
                >
                    <img
                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                        alt={photo.caption || 'Journey photo'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                </div>
            ))}
            {photos.length > maxVisible && (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(maxVisible);
                    }}
                    className="aspect-square rounded-lg bg-white/5 light:bg-black/5 flex items-center justify-center text-white/40 light:text-slate-400 text-xs cursor-pointer"
                >
                    +{photos.length - maxVisible}
                </div>
            )}
        </div>
    );
});

/**
 * Segment info component showing details between two camps
 */
interface SegmentInfoProps {
    segment: RouteSegment;
    isMobile?: boolean;
}

const SegmentInfo = memo(function SegmentInfo({ segment, isMobile = false }: SegmentInfoProps) {
    const difficultyColor = getDifficultyColor(segment.difficulty);

    return (
        <div className={cn(
            "py-3 border-y border-white/8 light:border-black/5",
            isMobile ? "-mx-4 px-4" : "-mx-6 px-6"
        )}
            style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, transparent 50%, rgba(255,255,255,0.03) 100%)' }}
        >
            <div className="flex items-center justify-between gap-3">
                {/* Distance & Time */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-white/70 light:text-slate-600 text-xs">
                        <span className="opacity-60">↓</span>
                        <span className="font-medium">{segment.distance} km</span>
                    </div>
                    <div className="w-px h-3 bg-white/10 light:bg-black/10" />
                    <div className="text-white/50 light:text-slate-500 text-[11px]">
                        {segment.estimatedTime}
                    </div>
                </div>

                {/* Elevation changes */}
                <div className="flex items-center gap-2">
                    {segment.elevationGain > 0 && (
                        <span className="text-[11px] text-green-400 font-medium">
                            +{segment.elevationGain}m
                        </span>
                    )}
                    {segment.elevationLoss > 0 && (
                        <span className="text-[11px] text-red-400 font-medium">
                            -{segment.elevationLoss}m
                        </span>
                    )}
                    <div
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
                        style={{
                            background: difficultyColor.replace('0.8', '0.15'),
                            color: difficultyColor
                        }}
                    >
                        {segment.difficulty}
                    </div>
                </div>
            </div>
        </div>
    );
});

interface CampItemProps {
    camp: Camp;
    isSelected: boolean;
    onClick: (camp: Camp) => void;
    onEdit: (camp: Camp) => void;
    onAssignPhotos: (camp: Camp) => void;
    onPhotoClick: (photos: Photo[], index: number) => void;
    isLast: boolean;
    isMobile?: boolean;
    dayDate: Date | null;
    photos: Photo[];
    assignedPhotos: Photo[];
    getMediaUrl: (path: string) => string;
    editMode?: boolean;
}

const CampItem = memo(function CampItem({
    camp,
    isSelected,
    onClick,
    onEdit,
    onAssignPhotos,
    onPhotoClick,
    isLast,
    isMobile = false,
    dayDate,
    photos,
    assignedPhotos,
    getMediaUrl,
    editMode = false
}: CampItemProps) {
    const handleClick = useCallback(() => onClick(camp), [onClick, camp]);
    const handleEdit = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onEdit(camp);
    }, [onEdit, camp]);
    const handleAssignPhotos = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onAssignPhotos(camp);
    }, [onAssignPhotos, camp]);

    // Combine auto-matched photos (by date) with manually assigned photos
    const allPhotos = useMemo(() => {
        const photoIds = new Set<string>();
        const combined: Photo[] = [];

        // Add assigned photos first
        assignedPhotos.forEach(p => {
            if (!photoIds.has(p.id)) {
                photoIds.add(p.id);
                combined.push(p);
            }
        });

        // Add date-matched photos
        photos.forEach(p => {
            if (!photoIds.has(p.id)) {
                photoIds.add(p.id);
                combined.push(p);
            }
        });

        return combined;
    }, [photos, assignedPhotos]);

    const dayLabel = dayDate
        ? `Day ${camp.dayNumber} · ${formatDate(dayDate)}`
        : `Day ${camp.dayNumber}`;

    return (
        <div
            onClick={handleClick}
            className={cn(
                "py-5 cursor-pointer transition-all duration-300 min-h-11",
                !isLast && "border-b border-white/8 light:border-black/5",
                isSelected && "bg-white/5 light:bg-black/3",
                isMobile ? "-mx-4 px-4" : "-mx-6 px-6",
                isSelected && "border-l-3 border-l-blue-500"
            )}
            style={{
                paddingLeft: isSelected ? (isMobile ? 13 : 21) : (isMobile ? 16 : 24),
                boxShadow: isSelected ? 'inset 6px 0 16px -8px rgba(59,130,246,0.3)' : 'none'
            }}
        >
            <div className="flex justify-between mb-1">
                <span className={cn(
                    "text-[10px] tracking-[0.1em] uppercase",
                    isSelected ? "text-blue-400" : "text-white/40 light:text-slate-400"
                )}>
                    {dayLabel}
                </span>
                <span className="text-white/40 light:text-slate-400 text-xs">
                    {camp.elevation}m
                </span>
            </div>
            <div className="flex justify-between items-center">
                <p className={cn(
                    "text-base m-0",
                    isSelected
                        ? "text-white/95 light:text-slate-900 mb-3"
                        : "text-white/70 light:text-slate-600"
                )}>
                    {camp.name}
                </p>
                {!isSelected && allPhotos.length > 0 && (
                    <span className="bg-white/10 light:bg-black/5 px-2 py-0.5 rounded-full text-[10px] text-white/50 light:text-slate-500">
                        {allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {isSelected && (
                <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-400">
                    {/* Action buttons - only show in edit mode */}
                    {editMode && (
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={handleEdit}
                                className="bg-white/10 light:bg-black/5 border border-white/10 light:border-black/5 text-white/70 light:text-slate-600 text-xs px-3 py-2 rounded-lg cursor-pointer min-h-9 hover:bg-white/15 light:hover:bg-black/8 transition-colors"
                            >
                                Edit Day
                            </button>
                            <button
                                onClick={handleAssignPhotos}
                                className="bg-white/10 light:bg-black/5 border border-white/10 light:border-black/5 text-white/70 light:text-slate-600 text-xs px-3 py-2 rounded-lg cursor-pointer min-h-9 hover:bg-white/15 light:hover:bg-black/8 transition-colors"
                            >
                                Assign Photos
                            </button>
                        </div>
                    )}

                    {camp.notes && (
                        <p className="text-white/50 light:text-slate-500 text-sm leading-relaxed mb-4 m-0">
                            {camp.notes}
                        </p>
                    )}
                    {camp.highlights && camp.highlights.length > 0 && (
                        <ul className="mb-5 pl-4 m-0">
                            {camp.highlights.map((highlight, idx) => (
                                <li key={idx} className="text-white/60 light:text-slate-600 text-[13px] mb-1">
                                    {highlight}
                                </li>
                            ))}
                        </ul>
                    )}

                    {allPhotos.length > 0 ? (
                        <DayPhotos
                            photos={allPhotos}
                            getMediaUrl={getMediaUrl}
                            isMobile={isMobile}
                            onPhotoClick={(index) => onPhotoClick(allPhotos, index)}
                        />
                    ) : (
                        <div className={cn(
                            "w-full bg-white/5 light:bg-black/5 border border-dashed border-white/10 light:border-black/10 rounded-lg",
                            "flex items-center justify-center text-white/30 light:text-slate-400 text-[11px] tracking-wide",
                            isMobile ? "h-20" : "h-24"
                        )}>
                            No photos for this day
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

interface JourneyTabProps {
    trekData: TrekData;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    isMobile?: boolean;
    photos?: Photo[];
    getMediaUrl?: (path: string) => string;
    onUpdate?: () => void;
    editMode?: boolean;
    onViewPhotoOnMap?: (photo: Photo) => void;
}

export const JourneyTab = memo(function JourneyTab({
    trekData,
    selectedCamp,
    onCampSelect,
    isMobile = false,
    photos = [],
    getMediaUrl = (path) => path,
    onUpdate,
    editMode = false,
    onViewPhotoOnMap
}: JourneyTabProps) {
    const [editingCamp, setEditingCamp] = useState<Camp | null>(null);
    const [assigningCamp, setAssigningCamp] = useState<Camp | null>(null);
    const [lightboxPhotos, setLightboxPhotos] = useState<Photo[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [showRouteEditor, setShowRouteEditor] = useState(false);

    // Group photos by day (auto-match by date)
    const photosByDay = useMemo(() => {
        const result: Record<number, Photo[]> = {};

        trekData.camps.forEach(camp => {
            const dayDate = getDateForDay(trekData.dateStarted, camp.dayNumber);
            if (dayDate) {
                result[camp.dayNumber] = photos.filter(p => isPhotoFromDay(p, dayDate));
            } else {
                result[camp.dayNumber] = [];
            }
        });

        return result;
    }, [trekData.camps, trekData.dateStarted, photos]);

    // Group photos by waypoint_id (manually assigned)
    const photosByWaypoint = useMemo(() => {
        const result: Record<string, Photo[]> = {};

        photos.forEach(photo => {
            if (photo.waypoint_id) {
                if (!result[photo.waypoint_id]) {
                    result[photo.waypoint_id] = [];
                }
                result[photo.waypoint_id].push(photo);
            }
        });

        return result;
    }, [photos]);

    // Calculate segments between camps
    const segments = useMemo(() => {
        if (!trekData.route?.coordinates || trekData.camps.length < 2) return [];
        return calculateAllSegments(trekData.camps, trekData.route.coordinates);
    }, [trekData.camps, trekData.route]);

    // Create a map of segment by toCampId for easy lookup
    const segmentByToCamp = useMemo(() => {
        const map = new Map<string, RouteSegment>();
        segments.forEach(seg => map.set(seg.toCampId, seg));
        return map;
    }, [segments]);

    // Sort camps by day number
    const sortedCamps = useMemo(() => {
        return [...trekData.camps].sort((a, b) => a.dayNumber - b.dayNumber);
    }, [trekData.camps]);

    const handleEdit = useCallback((camp: Camp) => {
        setEditingCamp(camp);
    }, []);

    const handleAssignPhotos = useCallback((camp: Camp) => {
        setAssigningCamp(camp);
    }, []);

    const handlePhotoClick = useCallback((dayPhotos: Photo[], index: number) => {
        setLightboxPhotos(dayPhotos);
        setLightboxIndex(index);
    }, []);

    const closeLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    const handleSave = useCallback(() => {
        if (onUpdate) onUpdate();
    }, [onUpdate]);

    return (
        <div>
            {/* Edit Route button - only in edit mode */}
            {editMode && (
                <div className="mb-4">
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => setShowRouteEditor(true)}
                        className="w-full"
                    >
                        Edit Route & Camp Positions
                    </Button>
                </div>
            )}

            {sortedCamps.map((camp, i) => {
                const segment = segmentByToCamp.get(camp.id);
                const prevCamp = i > 0 ? sortedCamps[i - 1] : null;

                return (
                    <div key={camp.id}>
                        {/* Show segment info before this camp (except for first camp) */}
                        {segment && prevCamp && (
                            <SegmentInfo
                                segment={segment}
                                isMobile={isMobile}
                            />
                        )}
                        <CampItem
                            camp={camp}
                            isSelected={selectedCamp?.id === camp.id}
                            onClick={onCampSelect}
                            onEdit={handleEdit}
                            onAssignPhotos={handleAssignPhotos}
                            onPhotoClick={handlePhotoClick}
                            isLast={i === sortedCamps.length - 1}
                            isMobile={isMobile}
                            dayDate={getDateForDay(trekData.dateStarted, camp.dayNumber)}
                            photos={photosByDay[camp.dayNumber] || []}
                            assignedPhotos={photosByWaypoint[camp.id] || []}
                            getMediaUrl={getMediaUrl}
                            editMode={editMode}
                        />
                    </div>
                );
            })}

            {/* Edit Modal */}
            {editingCamp && (
                <WaypointEditModal
                    camp={editingCamp}
                    isOpen={!!editingCamp}
                    onClose={() => setEditingCamp(null)}
                    onSave={handleSave}
                    isMobile={isMobile}
                    photos={photos}
                    getMediaUrl={getMediaUrl}
                />
            )}

            {/* Photo Assign Modal */}
            {assigningCamp && (
                <PhotoAssignModal
                    camp={assigningCamp}
                    photos={photos}
                    isOpen={!!assigningCamp}
                    onClose={() => setAssigningCamp(null)}
                    onAssign={handleSave}
                    isMobile={isMobile}
                    getMediaUrl={getMediaUrl}
                />
            )}

            {/* Photo Lightbox */}
            <PhotoLightbox
                photos={lightboxPhotos}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                getMediaUrl={getMediaUrl}
                onViewOnMap={onViewPhotoOnMap}
            />

            {/* Route Editor Modal */}
            <RouteEditor
                trekData={trekData}
                isOpen={showRouteEditor}
                onClose={() => setShowRouteEditor(false)}
                onSave={handleSave}
                isMobile={isMobile}
            />
        </div>
    );
});
