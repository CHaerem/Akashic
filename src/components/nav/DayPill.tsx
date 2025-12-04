/**
 * DayPill - Simplified navigation pill for day selection
 *
 * States:
 * - Collapsed: Shows "Day X • CampName" - tap to expand
 * - Expanded: Shows day numbers with magnification effect
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
    motion,
    useMotionValue,
    useSpring,
    useTransform,
    type MotionValue,
} from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';
import type { Camp } from '../../types/trek';

const SPRING_CONFIG = {
    mass: 0.1,
    stiffness: 200,
    damping: 15,
};

// Calendar icon
const CalendarIcon = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
);

// Day item with magnification effect
interface DayItemProps {
    mouseX: MotionValue<number>;
    day: number;
    isActive: boolean;
    isHovered: boolean;
    onClick: () => void;
    onHover: () => void;
    setRef: (el: HTMLButtonElement | null) => void;
}

function DayItem({ mouseX, day, isActive, isHovered, onClick, onHover, setRef }: DayItemProps) {
    const localRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        setRef(localRef.current);
        return () => setRef(null);
    }, [setRef]);

    const distance = useTransform(mouseX, (val) => {
        const bounds = localRef.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
        return val - bounds.x - bounds.width / 2;
    });

    const scale = useTransform(distance, [-50, 0, 50], [1, 1.4, 1]);
    const scaleSpring = useSpring(scale, SPRING_CONFIG);

    const showBubble = isHovered || isActive;
    const bubbleStyle = showBubble ? {
        background: `linear-gradient(135deg, rgba(255, 255, 255, ${isHovered ? 0.28 : 0.22}) 0%, rgba(255, 255, 255, ${isHovered ? 0.14 : 0.1}) 100%)`,
        boxShadow: `0 4px 16px rgba(0, 0, 0, ${isHovered ? 0.3 : 0.2}), inset 0 1px 0 rgba(255, 255, 255, ${isHovered ? 0.4 : 0.35}), 0 0 0 1px rgba(255, 255, 255, ${isHovered ? 0.25 : 0.2})`,
    } : {};

    return (
        <motion.button
            ref={localRef}
            onClick={onClick}
            onPointerEnter={onHover}
            style={{
                scale: scaleSpring,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                background: 'transparent',
                border: 'none',
                borderRadius: radius.pill,
                cursor: 'pointer',
                color: (isHovered || isActive) ? colors.text.primary : colors.text.secondary,
                fontSize: (isHovered || isActive) ? 15 : 14,
                fontWeight: (isHovered || isActive) ? 600 : 500,
                transformOrigin: 'bottom center',
                touchAction: 'none',
                ...bubbleStyle,
            }}
            whileTap={{ scale: 0.9 }}
        >
            {day}
        </motion.button>
    );
}

type PillMode = 'collapsed' | 'expanded';

interface DayPillProps {
    selectedCamp: Camp | null;
    totalDays: number;
    onDaySelect: (dayNumber: number) => void;
    isMobile: boolean;
}

export const DayPill = memo(function DayPill({
    selectedCamp,
    totalDays,
    onDaySelect,
    isMobile,
}: DayPillProps) {
    const [mode, setMode] = useState<PillMode>('collapsed');
    const [isDragging, setIsDragging] = useState(false);
    const [hoveredDay, setHoveredDay] = useState<number | null>(null);

    const pillRef = useRef<HTMLDivElement>(null);
    const mouseX = useMotionValue(Infinity);
    const dayRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? 'Start';

    // Find which day is under the pointer
    const findDayUnderPointer = useCallback((clientX: number) => {
        for (const [day, ref] of dayRefs.current.entries()) {
            if (ref) {
                const rect = ref.getBoundingClientRect();
                if (clientX >= rect.left && clientX <= rect.right) {
                    return day;
                }
            }
        }
        return null;
    }, []);

    // Pointer handlers for drag-to-select
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        if (mode === 'collapsed') return;
        setIsDragging(true);
        mouseX.set(e.clientX);
        const day = findDayUnderPointer(e.clientX);
        if (day !== null) setHoveredDay(day);
    }, [mode, mouseX, findDayUnderPointer]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        mouseX.set(e.clientX);
        if (isDragging) {
            const day = findDayUnderPointer(e.clientX);
            setHoveredDay(day);
        }
    }, [isDragging, mouseX, findDayUnderPointer]);

    const handlePointerUp = useCallback(() => {
        if (isDragging && hoveredDay !== null) {
            onDaySelect(hoveredDay);
            setMode('collapsed');
        }
        setIsDragging(false);
        setHoveredDay(null);
    }, [isDragging, hoveredDay, onDaySelect]);

    const handlePointerLeave = useCallback(() => {
        if (!isDragging) {
            mouseX.set(Infinity);
        }
    }, [isDragging, mouseX]);

    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            const target = e.target as Node;
            if (!pillRef.current?.contains(target)) {
                setMode('collapsed');
                mouseX.set(Infinity);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [mouseX]);

    // Cancel drag on pointer up anywhere
    useEffect(() => {
        const handleGlobalPointerUp = () => {
            if (isDragging) handlePointerUp();
        };

        window.addEventListener('pointerup', handleGlobalPointerUp);
        window.addEventListener('touchend', handleGlobalPointerUp);

        return () => {
            window.removeEventListener('pointerup', handleGlobalPointerUp);
            window.removeEventListener('touchend', handleGlobalPointerUp);
        };
    }, [isDragging, handlePointerUp]);

    const handlePillClick = useCallback(() => {
        if (mode === 'collapsed') {
            setMode('expanded');
        }
    }, [mode]);

    const handleDayClick = useCallback((dayNumber: number) => {
        if (isDragging) return;
        onDaySelect(dayNumber);
        setMode('collapsed');
    }, [isDragging, onDaySelect]);

    const days = Array.from({ length: totalDays }, (_, i) => i + 1);

    const setDayRef = useCallback((day: number) => (el: HTMLButtonElement | null) => {
        dayRefs.current.set(day, el);
    }, []);

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
                position: 'absolute',
                bottom: isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 32,
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                zIndex: 150, // Above JourneySheet
                pointerEvents: 'none',
            }}
        >
            <motion.div
                ref={pillRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                style={{
                    pointerEvents: 'auto',
                    touchAction: 'none',
                }}
            >
                <motion.div
                    onClick={mode === 'collapsed' ? handlePillClick : undefined}
                    layout
                    style={{
                        ...glassStyle,
                        borderRadius: mode === 'collapsed' ? radius.pill : radius.xl,
                        padding: mode === 'collapsed' ? (isMobile ? '10px 18px' : '12px 22px') : '8px 12px',
                        cursor: mode === 'collapsed' ? 'pointer' : 'default',
                        minHeight: isMobile ? 48 : 52,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        userSelect: 'none',
                    }}
                    transition={{ type: 'spring', ...SPRING_CONFIG }}
                >
                    {/* Collapsed State */}
                    {mode === 'collapsed' && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                color: colors.text.primary,
                            }}
                        >
                            <CalendarIcon size={isMobile ? 18 : 20} />
                            <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                Day {currentDay}
                                <span style={{ color: colors.text.tertiary, margin: '0 6px' }}>•</span>
                                {currentCampName}
                            </span>
                        </motion.div>
                    )}

                    {/* Expanded State - Day Selector */}
                    {mode === 'expanded' && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            style={{ display: 'flex', alignItems: 'center', gap: 2, paddingBottom: 2 }}
                        >
                            {days.map((day) => (
                                <DayItem
                                    key={day}
                                    mouseX={mouseX}
                                    day={day}
                                    isActive={day === currentDay}
                                    isHovered={hoveredDay === day}
                                    onClick={() => handleDayClick(day)}
                                    onHover={() => !isDragging && setHoveredDay(day)}
                                    setRef={setDayRef(day)}
                                />
                            ))}
                        </motion.div>
                    )}
                </motion.div>
            </motion.div>
        </div>
    );
});

export default DayPill;
