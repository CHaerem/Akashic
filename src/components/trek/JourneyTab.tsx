import { memo, useCallback, useMemo, useState } from 'react';
import type { TrekData, Camp, Photo } from '../../types/trek';
import { WaypointEditModal } from './WaypointEditModal';
import { PhotoAssignModal } from './PhotoAssignModal';

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
}

const DayPhotos = memo(function DayPhotos({ photos, getMediaUrl, isMobile }: DayPhotosProps) {
    if (photos.length === 0) {
        return null;
    }

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${isMobile ? 3 : 4}, 1fr)`,
            gap: 6
        }}>
            {photos.slice(0, isMobile ? 6 : 8).map(photo => (
                <div
                    key={photo.id}
                    style={{
                        aspectRatio: '1',
                        borderRadius: 6,
                        overflow: 'hidden',
                        background: 'rgba(255,255,255,0.05)'
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
            {photos.length > (isMobile ? 6 : 8) && (
                <div style={{
                    aspectRatio: '1',
                    borderRadius: 6,
                    background: 'rgba(255,255,255,0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 12
                }}>
                    +{photos.length - (isMobile ? 6 : 8)}
                </div>
            )}
        </div>
    );
});

interface CampItemProps {
    camp: Camp;
    isSelected: boolean;
    onClick: (camp: Camp) => void;
    onEdit: (camp: Camp) => void;
    onAssignPhotos: (camp: Camp) => void;
    isLast: boolean;
    isMobile?: boolean;
    dayDate: Date | null;
    photos: Photo[];
    assignedPhotos: Photo[];
    getMediaUrl: (path: string) => string;
}

const CampItem = memo(function CampItem({
    camp,
    isSelected,
    onClick,
    onEdit,
    onAssignPhotos,
    isLast,
    isMobile = false,
    dayDate,
    photos,
    assignedPhotos,
    getMediaUrl
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
        borderBottom: !isLast ? '1px solid rgba(255,255,255,0.05)' : 'none',
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
        margin: `0 -${padding}px`,
        paddingLeft: padding,
        paddingRight: padding,
        minHeight: 44
    }), [isLast, isSelected, padding]);

    const dayLabel = dayDate
        ? `Day ${camp.dayNumber} · ${formatDate(dayDate)}`
        : `Day ${camp.dayNumber}`;

    const actionButtonStyle: React.CSSProperties = {
        background: 'rgba(255,255,255,0.1)',
        border: 'none',
        color: 'rgba(255,255,255,0.7)',
        fontSize: 12,
        padding: '8px 12px',
        borderRadius: 6,
        cursor: 'pointer',
        minHeight: 36,
        transition: 'background 0.2s'
    };

    return (
        <div onClick={handleClick} style={containerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{
                    color: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.3)',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase'
                }}>
                    {dayLabel}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                    {camp.elevation}m
                </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{
                    color: isSelected ? 'white' : 'rgba(255,255,255,0.7)',
                    fontSize: 16,
                    marginBottom: isSelected ? 12 : 0,
                    margin: 0
                }}>
                    {camp.name}
                </p>
                {!isSelected && allPhotos.length > 0 && (
                    <span style={{
                        background: 'rgba(255,255,255,0.1)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.5)'
                    }}>
                        {allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {isSelected && (
                <div style={{ animation: 'fadeIn 0.3s ease', marginTop: 12 }}>
                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`}</style>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                        <button onClick={handleEdit} style={actionButtonStyle}>
                            Edit Day
                        </button>
                        <button onClick={handleAssignPhotos} style={actionButtonStyle}>
                            Assign Photos
                        </button>
                    </div>

                    {camp.notes && (
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6, marginBottom: 16, marginTop: 0 }}>
                            {camp.notes}
                        </p>
                    )}
                    {camp.highlights && camp.highlights.length > 0 && (
                        <ul style={{ marginBottom: 20, paddingLeft: 16, marginTop: 0 }}>
                            {camp.highlights.map((highlight, idx) => (
                                <li key={idx} style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 }}>
                                    {highlight}
                                </li>
                            ))}
                        </ul>
                    )}

                    {allPhotos.length > 0 ? (
                        <DayPhotos photos={allPhotos} getMediaUrl={getMediaUrl} isMobile={isMobile} />
                    ) : (
                        <div style={{
                            width: '100%',
                            height: isMobile ? 80 : 100,
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px dashed rgba(255,255,255,0.1)',
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'rgba(255,255,255,0.2)',
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
}

export const JourneyTab = memo(function JourneyTab({
    trekData,
    selectedCamp,
    onCampSelect,
    isMobile = false,
    photos = [],
    getMediaUrl = (path) => path,
    onUpdate
}: JourneyTabProps) {
    const [editingCamp, setEditingCamp] = useState<Camp | null>(null);
    const [assigningCamp, setAssigningCamp] = useState<Camp | null>(null);

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

    const handleEdit = useCallback((camp: Camp) => {
        setEditingCamp(camp);
    }, []);

    const handleAssignPhotos = useCallback((camp: Camp) => {
        setAssigningCamp(camp);
    }, []);

    const handleSave = useCallback(() => {
        if (onUpdate) onUpdate();
    }, [onUpdate]);

    return (
        <div>
            {trekData.camps.map((camp, i) => (
                <CampItem
                    key={camp.id}
                    camp={camp}
                    isSelected={selectedCamp?.id === camp.id}
                    onClick={onCampSelect}
                    onEdit={handleEdit}
                    onAssignPhotos={handleAssignPhotos}
                    isLast={i === trekData.camps.length - 1}
                    isMobile={isMobile}
                    dayDate={getDateForDay(trekData.dateStarted, camp.dayNumber)}
                    photos={photosByDay[camp.dayNumber] || []}
                    assignedPhotos={photosByWaypoint[camp.id] || []}
                    getMediaUrl={getMediaUrl}
                />
            ))}

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
        </div>
    );
});
