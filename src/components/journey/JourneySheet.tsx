/**
 * JourneySheet - Clean bottom sheet with pill-to-sheet morphing
 *
 * Two states only:
 * - Collapsed: Centered floating pill
 * - Expanded: Full-width bottom sheet with timeline
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

const ChevronDown = ({ size = 16 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"/>
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
    const [isExpanded, setIsExpanded] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? trekData.camps[0]?.name ?? 'Start';
    const totalDays = trekData.stats.duration;

    // Click outside to collapse
    useEffect(() => {
        if (!isExpanded) return;

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
                setIsExpanded(false);
            }
        };

        // Delay adding listener to avoid immediate trigger
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isExpanded]);

    // Handle day selection
    const handleDayClick = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        // Scroll to day in timeline
        setTimeout(() => {
            if (contentRef.current) {
                const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
                dayElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 50);
    }, [onDayChange]);

    // Scroll to day from elevation profile
    const handleElevationDaySelect = useCallback((dayNumber: number) => {
        onDayChange(dayNumber);
        setTimeout(() => {
            if (contentRef.current) {
                const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
                dayElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 50);
    }, [onDayChange]);

    // Glass pill style
    const pillGlass: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)`,
        backdropFilter: `blur(20px) saturate(180%)`,
        WebkitBackdropFilter: `blur(20px) saturate(180%)`,
        border: `1px solid rgba(255, 255, 255, 0.15)`,
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)`,
    };

    // Glass sheet style
    const sheetGlass: React.CSSProperties = {
        background: `linear-gradient(180deg,
            rgba(30, 30, 35, 0.95) 0%,
            rgba(20, 20, 25, 0.98) 100%
        )`,
        backdropFilter: `blur(40px) saturate(180%)`,
        WebkitBackdropFilter: `blur(40px) saturate(180%)`,
        borderTop: `1px solid rgba(255, 255, 255, 0.1)`,
        boxShadow: `0 -8px 32px rgba(0, 0, 0, 0.4)`,
    };

    return (
        <>
            {/* Collapsed Pill */}
            <AnimatePresence>
                {!isExpanded && (
                    <motion.button
                        initial={{ opacity: 0, y: 20, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ type: 'spring', mass: 0.3, stiffness: 300, damping: 25 }}
                        onClick={() => setIsExpanded(true)}
                        style={{
                            position: 'fixed',
                            bottom: isMobile ? 'calc(28px + env(safe-area-inset-bottom))' : 32,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 150,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '14px 20px',
                            borderRadius: 50,
                            cursor: 'pointer',
                            color: colors.text.primary,
                            fontSize: 15,
                            fontWeight: 500,
                            ...pillGlass,
                        }}
                    >
                        <CalendarIcon size={18} />
                        <span>
                            Day {currentDay}
                            <span style={{ color: colors.text.tertiary, margin: '0 8px' }}>·</span>
                            {currentCampName}
                        </span>
                    </motion.button>
                )}
            </AnimatePresence>

            {/* Expanded Sheet */}
            <AnimatePresence>
                {isExpanded && (
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
                            borderTopLeftRadius: 20,
                            borderTopRightRadius: 20,
                            overflow: 'hidden',
                            ...sheetGlass,
                        }}
                    >
                        {/* Handle + Close area */}
                        <div
                            onClick={() => setIsExpanded(false)}
                            style={{
                                padding: '12px 0 8px',
                                display: 'flex',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                flexShrink: 0,
                            }}
                        >
                            <div style={{
                                width: 36,
                                height: 5,
                                borderRadius: 3,
                                background: 'rgba(255, 255, 255, 0.3)',
                            }} />
                        </div>

                        {/* Header */}
                        <div style={{
                            padding: '0 20px 16px',
                            flexShrink: 0,
                        }}>
                            {/* Trek Title */}
                            <h2 style={{
                                fontSize: 22,
                                fontWeight: 600,
                                color: colors.text.primary,
                                margin: '0 0 4px',
                                letterSpacing: '-0.02em',
                            }}>
                                {trekData.name}
                            </h2>
                            <p style={{
                                fontSize: 14,
                                color: colors.text.secondary,
                                margin: '0 0 16px',
                            }}>
                                {trekData.stats.distance} km · {trekData.stats.duration} days · {trekData.stats.maxElevation}m peak
                            </p>

                            {/* Day Selector */}
                            <div style={{
                                display: 'flex',
                                gap: 8,
                                overflowX: 'auto',
                                paddingBottom: 4,
                                marginBottom: 16,
                                WebkitOverflowScrolling: 'touch',
                                msOverflowStyle: 'none',
                                scrollbarWidth: 'none',
                            }}>
                                {Array.from({ length: totalDays }, (_, i) => i + 1).map((day) => {
                                    const isActive = day === currentDay;
                                    return (
                                        <button
                                            key={day}
                                            onClick={() => handleDayClick(day)}
                                            style={{
                                                flexShrink: 0,
                                                width: 44,
                                                height: 44,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                background: isActive
                                                    ? 'rgba(255, 255, 255, 0.15)'
                                                    : 'rgba(255, 255, 255, 0.05)',
                                                border: isActive
                                                    ? '1px solid rgba(255, 255, 255, 0.25)'
                                                    : '1px solid transparent',
                                                borderRadius: 12,
                                                cursor: 'pointer',
                                                color: isActive ? colors.text.primary : colors.text.secondary,
                                                fontSize: 15,
                                                fontWeight: isActive ? 600 : 400,
                                                transition: 'all 0.15s ease',
                                            }}
                                        >
                                            {day}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Elevation Profile */}
                            {elevationProfile && (
                                <MiniElevationProfile
                                    elevationProfile={elevationProfile}
                                    camps={trekData.camps}
                                    selectedCamp={selectedCamp}
                                    onDaySelect={handleElevationDaySelect}
                                />
                            )}
                        </div>

                        {/* Divider */}
                        <div style={{
                            height: 1,
                            background: 'rgba(255, 255, 255, 0.08)',
                            marginLeft: 20,
                            marginRight: 20,
                        }} />

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
                )}
            </AnimatePresence>
        </>
    );
});

export default JourneySheet;
