/**
 * JourneySheet - Floating pill navigation + optional detail sheet
 *
 * The pill IS the navigation - stays on screen, doesn't take focus from map.
 * - Collapsed: "Day X · CampName"
 * - Expanded: Day selector in a wider floating pill
 * - Details button opens the full sheet only when wanted
 */

import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { TrekData, ExtendedStats, ElevationProfile, Camp, Photo } from '../../types/trek';
import { JourneyTimeline } from './JourneyTimeline';
import { MiniElevationProfile } from './MiniElevationProfile';

// Icons
const CalendarIcon = ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
);

const ListIcon = ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/>
        <line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/>
        <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
);

const CloseIcon = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
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

const SPRING = { type: 'spring', mass: 0.3, stiffness: 400, damping: 30 };

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
    const [pillExpanded, setPillExpanded] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const pillRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? trekData.camps[0]?.name ?? 'Start';
    const totalDays = trekData.stats.duration;

    // Click outside pill to collapse
    useEffect(() => {
        if (!pillExpanded) return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
                setPillExpanded(false);
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }, 50);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [pillExpanded]);

    // Handle day selection from pill
    const handleDayClick = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        setPillExpanded(false);
    }, [onDayChange]);

    // Handle day selection from sheet elevation profile
    const handleElevationDaySelect = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        setTimeout(() => {
            if (contentRef.current) {
                const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
                dayElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 50);
    }, [onDayChange]);

    // Open sheet
    const openSheet = useCallback(() => {
        setPillExpanded(false);
        setSheetOpen(true);
    }, []);

    // Liquid Glass pill style
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

    // Sheet glass style
    const sheetGlassStyle: React.CSSProperties = {
        background: `linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.10) 0%,
            rgba(255, 255, 255, 0.05) 50%,
            rgba(15, 15, 20, 0.98) 100%
        )`,
        backdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.intense} ${effects.saturation.enhanced}`,
        borderTop: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.panel,
    };

    return (
        <>
            {/* Floating Navigation Pill */}
            {!sheetOpen && (
                <motion.div
                    ref={pillRef}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={SPRING}
                    style={{
                        position: 'fixed',
                        bottom: isMobile ? 'calc(28px + env(safe-area-inset-bottom))' : 32,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 150,
                        borderRadius: radius.pill,
                        ...glassStyle,
                    }}
                >
                    <motion.div
                        layout
                        transition={SPRING}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: pillExpanded ? 6 : 10,
                            padding: pillExpanded ? '10px 14px' : '12px 18px',
                            minHeight: isMobile ? 48 : 52,
                        }}
                    >
                        {/* Collapsed: Day info */}
                        <AnimatePresence mode="wait">
                            {!pillExpanded && (
                                <motion.div
                                    key="collapsed"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    onClick={() => setPillExpanded(true)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        cursor: 'pointer',
                                        color: colors.text.primary,
                                    }}
                                >
                                    <CalendarIcon size={18} />
                                    <span style={{
                                        fontSize: 15,
                                        fontWeight: 500,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        Day {currentDay}
                                        <span style={{ color: colors.text.tertiary, margin: '0 8px' }}>·</span>
                                        {currentCampName}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Expanded: Day selector */}
                        <AnimatePresence mode="wait">
                            {pillExpanded && (
                                <motion.div
                                    key="expanded"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                    }}
                                >
                                    {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                                        const isActive = day === currentDay;
                                        return (
                                            <motion.button
                                                key={day}
                                                onClick={() => handleDayClick(day)}
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.95 }}
                                                style={{
                                                    width: 38,
                                                    height: 38,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    background: isActive
                                                        ? 'rgba(255, 255, 255, 0.2)'
                                                        : 'transparent',
                                                    border: isActive
                                                        ? `1px solid ${colors.glass.border}`
                                                        : '1px solid transparent',
                                                    borderRadius: radius.md,
                                                    cursor: 'pointer',
                                                    color: isActive ? colors.text.primary : colors.text.secondary,
                                                    fontSize: 14,
                                                    fontWeight: isActive ? 600 : 500,
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                {day}
                                            </motion.button>
                                        );
                                    })}

                                    {/* Divider */}
                                    <div style={{
                                        width: 1,
                                        height: 24,
                                        background: colors.glass.borderSubtle,
                                        margin: '0 6px',
                                    }} />

                                    {/* Details button */}
                                    <motion.button
                                        onClick={openSheet}
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        style={{
                                            width: 38,
                                            height: 38,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'rgba(255, 255, 255, 0.08)',
                                            border: `1px solid ${colors.glass.borderSubtle}`,
                                            borderRadius: radius.md,
                                            cursor: 'pointer',
                                            color: colors.text.secondary,
                                        }}
                                        title="View journey details"
                                    >
                                        <ListIcon size={16} />
                                    </motion.button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </motion.div>
            )}

            {/* Detail Sheet (overlay) */}
            <AnimatePresence>
                {sheetOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={() => setSheetOpen(false)}
                            style={{
                                position: 'fixed',
                                inset: 0,
                                background: 'rgba(0, 0, 0, 0.4)',
                                zIndex: 149,
                            }}
                        />

                        {/* Sheet */}
                        <motion.div
                            ref={sheetRef}
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', mass: 0.4, stiffness: 300, damping: 30 }}
                            style={{
                                position: 'fixed',
                                bottom: 0,
                                left: 0,
                                right: 0,
                                height: '85vh',
                                zIndex: 150,
                                display: 'flex',
                                flexDirection: 'column',
                                borderTopLeftRadius: radius.xl,
                                borderTopRightRadius: radius.xl,
                                overflow: 'hidden',
                                ...sheetGlassStyle,
                            }}
                        >
                            {/* Header */}
                            <div style={{
                                padding: '16px 20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexShrink: 0,
                                borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                            }}>
                                <div>
                                    <h2 style={{
                                        fontSize: 20,
                                        fontWeight: 600,
                                        color: colors.text.primary,
                                        margin: 0,
                                        letterSpacing: '-0.02em',
                                    }}>
                                        {trekData.name}
                                    </h2>
                                    <p style={{
                                        fontSize: 13,
                                        color: colors.text.secondary,
                                        margin: '4px 0 0',
                                    }}>
                                        {trekData.stats.distance} km · {trekData.stats.duration} days
                                    </p>
                                </div>

                                {/* Close button */}
                                <motion.button
                                    onClick={() => setSheetOpen(false)}
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    style={{
                                        width: 40,
                                        height: 40,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: 'rgba(255, 255, 255, 0.08)',
                                        border: `1px solid ${colors.glass.borderSubtle}`,
                                        borderRadius: radius.md,
                                        cursor: 'pointer',
                                        color: colors.text.secondary,
                                    }}
                                >
                                    <CloseIcon size={18} />
                                </motion.button>
                            </div>

                            {/* Elevation Profile */}
                            {elevationProfile && (
                                <div style={{ padding: '16px 20px', flexShrink: 0 }}>
                                    <MiniElevationProfile
                                        elevationProfile={elevationProfile}
                                        camps={trekData.camps}
                                        selectedCamp={selectedCamp}
                                        onDaySelect={handleElevationDaySelect}
                                    />
                                </div>
                            )}

                            {/* Scrollable Timeline */}
                            <div
                                ref={contentRef}
                                style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    WebkitOverflowScrolling: 'touch',
                                    overscrollBehavior: 'contain',
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

                                {/* Bottom safe area */}
                                <div style={{ height: 'calc(24px + env(safe-area-inset-bottom))' }} />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
});

export default JourneySheet;
