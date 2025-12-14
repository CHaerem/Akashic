/**
 * PlaybackControls - Journey playback UI controls
 *
 * Features:
 * - Play/Pause button to animate through the journey
 * - Progress bar showing current position
 * - Photo visibility toggle
 * - Smooth animations with Framer Motion
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';

interface PlaybackControlsProps {
    /** Whether playback is currently active */
    isPlaying: boolean;
    /** Playback progress (0-100) */
    progress: number;
    /** Called when play/pause is toggled */
    onPlayPause: () => void;
    /** Whether photo markers are visible */
    showPhotos: boolean;
    /** Called when photo visibility is toggled */
    onTogglePhotos: () => void;
    /** Whether we're on mobile */
    isMobile?: boolean;
    /** Total number of days */
    totalDays: number;
    /** Current day index (0-based) */
    currentDayIndex: number;
}

// Play icon SVG
const PlayIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 2.5v11l9-5.5-9-5.5z" />
    </svg>
);

// Pause icon SVG
const PauseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <rect x="3" y="2" width="4" height="12" rx="1" />
        <rect x="9" y="2" width="4" height="12" rx="1" />
    </svg>
);

// Photo icon SVG
const PhotoIcon = ({ visible }: { visible: boolean }) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: visible ? 1 : 0.4 }}>
        <rect x="1" y="3" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5" cy="6" r="1.5" />
        <path d="M3 11l3-3 2 2 4-4 3 3v2H3v0z" fill="currentColor" />
    </svg>
);

export const PlaybackControls = memo(function PlaybackControls({
    isPlaying,
    progress,
    onPlayPause,
    showPhotos,
    onTogglePhotos,
    isMobile = false,
    totalDays,
    currentDayIndex
}: PlaybackControlsProps) {
    const glassStyle: React.CSSProperties = {
        background: `linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)`,
        backdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
        WebkitBackdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
        border: `1px solid ${colors.glass.borderSubtle}`,
        boxShadow: shadows.glass.card,
    };

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: isMobile ? '8px 12px' : '10px 16px',
                ...glassStyle,
                borderRadius: radius.lg,
            }}
        >
            {/* Play/Pause Button */}
            <motion.button
                onClick={onPlayPause}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: isPlaying
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(96, 165, 250, 0.2)',
                    border: `1px solid ${isPlaying ? 'rgba(239, 68, 68, 0.4)' : 'rgba(96, 165, 250, 0.4)'}`,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isPlaying ? colors.accent.error : colors.accent.primary,
                    transition: 'all 0.2s ease',
                }}
                aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
            >
                <AnimatePresence mode="wait">
                    <motion.div
                        key={isPlaying ? 'pause' : 'play'}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </motion.div>
                </AnimatePresence>
            </motion.button>

            {/* Progress Bar */}
            <div
                style={{
                    flex: 1,
                    minWidth: isMobile ? 80 : 120,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                }}
            >
                {/* Progress track */}
                <div
                    style={{
                        height: 4,
                        background: 'rgba(255, 255, 255, 0.15)',
                        borderRadius: 2,
                        overflow: 'hidden',
                    }}
                >
                    <motion.div
                        animate={{ width: `${progress}%` }}
                        transition={{ type: 'spring', stiffness: 200, damping: 30 }}
                        style={{
                            height: '100%',
                            background: `linear-gradient(90deg, ${colors.accent.primary}, ${colors.accent.secondary || colors.accent.primary})`,
                            borderRadius: 2,
                        }}
                    />
                </div>

                {/* Day indicator */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: 10,
                        color: colors.text.tertiary,
                    }}
                >
                    <span>Day {currentDayIndex + 1}</span>
                    <span>Day {totalDays}</span>
                </div>
            </div>

            {/* Photo Toggle */}
            <motion.button
                onClick={onTogglePhotos}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.md,
                    background: showPhotos
                        ? 'rgba(96, 165, 250, 0.15)'
                        : 'rgba(255, 255, 255, 0.06)',
                    border: `1px solid ${showPhotos ? 'rgba(96, 165, 250, 0.3)' : colors.glass.borderSubtle}`,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: showPhotos ? colors.accent.primary : colors.text.subtle,
                    transition: 'all 0.2s ease',
                }}
                aria-label={showPhotos ? 'Hide photos on map' : 'Show photos on map'}
                title={showPhotos ? 'Hide photos on map' : 'Show photos on map'}
            >
                <PhotoIcon visible={showPhotos} />
            </motion.button>
        </div>
    );
});

export default PlaybackControls;
