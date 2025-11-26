import { memo, useCallback, useMemo } from 'react';
import type { TrekData, Camp, Photo } from '../../types/trek';

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
        return (
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
        );
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
    isLast: boolean;
    isMobile?: boolean;
    dayDate: Date | null;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
}

const CampItem = memo(function CampItem({
    camp,
    isSelected,
    onClick,
    isLast,
    isMobile = false,
    dayDate,
    photos,
    getMediaUrl
}: CampItemProps) {
    const handleClick = useCallback(() => onClick(camp), [onClick, camp]);
    const padding = isMobile ? 16 : 24;

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
                {!isSelected && photos.length > 0 && (
                    <span style={{
                        background: 'rgba(255,255,255,0.1)',
                        padding: '2px 8px',
                        borderRadius: 10,
                        fontSize: 10,
                        color: 'rgba(255,255,255,0.5)'
                    }}>
                        {photos.length} photo{photos.length !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            {isSelected && (
                <div style={{ animation: 'fadeIn 0.3s ease', marginTop: 12 }}>
                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`}</style>
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
                    <DayPhotos photos={photos} getMediaUrl={getMediaUrl} isMobile={isMobile} />
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
}

export const JourneyTab = memo(function JourneyTab({
    trekData,
    selectedCamp,
    onCampSelect,
    isMobile = false,
    photos = [],
    getMediaUrl = (path) => path
}: JourneyTabProps) {
    // Group photos by day
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

    return (
        <div>
            {trekData.camps.map((camp, i) => (
                <CampItem
                    key={camp.id}
                    camp={camp}
                    isSelected={selectedCamp?.id === camp.id}
                    onClick={onCampSelect}
                    isLast={i === trekData.camps.length - 1}
                    isMobile={isMobile}
                    dayDate={getDateForDay(trekData.dateStarted, camp.dayNumber)}
                    photos={photosByDay[camp.dayNumber] || []}
                    getMediaUrl={getMediaUrl}
                />
            ))}
        </div>
    );
});
