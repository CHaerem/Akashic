/**
 * Navigation Pill - Find My-inspired day navigation + mode switcher
 *
 * Simplified pill that sits above the BottomSheet.
 * Handles day navigation and content mode switching.
 * No floating cards - content is rendered in BottomSheet.
 */

import { memo, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, shadows, effects, transitions } from '../../styles/liquidGlass';
import type { Camp } from '../../types/trek';
import { ChevronIcon } from '../icons';

export type ContentMode = 'day' | 'photos' | 'stats' | 'info';

interface NavigationPillProps {
    /** Current selected camp (null = overview mode) */
    selectedCamp: Camp | null;
    /** Total number of days in the trek */
    totalDays: number;
    /** Trek name for overview mode */
    trekName: string;
    /** Current content mode */
    activeMode: ContentMode;
    /** Called when content mode changes */
    onModeChange: (mode: ContentMode) => void;
    /** Called when day is selected */
    onDaySelect: (dayNumber: number) => void;
    /** Called when user wants to start from day 1 */
    onStart: () => void;
    /** Bottom offset based on sheet height */
    bottomOffset: number;
    /** Mobile device */
    isMobile?: boolean;
}

const MODE_LABELS: Record<ContentMode, string> = {
    day: 'Day',
    photos: 'Photos',
    stats: 'Stats',
    info: 'Info',
};

export const NavigationPill = memo(function NavigationPill({
    selectedCamp,
    totalDays,
    trekName,
    activeMode,
    onModeChange,
    onDaySelect,
    onStart,
    bottomOffset,
    isMobile = false,
}: NavigationPillProps) {
    const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

    const isOverviewMode = selectedCamp === null;
    const currentDay = selectedCamp?.dayNumber ?? 0;
    const currentCampName = selectedCamp?.name ?? 'Overview';

    // Day navigation
    const goToPrevDay = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentDay > 1) {
            setSwipeDirection('right');
            onDaySelect(currentDay - 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, onDaySelect]);

    const goToNextDay = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (currentDay < totalDays) {
            setSwipeDirection('left');
            onDaySelect(currentDay + 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, totalDays, onDaySelect]);

    // Swipe handling for day navigation
    const handleSwipeDragEnd = useCallback(
        (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
            const threshold = 50;
            const velocityThreshold = 500;

            if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
                if (currentDay > 1) {
                    setSwipeDirection('right');
                    onDaySelect(currentDay - 1);
                    setTimeout(() => setSwipeDirection(null), 200);
                }
            } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
                if (currentDay < totalDays) {
                    setSwipeDirection('left');
                    onDaySelect(currentDay + 1);
                    setTimeout(() => setSwipeDirection(null), 200);
                }
            }
        },
        [currentDay, totalDays, onDaySelect]
    );

    // Show day info on center tap
    const handleCenterTap = useCallback(() => {
        onModeChange('day');
    }, [onModeChange]);

    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.elevated,
    };

    return (
        <div
            style={{
                position: 'fixed',
                bottom: bottomOffset + (isMobile ? 8 : 12),
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                zIndex: 55,
                pointerEvents: 'none',
                transition: `bottom ${transitions.glass}`,
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            <motion.div
                drag={!isOverviewMode ? 'x' : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragEnd={!isOverviewMode ? handleSwipeDragEnd : undefined}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                    ...glassStyle,
                    borderRadius: radius.xl,
                    overflow: 'hidden',
                    pointerEvents: 'auto',
                    userSelect: 'none',
                }}
            >
                {/* Day Navigation Row */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: isMobile ? '10px 16px' : '12px 20px',
                        minHeight: isMobile ? 48 : 52,
                    }}
                >
                    {isOverviewMode ? (
                        // Overview mode: trek name + start button
                        <>
                            <span
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: colors.accent.primary,
                                    background: 'rgba(96, 165, 250, 0.15)',
                                    padding: '3px 8px',
                                    borderRadius: 6,
                                }}
                            >
                                {totalDays} days
                            </span>
                            <span
                                style={{
                                    padding: '4px 8px',
                                    color: colors.text.primary,
                                    fontSize: isMobile ? 14 : 15,
                                    fontWeight: 500,
                                }}
                            >
                                {trekName}
                            </span>
                            <motion.button
                                onClick={onStart}
                                whileHover={{ scale: 1.05, backgroundColor: 'rgba(96, 165, 250, 0.2)' }}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    marginLeft: 4,
                                    padding: '6px 12px',
                                    background: 'rgba(96, 165, 250, 0.15)',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: 'pointer',
                                    color: colors.accent.primary,
                                    fontSize: 12,
                                    fontWeight: 600,
                                }}
                            >
                                Start
                                <ChevronIcon direction="right" size={12} />
                            </motion.button>
                        </>
                    ) : (
                        // Day mode: arrows + day info
                        <>
                            {/* Previous day */}
                            <motion.button
                                onClick={goToPrevDay}
                                whileHover={currentDay > 1 ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                                whileTap={currentDay > 1 ? { scale: 0.9 } : {}}
                                aria-label="Previous day"
                                disabled={currentDay <= 1}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 32,
                                    height: 32,
                                    background: 'transparent',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: currentDay > 1 ? 'pointer' : 'default',
                                    color: currentDay > 1 ? colors.text.secondary : colors.text.subtle,
                                    opacity: currentDay > 1 ? 1 : 0.3,
                                }}
                            >
                                <ChevronIcon direction="left" size={16} />
                            </motion.button>

                            {/* Day info - tap to show day details */}
                            <motion.button
                                key={currentDay}
                                onClick={handleCenterTap}
                                initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                                animate={{ opacity: 1, x: 0 }}
                                whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
                                whileTap={{ scale: 0.98 }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '4px 12px',
                                    background: 'transparent',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: 'pointer',
                                    color: colors.text.primary,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: colors.accent.primary,
                                        background: 'rgba(96, 165, 250, 0.15)',
                                        padding: '3px 8px',
                                        borderRadius: 6,
                                    }}
                                >
                                    Day {currentDay}
                                </span>
                                <span
                                    style={{
                                        fontSize: isMobile ? 14 : 15,
                                        fontWeight: 500,
                                        whiteSpace: 'nowrap',
                                        maxWidth: isMobile ? 140 : 180,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}
                                >
                                    {currentCampName}
                                </span>
                            </motion.button>

                            {/* Next day */}
                            <motion.button
                                onClick={goToNextDay}
                                whileHover={currentDay < totalDays ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                                whileTap={currentDay < totalDays ? { scale: 0.9 } : {}}
                                aria-label="Next day"
                                disabled={currentDay >= totalDays}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 32,
                                    height: 32,
                                    background: 'transparent',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: currentDay < totalDays ? 'pointer' : 'default',
                                    color: currentDay < totalDays ? colors.text.secondary : colors.text.subtle,
                                    opacity: currentDay < totalDays ? 1 : 0.3,
                                }}
                            >
                                <ChevronIcon direction="right" size={16} />
                            </motion.button>
                        </>
                    )}
                </div>

                {/* Mode Switcher Row */}
                <AnimatePresence>
                    {!isOverviewMode && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            style={{ overflow: 'hidden' }}
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    padding: '8px 16px 12px',
                                    borderTop: `1px solid ${colors.glass.borderSubtle}`,
                                }}
                            >
                                {(['day', 'photos', 'stats', 'info'] as ContentMode[]).map((mode) => (
                                    <motion.button
                                        key={mode}
                                        onClick={() => onModeChange(mode)}
                                        whileHover={{ scale: 1.05, backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
                                        whileTap={{ scale: 0.95 }}
                                        style={{
                                            flex: 1,
                                            padding: '8px 12px',
                                            background: activeMode === mode
                                                ? 'rgba(96, 165, 250, 0.15)'
                                                : 'rgba(255, 255, 255, 0.06)',
                                            border: 'none',
                                            borderRadius: radius.md,
                                            cursor: 'pointer',
                                            color: activeMode === mode
                                                ? colors.accent.primary
                                                : colors.text.secondary,
                                            fontSize: 13,
                                            fontWeight: 500,
                                            transition: 'background 0.2s ease, color 0.2s ease',
                                        }}
                                    >
                                        {MODE_LABELS[mode]}
                                    </motion.button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
});

export default NavigationPill;
