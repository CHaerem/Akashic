/**
 * TimelineScrubber - Scrub through the journey timeline
 *
 * Features:
 * - Horizontal timeline with camp/waypoint markers
 * - Drag to scrub through days
 * - Shows info tooltip at current position
 * - Photo thumbnails at timeline points
 */

import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, effects, shadows, radius } from '../../styles/liquidGlass';
import type { Camp, Photo } from '../../types/trek';
import { getDateForDay, isPhotoFromDay, formatDateShort } from '../../utils/dates';

interface TimelineScrubberProps {
    camps: Camp[];
    photos: Photo[];
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    getMediaUrl: (path: string) => string;
    isMobile: boolean;
    inline?: boolean; // When true, removes outer glass styling for embedding
    dateStarted?: string; // Journey start date for calculating camp dates
}

export const TimelineScrubber = memo(function TimelineScrubber({
    camps,
    photos,
    selectedCamp,
    onCampSelect,
    getMediaUrl,
    isMobile,
    inline = false,
    dateStarted,
}: TimelineScrubberProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [hoverCamp, setHoverCamp] = useState<Camp | null>(null);
    const [showTooltip, setShowTooltip] = useState(false);
    const trackRef = useRef<HTMLDivElement>(null);
    const tooltipTimeoutRef = useRef<number | null>(null);

    const currentDayIndex = selectedCamp
        ? camps.findIndex(c => c.dayNumber === selectedCamp.dayNumber)
        : 0;

    // Group photos by camp
    const photosByDay = useMemo(() => {
        const grouped = new Map<number, Photo[]>();
        camps.forEach(camp => {
            const campDate = getDateForDay(dateStarted, camp.dayNumber);
            const campPhotos = campDate
                ? photos.filter(p => isPhotoFromDay(p, campDate))
                : [];
            grouped.set(camp.dayNumber, campPhotos);
        });
        return grouped;
    }, [camps, photos, dateStarted]);

    // Get camp at position
    const getCampAtPosition = useCallback((clientX: number) => {
        if (!trackRef.current || camps.length === 0) return null;
        const rect = trackRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const progress = Math.max(0, Math.min(1, x / rect.width));
        const index = Math.round(progress * (camps.length - 1));
        return camps[index];
    }, [camps]);

    // Handle pointer events for scrubbing
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        setIsDragging(true);
        setShowTooltip(true);
        const camp = getCampAtPosition(e.clientX);
        if (camp) {
            setHoverCamp(camp);
            onCampSelect(camp);
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [getCampAtPosition, onCampSelect]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        const camp = getCampAtPosition(e.clientX);
        if (camp && camp !== hoverCamp) {
            setHoverCamp(camp);
            onCampSelect(camp);
        }
    }, [isDragging, getCampAtPosition, hoverCamp, onCampSelect]);

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
        setIsDragging(false);
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        // Hide tooltip after delay
        if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = window.setTimeout(() => {
            setShowTooltip(false);
            setHoverCamp(null);
        }, 1500);
    }, []);

    // Clear timeout on unmount
    useEffect(() => {
        return () => {
            if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
        };
    }, []);

    // Handle marker click
    const handleMarkerClick = useCallback((camp: Camp) => {
        onCampSelect(camp);
        setHoverCamp(camp);
        setShowTooltip(true);
        if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = window.setTimeout(() => {
            setShowTooltip(false);
            setHoverCamp(null);
        }, 2000);
    }, [onCampSelect]);

    // Glass style
    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.05) 100%)`,
        backdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.borderSubtle}`,
        boxShadow: shadows.glass.card,
    };

    const tooltipGlassStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
        backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.border}`,
        boxShadow: shadows.glass.elevated,
    };

    const displayCamp = hoverCamp || selectedCamp;
    const displayPhotos = displayCamp ? photosByDay.get(displayCamp.dayNumber) || [] : [];
    const displayCampDate = displayCamp ? getDateForDay(dateStarted, displayCamp.dayNumber) : null;

    return (
        <div
            style={{
                position: 'relative',
                width: inline ? (isMobile ? 240 : 280) : (isMobile ? 'calc(100% - 32px)' : 360),
                maxWidth: inline ? 320 : 400,
            }}
        >
            {/* Tooltip */}
            <AnimatePresence>
                {showTooltip && displayCamp && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            ...tooltipGlassStyle,
                            position: 'absolute',
                            bottom: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            marginBottom: 12,
                            borderRadius: radius.lg,
                            padding: 12,
                            minWidth: 200,
                            zIndex: 10,
                        }}
                    >
                        {/* Day badge */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 6,
                        }}>
                            <span style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: colors.accent.primary,
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                background: 'rgba(96, 165, 250, 0.15)',
                                padding: '2px 6px',
                                borderRadius: 4,
                            }}>
                                Day {displayCamp.dayNumber}
                            </span>
                            {displayCampDate && (
                                <span style={{
                                    fontSize: 11,
                                    color: colors.text.tertiary,
                                }}>
                                    {formatDateShort(displayCampDate)}
                                </span>
                            )}
                        </div>

                        {/* Camp name */}
                        <h4 style={{
                            fontSize: 15,
                            fontWeight: 600,
                            color: colors.text.primary,
                            margin: 0,
                            marginBottom: 4,
                        }}>
                            {displayCamp.name}
                        </h4>

                        {/* Elevation */}
                        <p style={{
                            fontSize: 12,
                            color: colors.text.secondary,
                            margin: 0,
                        }}>
                            {displayCamp.elevation}m elevation
                        </p>

                        {/* Photo thumbnails */}
                        {displayPhotos.length > 0 && (
                            <div style={{
                                display: 'flex',
                                gap: 6,
                                marginTop: 10,
                                overflowX: 'auto',
                            }}>
                                {displayPhotos.slice(0, 4).map((photo) => (
                                    <div
                                        key={photo.id}
                                        style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: 6,
                                            overflow: 'hidden',
                                            flexShrink: 0,
                                            border: `1px solid ${colors.glass.borderSubtle}`,
                                        }}
                                    >
                                        <img
                                            src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                            alt=""
                                            style={{
                                                width: '100%',
                                                height: '100%',
                                                objectFit: 'cover',
                                            }}
                                        />
                                    </div>
                                ))}
                                {displayPhotos.length > 4 && (
                                    <div style={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: 6,
                                        background: 'rgba(255,255,255,0.08)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 11,
                                        color: colors.text.secondary,
                                        flexShrink: 0,
                                    }}>
                                        +{displayPhotos.length - 4}
                                    </div>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Timeline track */}
            <div
                ref={trackRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{
                    ...(inline ? {} : glassStyle),
                    borderRadius: inline ? radius.md : radius.pill,
                    padding: inline ? '8px 12px' : '12px 16px',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    background: inline ? 'rgba(255, 255, 255, 0.06)' : glassStyle.background,
                }}
            >
                {/* Track line */}
                <div style={{
                    position: 'relative',
                    height: 4,
                    background: 'rgba(255, 255, 255, 0.15)',
                    borderRadius: 2,
                }}>
                    {/* Progress fill */}
                    <motion.div
                        animate={{
                            width: `${(currentDayIndex / Math.max(1, camps.length - 1)) * 100}%`,
                        }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            background: `linear-gradient(90deg, ${colors.accent.primary}, ${colors.accent.secondary || colors.accent.primary})`,
                            borderRadius: 2,
                        }}
                    />

                    {/* Camp markers */}
                    {camps.map((camp, index) => {
                        const position = (index / Math.max(1, camps.length - 1)) * 100;
                        const isActive = camp.dayNumber === selectedCamp?.dayNumber;
                        const isHovered = camp.dayNumber === hoverCamp?.dayNumber;
                        const hasPhotos = (photosByDay.get(camp.dayNumber)?.length || 0) > 0;

                        return (
                            <motion.button
                                key={camp.dayNumber}
                                onClick={() => handleMarkerClick(camp)}
                                whileHover={{ scale: 1.3 }}
                                whileTap={{ scale: 0.9 }}
                                animate={{
                                    scale: isActive || isHovered ? 1.2 : 1,
                                }}
                                style={{
                                    position: 'absolute',
                                    left: `${position}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: isActive || isHovered ? 14 : 10,
                                    height: isActive || isHovered ? 14 : 10,
                                    borderRadius: '50%',
                                    background: isActive
                                        ? colors.text.primary
                                        : hasPhotos
                                            ? colors.accent.primary
                                            : 'rgba(255, 255, 255, 0.5)',
                                    border: isActive || isHovered
                                        ? `2px solid ${colors.text.primary}`
                                        : 'none',
                                    boxShadow: isActive
                                        ? `0 0 8px ${colors.accent.primary}`
                                        : 'none',
                                    cursor: 'pointer',
                                    padding: 0,
                                    zIndex: isActive || isHovered ? 2 : 1,
                                }}
                            />
                        );
                    })}
                </div>

                {/* Day labels */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 8,
                    fontSize: 10,
                    color: colors.text.tertiary,
                }}>
                    <span>Day 1</span>
                    <span>Day {camps.length}</span>
                </div>
            </div>
        </div>
    );
});

export default TimelineScrubber;
