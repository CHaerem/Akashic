import { memo, useCallback, useMemo, useState } from 'react';
import type { TrekData, Camp, Photo, RouteSegment } from '../../types/trek';
import { WaypointEditModal } from './WaypointEditModal';
import { PhotoAssignModal } from './PhotoAssignModal';
import { RouteEditor } from './RouteEditor';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, transitions } from '../../styles/liquidGlass';
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
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${isMobile ? 3 : 4}, 1fr)`,
            gap: 6
        }}>
            {photos.slice(0, maxVisible).map((photo, index) => (
                <div
                    key={photo.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(index);
                    }}
                    style={{
                        aspectRatio: '1',
                        borderRadius: radius.sm,
                        overflow: 'hidden',
                        background: colors.glass.subtle,
                        cursor: 'pointer'
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
                </div>
            ))}
            {photos.length > maxVisible && (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(maxVisible);
                    }}
                    style={{
                        aspectRatio: '1',
                        borderRadius: radius.sm,
                        background: colors.glass.subtle,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: colors.text.subtle,
                        fontSize: 12,
                        cursor: 'pointer'
                    }}
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
    fromCamp: Camp;
    toCamp: Camp;
    isMobile?: boolean;
}

const SegmentInfo = memo(function SegmentInfo({ segment, fromCamp, toCamp, isMobile = false }: SegmentInfoProps) {
    const difficultyColor = getDifficultyColor(segment.difficulty);

    return (
        <div style={{
            margin: isMobile ? '0 -16px' : '0 -24px',
            padding: isMobile ? '12px 16px' : '12px 24px',
            background: `linear-gradient(90deg, ${colors.glass.subtle} 0%, transparent 50%, ${colors.glass.subtle} 100%)`,
            borderTop: `1px solid ${colors.glass.borderSubtle}`,
            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12
            }}>
                {/* Distance & Time */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: colors.text.secondary,
                        fontSize: 12
                    }}>
                        <span style={{ opacity: 0.6 }}>↓</span>
                        <span style={{ fontWeight: 500 }}>{segment.distance} km</span>
                    </div>
                    <div style={{
                        width: 1,
                        height: 12,
                        background: colors.glass.borderSubtle
                    }} />
                    <div style={{
                        color: colors.text.tertiary,
                        fontSize: 11
                    }}>
                        {segment.estimatedTime}
                    </div>
                </div>

                {/* Elevation changes */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {segment.elevationGain > 0 && (
                        <span style={{
                            fontSize: 11,
                            color: 'rgba(34, 197, 94, 0.9)',
                            fontWeight: 500
                        }}>
                            +{segment.elevationGain}m
                        </span>
                    )}
                    {segment.elevationLoss > 0 && (
                        <span style={{
                            fontSize: 11,
                            color: 'rgba(239, 68, 68, 0.8)',
                            fontWeight: 500
                        }}>
                            -{segment.elevationLoss}m
                        </span>
                    )}
                    <div style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: difficultyColor.replace('0.8', '0.15'),
                        color: difficultyColor,
                        fontSize: 9,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                    }}>
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

    const padding = isMobile ? 16 : 24;

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

    const containerStyle = useMemo(() => ({
        padding: '20px 0',
        borderBottom: !isLast ? `1px solid ${colors.glass.borderSubtle}` : 'none',
        cursor: 'pointer',
        transition: `all ${transitions.smooth}`,
        background: isSelected ? colors.glass.subtle : 'transparent',
        margin: `0 -${padding}px`,
        paddingLeft: isSelected ? padding - 3 : padding, // Compensate for border
        paddingRight: padding,
        minHeight: 44,
        // Selection indicator - colored left border
        borderLeft: isSelected ? `3px solid ${colors.accent.primary}` : '3px solid transparent',
        // Subtle glow when selected
        boxShadow: isSelected ? `inset 6px 0 16px -8px ${colors.glow.blue}` : 'none',
    }), [isLast, isSelected, padding]);

    const dayLabel = dayDate
        ? `Day ${camp.dayNumber} · ${formatDate(dayDate)}`
        : `Day ${camp.dayNumber}`;

    const actionButtonStyle: React.CSSProperties = {
        background: colors.glass.medium,
        border: `1px solid ${colors.glass.borderSubtle}`,
        color: colors.text.secondary,
        fontSize: 12,
        padding: '8px 12px',
        borderRadius: radius.sm,
        cursor: 'pointer',
        minHeight: 36,
        transition: `all ${transitions.normal}`
    };

    return (
        <div onClick={handleClick} style={containerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{
                    color: isSelected ? colors.accent.primary : colors.text.subtle,
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase'
                }}>
                    {dayLabel}
                </span>
                <span style={{ color: colors.text.subtle, fontSize: 12 }}>
                    {camp.elevation}m
                </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{
                    color: isSelected ? colors.text.primary : colors.text.secondary,
                    fontSize: 16,
                    marginTop: 0,
                    marginBottom: isSelected ? 12 : 0,
                    marginLeft: 0,
                    marginRight: 0
                }}>
                    {camp.name}
                </p>
                {!isSelected && allPhotos.length > 0 && (
                    <span style={{
                        background: colors.glass.medium,
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 10,
                        color: colors.text.tertiary
                    }}>
                        {allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {isSelected && (
                <div style={{ animation: 'expandIn 0.4s cubic-bezier(0.32, 0.72, 0, 1)', marginTop: 12 }}>
                    <style>{`@keyframes expandIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                    {/* Action buttons - only show in edit mode */}
                    {editMode && (
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            <button onClick={handleEdit} style={actionButtonStyle}>
                                Edit Day
                            </button>
                            <button onClick={handleAssignPhotos} style={actionButtonStyle}>
                                Assign Photos
                            </button>
                        </div>
                    )}

                    {camp.notes && (
                        <p style={{ color: colors.text.tertiary, fontSize: 14, lineHeight: 1.6, marginBottom: 16, marginTop: 0 }}>
                            {camp.notes}
                        </p>
                    )}
                    {camp.highlights && camp.highlights.length > 0 && (
                        <ul style={{ marginBottom: 20, paddingLeft: 16, marginTop: 0 }}>
                            {camp.highlights.map((highlight, idx) => (
                                <li key={idx} style={{ color: colors.text.secondary, fontSize: 13, marginBottom: 4 }}>
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
                        <div style={{
                            width: '100%',
                            height: isMobile ? 80 : 100,
                            background: colors.glass.subtle,
                            border: `1px dashed ${colors.glass.borderSubtle}`,
                            borderRadius: radius.sm,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: colors.text.disabled,
                            fontSize: 11,
                            letterSpacing: '0.05em'
                        }}>
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
                <div style={{ marginBottom: 16 }}>
                    <GlassButton
                        variant="primary"
                        size="md"
                        fullWidth
                        onClick={() => setShowRouteEditor(true)}
                    >
                        Edit Route & Camp Positions
                    </GlassButton>
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
                                fromCamp={prevCamp}
                                toCamp={camp}
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
