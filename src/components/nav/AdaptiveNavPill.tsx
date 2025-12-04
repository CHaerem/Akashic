import { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
  type MotionValue,
} from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType, TrekData, ExtendedStats, Photo } from '../../types/trek';

// Magnification constants
const MAGNIFICATION = {
  scale: 1.5,
  distance: 70,
  baseSize: 48,
};

const SPRING_CONFIG = {
  mass: 0.1,
  stiffness: 200,
  damping: 15,
};

// Icons
const CalendarIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const InfoIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
);

const PhotoIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const StatsIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

type NavMode = 'collapsed' | 'expanded' | 'days' | 'content';

interface NavOption {
  id: TabType;
  icon: React.ReactNode;
  label: string;
}

const NAV_OPTIONS: NavOption[] = [
  { id: 'journey', icon: <CalendarIcon />, label: 'Days' },
  { id: 'overview', icon: <InfoIcon />, label: 'Info' },
  { id: 'photos', icon: <PhotoIcon />, label: 'Photos' },
  { id: 'stats', icon: <StatsIcon />, label: 'Stats' },
];

// Dock item with magnification and drag-to-select
interface DockItemProps {
  mouseX: MotionValue<number>;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  isHovered: boolean; // For drag-to-select highlight
  onClick: () => void;
  onHover: () => void;
  isMobile: boolean;
  setRef: (el: HTMLButtonElement | null) => void;
}

function DockItem({ mouseX, icon, label, isActive, isHovered, onClick, onHover, isMobile, setRef }: DockItemProps) {
  const localRef = useRef<HTMLButtonElement>(null);

  // Set the external ref whenever our local ref changes
  useEffect(() => {
    setRef(localRef.current);
    return () => setRef(null);
  }, [setRef]);

  const distance = useTransform(mouseX, (val) => {
    const bounds = localRef.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const scale = useTransform(
    distance,
    [-MAGNIFICATION.distance, 0, MAGNIFICATION.distance],
    [1, MAGNIFICATION.scale, 1]
  );

  const scaleSpring = useSpring(scale, SPRING_CONFIG);
  const baseSize = isMobile ? MAGNIFICATION.baseSize : MAGNIFICATION.baseSize + 8;

  // Selection bubble appears when hovered during drag OR when active
  const showBubble = isHovered || isActive;
  const bubbleStyle = showBubble ? {
    background: `linear-gradient(135deg, rgba(255, 255, 255, ${isHovered ? 0.28 : 0.22}) 0%, rgba(255, 255, 255, ${isHovered ? 0.14 : 0.1}) 100%)`,
    boxShadow: `0 4px 20px rgba(0, 0, 0, ${isHovered ? 0.35 : 0.25}), inset 0 1px 0 rgba(255, 255, 255, ${isHovered ? 0.4 : 0.3}), 0 0 0 1px rgba(255, 255, 255, ${isHovered ? 0.25 : 0.2})`,
  } : {};

  return (
    <motion.button
      ref={localRef}
      onClick={onClick}
      onPointerEnter={onHover}
      style={{
        scale: scaleSpring,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        width: baseSize,
        height: baseSize + 16,
        background: 'transparent',
        border: 'none',
        borderRadius: radius.lg,
        cursor: 'pointer',
        color: (isHovered || isActive) ? colors.text.primary : colors.text.secondary,
        transformOrigin: 'bottom center',
        touchAction: 'none',
        ...bubbleStyle,
      }}
      whileTap={{ scale: 0.95 }}
    >
      {icon}
      <span style={{ fontSize: isMobile ? 9 : 10, fontWeight: 500, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </motion.button>
  );
}

// Day item with magnification and drag-to-select
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

// Floating Content Card
interface ContentCardProps {
  activeTab: TabType;
  trekData: TrekData;
  extendedStats: ExtendedStats | null;
  photos: Photo[];
  getMediaUrl: (path: string) => string;
  onClose: () => void;
  onPhotoClick: (photo: Photo) => void;
  isMobile: boolean;
}

function ContentCard({ activeTab, trekData, extendedStats, photos, getMediaUrl, onClose, onPhotoClick, isMobile }: ContentCardProps) {
  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  const cardWidth = isMobile ? 'calc(100vw - 32px)' : '420px';
  // Leave space for nav pill (approx 100px) + safe area on mobile
  const maxHeight = isMobile ? 'calc(100vh - 160px - env(safe-area-inset-top) - env(safe-area-inset-bottom))' : '70vh';

  return (
    // Wrapper for centering - handles the positioning
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: isMobile ? 'env(safe-area-inset-top)' : 0,
        paddingBottom: isMobile ? 'calc(100px + env(safe-area-inset-bottom))' : 0,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 5 }}
        transition={{ type: 'spring', ...SPRING_CONFIG }}
        style={{
          ...glassStyle,
          width: cardWidth,
          maxWidth: cardWidth,
          maxHeight,
          borderRadius: radius.xl,
          overflow: 'hidden',
          pointerEvents: 'auto',
        }}
      >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 16px',
        borderBottom: `1px solid ${colors.glass.borderSubtle}`,
      }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.text.primary, textTransform: 'capitalize' }}>
          {activeTab === 'overview' ? 'Journey Info' : activeTab}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: colors.text.tertiary,
            padding: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <CloseIcon />
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: 16, overflowY: 'auto', maxHeight: `calc(${maxHeight} - 60px)` }}>
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: colors.text.primary }}>{trekData.name}</h3>
            <p style={{ margin: 0, fontSize: 13, color: colors.text.secondary, lineHeight: 1.5 }}>{trekData.description}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
              <StatItem label="Duration" value={`${trekData.stats.duration} days`} />
              <StatItem label="Distance" value={`${trekData.stats.totalDistance} km`} />
              <StatItem label="Elevation Gain" value={`${trekData.stats.totalElevationGain}m`} />
              <StatItem label="Highest Point" value={`${trekData.stats.highestPoint.elevation}m`} />
            </div>
          </div>
        )}

        {activeTab === 'stats' && extendedStats && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StatItem label="Avg Daily Distance" value={extendedStats.avgDailyDistance} />
            <StatItem label="Max Daily Gain" value={`${extendedStats.maxDailyGain}m`} />
            <StatItem label="Total Elevation Gain" value={`${extendedStats.totalElevationGain}m`} />
            <StatItem label="Total Elevation Loss" value={`${extendedStats.totalElevationLoss}m`} />
            <StatItem label="Difficulty" value={extendedStats.difficulty} />
            <StatItem label="Est. Total Time" value={extendedStats.estimatedTotalTime} />
          </div>
        )}

        {activeTab === 'photos' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {photos.slice(0, 12).map((photo, index) => (
              <motion.div
                key={photo.id}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onPhotoClick(photo)}
                style={{
                  aspectRatio: '1',
                  borderRadius: radius.md,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: colors.glass.subtle,
                }}
              >
                <img
                  src={getMediaUrl(photo.thumbnail_url || photo.url)}
                  alt={photo.caption || `Photo ${index + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                />
              </motion.div>
            ))}
            {photos.length > 12 && (
              <div style={{
                aspectRatio: '1',
                borderRadius: radius.md,
                background: colors.glass.medium,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.text.secondary,
                fontSize: 13,
                fontWeight: 500,
              }}>
                +{photos.length - 12}
              </div>
            )}
          </div>
        )}

        {activeTab === 'journey' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {trekData.camps.map((camp) => (
              <div key={camp.id} style={{
                padding: 12,
                borderRadius: radius.md,
                background: colors.glass.subtle,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: colors.accent.primary }}>Day {camp.dayNumber}</span>
                  <span style={{ fontSize: 11, color: colors.text.tertiary }}>{camp.elevation}m</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 500, color: colors.text.primary }}>{camp.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </motion.div>
    </div>
  );
}

// Stat item helper
function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: radius.md,
      background: colors.glass.subtle,
    }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: colors.text.tertiary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: colors.text.primary }}>
        {value}
      </div>
    </div>
  );
}

interface AdaptiveNavPillProps {
  selectedCamp: Camp | null;
  totalDays: number;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onDaySelect: (dayNumber: number) => void;
  trekData: TrekData;
  extendedStats: ExtendedStats | null;
  photos: Photo[];
  getMediaUrl: (path: string) => string;
  onViewPhotoOnMap: (photo: Photo) => void;
  isMobile: boolean;
}

export const AdaptiveNavPill = memo(function AdaptiveNavPill({
  selectedCamp,
  totalDays,
  activeTab,
  onTabChange,
  onDaySelect,
  trekData,
  extendedStats,
  photos,
  getMediaUrl,
  onViewPhotoOnMap,
  isMobile,
}: AdaptiveNavPillProps) {
  const [mode, setMode] = useState<NavMode>('collapsed');
  const [showContent, setShowContent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  const pillRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(Infinity);

  // Refs for each nav option
  const navRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const dayRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const currentDay = selectedCamp?.dayNumber ?? 1;
  const currentCampName = selectedCamp?.name ?? 'Start';

  // Find which item is under the pointer position
  const findItemUnderPointer = useCallback((clientX: number) => {
    if (mode === 'expanded' || mode === 'content') {
      for (const [id, ref] of navRefs.current.entries()) {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right) {
            return { type: 'nav' as const, id };
          }
        }
      }
    } else if (mode === 'days') {
      for (const [day, ref] of dayRefs.current.entries()) {
        if (ref) {
          const rect = ref.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right) {
            return { type: 'day' as const, day };
          }
        }
      }
    }
    return null;
  }, [mode]);

  // Pointer/touch handlers for drag-to-select
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (mode === 'collapsed') return;
    setIsDragging(true);
    mouseX.set(e.clientX);

    const item = findItemUnderPointer(e.clientX);
    if (item?.type === 'nav') setHoveredOption(item.id);
    else if (item?.type === 'day') setHoveredDay(item.day);
  }, [mode, mouseX, findItemUnderPointer]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    mouseX.set(e.clientX);

    if (isDragging) {
      const item = findItemUnderPointer(e.clientX);
      if (item?.type === 'nav') {
        setHoveredOption(item.id);
        setHoveredDay(null);
      } else if (item?.type === 'day') {
        setHoveredDay(item.day);
        setHoveredOption(null);
      } else {
        setHoveredOption(null);
        setHoveredDay(null);
      }
    }
  }, [isDragging, mouseX, findItemUnderPointer]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      // Select the hovered item on release
      if (hoveredOption) {
        if (hoveredOption === 'journey') {
          setMode('days');
          setShowContent(false);
        } else {
          onTabChange(hoveredOption as TabType);
          setShowContent(true);
          setMode('content');
        }
      } else if (hoveredDay !== null) {
        onDaySelect(hoveredDay);
        setMode('collapsed');
        setShowContent(false);
      }
    }
    setIsDragging(false);
    setHoveredOption(null);
    setHoveredDay(null);
  }, [isDragging, hoveredOption, hoveredDay, onTabChange, onDaySelect]);

  const handlePointerLeave = useCallback(() => {
    if (!isDragging) {
      mouseX.set(Infinity);
    }
  }, [isDragging, mouseX]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        if (mode !== 'collapsed') {
          setMode('collapsed');
          setShowContent(false);
        }
        mouseX.set(Infinity);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mode, mouseX]);

  // Cancel drag on pointer up anywhere
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDragging) {
        handlePointerUp();
      }
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
      setShowContent(false);
    }
  }, [mode]);

  const handleOptionClick = useCallback((optionId: TabType) => {
    if (isDragging) return; // Don't handle click during drag
    if (optionId === 'journey') {
      setMode('days');
      setShowContent(false);
    } else {
      onTabChange(optionId);
      setShowContent(true);
      setMode('content');
    }
  }, [isDragging, onTabChange]);

  const handleDayClick = useCallback((dayNumber: number) => {
    if (isDragging) return;
    onDaySelect(dayNumber);
    setMode('collapsed');
    setShowContent(false);
  }, [isDragging, onDaySelect]);

  const handleBackFromDays = useCallback(() => {
    setMode('expanded');
  }, []);

  const handleCloseContent = useCallback(() => {
    setShowContent(false);
    setMode('collapsed');
  }, []);

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  // Create ref callbacks for nav items
  const setNavRef = useCallback((id: string) => (el: HTMLButtonElement | null) => {
    navRefs.current.set(id, el);
  }, []);

  const setDayRef = useCallback((day: number) => (el: HTMLButtonElement | null) => {
    dayRefs.current.set(day, el);
  }, []);

  return (
    <>
      {/* Content Card */}
      <AnimatePresence>
        {showContent && mode === 'content' && (
          <ContentCard
            activeTab={activeTab}
            trekData={trekData}
            extendedStats={extendedStats}
            photos={photos}
            getMediaUrl={getMediaUrl}
            onClose={handleCloseContent}
            onPhotoClick={onViewPhotoOnMap}
            isMobile={isMobile}
          />
        )}
      </AnimatePresence>

      {/* Navigation Pill */}
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
          position: 'absolute',
          bottom: isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 32,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 50,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
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
            alignItems: 'flex-end',
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
                paddingBottom: 2,
              }}
            >
              <CalendarIcon size={isMobile ? 20 : 22} />
              <span style={{ fontSize: isMobile ? 14 : 15, fontWeight: 500, whiteSpace: 'nowrap' }}>
                Day {currentDay} <span style={{ color: colors.text.tertiary, margin: '0 2px' }}>•</span> {currentCampName}
              </span>
            </motion.div>
          )}

          {/* Expanded State - Drag to select */}
          {(mode === 'expanded' || mode === 'content') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ display: 'flex', alignItems: 'flex-end', gap: 2, paddingBottom: 4 }}
            >
              {NAV_OPTIONS.map((option) => (
                <DockItem
                  key={option.id}
                  mouseX={mouseX}
                  icon={option.icon}
                  label={option.label}
                  isActive={option.id === activeTab && showContent}
                  isHovered={hoveredOption === option.id}
                  onClick={() => handleOptionClick(option.id)}
                  onHover={() => !isDragging && setHoveredOption(option.id)}
                  isMobile={isMobile}
                  setRef={setNavRef(option.id)}
                />
              ))}
            </motion.div>
          )}

          {/* Days Selector - Drag to select */}
          {mode === 'days' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}
            >
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
    </>
  );
});

export default AdaptiveNavPill;
