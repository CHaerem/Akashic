/**
 * JourneySheet - Immersive bottom sheet for exploring the trek journey
 *
 * Features:
 * - 4 snap points: collapsed (12vh), peek (25vh), half (50vh), expanded (85vh)
 * - Drag-to-snap with velocity detection
 * - Scroll vs drag detection (drag when at scroll top, scroll otherwise)
 * - Liquid Glass styling
 */

import { memo, useRef, useCallback, useState, useEffect } from 'react';
import { useDragGesture } from '../../hooks/useDragGesture';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { TrekData, ExtendedStats, ElevationProfile, Camp, Photo } from '../../types/trek';
import { JourneyTimeline } from './JourneyTimeline';
import { JourneyHeader } from './JourneyHeader';

// Snap points as percentages of viewport height
const SNAP_POINTS = [12, 25, 50, 85]; // collapsed, peek, half, expanded

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
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [snapIndex, setSnapIndex] = useState(1); // Start at peek (25vh)
    const [isContentScrollable, setIsContentScrollable] = useState(false);

    // Track if content is scrolled to top (for drag vs scroll decision)
    const isAtScrollTop = useRef(true);

    // Handle snap point changes
    const handleSnapChange = useCallback((newIndex: number) => {
        setSnapIndex(newIndex);
    }, []);

    // Use the drag gesture hook
    const [{ isDragging }, dragHandlers] = useDragGesture({
        snapPoints: SNAP_POINTS,
        currentSnapIndex: snapIndex,
        onSnapChange: handleSnapChange,
        panelRef,
        velocityThreshold: 0.5,
        distanceThreshold: 50,
    });

    // Check if content is scrollable based on snap point
    useEffect(() => {
        // Only allow content scroll at half or expanded
        setIsContentScrollable(snapIndex >= 2);
    }, [snapIndex]);

    // Track scroll position for drag vs scroll decision
    const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        isAtScrollTop.current = e.currentTarget.scrollTop <= 0;
    }, []);

    // Custom touch handlers that decide between drag and scroll
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // If at scroll top or not scrollable, let drag gesture handle it
        if (isAtScrollTop.current || !isContentScrollable) {
            dragHandlers.onTouchStart(e);
        }
    }, [dragHandlers, isContentScrollable]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (isDragging) {
            dragHandlers.onTouchMove(e);
        }
    }, [dragHandlers, isDragging]);

    const handleTouchEnd = useCallback(() => {
        if (isDragging) {
            dragHandlers.onTouchEnd();
        }
    }, [dragHandlers, isDragging]);

    // Scroll to specific day
    const scrollToDay = useCallback((dayNumber: number) => {
        if (contentRef.current) {
            const dayElement = contentRef.current.querySelector(`[data-day="${dayNumber}"]`);
            if (dayElement) {
                dayElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
        // Expand to at least half if collapsed
        if (snapIndex < 2) {
            setSnapIndex(2);
            if (panelRef.current) {
                const vh = window.innerHeight / 100;
                panelRef.current.style.transition = 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
                panelRef.current.style.height = `${SNAP_POINTS[2] * vh}px`;
            }
        }
    }, [snapIndex]);

    // Set initial height on mount
    useEffect(() => {
        if (panelRef.current) {
            const vh = window.innerHeight / 100;
            panelRef.current.style.height = `${SNAP_POINTS[snapIndex] * vh}px`;
        }
    }, []);

    // Glass styling for the sheet
    const sheetStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: `linear-gradient(180deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 30%,
            rgba(10, 10, 15, 0.98) 100%
        )`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        borderTop: `1px solid ${colors.glass.border}`,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
        boxShadow: shadows.glass.panel,
        zIndex: 100,
        touchAction: 'none',
        willChange: isDragging ? 'height' : 'auto',
        transition: isDragging ? 'none' : 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
    };

    return (
        <div
            ref={panelRef}
            style={sheetStyle}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Drag Handle */}
            <div
                style={{
                    padding: '12px 0 8px',
                    display: 'flex',
                    justifyContent: 'center',
                    cursor: 'grab',
                    touchAction: 'none',
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

            {/* Header - always visible */}
            <JourneyHeader
                trekData={trekData}
                extendedStats={extendedStats}
                elevationProfile={elevationProfile}
                selectedCamp={selectedCamp}
                onDaySelect={scrollToDay}
                isCompact={snapIndex < 2}
            />

            {/* Scrollable Content */}
            <div
                ref={contentRef}
                onScroll={handleContentScroll}
                style={{
                    flex: 1,
                    overflowY: isContentScrollable ? 'auto' : 'hidden',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain',
                    paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
                    opacity: snapIndex >= 1 ? 1 : 0,
                    transition: 'opacity 0.2s ease-out',
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
        </div>
    );
});

export default JourneySheet;
