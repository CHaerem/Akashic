import { useRef, useCallback, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, transitions, effects } from '../../styles/liquidGlass';
import type { Camp, TrekConfig, TrekData } from '../../types/trek';
import type { ContentMode } from '../../hooks/useTrekData';
import { ChevronIcon } from '../icons';
import { getCountryFlag } from '../../utils/countryFlags';

const MODE_LABELS: Record<Exclude<ContentMode, 'info'>, string> = {
    day: 'Day',
    photos: 'Media',
    stats: 'Stats',
};

// Sidebar dimensions (Find My pattern)
const SIDEBAR_WIDTH = 340;

interface SidebarProps {
    children: ReactNode;
    isOpen?: boolean;

    // Navigation props (same as BottomSheet)
    view: 'globe' | 'trek';
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    totalDays: number;
    trekData?: TrekData | null;
    activeMode: ContentMode;
    onModeChange: (mode: ContentMode) => void;
    onDaySelect: (dayNumber: number) => void;
    onStart: () => void;
    onExplore: () => void;
    onBackToOverview: () => void;
    // Journey navigation (globe view)
    onPrevJourney?: () => void;
    onNextJourney?: () => void;
    totalJourneys?: number;
    // Edit mode
    editMode?: boolean;
    onToggleEditMode?: () => void;
}

/**
 * Desktop sidebar panel - Find My macOS style.
 * Left sidebar with Liquid Glass styling, tabs at top, content below.
 * Map content flows behind the translucent sidebar.
 */
export function Sidebar({
    children,
    isOpen = true,
    // Navigation props
    view,
    selectedTrek,
    selectedCamp,
    totalDays,
    trekData,
    activeMode,
    onModeChange,
    onDaySelect,
    onStart,
    onBackToOverview,
    // Journey navigation
    onPrevJourney,
    onNextJourney,
    totalJourneys = 0,
    // Edit mode
    editMode = false,
    onToggleEditMode,
}: SidebarProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

    // Day navigation state
    const isOverviewMode = selectedCamp === null;
    const currentDay = selectedCamp?.dayNumber ?? 0;
    const currentCampName = selectedCamp?.name ?? 'Overview';

    const goToPrevDay = useCallback(() => {
        if (currentDay > 1) {
            setSwipeDirection('right');
            onDaySelect(currentDay - 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, onDaySelect]);

    const goToNextDay = useCallback(() => {
        if (currentDay < totalDays) {
            setSwipeDirection('left');
            onDaySelect(currentDay + 1);
            setTimeout(() => setSwipeDirection(null), 200);
        }
    }, [currentDay, totalDays, onDaySelect]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -SIDEBAR_WIDTH, opacity: 0 }}
                transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                style={{
                    position: 'fixed',
                    top: 12,
                    left: 12,
                    bottom: 12,
                    width: SIDEBAR_WIDTH,
                    zIndex: 50,
                    // Liquid Glass styling - inset per macOS Tahoe
                    background: `linear-gradient(
                        180deg,
                        rgba(255, 255, 255, 0.10) 0%,
                        rgba(255, 255, 255, 0.06) 30%,
                        rgba(255, 255, 255, 0.04) 100%
                    )`,
                    backdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
                    WebkitBackdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
                    borderRadius: radius.xl,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: `
                        0 8px 32px rgba(0, 0, 0, 0.3),
                        0 0 0 1px rgba(255, 255, 255, 0.05),
                        inset 0 1px 0 rgba(255, 255, 255, 0.15)
                    `,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
            >
                {/* Header - Mode tabs (like Find My's People/Devices/Items) */}
                <div
                    style={{
                        flexShrink: 0,
                        padding: '16px 16px 12px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                >
                    {/* Mode Tabs - always visible at top */}
                    {view === 'trek' && !isOverviewMode && (
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 6,
                                marginBottom: 12,
                            }}
                        >
                            {(['day', 'photos', 'stats'] as const).map((mode) => (
                                <motion.button
                                    key={mode}
                                    onClick={() => onModeChange(mode)}
                                    whileTap={{ scale: 0.95 }}
                                    style={{
                                        padding: '10px 12px',
                                        background: activeMode === mode
                                            ? 'rgba(96, 165, 250, 0.15)'
                                            : 'rgba(255, 255, 255, 0.04)',
                                        border: 'none',
                                        borderRadius: radius.md,
                                        cursor: 'pointer',
                                        color: activeMode === mode
                                            ? colors.accent.primary
                                            : colors.text.secondary,
                                        fontSize: 13,
                                        fontWeight: 500,
                                        transition: `background ${transitions.fast}, color ${transitions.fast}`,
                                    }}
                                >
                                    {MODE_LABELS[mode]}
                                </motion.button>
                            ))}
                            {/* Back to Overview */}
                            <motion.button
                                onClick={onBackToOverview}
                                whileTap={{ scale: 0.95 }}
                                style={{
                                    padding: '10px 12px',
                                    background: 'rgba(255, 255, 255, 0.04)',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: 'pointer',
                                    color: colors.text.tertiary,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 4,
                                    transition: `background ${transitions.fast}, color ${transitions.fast}`,
                                }}
                            >
                                <ChevronIcon direction="left" size={12} />
                                Overview
                            </motion.button>
                        </div>
                    )}

                    {/* Navigation Row */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            minHeight: 48,
                        }}
                    >
                        {view === 'globe' && selectedTrek ? (
                            <GlobeNavigation
                                trek={selectedTrek}
                                onPrevJourney={onPrevJourney}
                                onNextJourney={onNextJourney}
                                totalJourneys={totalJourneys}
                            />
                        ) : view === 'trek' && isOverviewMode ? (
                            <TrekOverviewNavigation
                                trekName={selectedTrek?.name ?? ''}
                                totalDays={totalDays}
                                trekData={trekData}
                                onStart={onStart}
                            />
                        ) : view === 'trek' ? (
                            <DayNavigation
                                currentDay={currentDay}
                                currentCampName={currentCampName}
                                totalDays={totalDays}
                                swipeDirection={swipeDirection}
                                onPrevDay={goToPrevDay}
                                onNextDay={goToNextDay}
                            />
                        ) : null}
                    </div>

                    {/* Edit mode toggle - positioned in header for desktop */}
                    {view === 'trek' && !isOverviewMode && onToggleEditMode && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <motion.button
                                onClick={onToggleEditMode}
                                whileTap={{ scale: 0.95 }}
                                aria-label={editMode ? 'Exit edit mode' : 'Edit mode'}
                                aria-pressed={editMode}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 10px',
                                    background: editMode
                                        ? 'rgba(96, 165, 250, 0.2)'
                                        : 'rgba(255, 255, 255, 0.04)',
                                    border: 'none',
                                    borderRadius: radius.md,
                                    cursor: 'pointer',
                                    color: editMode
                                        ? colors.accent.primary
                                        : colors.text.tertiary,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    opacity: editMode ? 1 : 0.7,
                                    transition: `all ${transitions.fast}`,
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                                {editMode ? 'Editing' : 'Edit'}
                            </motion.button>
                        </div>
                    )}
                </div>

                {/* Scrollable Content */}
                <div
                    ref={contentRef}
                    style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
                    }}
                >
                    {children}
                </div>
            </motion.div>
        </AnimatePresence>
    );
}

// --- Navigation Sub-Components ---

interface GlobeNavigationProps {
    trek: TrekConfig;
    onPrevJourney?: () => void;
    onNextJourney?: () => void;
    totalJourneys: number;
}

function GlobeNavigation({ trek, onPrevJourney, onNextJourney, totalJourneys }: GlobeNavigationProps) {
    const canNavigate = totalJourneys > 1;

    return (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <NavButton
                direction="left"
                onClick={onPrevJourney}
                disabled={!canNavigate}
                label="Previous journey"
            />

            <div style={{ flex: 1, minWidth: 0, padding: '0 8px', textAlign: 'center' }}>
                <p
                    style={{
                        fontSize: 10,
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        color: colors.text.tertiary,
                        margin: 0,
                    }}
                >
                    <span style={{ marginRight: 6 }}>{getCountryFlag(trek.country)}</span>
                    {trek.country}
                </p>
                <h2
                    style={{
                        fontSize: 17,
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

            <NavButton
                direction="right"
                onClick={onNextJourney}
                disabled={!canNavigate}
                label="Next journey"
            />
        </div>
    );
}

interface TrekOverviewNavigationProps {
    trekName: string;
    totalDays: number;
    trekData?: TrekData | null;
    onStart: () => void;
}

function TrekOverviewNavigation({ trekName, totalDays, trekData, onStart }: TrekOverviewNavigationProps) {
    // Format stats: "5 days · 42km · Summit 5,895m"
    const statsText = trekData
        ? `${totalDays} days · ${trekData.stats.totalDistance}km · Summit ${trekData.stats.highestPoint.elevation.toLocaleString()}m`
        : `${totalDays} days`;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    overflow: 'hidden',
                }}
            >
                <span
                    style={{
                        color: colors.text.primary,
                        fontSize: 15,
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {trekName}
                </span>
                <span
                    style={{
                        fontSize: 11,
                        color: colors.text.tertiary,
                        fontWeight: 400,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {statsText}
                </span>
            </div>
            <motion.button
                onClick={onStart}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 14px',
                    background: 'rgba(96, 165, 250, 0.15)',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    color: colors.accent.primary,
                    fontSize: 13,
                    fontWeight: 600,
                    flexShrink: 0,
                }}
            >
                Start
                <ChevronIcon direction="right" size={12} />
            </motion.button>
        </div>
    );
}

interface DayNavigationProps {
    currentDay: number;
    currentCampName: string;
    totalDays: number;
    swipeDirection: 'left' | 'right' | null;
    onPrevDay: () => void;
    onNextDay: () => void;
}

function DayNavigation({
    currentDay,
    currentCampName,
    totalDays,
    swipeDirection,
    onPrevDay,
    onNextDay,
}: DayNavigationProps) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <NavButton
                direction="left"
                onClick={onPrevDay}
                disabled={currentDay <= 1}
                label="Previous day"
            />

            <motion.div
                key={currentDay}
                initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                animate={{ opacity: 1, x: 0 }}
                style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    padding: '0 8px',
                }}
            >
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: colors.accent.primary,
                        background: 'rgba(96, 165, 250, 0.15)',
                        padding: '4px 10px',
                        borderRadius: 6,
                        flexShrink: 0,
                    }}
                >
                    Day {currentDay}
                </span>
                <span
                    style={{
                        fontSize: 15,
                        fontWeight: 500,
                        color: colors.text.primary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {currentCampName}
                </span>
            </motion.div>

            <NavButton
                direction="right"
                onClick={onNextDay}
                disabled={currentDay >= totalDays}
                label="Next day"
            />
        </div>
    );
}

interface NavButtonProps {
    direction: 'left' | 'right';
    onClick?: () => void;
    disabled?: boolean;
    label: string;
}

function NavButton({ direction, onClick, disabled, label }: NavButtonProps) {
    return (
        <motion.button
            onClick={onClick}
            whileHover={!disabled ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
            whileTap={!disabled ? { scale: 0.9 } : {}}
            aria-label={label}
            disabled={disabled}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                background: 'transparent',
                border: 'none',
                borderRadius: radius.md,
                cursor: disabled ? 'default' : 'pointer',
                color: disabled ? colors.text.subtle : colors.text.secondary,
                opacity: disabled ? 0.3 : 1,
                flexShrink: 0,
                transition: `all ${transitions.fast}`,
            }}
        >
            <ChevronIcon direction={direction} size={16} />
        </motion.button>
    );
}

export default Sidebar;
