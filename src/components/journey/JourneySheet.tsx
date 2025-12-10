/**
 * JourneyNav - Liquid Glass pill with gestures and context overlays
 *
 * - Pill: Shows "Day X · CampName", swipe left/right to change days
 * - Context card: Tap pill to show info overlay above it
 * - Map is the hero, pill is the navigator
 */

import { memo, useState, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { TrekData, ExtendedStats, ElevationProfile, Camp, Photo } from '../../types/trek';
import { getDateForDay, isPhotoFromDay, formatDateShort } from '../../utils/dates';

// Icons
const ChevronLeft = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"/>
    </svg>
);

const ChevronRight = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6"/>
    </svg>
);

const MountainIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3l4 8 5-5 5 15H2L8 3z"/>
    </svg>
);

const CameraIcon = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
    </svg>
);

interface JourneySheetProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    onDayChange: (dayNumber: number) => void;
    onPhotoClick: (photo: Photo) => void;
    onJourneyUpdate: () => void;
    isMobile: boolean;
}

export const JourneySheet = memo(function JourneySheet({
    trekData,
    photos,
    getMediaUrl,
    selectedCamp,
    onDayChange,
    onPhotoClick,
    isMobile,
}: JourneySheetProps) {
    const [showCard, setShowCard] = useState(false);
    const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
    const pillRef = useRef<HTMLDivElement>(null);

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCamp = selectedCamp ?? trekData.camps[0];
    const totalDays = trekData.stats.duration;

    // Calculate the date for the current camp
    const currentCampDate = useMemo(
        () => getDateForDay(trekData.dateStarted, currentCamp.dayNumber),
        [trekData.dateStarted, currentCamp.dayNumber]
    );

    // Get photos for current day
    const dayPhotos = useMemo(() => {
        if (!currentCampDate) return [];
        return photos.filter(p => isPhotoFromDay(p, currentCampDate));
    }, [photos, currentCampDate]);

    // Navigate to previous/next day
    const goToPrevDay = useCallback(() => {
        if (currentDay > 1) {
            setSwipeDirection('right');
            onDayChange(currentDay - 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, onDayChange]);

    const goToNextDay = useCallback(() => {
        if (currentDay < totalDays) {
            setSwipeDirection('left');
            onDayChange(currentDay + 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, totalDays, onDayChange]);

    // Handle swipe gestures
    const handleDragEnd = useCallback((_: any, info: PanInfo) => {
        const threshold = 50;
        if (info.offset.x > threshold) {
            goToPrevDay();
        } else if (info.offset.x < -threshold) {
            goToNextDay();
        }
    }, [goToPrevDay, goToNextDay]);

    // Toggle context card
    const toggleCard = useCallback(() => {
        setShowCard(prev => !prev);
    }, []);

    // Glass styles
    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.14) 0%,
            rgba(255, 255, 255, 0.07) 100%
        )`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.elevated,
    };

    const cardGlassStyle: React.CSSProperties = {
        background: `linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 100%
        )`,
        backdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.panel,
    };

    return (
        <div
            style={{
                position: 'fixed',
                bottom: isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 28,
                left: 0,
                right: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                zIndex: 150,
                pointerEvents: 'none',
            }}
        >
            {/* Context Card - shows above pill when active */}
            <AnimatePresence>
                {showCard && currentCamp && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.98 }}
                        transition={{ type: 'spring', mass: 0.3, stiffness: 400, damping: 30 }}
                        style={{
                            ...cardGlassStyle,
                            borderRadius: radius.xl,
                            padding: 16,
                            width: isMobile ? 'calc(100% - 32px)' : 360,
                            maxWidth: 400,
                            pointerEvents: 'auto',
                        }}
                    >
                        {/* Camp header */}
                        <div style={{ marginBottom: 12 }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 4,
                            }}>
                                <span style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: colors.accent.primary,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    background: 'rgba(96, 165, 250, 0.15)',
                                    padding: '3px 8px',
                                    borderRadius: 6,
                                }}>
                                    Day {currentDay}
                                </span>
                                {currentCampDate && (
                                    <span style={{
                                        fontSize: 12,
                                        color: colors.text.tertiary,
                                    }}>
                                        {formatDateShort(currentCampDate)}
                                    </span>
                                )}
                            </div>
                            <h3 style={{
                                fontSize: 18,
                                fontWeight: 600,
                                color: colors.text.primary,
                                margin: 0,
                            }}>
                                {currentCamp.name}
                            </h3>
                        </div>

                        {/* Stats row */}
                        <div style={{
                            display: 'flex',
                            gap: 16,
                            marginBottom: dayPhotos.length > 0 ? 12 : 0,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <MountainIcon size={14} />
                                <span style={{ fontSize: 13, color: colors.text.secondary }}>
                                    {currentCamp.elevation}m
                                </span>
                            </div>
                            {dayPhotos.length > 0 && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <CameraIcon size={14} />
                                    <span style={{ fontSize: 13, color: colors.text.secondary }}>
                                        {dayPhotos.length} photo{dayPhotos.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Photo strip */}
                        {dayPhotos.length > 0 && (
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                overflowX: 'auto',
                                marginLeft: -4,
                                marginRight: -4,
                                paddingLeft: 4,
                                paddingRight: 4,
                                paddingBottom: 4,
                                WebkitOverflowScrolling: 'touch',
                            }}>
                                {dayPhotos.slice(0, 5).map((photo, idx) => (
                                    <motion.div
                                        key={photo.id}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => onPhotoClick(photo)}
                                        style={{
                                            flexShrink: 0,
                                            width: 64,
                                            height: 64,
                                            borderRadius: radius.md,
                                            overflow: 'hidden',
                                            cursor: 'pointer',
                                            border: `1px solid ${colors.glass.borderSubtle}`,
                                        }}
                                    >
                                        <img
                                            src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                            alt={photo.caption || `Photo ${idx + 1}`}
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover',
                                            }}
                                        />
                                    </motion.div>
                                ))}
                                {dayPhotos.length > 5 && (
                                    <div style={{
                                        flexShrink: 0,
                                        width: 64,
                                        height: 64,
                                        borderRadius: radius.md,
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        border: `1px solid ${colors.glass.borderSubtle}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: colors.text.secondary,
                                        fontSize: 13,
                                        fontWeight: 500,
                                    }}>
                                        +{dayPhotos.length - 5}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Notes */}
                        {currentCamp.notes && (
                            <p style={{
                                fontSize: 13,
                                lineHeight: 1.5,
                                color: colors.text.secondary,
                                margin: dayPhotos.length > 0 ? '12px 0 0' : 0,
                            }}>
                                {currentCamp.notes}
                            </p>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Navigation Pill */}
            <motion.div
                ref={pillRef}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', mass: 0.3, stiffness: 400, damping: 30 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={handleDragEnd}
                onClick={toggleCard}
                whileTap={{ scale: 0.98 }}
                style={{
                    ...glassStyle,
                    borderRadius: radius.pill,
                    padding: '12px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    touchAction: 'pan-y',
                    userSelect: 'none',
                }}
            >
                {/* Previous day button */}
                <motion.button
                    onClick={(e) => { e.stopPropagation(); goToPrevDay(); }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    disabled={currentDay <= 1}
                    style={{
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: radius.md,
                        cursor: currentDay > 1 ? 'pointer' : 'default',
                        color: currentDay > 1 ? colors.text.secondary : colors.text.subtle,
                        opacity: currentDay > 1 ? 1 : 0.3,
                    }}
                >
                    <ChevronLeft size={18} />
                </motion.button>

                {/* Day info */}
                <motion.div
                    key={currentDay}
                    initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '0 8px',
                        minWidth: 160,
                        justifyContent: 'center',
                    }}
                >
                    <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: colors.accent.primary,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                    }}>
                        Day {currentDay}
                    </span>
                    <span style={{
                        width: 1,
                        height: 14,
                        background: colors.glass.borderSubtle,
                    }} />
                    <span style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: colors.text.primary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 120,
                    }}>
                        {currentCamp?.name ?? 'Start'}
                    </span>
                </motion.div>

                {/* Next day button */}
                <motion.button
                    onClick={(e) => { e.stopPropagation(); goToNextDay(); }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    disabled={currentDay >= totalDays}
                    style={{
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: radius.md,
                        cursor: currentDay < totalDays ? 'pointer' : 'default',
                        color: currentDay < totalDays ? colors.text.secondary : colors.text.subtle,
                        opacity: currentDay < totalDays ? 1 : 0.3,
                    }}
                >
                    <ChevronRight size={18} />
                </motion.button>
            </motion.div>

            {/* Day indicator dots */}
            <div style={{
                display: 'flex',
                gap: 6,
                pointerEvents: 'none',
            }}>
                {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => (
                    <div
                        key={day}
                        style={{
                            width: day === currentDay ? 8 : 5,
                            height: day === currentDay ? 8 : 5,
                            borderRadius: '50%',
                            background: day === currentDay
                                ? colors.text.primary
                                : 'rgba(255, 255, 255, 0.3)',
                            transition: 'all 0.2s ease',
                        }}
                    />
                ))}
            </div>
        </div>
    );
});

export default JourneySheet;
