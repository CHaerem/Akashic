/**
 * JourneySheet - Unified bottom sheet with integrated day pill
 *
 * The pill and sheet are ONE component with smooth transitions:
 * - Collapsed: Floating pill showing "Day X • CampName"
 * - Expanded: Full sheet with timeline content
 */

import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { TrekData, ExtendedStats, ElevationProfile, Camp, Photo } from '../../types/trek';
import { JourneyTimeline } from './JourneyTimeline';
import { MiniElevationProfile } from './MiniElevationProfile';

// Calendar icon
const CalendarIcon = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
);

// Chevron icon
const ChevronIcon = ({ direction = 'up', size = 16 }: { direction?: 'up' | 'down'; size?: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: direction === 'down' ? 'rotate(180deg)' : 'none' }}
    >
        <polyline points="18 15 12 9 6 15"/>
    </svg>
);

const SPRING_CONFIG = { mass: 0.1, stiffness: 180, damping: 18 };

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

type SheetState = 'collapsed' | 'peek' | 'expanded';

export const JourneySheet = memo(function JourneySheet({
    trekData,
    extendedStats,
    elevationProfile,
    photos,
    getMediaUrl,
    selectedCamp,
    onCampSelect,
    onDayChange,
    onPhotoClick,
    onJourneyUpdate,
    isMobile,
}: JourneySheetProps) {
    const [state, setState] = useState<SheetState>('collapsed');
    const [showDaySelector, setShowDaySelector] = useState(false);
    const [hoveredDay, setHoveredDay] = useState<number | null>(null);

    const sheetRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const dragStartY = useRef(0);
    const dragStartState = useRef<SheetState>('collapsed');

    const mouseX = useMotionValue(Infinity);
    const dayRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? trekData.camps[0]?.name ?? 'Start';
    const totalDays = trekData.stats.duration;
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);

    // Heights for each state
    const getHeight = useCallback((s: SheetState) => {
        const vh = window.innerHeight;
        const safeBottom = isMobile ? 24 : 32;
        switch (s) {
            case 'collapsed': return 56 + safeBottom; // Pill height + safe area
            case 'peek': return vh * 0.35;
            case 'expanded': return vh * 0.85;
        }
    }, [isMobile]);

    // Handle drag
    const handleDragStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        dragStartY.current = clientY;
        dragStartState.current = state;
    }, [state]);

    const handleDragEnd = useCallback((e: React.TouchEvent | React.MouseEvent) => {
        const clientY = 'changedTouches' in e ? e.changedTouches[0].clientY : e.clientY;
        const delta = dragStartY.current - clientY;
        const threshold = 50;

        if (delta > threshold) {
            // Dragging up - expand
            if (state === 'collapsed') setState('peek');
            else if (state === 'peek') setState('expanded');
        } else if (delta < -threshold) {
            // Dragging down - collapse
            if (state === 'expanded') setState('peek');
            else if (state === 'peek') setState('collapsed');
        }
    }, [state]);

    // Click outside to collapse
    useEffect(() => {
        if (state === 'collapsed') return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
                setState('collapsed');
                setShowDaySelector(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [state]);

    // Handle day selection
    const handleDayClick = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        setShowDaySelector(false);
        // Scroll to day in timeline if expanded
        if (state === 'expanded' && contentRef.current) {
            const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
            dayElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [onDayChange, state]);

    // Toggle pill expansion
    const handlePillClick = useCallback(() => {
        if (state === 'collapsed') {
            setState('peek');
        }
    }, [state]);

    // Toggle day selector
    const toggleDaySelector = useCallback(() => {
        setShowDaySelector(prev => !prev);
    }, []);

    // Scroll to day from elevation profile
    const handleElevationDaySelect = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        if (state !== 'expanded') {
            setState('expanded');
        }
        // Small delay for state change, then scroll
        setTimeout(() => {
            if (contentRef.current) {
                const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
                dayElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }, [onDayChange, state]);

    const setDayRef = useCallback((day: number) => (el: HTMLButtonElement | null) => {
        dayRefs.current.set(day, el);
    }, []);

    // Glass styles
    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.elevated,
    };

    const expandedGlassStyle: React.CSSProperties = {
        background: `linear-gradient(180deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 30%,
            rgba(10, 10, 15, 0.98) 100%
        )`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        borderTop: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.panel,
    };

    return (
        <motion.div
            ref={sheetRef}
            initial={{ opacity: 0, y: 20 }}
            animate={{
                opacity: 1,
                y: 0,
                height: getHeight(state),
                width: state === 'collapsed' ? 'auto' : '100%',
                left: state === 'collapsed' ? '50%' : 0,
                x: state === 'collapsed' ? '-50%' : 0,
                borderRadius: state === 'collapsed' ? radius.pill : `${radius.xl} ${radius.xl} 0 0`,
            }}
            transition={{ type: 'spring', ...SPRING_CONFIG }}
            style={{
                position: 'fixed',
                bottom: state === 'collapsed'
                    ? (isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 32)
                    : 0,
                zIndex: 150,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                ...(state === 'collapsed' ? glassStyle : expandedGlassStyle),
            }}
            onTouchStart={handleDragStart}
            onTouchEnd={handleDragEnd}
            onMouseDown={handleDragStart}
            onMouseUp={handleDragEnd}
        >
            {/* Collapsed State - Pill */}
            <AnimatePresence mode="wait">
                {state === 'collapsed' && (
                    <motion.div
                        key="pill"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={handlePillClick}
                        style={{
                            padding: isMobile ? '12px 20px' : '14px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            cursor: 'pointer',
                            color: colors.text.primary,
                            minHeight: isMobile ? 48 : 52,
                        }}
                    >
                        <CalendarIcon size={isMobile ? 18 : 20} />
                        <span style={{
                            fontSize: isMobile ? 14 : 15,
                            fontWeight: 500,
                            whiteSpace: 'nowrap'
                        }}>
                            Day {currentDay}
                            <span style={{ color: colors.text.tertiary, margin: '0 8px' }}>•</span>
                            {currentCampName}
                        </span>
                        <ChevronIcon direction="up" size={14} />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Expanded States - Peek & Full */}
            <AnimatePresence mode="wait">
                {state !== 'collapsed' && (
                    <motion.div
                        key="expanded"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            height: '100%',
                            overflow: 'hidden',
                        }}
                    >
                        {/* Drag Handle */}
                        <div
                            style={{
                                padding: '12px 0 8px',
                                display: 'flex',
                                justifyContent: 'center',
                                cursor: 'grab',
                                touchAction: 'none',
                                flexShrink: 0,
                            }}
                        >
                            <div style={{
                                width: 36,
                                height: 4,
                                borderRadius: 2,
                                background: `linear-gradient(90deg,
                                    rgba(255,255,255,0.2) 0%,
                                    rgba(255,255,255,0.4) 50%,
                                    rgba(255,255,255,0.2) 100%
                                )`,
                            }} />
                        </div>

                        {/* Header with Day Selector */}
                        <div style={{
                            padding: '0 16px 12px',
                            flexShrink: 0,
                            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                        }}>
                            {/* Trek Name & Day Selector Row */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 12,
                            }}>
                                <div>
                                    <h2 style={{
                                        fontSize: 18,
                                        fontWeight: 600,
                                        color: colors.text.primary,
                                        margin: 0,
                                    }}>
                                        {trekData.name}
                                    </h2>
                                    <p style={{
                                        fontSize: 13,
                                        color: colors.text.secondary,
                                        margin: '4px 0 0',
                                    }}>
                                        {trekData.stats.distance} km • {trekData.stats.duration} days
                                    </p>
                                </div>

                                {/* Day Selector Button */}
                                <motion.button
                                    onClick={toggleDaySelector}
                                    whileTap={{ scale: 0.95 }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '8px 14px',
                                        background: showDaySelector
                                            ? 'rgba(255,255,255,0.15)'
                                            : 'rgba(255,255,255,0.08)',
                                        border: `1px solid ${showDaySelector ? colors.glass.border : colors.glass.borderSubtle}`,
                                        borderRadius: radius.lg,
                                        cursor: 'pointer',
                                        color: colors.text.primary,
                                        fontSize: 14,
                                        fontWeight: 500,
                                    }}
                                >
                                    <CalendarIcon size={16} />
                                    Day {currentDay}
                                    <ChevronIcon direction={showDaySelector ? 'up' : 'down'} size={14} />
                                </motion.button>
                            </div>

                            {/* Day Selector Dropdown */}
                            <AnimatePresence>
                                {showDaySelector && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        style={{ overflow: 'hidden', marginBottom: 12 }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                gap: 6,
                                                flexWrap: 'wrap',
                                                padding: '8px 0',
                                            }}
                                            onPointerMove={(e) => mouseX.set(e.clientX)}
                                            onPointerLeave={() => mouseX.set(Infinity)}
                                        >
                                            {days.map((day) => (
                                                <DayButton
                                                    key={day}
                                                    day={day}
                                                    isActive={day === currentDay}
                                                    isHovered={hoveredDay === day}
                                                    onClick={() => handleDayClick(day)}
                                                    onHover={() => setHoveredDay(day)}
                                                    onLeave={() => setHoveredDay(null)}
                                                    mouseX={mouseX}
                                                    setRef={setDayRef(day)}
                                                />
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Mini Elevation Profile */}
                            {elevationProfile && state === 'expanded' && (
                                <div style={{ marginTop: 8 }}>
                                    <MiniElevationProfile
                                        elevationProfile={elevationProfile}
                                        camps={trekData.camps}
                                        selectedCamp={selectedCamp}
                                        onDaySelect={handleElevationDaySelect}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Scrollable Timeline - Only in expanded state */}
                        {state === 'expanded' && (
                            <div
                                ref={contentRef}
                                style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    WebkitOverflowScrolling: 'touch',
                                    overscrollBehavior: 'contain',
                                    paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
                                }}
                            >
                                <JourneyTimeline
                                    trekData={trekData}
                                    photos={photos}
                                    getMediaUrl={getMediaUrl}
                                    selectedCamp={selectedCamp}
                                    onCampSelect={onCampSelect}
                                    onDayChange={onDayChange}
                                    onPhotoClick={onPhotoClick}
                                    onJourneyUpdate={onJourneyUpdate}
                                    isMobile={isMobile}
                                />
                            </div>
                        )}

                        {/* Peek state - Just show tap hint */}
                        {state === 'peek' && (
                            <div
                                onClick={() => setState('expanded')}
                                style={{
                                    flex: 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    color: colors.text.tertiary,
                                    fontSize: 14,
                                }}
                            >
                                <span>Tap or drag up to explore the journey</span>
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
});

// Day button with subtle hover effect
interface DayButtonProps {
    day: number;
    isActive: boolean;
    isHovered: boolean;
    onClick: () => void;
    onHover: () => void;
    onLeave: () => void;
    mouseX: ReturnType<typeof useMotionValue<number>>;
    setRef: (el: HTMLButtonElement | null) => void;
}

function DayButton({ day, isActive, isHovered, onClick, onHover, onLeave, mouseX, setRef }: DayButtonProps) {
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        setRef(ref.current);
        return () => setRef(null);
    }, [setRef]);

    const distance = useTransform(mouseX, (val) => {
        const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
        return val - bounds.x - bounds.width / 2;
    });

    const scale = useTransform(distance, [-60, 0, 60], [1, 1.15, 1]);
    const scaleSpring = useSpring(scale, { mass: 0.1, stiffness: 200, damping: 15 });

    const showHighlight = isHovered || isActive;

    return (
        <motion.button
            ref={ref}
            onClick={onClick}
            onPointerEnter={onHover}
            onPointerLeave={onLeave}
            style={{
                scale: scaleSpring,
                width: 40,
                height: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: showHighlight
                    ? 'rgba(255, 255, 255, 0.15)'
                    : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${showHighlight ? colors.glass.border : 'transparent'}`,
                borderRadius: radius.md,
                cursor: 'pointer',
                color: showHighlight ? colors.text.primary : colors.text.secondary,
                fontSize: 14,
                fontWeight: showHighlight ? 600 : 500,
            }}
            whileTap={{ scale: 0.9 }}
        >
            {day}
        </motion.button>
    );
}

export default JourneySheet;
