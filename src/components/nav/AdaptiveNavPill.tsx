import { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { colors, radius, transitions, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType } from '../../types/trek';

// Magnification constants (based on macOS dock behavior)
const MAGNIFICATION = {
  scale: 1.5,           // Max scale when directly under cursor
  distance: 100,        // Pixels before cursor affects an icon
  baseSize: 44,         // Base icon size in pixels
};

const SPRING_CONFIG = {
  mass: 0.1,
  stiffness: 170,
  damping: 12,
};

// Icons as simple SVG components
const CalendarIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const MapIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
);

const PhotoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const StatsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const InfoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
);

type NavMode = 'collapsed' | 'expanded' | 'days';

interface NavOption {
  id: TabType | 'info';
  icon: React.ReactNode;
  label: string;
}

const NAV_OPTIONS: NavOption[] = [
  { id: 'journey', icon: <CalendarIcon />, label: 'Days' },
  { id: 'overview', icon: <InfoIcon />, label: 'Info' },
  { id: 'photos', icon: <PhotoIcon />, label: 'Photos' },
  { id: 'stats', icon: <StatsIcon />, label: 'Stats' },
];

// Individual dock item with magnification
interface DockItemProps {
  mouseX: MotionValue<number>;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function DockItem({ mouseX, icon, label, isActive, onClick }: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null);

  // Calculate distance from mouse to this item's center
  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  // Map distance to scale: max scale at center, 1 at edges
  const scale = useTransform(
    distance,
    [-MAGNIFICATION.distance, 0, MAGNIFICATION.distance],
    [1, MAGNIFICATION.scale, 1]
  );

  // Apply spring physics for smooth animation
  const scaleSpring = useSpring(scale, SPRING_CONFIG);

  // Glass bubble style for active state
  const activeBubbleStyle = isActive ? {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.2) 0%,
      rgba(255, 255, 255, 0.1) 100%
    )`,
    boxShadow: `
      0 4px 16px rgba(0, 0, 0, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.2)
    `,
  } : {};

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      style={{
        scale: scaleSpring,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        width: MAGNIFICATION.baseSize,
        height: MAGNIFICATION.baseSize + 16,
        background: 'transparent',
        border: 'none',
        borderRadius: radius.lg,
        cursor: 'pointer',
        color: isActive ? colors.text.primary : colors.text.secondary,
        transformOrigin: 'bottom center',
        ...activeBubbleStyle,
      }}
      whileTap={{ scale: 0.95 }}
    >
      {icon}
      <span style={{
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </motion.button>
  );
}

// Day item with magnification for day selector
interface DayItemProps {
  mouseX: MotionValue<number>;
  day: number;
  isActive: boolean;
  onClick: () => void;
}

function DayItem({ mouseX, day, isActive, onClick }: DayItemProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const scale = useTransform(
    distance,
    [-MAGNIFICATION.distance * 0.6, 0, MAGNIFICATION.distance * 0.6],
    [1, MAGNIFICATION.scale * 0.9, 1]
  );

  const scaleSpring = useSpring(scale, SPRING_CONFIG);

  const activeBubbleStyle = isActive ? {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.22) 0%,
      rgba(255, 255, 255, 0.1) 100%
    )`,
    boxShadow: `
      0 4px 12px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.2)
    `,
  } : {};

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
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
        color: isActive ? colors.text.primary : colors.text.secondary,
        fontSize: isActive ? 15 : 14,
        fontWeight: isActive ? 600 : 500,
        transformOrigin: 'bottom center',
        ...activeBubbleStyle,
      }}
      whileTap={{ scale: 0.9 }}
    >
      {day}
    </motion.button>
  );
}

interface AdaptiveNavPillProps {
  selectedCamp: Camp | null;
  totalDays: number;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onDaySelect: (dayNumber: number) => void;
  onSearch?: () => void;
  panelVisible?: boolean;
}

export const AdaptiveNavPill = memo(function AdaptiveNavPill({
  selectedCamp,
  totalDays,
  activeTab,
  onTabChange,
  onDaySelect,
}: AdaptiveNavPillProps) {
  const [mode, setMode] = useState<NavMode>('collapsed');
  const pillRef = useRef<HTMLDivElement>(null);

  // Mouse/touch position for magnification
  const mouseX = useMotionValue(Infinity);

  // Current day context
  const currentDay = selectedCamp?.dayNumber ?? 1;
  const currentCampName = selectedCamp?.name ?? 'Start';

  // Handle mouse/touch movement for magnification
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    mouseX.set(e.clientX);
  }, [mouseX]);

  const handlePointerLeave = useCallback(() => {
    mouseX.set(Infinity);
  }, [mouseX]);

  // Close pill when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setMode('collapsed');
        mouseX.set(Infinity);
      }
    };

    if (mode !== 'collapsed') {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mode, mouseX]);

  const handlePillClick = useCallback(() => {
    if (mode === 'collapsed') {
      setMode('expanded');
    }
  }, [mode]);

  const handleOptionClick = useCallback((optionId: TabType | 'info') => {
    if (optionId === 'journey') {
      setMode('days');
    } else {
      onTabChange(optionId as TabType);
      // Keep expanded to show selection, user taps outside to collapse
    }
  }, [onTabChange]);

  const handleDayClick = useCallback((dayNumber: number) => {
    onDaySelect(dayNumber);
    setMode('collapsed');
  }, [onDaySelect]);

  const handleBackFromDays = useCallback(() => {
    setMode('expanded');
  }, []);

  // Generate days array
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Glass style for the pill container
  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.14) 0%,
      rgba(255, 255, 255, 0.07) 100%
    )`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  return (
    <motion.div
      ref={pillRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      style={{
        position: 'absolute',
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
      }}
    >
      {/* Main Nav Pill */}
      <motion.div
        onClick={mode === 'collapsed' ? handlePillClick : undefined}
        layout
        style={{
          ...glassStyle,
          borderRadius: mode === 'collapsed' ? radius.pill : radius.xl,
          padding: mode === 'collapsed' ? '10px 18px' : '8px 12px',
          cursor: mode === 'collapsed' ? 'pointer' : 'default',
          minHeight: 48,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 4,
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
              paddingBottom: 2,
            }}
          >
            <CalendarIcon />
            <span style={{
              fontSize: 14,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}>
              Day {currentDay} <span style={{ color: colors.text.tertiary, margin: '0 2px' }}>•</span> {currentCampName}
            </span>
          </motion.div>
        )}

        {/* Expanded State - Navigation Options with Magnification */}
        {mode === 'expanded' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 2,
              paddingBottom: 4,
            }}
          >
            {NAV_OPTIONS.map((option) => (
              <DockItem
                key={option.id}
                mouseX={mouseX}
                icon={option.icon}
                label={option.label}
                isActive={option.id === activeTab}
                onClick={() => handleOptionClick(option.id)}
              />
            ))}
          </motion.div>
        )}

        {/* Days Selector State with Magnification */}
        {mode === 'days' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 2,
            }}
          >
            {/* Back button */}
            <motion.button
              onClick={handleBackFromDays}
              whileTap={{ scale: 0.9 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                background: 'transparent',
                border: 'none',
                borderRadius: radius.md,
                cursor: 'pointer',
                color: colors.text.secondary,
                fontSize: 18,
                marginRight: 4,
              }}
            >
              ←
            </motion.button>

            {/* Day pills with magnification */}
            {days.map((day) => (
              <DayItem
                key={day}
                mouseX={mouseX}
                day={day}
                isActive={day === currentDay}
                onClick={() => handleDayClick(day)}
              />
            ))}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
});

export default AdaptiveNavPill;
