import { memo, useCallback, useMemo, useState } from 'react';
import type { TrekData, Camp, Photo, RouteSegment } from '../../types/trek';
import { WaypointEditModal } from './WaypointEditModal';
import { PhotoAssignModal } from './PhotoAssignModal';
import { RouteEditor } from './RouteEditor';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { DayPhotos } from './DayPhotos';
import { SegmentInfo } from './SegmentInfo';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { calculateAllSegments } from '../../utils/routeUtils';
import { getDateForDay, isPhotoFromDay, formatDateShort } from '../../utils/dates';

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
        ? `Day ${camp.dayNumber} · ${formatDateShort(dayDate)}`
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
            <div className="flex justify-between items-center gap-3">
                <p className={cn(
                    "text-base m-0 flex-1",
                    isSelected
                        ? "text-white/95 light:text-slate-900 mb-3"
                        : "text-white/70 light:text-slate-600"
                )}>
                    {camp.name}
                </p>
                {/* Photo preview thumbnail - shows first photo as teaser */}
                {!isSelected && allPhotos.length > 0 && (
                    <div className="flex items-center gap-2 shrink-0">
                        <div
                            className="relative w-10 h-10 rounded-lg overflow-hidden bg-white/10 light:bg-black/5"
                            style={{
                                boxShadow: '0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                            }}
                        >
                            <img
                                src={getMediaUrl(allPhotos[0].storage_path + '?w=80&h=80&fit=cover')}
                                alt=""
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                            {allPhotos.length > 1 && (
                                <span
                                    className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded"
                                    style={{ backdropFilter: 'blur(4px)' }}
                                >
                                    +{allPhotos.length - 1}
                                </span>
                            )}
                        </div>
                    </div>
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
