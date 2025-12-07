import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDragGesture } from '../../hooks/useDragGesture';
import { colors, radius, transitions } from '../../styles/liquidGlass';
import type { Camp, TrekConfig } from '../../types/trek';
import type { ContentMode } from '../../hooks/useTrekData';
import { ChevronIcon } from '../icons';

// Snap points as vh percentages
export const SNAP_POINTS = {
    minimized: 14,   // Header only (grabber + nav)
    half: 50,        // Half screen
    expanded: 88,    // Full content (leaving room for status bar)
};

export type SnapPoint = keyof typeof SNAP_POINTS;

const SNAP_VALUES = [SNAP_POINTS.minimized, SNAP_POINTS.half, SNAP_POINTS.expanded];

const MODE_LABELS: Record<ContentMode, string> = {
    day: 'Day',
    photos: 'Photos',
    stats: 'Stats',
    info: 'Info',
};

interface BottomSheetProps {
    children: ReactNode;
    snapPoint: SnapPoint;
    onSnapChange: (snap: SnapPoint) => void;
    onDismiss?: () => void;
    isOpen?: boolean;

    // Navigation props (for unified header)
    view: 'globe' | 'trek';
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    totalDays: number;
    activeMode: ContentMode;
    onModeChange: (mode: ContentMode) => void;
    onDaySelect: (dayNumber: number) => void;
    onStart: () => void;
    onExplore: () => void;
    isMobile?: boolean;
}

/**
 * iOS Find My-style unified bottom sheet.
 * Navigation is integrated into the header - when minimized, only header is visible.
 * Drag to expand for content.
 */
export function BottomSheet({
    children,
    snapPoint,
    onSnapChange,
    onDismiss,
    isOpen = true,
    // Navigation props
    view,
    selectedTrek,
    selectedCamp,
    totalDays,
    activeMode,
    onModeChange,
    onDaySelect,
    onStart,
    onExplore,
    isMobile = false,
}: BottomSheetProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

    const snapIndex = SNAP_VALUES.indexOf(SNAP_POINTS[snapPoint]);

    const handleSnapChange = useCallback((index: number) => {
        const snapKeys: SnapPoint[] = ['minimized', 'half', 'expanded'];
        onSnapChange(snapKeys[index]);
    }, [onSnapChange]);

    const [dragState, dragHandlers] = useDragGesture({
        snapPoints: SNAP_VALUES,
        currentSnapIndex: snapIndex,
        onSnapChange: handleSnapChange,
        panelRef,
        onDismiss,
    });

    // Set initial height on mount and when snap point changes externally
    useEffect(() => {
        if (panelRef.current && !dragState.isDragging) {
            const vh = window.innerHeight / 100;
            const height = SNAP_POINTS[snapPoint] * vh;
            panelRef.current.style.transition = `height ${transitions.glass}`;
            panelRef.current.style.height = `${height}px`;
        }
    }, [snapPoint, dragState.isDragging]);

    // Day navigation handlers
    const isOverviewMode = selectedCamp === null;
    const currentDay = selectedCamp?.dayNumber ?? 0;
    const currentCampName = selectedCamp?.name ?? 'Overview';

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

    // Handle mode change - auto-expand if minimized
    const handleModeSelect = useCallback((mode: ContentMode) => {
        onModeChange(mode);
        if (snapPoint === 'minimized') {
            onSnapChange('half');
        }
    }, [snapPoint, onModeChange, onSnapChange]);

    // Tap on day info to show day content
    const handleDayTap = useCallback(() => {
        onModeChange('day');
        if (snapPoint === 'minimized') {
            onSnapChange('half');
        }
    }, [snapPoint, onModeChange, onSnapChange]);

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 50,
                // Liquid Glass styling
                background: `linear-gradient(
                    180deg,
                    rgba(255, 255, 255, 0.12) 0%,
                    rgba(255, 255, 255, 0.06) 30%,
                    rgba(255, 255, 255, 0.04) 100%
                )`,
                backdropFilter: 'blur(40px) saturate(180%)',
                WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                borderTopLeftRadius: radius.xxl,
                borderTopRightRadius: radius.xxl,
                boxShadow: `
                    0 -8px 40px rgba(0, 0, 0, 0.4),
                    0 0 0 1px rgba(255, 255, 255, 0.08),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15)
                `,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* Header Area - Always visible, contains navigation */}
            <div
                {...dragHandlers}
                style={{
                    cursor: 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    flexShrink: 0,
                }}
            >
                {/* Grabber */}
                <div
                    style={{
                        width: 36,
                        height: 5,
                        borderRadius: radius.pill,
                        background: colors.glass.light,
                        margin: '12px auto 8px',
                        opacity: dragState.isDragging ? 0.8 : 0.5,
                        transition: `opacity ${transitions.fast}`,
                    }}
                />

                {/* Navigation Row */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        padding: isMobile ? '8px 16px' : '10px 20px',
                        minHeight: isMobile ? 44 : 48,
                    }}
                >
                    {view === 'globe' && selectedTrek ? (
                        // Globe view: Trek info + explore button
                        <GlobeHeader
                            trek={selectedTrek}
                            onExplore={onExplore}
                            isMobile={isMobile}
                        />
                    ) : view === 'trek' && isOverviewMode ? (
                        // Trek view, no camp selected: overview mode
                        <TrekOverviewHeader
                            trekName={selectedTrek?.name ?? ''}
                            totalDays={totalDays}
                            onStart={onStart}
                            isMobile={isMobile}
                        />
                    ) : view === 'trek' ? (
                        // Trek view with camp selected: day navigation
                        <DayNavigationHeader
                            currentDay={currentDay}
                            currentCampName={currentCampName}
                            totalDays={totalDays}
                            swipeDirection={swipeDirection}
                            onPrevDay={goToPrevDay}
                            onNextDay={goToNextDay}
                            onDayTap={handleDayTap}
                            isMobile={isMobile}
                        />
                    ) : null}
                </div>

                {/* Mode Tabs - only in trek view with camp selected */}
                {view === 'trek' && !isOverviewMode && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            padding: '0 16px 12px',
                        }}
                    >
                        {(['day', 'photos', 'stats', 'info'] as ContentMode[]).map((mode) => (
                            <motion.button
                                key={mode}
                                onClick={() => handleModeSelect(mode)}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    flex: 1,
                                    padding: isMobile ? '8px 10px' : '8px 12px',
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
                )}
            </div>

            {/* Scrollable Content - visible when expanded */}
            <div
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch',
                }}
            >
                <style>{`
                    .bottom-sheet-content::-webkit-scrollbar {
                        display: none;
                    }
                `}</style>
                <div className="bottom-sheet-content">
                    {children}
                </div>
            </div>
        </div>
    );
}

// --- Header Components ---

interface GlobeHeaderProps {
    trek: TrekConfig;
    onExplore: () => void;
    isMobile: boolean;
}

function GlobeHeader({ trek, onExplore, isMobile }: GlobeHeaderProps) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <p
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: colors.text.tertiary,
                        margin: 0,
                    }}
                >
                    {trek.country}
                </p>
                <h2
                    style={{
                        fontSize: isMobile ? 16 : 18,
                        fontWeight: 500,
                        color: colors.text.primary,
                        margin: '2px 0 0 0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {trek.name}
                </h2>
            </div>
            <motion.button
                onClick={onExplore}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                    padding: '8px 16px',
                    background: 'rgba(96, 165, 250, 0.15)',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    color: colors.accent.primary,
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    flexShrink: 0,
                }}
            >
                Explore
                <ChevronIcon direction="right" size={12} />
            </motion.button>
        </div>
    );
}

interface TrekOverviewHeaderProps {
    trekName: string;
    totalDays: number;
    onStart: () => void;
    isMobile: boolean;
}

function TrekOverviewHeader({ trekName, totalDays, onStart, isMobile }: TrekOverviewHeaderProps) {
    return (
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
                whileHover={{ scale: 1.05 }}
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
    );
}

interface DayNavigationHeaderProps {
    currentDay: number;
    currentCampName: string;
    totalDays: number;
    swipeDirection: 'left' | 'right' | null;
    onPrevDay: (e: React.MouseEvent) => void;
    onNextDay: (e: React.MouseEvent) => void;
    onDayTap: () => void;
    isMobile: boolean;
}

function DayNavigationHeader({
    currentDay,
    currentCampName,
    totalDays,
    swipeDirection,
    onPrevDay,
    onNextDay,
    onDayTap,
    isMobile,
}: DayNavigationHeaderProps) {
    return (
        <>
            {/* Previous day */}
            <motion.button
                onClick={onPrevDay}
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

            {/* Day info - tap to show day content */}
            <motion.button
                key={currentDay}
                onClick={onDayTap}
                initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                animate={{ opacity: 1, x: 0 }}
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
                onClick={onNextDay}
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
    );
}
