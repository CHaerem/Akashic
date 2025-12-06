import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  AnimatePresence,
  type MotionValue,
} from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType, TrekData, ExtendedStats, ElevationProfile, Photo } from '../../types/trek';
import { DayGallery } from '../common/DayGallery';
import { usePhotoDay } from '../../hooks/usePhotoDay';
import { ContentCard } from './ContentCard';
import { ContextCard } from './ContextCard';
import {
  CalendarIcon,
  InfoIcon,
  PhotoIcon,
  StatsIcon,
  ChevronIcon,
} from '../icons';

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

interface AdaptiveNavPillProps {
  selectedCamp: Camp | null;
  totalDays: number;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onDaySelect: (dayNumber: number) => void;
  onCampSelect: (camp: Camp) => void;
  trekData: TrekData;
  extendedStats: ExtendedStats | null;
  elevationProfile: ElevationProfile | null;
  photos: Photo[];
  getMediaUrl: (path: string) => string;
  onViewPhotoOnMap: (photo: Photo) => void;
  onJourneyUpdate: () => void;
  isMobile: boolean;
}

export const AdaptiveNavPill = memo(function AdaptiveNavPill({
  selectedCamp,
  totalDays,
  activeTab,
  onTabChange,
  onDaySelect,
  onCampSelect,
  trekData,
  extendedStats,
  elevationProfile,
  photos,
  getMediaUrl,
  onViewPhotoOnMap,
  onJourneyUpdate,
  isMobile,
}: AdaptiveNavPillProps) {
  const [mode, setMode] = useState<NavMode>('collapsed'); // Start collapsed - map is hero
  const [showContent, setShowContent] = useState(false);
  const [showContext, setShowContext] = useState(false); // Day info context card
  const [showDayGallery, setShowDayGallery] = useState(false); // Fullscreen day photo gallery
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false); // Track if user has interacted

  const pillRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(Infinity);

  // Refs for each nav option
  const navRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const dayRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  const currentDay = selectedCamp?.dayNumber ?? 1;
  const currentCampName = selectedCamp?.name ?? 'Start';
  const currentCamp = selectedCamp ?? trekData.camps[0];

  // Calculate date for current day based on journey start date
  const currentDayDate = useMemo(() => {
    if (!trekData.dateStarted || !currentCamp) return null;
    const start = new Date(trekData.dateStarted);
    start.setDate(start.getDate() + (currentCamp.dayNumber - 1));
    return start;
  }, [trekData.dateStarted, currentCamp]);

  // Use shared photo-day matching hook
  const { getPhotosForDay } = usePhotoDay(trekData, photos);

  // Get photos for current day
  const dayPhotos = useMemo(() => {
    if (!currentCamp) return [];
    return getPhotosForDay(currentDay);
  }, [currentCamp, currentDay, getPhotosForDay]);

  // Swipe handlers for collapsed pill (mobile gesture support)
  const handleSwipeDrag = useCallback(() => {
    if (!hasInteracted) setHasInteracted(true);
  }, [hasInteracted]);

  const handleSwipeDragEnd = useCallback((_: any, info: { offset: { x: number }; velocity: { x: number } }) => {
    const threshold = 50;
    const velocityThreshold = 500;

    if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      // Swipe right - previous day
      if (currentDay > 1) {
        setSwipeDirection('right');
        onDaySelect(currentDay - 1);
        setTimeout(() => setSwipeDirection(null), 200);
      }
    } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      // Swipe left - next day
      if (currentDay < totalDays) {
        setSwipeDirection('left');
        onDaySelect(currentDay + 1);
        setTimeout(() => setSwipeDirection(null), 200);
      }
    }
  }, [currentDay, totalDays, onDaySelect]);


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
      const target = e.target as Node;
      const isInsidePill = pillRef.current?.contains(target);
      const isInsideCard = cardRef.current?.contains(target);
      const isInsideContext = contextRef.current?.contains(target);

      if (!isInsidePill && !isInsideCard && !isInsideContext) {
        // If content card is showing, close it and return to collapsed
        if (showContent) {
          setShowContent(false);
          setMode('collapsed');
        }
        // If context is showing, close it
        else if (showContext) {
          setShowContext(false);
        }
        // If in expanded mode or days mode, collapse
        else if (mode === 'expanded' || mode === 'days') {
          setMode('collapsed');
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
  }, [mode, showContent, showContext, mouseX]);

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

  // Auto-show context card on initial load to welcome users to day 1
  useEffect(() => {
    // Small delay to let the map animation settle
    const timer = setTimeout(() => {
      setShowContext(true);
    }, 800);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount

  // Tap main pill area → show context card
  const handlePillTap = useCallback(() => {
    if (mode === 'collapsed') {
      setShowContext(prev => !prev);
      if (!hasInteracted) setHasInteracted(true);
    }
  }, [mode, hasInteracted]);

  // Tap expand icon → show full menu
  const handleExpandTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation(); // Don't trigger pill tap
    if (mode === 'collapsed') {
      setShowContext(false);
      setMode('expanded');
      if (!hasInteracted) setHasInteracted(true);
    }
  }, [mode, hasInteracted]);

  // Open content card from context card action buttons
  const handleOpenContent = useCallback((tab: TabType) => {
    setShowContext(false);
    onTabChange(tab);
    setShowContent(true);
    setMode('content');
  }, [onTabChange]);

  // Open day gallery for immersive photo viewing
  const handleOpenDayGallery = useCallback(() => {
    setShowContext(false);
    setShowDayGallery(true);
    if (!hasInteracted) setHasInteracted(true);
  }, [hasInteracted]);

  // Handle day change from gallery
  const handleGalleryDayChange = useCallback((dayNumber: number) => {
    onDaySelect(dayNumber);
  }, [onDaySelect]);

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
    setMode('collapsed'); // Return to collapsed state - map is hero
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
            elevationProfile={elevationProfile}
            selectedCamp={selectedCamp}
            photos={photos}
            getMediaUrl={getMediaUrl}
            onClose={handleCloseContent}
            onCampSelect={onCampSelect}
            onPhotoClick={onViewPhotoOnMap}
            onJourneyUpdate={onJourneyUpdate}
            isMobile={isMobile}
            cardRef={cardRef}
          />
        )}
      </AnimatePresence>

      {/* Day Gallery - fullscreen photo exploration */}
      <DayGallery
        isOpen={showDayGallery}
        onClose={() => setShowDayGallery(false)}
        trekData={trekData}
        photos={photos}
        getMediaUrl={getMediaUrl}
        initialDay={currentDay}
        onDayChange={handleGalleryDayChange}
        onViewOnMap={onViewPhotoOnMap}
      />

      {/* Navigation Pill - wrapper for centering */}
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 32,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 50,
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
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            touchAction: 'none',
            pointerEvents: 'auto',
          }}
        >
          {/* Camp Info Tooltip - shows when hovering day in days mode */}
          <AnimatePresence>
            {mode === 'days' && hoveredDay !== null && (() => {
              const camp = trekData.camps.find(c => c.dayNumber === hoveredDay);
              if (!camp) return null;
              return (
                <motion.div
                  key="camp-tooltip"
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98 }}
                  transition={{ type: 'spring', ...SPRING_CONFIG }}
                  style={{
                    background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
                    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
                    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
                    border: `1px solid ${colors.glass.border}`,
                    boxShadow: shadows.glass.elevated,
                    borderRadius: radius.lg,
                    padding: '10px 14px',
                    minWidth: 140,
                    textAlign: 'center',
                  }}
                >
                  <div style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: colors.accent.primary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}>
                    Day {camp.dayNumber}
                  </div>
                  <div style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: colors.text.primary,
                    marginBottom: 2,
                  }}>
                    {camp.name}
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: colors.text.secondary,
                  }}>
                    {camp.elevation}m
                  </div>
                </motion.div>
              );
            })()}
          </AnimatePresence>

          {/* Context Card - shows day info when pill is tapped */}
          <AnimatePresence>
            {showContext && mode === 'collapsed' && currentCamp && (
              <ContextCard
                currentCamp={currentCamp}
                currentDay={currentDay}
                currentDayDate={currentDayDate}
                dayPhotos={dayPhotos}
                getMediaUrl={getMediaUrl}
                onClose={() => setShowContext(false)}
                onOpenContent={handleOpenContent}
                onOpenDayGallery={handleOpenDayGallery}
                isMobile={isMobile}
                contextRef={contextRef}
              />
            )}
          </AnimatePresence>

        <motion.div
          onClick={mode === 'collapsed' ? handlePillTap : undefined}
          layout
          drag={mode === 'collapsed' ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDrag={mode === 'collapsed' ? handleSwipeDrag : undefined}
          onDragEnd={mode === 'collapsed' ? handleSwipeDragEnd : undefined}
          whileTap={mode === 'collapsed' ? { scale: 0.98 } : undefined}
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
            touchAction: mode === 'collapsed' ? 'pan-y' : 'none',
          }}
          transition={{ type: 'spring', ...SPRING_CONFIG }}
        >
          {/* Collapsed State - Clickable navigation */}
          {mode === 'collapsed' && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}>
              {/* Previous day button - always visible, clickable */}
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentDay > 1) {
                    setSwipeDirection('right');
                    onDaySelect(currentDay - 1);
                    setTimeout(() => setSwipeDirection(null), 200);
                  }
                }}
                whileHover={currentDay > 1 ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                whileTap={currentDay > 1 ? { scale: 0.9 } : {}}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: radius.md,
                  cursor: currentDay > 1 ? 'pointer' : 'default',
                  color: currentDay > 1 ? colors.text.secondary : colors.text.subtle,
                  opacity: currentDay > 1 ? 1 : 0.3,
                  transition: 'all 0.15s ease',
                }}
              >
                <ChevronIcon direction="left" size={16} />
              </motion.button>

              {/* Day content - tap to show context */}
              <motion.div
                key={currentDay}
                initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: colors.text.primary,
                  padding: '4px 8px',
                }}
              >
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: colors.accent.primary,
                  background: 'rgba(96, 165, 250, 0.15)',
                  padding: '3px 8px',
                  borderRadius: 6,
                }}>
                  {currentDay}/{totalDays}
                </span>
                <span style={{
                  fontSize: isMobile ? 14 : 15,
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  maxWidth: isMobile ? 120 : 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {currentCampName}
                </span>
              </motion.div>

              {/* Next day button - always visible, clickable */}
              <motion.button
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentDay < totalDays) {
                    setSwipeDirection('left');
                    onDaySelect(currentDay + 1);
                    setTimeout(() => setSwipeDirection(null), 200);
                  }
                }}
                whileHover={currentDay < totalDays ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                whileTap={currentDay < totalDays ? { scale: 0.9 } : {}}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: radius.md,
                  cursor: currentDay < totalDays ? 'pointer' : 'default',
                  color: currentDay < totalDays ? colors.text.secondary : colors.text.subtle,
                  opacity: currentDay < totalDays ? 1 : 0.3,
                  transition: 'all 0.15s ease',
                }}
              >
                <ChevronIcon direction="right" size={16} />
              </motion.button>

              {/* Divider */}
              <div style={{
                width: 1,
                height: 20,
                background: colors.glass.borderSubtle,
                marginLeft: 4,
                marginRight: 4,
              }} />

              {/* More button - opens the menu */}
              <motion.button
                onClick={handleExpandTap}
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
                whileTap={{ scale: 0.95 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: radius.md,
                  cursor: 'pointer',
                  color: colors.text.secondary,
                  padding: '6px 10px',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                <span>More</span>
                <ChevronIcon direction="up" size={12} />
              </motion.button>
            </div>
          )}

          {/* Expanded State - Main menu */}
          {(mode === 'expanded' || mode === 'content') && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {/* Current day indicator - clickable to collapse */}
              <motion.div
                onClick={() => setMode('collapsed')}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: radius.pill,
                  cursor: 'pointer',
                  marginBottom: 4,
                }}
              >
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: colors.accent.primary,
                  background: 'rgba(96, 165, 250, 0.15)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}>
                  {currentDay}/{totalDays}
                </span>
                <span style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: colors.text.primary,
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {currentCampName}
                </span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={colors.text.tertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </motion.div>

              {/* Nav options with magnification */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, paddingBottom: 4 }}>
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
              </div>
            </motion.div>
          )}

          {/* Days Selector with magnification */}
          {mode === 'days' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ display: 'flex', alignItems: 'flex-end', gap: 2, paddingBottom: 4 }}
            >
              <motion.button
                onClick={handleBackFromDays}
                whileTap={{ scale: 0.9 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 52,
                  background: 'transparent',
                  border: 'none',
                  borderRadius: radius.md,
                  cursor: 'pointer',
                  color: colors.text.secondary,
                  fontSize: 18,
                  flexShrink: 0,
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
      </div>
    </>
  );
});

export default AdaptiveNavPill;
