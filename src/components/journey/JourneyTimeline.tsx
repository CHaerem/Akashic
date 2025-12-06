/**
 * JourneyTimeline - Scrollable list of day chapters
 *
 * Orchestrates the day-by-day journey view with:
 * - DayChapter for each day
 * - SegmentTransition between days
 * - Photo lightbox
 * - Scroll-based day change notifications
 */

import { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { TrekData, Camp, Photo, RouteSegment } from '../../types/trek';
import { DayChapter } from './DayChapter';
import { SegmentTransition } from './SegmentTransition';
import { PhotoLightbox } from '../common/PhotoLightbox';
import { calculateAllSegments } from '../../utils/routeUtils';
import { getDateForDay, isPhotoFromDay } from '../../utils/dates';
import { colors } from '../../styles/liquidGlass';

interface JourneyTimelineProps {
    trekData: TrekData;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    onDayChange: (dayNumber: number) => void;
    onPhotoClick: (photo: Photo) => void;
    onJourneyUpdate: () => void;
    isMobile: boolean;
}

export const JourneyTimeline = memo(function JourneyTimeline({
    trekData,
    photos,
    getMediaUrl,
    selectedCamp,
    onCampSelect,
    onDayChange,
    onPhotoClick,
    isMobile,
}: JourneyTimelineProps) {
    const [lightboxPhotos, setLightboxPhotos] = useState<Photo[]>([]);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const visibleDaysRef = useRef<Set<number>>(new Set());

    // Sort camps by day number
    const sortedCamps = useMemo(() => {
        return [...trekData.camps].sort((a, b) => a.dayNumber - b.dayNumber);
    }, [trekData.camps]);

    // Group photos by day (auto-match by date)
    const photosByDay = useMemo(() => {
        const result: Record<number, Photo[]> = {};

        sortedCamps.forEach(camp => {
            const dayDate = getDateForDay(trekData.dateStarted, camp.dayNumber);
            if (dayDate) {
                result[camp.dayNumber] = photos.filter(p => isPhotoFromDay(p, dayDate));
            } else {
                result[camp.dayNumber] = [];
            }
        });

        // Also include photos assigned by waypoint_id
        photos.forEach(photo => {
            if (photo.waypoint_id) {
                const camp = trekData.camps.find(c => c.id === photo.waypoint_id);
                if (camp) {
                    const dayPhotos = result[camp.dayNumber] || [];
                    if (!dayPhotos.some(p => p.id === photo.id)) {
                        result[camp.dayNumber] = [...dayPhotos, photo];
                    }
                }
            }
        });

        return result;
    }, [sortedCamps, trekData.dateStarted, trekData.camps, photos]);

    // Calculate segments between camps
    const segments = useMemo(() => {
        if (!trekData.route?.coordinates || trekData.camps.length < 2) return [];
        return calculateAllSegments(trekData.camps, trekData.route.coordinates);
    }, [trekData.camps, trekData.route]);

    // Create a map of segment by toCampId
    const segmentByToCamp = useMemo(() => {
        const map = new Map<string, RouteSegment>();
        segments.forEach(seg => map.set(seg.toCampId, seg));
        return map;
    }, [segments]);

    // Handle photo click - open lightbox with all photos from that day
    const handlePhotoClick = useCallback((camp: Camp, photo: Photo, index: number) => {
        const dayPhotos = photosByDay[camp.dayNumber] || [];
        setLightboxPhotos(dayPhotos);
        setLightboxIndex(index);
    }, [photosByDay]);

    const closeLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    // Set up intersection observer for scroll-based day detection
    useEffect(() => {
        observerRef.current = new IntersectionObserver(
            (entries) => {
                entries.forEach(entry => {
                    const dayNumber = parseInt(entry.target.getAttribute('data-day') || '0', 10);
                    if (entry.isIntersecting) {
                        visibleDaysRef.current.add(dayNumber);
                    } else {
                        visibleDaysRef.current.delete(dayNumber);
                    }
                });

                // Report the lowest visible day number
                if (visibleDaysRef.current.size > 0) {
                    const lowestDay = Math.min(...Array.from(visibleDaysRef.current));
                    onDayChange(lowestDay);
                }
            },
            {
                threshold: 0.3,
                rootMargin: '-20% 0px -60% 0px',
            }
        );

        return () => {
            observerRef.current?.disconnect();
        };
    }, [onDayChange]);

    // Observe day chapter elements
    useEffect(() => {
        const observer = observerRef.current;
        if (!observer) return;

        const dayElements = document.querySelectorAll('[data-day]');
        dayElements.forEach(el => observer.observe(el));

        return () => {
            dayElements.forEach(el => observer.unobserve(el));
        };
    }, [sortedCamps]);

    return (
        <div style={{ paddingTop: 8 }}>
            {sortedCamps.map((camp, index) => {
                const segment = segmentByToCamp.get(camp.id);
                const dayPhotos = photosByDay[camp.dayNumber] || [];
                const dayDate = getDateForDay(trekData.dateStarted, camp.dayNumber);

                return (
                    <div key={camp.id}>
                        {/* Segment transition (between days) */}
                        {index > 0 && segment && (
                            <SegmentTransition segment={segment} />
                        )}

                        {/* Day chapter */}
                        <DayChapter
                            camp={camp}
                            dayNumber={camp.dayNumber}
                            date={dayDate}
                            photos={dayPhotos}
                            getMediaUrl={getMediaUrl}
                            onPhotoClick={(photo, photoIndex) => handlePhotoClick(camp, photo, photoIndex)}
                            isSelected={selectedCamp?.id === camp.id}
                            onSelect={() => onCampSelect(camp)}
                        />
                    </div>
                );
            })}

            {/* Journey summary at the end */}
            <div style={{
                margin: '24px 16px 16px',
                padding: 20,
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                textAlign: 'center',
            }}>
                <div style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: colors.text.subtle,
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    marginBottom: 8,
                }}>
                    Journey Complete
                </div>
                <div style={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: colors.text.primary,
                    marginBottom: 4,
                }}>
                    {trekData.stats.totalDistance} km
                </div>
                <div style={{
                    fontSize: 13,
                    color: colors.text.tertiary,
                }}>
                    {trekData.stats.duration} days • Summit: {trekData.stats.highestPoint.elevation}m
                </div>
            </div>

            {/* Photo Lightbox */}
            <PhotoLightbox
                photos={lightboxPhotos}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={closeLightbox}
                getMediaUrl={getMediaUrl}
                onViewOnMap={onPhotoClick}
            />
        </div>
    );
});

export default JourneyTimeline;
