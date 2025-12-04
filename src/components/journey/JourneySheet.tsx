/**
 * JourneyNav - Minimal day navigation dock
 *
 * Ultra-simple: just day dots at the bottom.
 * Tap a dot to fly to that day's camp.
 * Current day shows camp name in a small label.
 * The map is the content.
 */

import { memo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { TrekData, ExtendedStats, ElevationProfile, Camp, Photo } from '../../types/trek';

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
    selectedCamp,
    onDayChange,
    isMobile,
}: JourneySheetProps) {
    const [showLabel, setShowLabel] = useState(true);

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? trekData.camps[0]?.name ?? 'Start';
    const currentElevation = selectedCamp?.elevation ?? trekData.camps[0]?.elevation;
    const totalDays = trekData.stats.duration;

    const handleDayTap = useCallback((day: number) => {
        onDayChange(day);
        setShowLabel(true);
    }, [onDayChange]);

    // Glass style
    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 100%
        )`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.elevated,
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
                gap: 8,
                zIndex: 150,
                pointerEvents: 'none',
            }}
        >
            {/* Camp label - shows above dots */}
            <AnimatePresence>
                {showLabel && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2 }}
                        style={{
                            ...glassStyle,
                            borderRadius: radius.lg,
                            padding: '8px 14px',
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                        }}
                        onClick={() => setShowLabel(false)}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                        }}>
                            <span style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: colors.accent.primary,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                            }}>
                                Day {currentDay}
                            </span>
                            <span style={{
                                fontSize: 14,
                                fontWeight: 500,
                                color: colors.text.primary,
                            }}>
                                {currentCampName}
                            </span>
                            {currentElevation && (
                                <span style={{
                                    fontSize: 12,
                                    color: colors.text.tertiary,
                                }}>
                                    {currentElevation}m
                                </span>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Day dots */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', mass: 0.3, stiffness: 400, damping: 30 }}
                style={{
                    ...glassStyle,
                    borderRadius: radius.pill,
                    padding: '10px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    pointerEvents: 'auto',
                }}
            >
                {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                    const isActive = day === currentDay;
                    return (
                        <motion.button
                            key={day}
                            onClick={() => handleDayTap(day)}
                            whileHover={{ scale: 1.3 }}
                            whileTap={{ scale: 0.9 }}
                            animate={{
                                scale: isActive ? 1.2 : 1,
                            }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            style={{
                                width: isActive ? 10 : 8,
                                height: isActive ? 10 : 8,
                                borderRadius: '50%',
                                background: isActive
                                    ? colors.text.primary
                                    : 'rgba(255, 255, 255, 0.35)',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                transition: 'background 0.2s ease',
                            }}
                            aria-label={`Day ${day}`}
                        />
                    );
                })}
            </motion.div>
        </div>
    );
});

export default JourneySheet;
