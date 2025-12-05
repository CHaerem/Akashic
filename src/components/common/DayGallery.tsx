/**
 * DayGallery - Fullscreen photo carousel for day-by-day exploration
 *
 * Option D implementation from day-photo-exploration.md:
 * - Opens fullscreen when tapping a day
 * - Swipe photos left/right within the day
 * - Swipe down or tap X to return to map
 * - "View on Map" button to see photo location
 * - Swipe between days at photo boundaries
 */

import { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { Photo, Camp, TrekData } from '../../types/trek';
import { colors, radius, effects } from '../../styles/liquidGlass';

interface DayGalleryProps {
  isOpen: boolean;
  onClose: () => void;
  trekData: TrekData;
  photos: Photo[];
  getMediaUrl: (path: string) => string;
  initialDay: number;
  onDayChange: (dayNumber: number) => void;
  onViewOnMap?: (photo: Photo) => void;
}

export const DayGallery = memo(function DayGallery({
  isOpen,
  onClose,
  trekData,
  photos,
  getMediaUrl,
  initialDay,
  onDayChange,
  onViewOnMap,
}: DayGalleryProps) {
  const [currentDay, setCurrentDay] = useState(initialDay);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchDelta, setTouchDelta] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate date for a given day based on journey start date
  const getDayDate = useCallback((dayNumber: number): Date | null => {
    if (!trekData.dateStarted) return null;
    const start = new Date(trekData.dateStarted);
    start.setDate(start.getDate() + (dayNumber - 1));
    return start;
  }, [trekData.dateStarted]);

  // Get photos for a specific day
  const getPhotosForDay = useCallback((dayNumber: number): Photo[] => {
    const dayDate = getDayDate(dayNumber);
    if (!dayDate) return [];

    return photos.filter(p => {
      if (!p.taken_at) return false;
      const photoDate = new Date(p.taken_at);
      return (
        photoDate.getFullYear() === dayDate.getFullYear() &&
        photoDate.getMonth() === dayDate.getMonth() &&
        photoDate.getDate() === dayDate.getDate()
      );
    });
  }, [photos, getDayDate]);

  // Current day's photos
  const dayPhotos = useMemo(() => getPhotosForDay(currentDay), [getPhotosForDay, currentDay]);

  // Current camp info
  const currentCamp = useMemo(() =>
    trekData.camps.find(c => c.dayNumber === currentDay),
    [trekData.camps, currentDay]
  );

  // Total days with photos
  const daysWithPhotos = useMemo(() => {
    const days = new Set<number>();
    const startDate = trekData.dateStarted ? new Date(trekData.dateStarted) : null;

    photos.forEach(p => {
      if (p.taken_at && startDate) {
        const photoDate = new Date(p.taken_at);
        const diffTime = photoDate.getTime() - startDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
        if (diffDays >= 1 && diffDays <= trekData.camps.length) {
          days.add(diffDays);
        }
      }
    });

    return Array.from(days).sort((a, b) => a - b);
  }, [photos, trekData.dateStarted, trekData.camps.length]);

  // Reset when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentDay(initialDay);
      setCurrentPhotoIndex(0);
      setShowControls(true);
      setIsExiting(false);
      setImageLoaded(false);
    }
  }, [isOpen, initialDay]);

  // Reset photo index when day changes
  useEffect(() => {
    setCurrentPhotoIndex(0);
    setImageLoaded(false);
  }, [currentDay]);

  // Auto-hide controls
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    setShowControls(true);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 4000);
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetControlsTimeout();
    }
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isOpen, resetControlsTimeout]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowRight') {
        navigateNext();
      } else if (e.key === 'ArrowLeft') {
        navigatePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentPhotoIndex, dayPhotos.length, currentDay]);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
      setIsExiting(false);
    }, 200);
  }, [onClose]);

  const navigateNext = useCallback(() => {
    resetControlsTimeout();

    if (currentPhotoIndex < dayPhotos.length - 1) {
      // Next photo in same day
      setCurrentPhotoIndex(prev => prev + 1);
      setImageLoaded(false);
    } else {
      // Try to go to next day with photos
      const currentDayIndex = daysWithPhotos.indexOf(currentDay);
      if (currentDayIndex < daysWithPhotos.length - 1) {
        const nextDay = daysWithPhotos[currentDayIndex + 1];
        setCurrentDay(nextDay);
        onDayChange(nextDay);
      }
    }
  }, [currentPhotoIndex, dayPhotos.length, currentDay, daysWithPhotos, resetControlsTimeout, onDayChange]);

  const navigatePrev = useCallback(() => {
    resetControlsTimeout();

    if (currentPhotoIndex > 0) {
      // Previous photo in same day
      setCurrentPhotoIndex(prev => prev - 1);
      setImageLoaded(false);
    } else {
      // Try to go to previous day with photos
      const currentDayIndex = daysWithPhotos.indexOf(currentDay);
      if (currentDayIndex > 0) {
        const prevDay = daysWithPhotos[currentDayIndex - 1];
        const prevDayPhotos = getPhotosForDay(prevDay);
        setCurrentDay(prevDay);
        setCurrentPhotoIndex(prevDayPhotos.length - 1);
        onDayChange(prevDay);
      }
    }
  }, [currentPhotoIndex, currentDay, daysWithPhotos, getPhotosForDay, resetControlsTimeout, onDayChange]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    });
    setTouchDelta({ x: 0, y: 0 });
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStart) return;
    const deltaX = e.touches[0].clientX - touchStart.x;
    const deltaY = e.touches[0].clientY - touchStart.y;
    setTouchDelta({ x: deltaX, y: deltaY });
  }, [touchStart]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStart) return;

    const horizontalThreshold = 60;
    const verticalThreshold = 100;

    // Swipe down to close
    if (touchDelta.y > verticalThreshold && Math.abs(touchDelta.x) < horizontalThreshold) {
      handleClose();
    }
    // Swipe left for next
    else if (touchDelta.x < -horizontalThreshold && Math.abs(touchDelta.y) < verticalThreshold) {
      navigateNext();
    }
    // Swipe right for prev
    else if (touchDelta.x > horizontalThreshold && Math.abs(touchDelta.y) < verticalThreshold) {
      navigatePrev();
    }

    setTouchStart(null);
    setTouchDelta({ x: 0, y: 0 });
  }, [touchStart, touchDelta, handleClose, navigateNext, navigatePrev]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      resetControlsTimeout();
    }
  }, [resetControlsTimeout]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  if (!isOpen) return null;

  const currentPhoto = dayPhotos[currentPhotoIndex];
  const currentDayDate = getDayDate(currentDay);
  const hasPhotos = dayPhotos.length > 0;

  // Calculate global position across all days
  const photosBeforeCurrentDay = daysWithPhotos
    .filter(d => d < currentDay)
    .reduce((sum, d) => sum + getPhotosForDay(d).length, 0);
  const totalPhotos = daysWithPhotos.reduce((sum, d) => sum + getPhotosForDay(d).length, 0);
  const globalIndex = photosBeforeCurrentDay + currentPhotoIndex + 1;

  // Check if can navigate to other days
  const currentDayIndex = daysWithPhotos.indexOf(currentDay);
  const canGoPrevDay = currentDayIndex > 0;
  const canGoNextDay = currentDayIndex < daysWithPhotos.length - 1;
  const canGoPrev = currentPhotoIndex > 0 || canGoPrevDay;
  const canGoNext = currentPhotoIndex < dayPhotos.length - 1 || canGoNextDay;

  return createPortal(
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.2 }}
      onClick={handleContainerClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.95)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        touchAction: 'none',
      }}
    >
      {/* Top bar with day info */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: showControls ? 1 : 0, y: showControls ? 0 : -20 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
          paddingTop: 'max(16px, env(safe-area-inset-top))',
          paddingBottom: 24,
          paddingLeft: 20,
          paddingRight: 20,
          pointerEvents: showControls ? 'auto' : 'none',
          zIndex: 10,
        }}
      >
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}>
          {/* Day info */}
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}>
              <span style={{
                fontSize: 12,
                fontWeight: 600,
                color: colors.accent.primary,
                background: 'rgba(96, 165, 250, 0.2)',
                padding: '4px 10px',
                borderRadius: 6,
              }}>
                Day {currentDay}
              </span>
              {currentDayDate && (
                <span style={{ fontSize: 13, color: colors.text.tertiary }}>
                  {currentDayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              {currentCamp && (
                <span style={{
                  fontSize: 12,
                  color: colors.text.secondary,
                  background: 'rgba(255, 255, 255, 0.1)',
                  padding: '3px 8px',
                  borderRadius: 4,
                }}>
                  {currentCamp.elevation}m
                </span>
              )}
            </div>
            {currentCamp && (
              <h2 style={{
                fontSize: 20,
                fontWeight: 600,
                color: colors.text.primary,
                margin: 0,
              }}>
                {currentCamp.name}
              </h2>
            )}
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.pill,
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.text.primary,
              transition: 'background 0.2s',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </motion.div>

      {/* Photo display area */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {hasPhotos && currentPhoto ? (
          <>
            {/* Navigation arrows (desktop) */}
            {canGoPrev && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigatePrev();
                }}
                style={{
                  position: 'absolute',
                  left: 20,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 52,
                  height: 52,
                  borderRadius: radius.pill,
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.text.primary,
                  opacity: showControls ? 1 : 0,
                  transition: 'opacity 0.3s, background 0.2s',
                  zIndex: 5,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>
            )}

            {canGoNext && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateNext();
                }}
                style={{
                  position: 'absolute',
                  right: 20,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 52,
                  height: 52,
                  borderRadius: radius.pill,
                  background: 'rgba(255, 255, 255, 0.15)',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.text.primary,
                  opacity: showControls ? 1 : 0,
                  transition: 'opacity 0.3s, background 0.2s',
                  zIndex: 5,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </button>
            )}

            {/* Photo */}
            <motion.div
              style={{
                transform: `translate(${touchDelta.x * 0.3}px, ${touchDelta.y * 0.3}px)`,
                transition: touchDelta.x === 0 && touchDelta.y === 0 ? 'transform 0.2s' : 'none',
              }}
            >
              {/* Loading indicator */}
              {!imageLoaded && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    border: '2px solid rgba(255, 255, 255, 0.2)',
                    borderTopColor: 'rgba(255, 255, 255, 0.6)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                </div>
              )}

              <AnimatePresence mode="wait">
                <motion.img
                  key={currentPhoto.id}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: imageLoaded ? 1 : 0, scale: imageLoaded ? 1 : 0.98 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  src={getMediaUrl(currentPhoto.url)}
                  alt={currentPhoto.caption || 'Photo'}
                  onLoad={handleImageLoad}
                  onClick={(e) => {
                    e.stopPropagation();
                    resetControlsTimeout();
                  }}
                  style={{
                    maxWidth: 'calc(100vw - 120px)',
                    maxHeight: 'calc(100vh - 200px)',
                    objectFit: 'contain',
                    borderRadius: radius.sm,
                    userSelect: 'none',
                    cursor: 'default',
                  }}
                  draggable={false}
                />
              </AnimatePresence>
            </motion.div>
          </>
        ) : (
          /* No photos message */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            color: colors.text.tertiary,
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <p style={{ margin: 0, fontSize: 14 }}>No photos for Day {currentDay}</p>
            {daysWithPhotos.length > 0 && (
              <p style={{ margin: 0, fontSize: 12, color: colors.text.subtle }}>
                Swipe to find photos on other days
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar with caption and actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: showControls ? 1 : 0, y: showControls ? 0 : 20 }}
        transition={{ duration: 0.3 }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
          paddingTop: 24,
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
          paddingLeft: 20,
          paddingRight: 20,
          pointerEvents: showControls ? 'auto' : 'none',
          zIndex: 10,
        }}
      >
        {/* Caption */}
        {currentPhoto?.caption && (
          <p style={{
            fontSize: 14,
            color: colors.text.primary,
            textAlign: 'center',
            maxWidth: 500,
            margin: '0 auto 16px',
            lineHeight: 1.5,
          }}>
            {currentPhoto.caption}
          </p>
        )}

        {/* Progress and actions */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}>
          {/* Day photo counter */}
          <div style={{
            fontSize: 13,
            color: colors.text.secondary,
            minWidth: 80,
          }}>
            {hasPhotos ? (
              <>
                <span style={{ color: colors.text.primary, fontWeight: 500 }}>
                  {currentPhotoIndex + 1}
                </span>
                <span> / {dayPhotos.length}</span>
                <span style={{ color: colors.text.subtle, marginLeft: 8 }}>
                  ({globalIndex}/{totalPhotos})
                </span>
              </>
            ) : (
              <span>0 photos</span>
            )}
          </div>

          {/* Day progress dots */}
          {daysWithPhotos.length > 1 && (
            <div style={{
              display: 'flex',
              gap: 6,
              justifyContent: 'center',
            }}>
              {daysWithPhotos.map(day => (
                <button
                  key={day}
                  onClick={() => {
                    setCurrentDay(day);
                    onDayChange(day);
                  }}
                  style={{
                    width: day === currentDay ? 20 : 8,
                    height: 8,
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    background: day === currentDay
                      ? colors.accent.primary
                      : 'rgba(255, 255, 255, 0.3)',
                    transition: 'all 0.2s',
                  }}
                />
              ))}
            </div>
          )}

          {/* View on map button */}
          {currentPhoto?.coordinates && onViewOnMap && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
                onViewOnMap(currentPhoto);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                background: 'rgba(255, 255, 255, 0.15)',
                border: `1px solid rgba(255, 255, 255, 0.2)`,
                borderRadius: radius.pill,
                color: colors.text.primary,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              View on Map
            </button>
          )}
        </div>
      </motion.div>

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>,
    document.body
  );
});

export default DayGallery;
