/**
 * Adaptive Navigation Pill - Layout 3: Minimal Expandable
 *
 * States:
 * 1. collapsed - Just navigation row: ← Day 3 · Shira Camp →
 * 2. expanded - Navigation + action buttons row
 * 3. content - Expanded + floating card visible
 */

import { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { colors, radius, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType, TrekData, ExtendedStats, ElevationProfile, Photo } from '../../types/trek';
import { DayGallery } from '../common/DayGallery';
import { ContentCard } from './ContentCard';
import { ChevronIcon, CloseIcon, PhotoIcon } from '../icons';
import { usePhotoDay } from '../../hooks/usePhotoDay';

const SPRING_CONFIG = {
  type: 'spring' as const,
  mass: 0.1,
  stiffness: 200,
  damping: 15,
};

// Content types for the floating card
type ContentType = 'day' | 'photos' | 'stats' | 'info';

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
  activeTab: _activeTab, // Used for external sync, internal state managed separately
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
  // Layout 3 states - default expanded when viewing a day
  const [isExpanded, setIsExpanded] = useState(selectedCamp !== null);
  const [activeContent, setActiveContent] = useState<ContentType | null>(null);
  const [showDayGallery, setShowDayGallery] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

  const pillRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Overview mode when no camp is selected
  const isOverviewMode = selectedCamp === null;

  // Auto-expand when entering day mode
  useEffect(() => {
    if (selectedCamp !== null) {
      setIsExpanded(true);
    }
  }, [selectedCamp]);
  const currentDay = selectedCamp?.dayNumber ?? 0;
  const currentCampName = selectedCamp?.name ?? 'Overview';

  // Map content type to tab type (day is handled separately)
  const contentToTab: Record<Exclude<ContentType, 'day'>, TabType> = {
    photos: 'photos',
    stats: 'stats',
    info: 'overview',
  };

  // Calculate date for current day
  const currentDayDate = useMemo(() => {
    if (!trekData.dateStarted || !selectedCamp) return null;
    const start = new Date(trekData.dateStarted);
    start.setDate(start.getDate() + (selectedCamp.dayNumber - 1));
    return start;
  }, [trekData.dateStarted, selectedCamp]);

  // Get photos for current day
  const { getPhotosForDay } = usePhotoDay(trekData, photos);
  const dayPhotos = useMemo(() => {
    if (!selectedCamp) return [];
    return getPhotosForDay(currentDay);
  }, [selectedCamp, currentDay, getPhotosForDay]);

  // Handle swipe for day navigation
  const handleSwipeDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const threshold = 50;
      const velocityThreshold = 500;

      if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
        if (currentDay > 1) {
          setSwipeDirection('right');
          onDaySelect(currentDay - 1);
          setTimeout(() => setSwipeDirection(null), 200);
        }
      } else if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
        if (currentDay < totalDays) {
          setSwipeDirection('left');
          onDaySelect(currentDay + 1);
          setTimeout(() => setSwipeDirection(null), 200);
        }
      }
    },
    [currentDay, totalDays, onDaySelect]
  );

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const isInsidePill = pillRef.current?.contains(target);
      const isInsideCard = cardRef.current?.contains(target);

      if (!isInsidePill && !isInsideCard) {
        if (activeContent) {
          setActiveContent(null);
        } else if (isExpanded) {
          setIsExpanded(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isExpanded, activeContent]);

  // Keyboard: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDayGallery) {
          setShowDayGallery(false);
        } else if (activeContent) {
          setActiveContent(null);
        } else if (isExpanded) {
          setIsExpanded(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, activeContent, showDayGallery]);

  // Toggle expanded state
  const handleToggleExpanded = useCallback(() => {
    if (activeContent) {
      setActiveContent(null);
    } else {
      setIsExpanded((prev) => !prev);
    }
  }, [activeContent]);

  // Open content card
  const handleOpenContent = useCallback(
    (content: ContentType) => {
      setActiveContent(content);
      setIsExpanded(true);
      if (content !== 'day') {
        onTabChange(contentToTab[content]);
      }
    },
    [onTabChange, contentToTab]
  );

  // Center text tap: expand when collapsed, show day info when expanded
  const handleCenterTap = useCallback(() => {
    if (isOverviewMode) {
      // In overview mode, toggle expanded
      setIsExpanded((prev) => !prev);
    } else if (!isExpanded) {
      // In day mode but collapsed → expand to show action row
      setIsExpanded(true);
    } else {
      // In day mode and expanded → show day info card
      setActiveContent('day');
    }
  }, [isOverviewMode, isExpanded]);

  // Open day gallery
  const handleOpenDayGallery = useCallback(() => {
    setActiveContent(null);
    setShowDayGallery(true);
  }, []);

  // Close content card
  const handleCloseContent = useCallback(() => {
    setActiveContent(null);
  }, []);

  // Day navigation
  const goToPrevDay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentDay > 1) {
        setSwipeDirection('right');
        onDaySelect(currentDay - 1);
        setTimeout(() => setSwipeDirection(null), 200);
      }
    },
    [currentDay, onDaySelect]
  );

  const goToNextDay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentDay < totalDays) {
        setSwipeDirection('left');
        onDaySelect(currentDay + 1);
        setTimeout(() => setSwipeDirection(null), 200);
      }
    },
    [currentDay, totalDays, onDaySelect]
  );

  const handleStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDaySelect(1);
    },
    [onDaySelect]
  );

  // Gallery handlers
  const handleGalleryDayChange = useCallback(
    (dayNumber: number) => {
      onDaySelect(dayNumber);
    },
    [onDaySelect]
  );

  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.07) 100%)`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  return (
    <>
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

      {/* Navigation Pill Container */}
      <div
        style={{
          position: 'absolute',
          bottom: isMobile ? 'calc(24px + env(safe-area-inset-bottom))' : 32,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 50,
          pointerEvents: 'none',
          gap: 12,
        }}
      >
        {/* Floating Content Card */}
        <AnimatePresence>
          {activeContent && (
            <motion.div
              ref={cardRef}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={SPRING_CONFIG}
              style={{
                ...glassStyle,
                borderRadius: radius.xl,
                width: isMobile ? 'calc(100vw - 32px)' : 380,
                maxWidth: 420,
                maxHeight: isMobile ? 'calc(60vh - env(safe-area-inset-bottom))' : '50vh',
                overflow: 'hidden',
                pointerEvents: 'auto',
              }}
            >
              {/* Card Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.glass.borderSubtle}`,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: colors.text.primary,
                  }}
                >
                  {activeContent === 'day'
                    ? `Day ${currentDay}`
                    : activeContent === 'info'
                      ? 'Journey Info'
                      : activeContent.charAt(0).toUpperCase() + activeContent.slice(1)}
                </span>
                <button
                  onClick={handleCloseContent}
                  aria-label="Close"
                  style={{
                    padding: 4,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: colors.text.tertiary,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CloseIcon size={16} />
                </button>
              </div>

              {/* Card Content */}
              <div
                style={{
                  overflowY: 'auto',
                  maxHeight: isMobile ? 'calc(60vh - 100px)' : 'calc(50vh - 60px)',
                }}
              >
                {activeContent === 'day' ? (
                  <DayInfoContent
                    camp={selectedCamp}
                    currentDayDate={currentDayDate}
                    dayPhotos={dayPhotos}
                    getMediaUrl={getMediaUrl}
                    onOpenGallery={handleOpenDayGallery}
                  />
                ) : (
                  <ContentCard
                    activeTab={contentToTab[activeContent]}
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
                    embedded={true}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The Pill */}
        <motion.div
          ref={pillRef}
          drag={!isExpanded && !isOverviewMode ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={!isExpanded && !isOverviewMode ? handleSwipeDragEnd : undefined}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          style={{
            ...glassStyle,
            borderRadius: isExpanded ? radius.xl : radius.pill,
            padding: 0,
            overflow: 'hidden',
            pointerEvents: 'auto',
            userSelect: 'none',
          }}
        >
          {/* Main Navigation Row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: isMobile ? '10px 16px' : '12px 20px',
              minHeight: isMobile ? 48 : 52,
            }}
          >
            {isOverviewMode ? (
              // Overview mode: trek name + start button
              <>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.accent.primary,
                    background: 'rgba(96, 165, 250, 0.15)',
                    padding: '3px 8px',
                    borderRadius: 6,
                  }}
                >
                  {totalDays} days
                </span>
                <motion.button
                  onClick={handleToggleExpanded}
                  whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    borderRadius: radius.md,
                    color: colors.text.primary,
                    fontSize: isMobile ? 14 : 15,
                    fontWeight: 500,
                  }}
                >
                  {trekData.name}
                </motion.button>
                <motion.button
                  onClick={handleStart}
                  whileHover={{ scale: 1.05, backgroundColor: 'rgba(96, 165, 250, 0.2)' }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    marginLeft: 4,
                    padding: '6px 12px',
                    background: 'rgba(96, 165, 250, 0.15)',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    color: colors.accent.primary,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Start
                  <ChevronIcon direction="right" size={12} />
                </motion.button>
              </>
            ) : (
              // Day mode: arrows + day info
              <>
                {/* Previous day */}
                <motion.button
                  onClick={goToPrevDay}
                  whileHover={currentDay > 1 ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                  whileTap={currentDay > 1 ? { scale: 0.9 } : {}}
                  aria-label="Previous day"
                  disabled={currentDay <= 1}
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
                  }}
                >
                  <ChevronIcon direction="left" size={16} />
                </motion.button>

                {/* Center tap: expand when collapsed, show day info when expanded */}
                <motion.button
                  key={currentDay}
                  onClick={handleCenterTap}
                  initial={{ opacity: 0, x: swipeDirection === 'left' ? 20 : swipeDirection === 'right' ? -20 : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  whileHover={{ backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
                  whileTap={{ scale: 0.98 }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '4px 12px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: radius.md,
                    cursor: 'pointer',
                    color: colors.text.primary,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: colors.accent.primary,
                      background: 'rgba(96, 165, 250, 0.15)',
                      padding: '3px 8px',
                      borderRadius: 6,
                    }}
                  >
                    Day {currentDay}
                  </span>
                  <span
                    style={{
                      fontSize: isMobile ? 14 : 15,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      maxWidth: isMobile ? 140 : 180,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentCampName}
                  </span>
                </motion.button>

                {/* Next day */}
                <motion.button
                  onClick={goToNextDay}
                  whileHover={currentDay < totalDays ? { scale: 1.15, backgroundColor: 'rgba(255, 255, 255, 0.1)' } : {}}
                  whileTap={currentDay < totalDays ? { scale: 0.9 } : {}}
                  aria-label="Next day"
                  disabled={currentDay >= totalDays}
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
                  }}
                >
                  <ChevronIcon direction="right" size={16} />
                </motion.button>
              </>
            )}
          </div>

          {/* Action Row (when expanded) */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                style={{ overflow: 'hidden' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '8px 16px 12px',
                    borderTop: `1px solid ${colors.glass.borderSubtle}`,
                  }}
                >
                  {(['photos', 'stats', 'info'] as ContentType[]).map((content) => (
                    <motion.button
                      key={content}
                      onClick={() => handleOpenContent(content)}
                      whileHover={{ scale: 1.05, backgroundColor: 'rgba(255, 255, 255, 0.12)' }}
                      whileTap={{ scale: 0.95 }}
                      style={{
                        flex: 1,
                        padding: '8px 16px',
                        background:
                          activeContent === content ? 'rgba(96, 165, 250, 0.15)' : 'rgba(255, 255, 255, 0.06)',
                        border: 'none',
                        borderRadius: radius.md,
                        cursor: 'pointer',
                        color: activeContent === content ? colors.accent.primary : colors.text.secondary,
                        fontSize: 13,
                        fontWeight: 500,
                        textTransform: 'capitalize',
                        transition: 'background 0.2s ease, color 0.2s ease',
                      }}
                    >
                      {content}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  );
});

// Day info content component
interface DayInfoContentProps {
  camp: Camp | null;
  currentDayDate: Date | null;
  dayPhotos: Photo[];
  getMediaUrl: (path: string) => string;
  onOpenGallery: () => void;
}

function DayInfoContent({ camp, currentDayDate, dayPhotos, getMediaUrl, onOpenGallery }: DayInfoContentProps) {
  if (!camp) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: colors.text.secondary }}>
        Select a day to see details
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {currentDayDate && (
            <span style={{ fontSize: 12, color: colors.text.tertiary }}>
              {currentDayDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          )}
          <span
            style={{
              fontSize: 12,
              color: colors.text.secondary,
              background: 'rgba(255, 255, 255, 0.08)',
              padding: '2px 8px',
              borderRadius: 4,
            }}
          >
            {camp.elevation}m
          </span>
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text.primary, margin: 0 }}>{camp.name}</h3>
      </div>

      {/* Notes */}
      {camp.notes && (
        <p style={{ fontSize: 13, lineHeight: 1.5, color: colors.text.secondary, margin: '0 0 12px 0' }}>
          {camp.notes}
        </p>
      )}

      {/* Photo strip */}
      {dayPhotos.length > 0 && (
        <motion.div
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={onOpenGallery}
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            cursor: 'pointer',
            padding: 8,
            margin: '0 -8px 12px -8px',
            borderRadius: radius.md,
            background: 'rgba(255, 255, 255, 0.03)',
          }}
        >
          {dayPhotos.slice(0, 5).map((photo, idx) => (
            <div
              key={photo.id}
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: radius.md,
                overflow: 'hidden',
                border: `1px solid ${colors.glass.borderSubtle}`,
              }}
            >
              <img
                src={getMediaUrl(photo.thumbnail_url || photo.url)}
                alt={photo.caption || `Photo ${idx + 1}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          ))}
          {dayPhotos.length > 5 && (
            <div
              style={{
                flexShrink: 0,
                width: 56,
                height: 56,
                borderRadius: radius.md,
                background: 'rgba(255, 255, 255, 0.08)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.text.secondary,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              +{dayPhotos.length - 5}
            </div>
          )}
        </motion.div>
      )}

      {/* Highlights */}
      {camp.highlights && camp.highlights.length > 0 && (
        <ul style={{ margin: '0 0 12px 0', paddingLeft: 16 }}>
          {camp.highlights.map((highlight, idx) => (
            <li key={idx} style={{ fontSize: 12, color: colors.text.secondary, marginBottom: 2 }}>
              {highlight}
            </li>
          ))}
        </ul>
      )}

      {/* View gallery button */}
      {dayPhotos.length > 0 && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onOpenGallery}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'rgba(96, 165, 250, 0.15)',
            border: 'none',
            borderRadius: radius.md,
            cursor: 'pointer',
            color: colors.accent.primary,
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <PhotoIcon size={14} />
          View Day {camp.dayNumber} Photos ({dayPhotos.length})
        </motion.button>
      )}
    </div>
  );
}

export default AdaptiveNavPill;
