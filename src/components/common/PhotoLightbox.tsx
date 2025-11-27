/**
 * Immersive Photo Lightbox - Liquid Glass Design System
 *
 * Full-screen photo viewing with smooth, physics-based gestures:
 * - Horizontal swipe with velocity-based navigation
 * - Vertical swipe to dismiss
 * - Pinch-to-zoom (future enhancement)
 * - Auto-hiding controls with elegant fade
 * - Haptic feedback on navigation
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Photo } from '../../types/trek';
import { colors, gradients, transitions } from '../../styles/liquidGlass';
import { triggerHaptic, VelocityTracker, liquidTransitions, rubberBand } from '../../hooks/useTouchFeedback';

interface PhotoLightboxProps {
  photos: Photo[];
  initialIndex: number;
  isOpen: boolean;
  onClose: () => void;
  getMediaUrl: (path: string) => string;
  onDelete?: (photo: Photo) => void;
  editMode?: boolean;
  onViewOnMap?: (photo: Photo) => void;
  onEdit?: (photo: Photo) => void;
}

// Animation timing
const SWIPE_THRESHOLD = 50; // px
const VELOCITY_THRESHOLD = 400; // px/s
const DISMISS_THRESHOLD = 100; // px for vertical dismiss
const CONTROLS_TIMEOUT = 5000; // ms

export const PhotoLightbox = memo(function PhotoLightbox({
  photos,
  initialIndex,
  isOpen,
  onClose,
  getMediaUrl,
  onDelete,
  editMode = false,
  onViewOnMap,
  onEdit
}: PhotoLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isEntering, setIsEntering] = useState(true);

  // Touch state
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const [touchDeltaY, setTouchDeltaY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDirection, setDragDirection] = useState<'horizontal' | 'vertical' | null>(null);

  // Refs
  const controlsTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const velocityTrackerRef = useRef(new VelocityTracker());

  // Reset index and trigger enter animation when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setImageLoaded(false);
      setIsEntering(true);
      setTouchDeltaX(0);
      setTouchDeltaY(0);
      const timer = setTimeout(() => setIsEntering(false), 50);
      return () => clearTimeout(timer);
    }
  }, [initialIndex, isOpen]);

  // Reset loaded state when changing photos
  useEffect(() => {
    setImageLoaded(false);
  }, [currentIndex]);

  // Auto-hide controls
  const resetControlsTimeout = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    setShowControls(true);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, CONTROLS_TIMEOUT);
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
        onClose();
      } else if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) {
        navigateNext();
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        navigatePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentIndex, photos.length, onClose]);

  const navigateNext = useCallback(() => {
    if (currentIndex < photos.length - 1 && !isAnimating) {
      setIsAnimating(true);
      triggerHaptic('light');
      setCurrentIndex(prev => prev + 1);
      resetControlsTimeout();
      setTimeout(() => setIsAnimating(false), 300);
    }
  }, [currentIndex, photos.length, isAnimating, resetControlsTimeout]);

  const navigatePrev = useCallback(() => {
    if (currentIndex > 0 && !isAnimating) {
      setIsAnimating(true);
      triggerHaptic('light');
      setCurrentIndex(prev => prev - 1);
      resetControlsTimeout();
      setTimeout(() => setIsAnimating(false), 300);
    }
  }, [currentIndex, isAnimating, resetControlsTimeout]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    velocityTrackerRef.current.reset();
    velocityTrackerRef.current.addPoint(touch.clientX, touch.clientY);
    setIsDragging(true);
    setDragDirection(null);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || !isDragging) return;

    const touch = e.touches[0];
    velocityTrackerRef.current.addPoint(touch.clientX, touch.clientY);

    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    // Determine drag direction on first significant movement
    if (!dragDirection) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < 10 && absDy < 10) return; // Not enough movement

      if (absDx > absDy * 1.2) {
        setDragDirection('horizontal');
      } else if (absDy > absDx * 1.2) {
        setDragDirection('vertical');
      } else {
        setDragDirection('horizontal'); // Default to horizontal for photos
      }
    }

    if (dragDirection === 'horizontal') {
      // Apply rubber band at edges
      let adjustedDx = dx;
      if ((currentIndex === 0 && dx > 0) || (currentIndex === photos.length - 1 && dx < 0)) {
        adjustedDx = rubberBand(Math.abs(dx), 150, 0.4) * Math.sign(dx);
      }
      setTouchDeltaX(adjustedDx);
      setTouchDeltaY(0);
    } else if (dragDirection === 'vertical') {
      // Vertical drag for dismiss - apply rubber band
      const adjustedDy = rubberBand(Math.abs(dy), 200, 0.5) * Math.sign(dy);
      setTouchDeltaY(adjustedDy);
      setTouchDeltaX(0);
    }
  }, [isDragging, dragDirection, currentIndex, photos.length]);

  const handleTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const { vx, vy } = velocityTrackerRef.current.getVelocity();

    if (dragDirection === 'horizontal') {
      // Horizontal swipe - navigate photos
      const velocityTriggered = Math.abs(vx) > VELOCITY_THRESHOLD;

      if (touchDeltaX < -SWIPE_THRESHOLD || (velocityTriggered && vx < 0)) {
        navigateNext();
      } else if (touchDeltaX > SWIPE_THRESHOLD || (velocityTriggered && vx > 0)) {
        navigatePrev();
      }
    } else if (dragDirection === 'vertical') {
      // Vertical swipe - dismiss
      const velocityTriggered = Math.abs(vy) > VELOCITY_THRESHOLD;

      if (Math.abs(touchDeltaY) > DISMISS_THRESHOLD || velocityTriggered) {
        triggerHaptic('light');
        onClose();
        return;
      }
    }

    // Reset
    setTouchDeltaX(0);
    setTouchDeltaY(0);
    setIsDragging(false);
    setDragDirection(null);
    touchStartRef.current = null;
  }, [dragDirection, touchDeltaX, touchDeltaY, navigateNext, navigatePrev, onClose]);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onClose();
    } else {
      resetControlsTimeout();
    }
  }, [onClose, resetControlsTimeout]);

  const handleDelete = useCallback(() => {
    if (onDelete && photos[currentIndex]) {
      onDelete(photos[currentIndex]);
      if (photos.length === 1) {
        onClose();
      } else if (currentIndex >= photos.length - 1) {
        setCurrentIndex(prev => prev - 1);
      }
    }
  }, [onDelete, photos, currentIndex, onClose]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
  }, []);

  if (!isOpen || photos.length === 0) return null;

  const currentPhoto = photos[currentIndex];
  if (!currentPhoto) return null;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < photos.length - 1;

  // Calculate transform for drag feedback
  const getImageTransform = () => {
    const translateX = touchDeltaX * 0.5; // Reduced movement for natural feel
    const translateY = touchDeltaY * 0.3;
    const scale = 1 - Math.abs(touchDeltaY) * 0.001; // Subtle scale down on vertical drag

    return `translate(${translateX}px, ${translateY}px) scale(${Math.max(0.9, scale)})`;
  };

  // Calculate opacity for dismiss gesture
  const getDismissOpacity = () => {
    const progress = Math.abs(touchDeltaY) / 200;
    return Math.max(0.3, 1 - progress * 0.7);
  };

  return createPortal(
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed',
        inset: 0,
        background: `rgba(0, 0, 0, ${getDismissOpacity()})`,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        touchAction: 'none',
        opacity: isEntering ? 0 : 1,
        transition: isDragging ? 'none' : `opacity 0.25s ease-out, background ${liquidTransitions.normal}`,
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      {/* Top bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: 'max(16px, env(safe-area-inset-top)) 16px 24px',
        background: gradients.overlay.top,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        opacity: showControls ? 1 : 0,
        transform: showControls ? 'translateY(0)' : 'translateY(-10px)',
        transition: `opacity ${liquidTransitions.normal}, transform ${liquidTransitions.smooth}`,
        pointerEvents: showControls ? 'auto' : 'none'
      }}>
        {/* Photo counter */}
        <span style={{
          color: colors.text.primary,
          fontSize: 14,
          fontWeight: 400,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
          textShadow: '0 1px 2px rgba(0,0,0,0.5)'
        }}>
          {currentIndex + 1} / {photos.length}
        </span>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          {editMode && onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('light');
                onClose();
                onEdit(currentPhoto);
              }}
              style={actionButtonStyle}
              aria-label="Edit photo"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {editMode && onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('warning');
                if (confirm('Delete this photo?')) {
                  handleDelete();
                }
              }}
              style={{
                ...actionButtonStyle,
                background: 'rgba(248, 113, 113, 0.2)',
                color: colors.accent.error,
              }}
              aria-label="Delete photo"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              triggerHaptic('light');
              onClose();
            }}
            style={actionButtonStyle}
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation arrows (desktop) */}
      {canGoPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigatePrev();
          }}
          style={{
            ...navButtonStyle,
            left: 20,
            opacity: showControls ? 0.9 : 0,
          }}
          aria-label="Previous photo"
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
            ...navButtonStyle,
            right: 20,
            opacity: showControls ? 0.9 : 0,
          }}
          aria-label="Next photo"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      )}

      {/* Photo container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: getImageTransform(),
          transition: isDragging ? 'none' : `transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)`,
          cursor: 'default',
          pointerEvents: 'none',
          willChange: isDragging ? 'transform' : 'auto',
        }}
      >
        {/* Loading indicator */}
        {!imageLoaded && (
          <div style={{
            position: 'absolute',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{
              width: 32,
              height: 32,
              border: `2px solid ${colors.glass.borderSubtle}`,
              borderTopColor: colors.text.tertiary,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite'
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        <img
          key={currentPhoto.url}
          src={getMediaUrl(currentPhoto.url)}
          alt={currentPhoto.caption || 'Photo'}
          onLoad={handleImageLoad}
          onClick={(e) => {
            e.stopPropagation();
            resetControlsTimeout();
          }}
          style={{
            maxWidth: 'calc(100vw - 80px)',
            maxHeight: 'calc(100vh - 160px)',
            objectFit: 'contain',
            userSelect: 'none',
            WebkitUserDrag: 'none',
            opacity: imageLoaded && !isAnimating ? 1 : 0,
            transform: imageLoaded ? 'scale(1)' : 'scale(0.96)',
            transition: `opacity 0.25s ease, transform 0.3s ${liquidTransitions.spring}`,
            borderRadius: 4,
            pointerEvents: 'auto',
            cursor: 'default',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          } as React.CSSProperties}
          draggable={false}
        />
      </div>

      {/* Bottom info bar */}
      {(currentPhoto.caption || currentPhoto.coordinates) && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '32px 24px max(24px, env(safe-area-inset-bottom))',
          background: gradients.overlay.bottom,
          opacity: showControls ? 1 : 0,
          transform: showControls ? 'translateY(0)' : 'translateY(10px)',
          transition: `opacity ${liquidTransitions.normal}, transform ${liquidTransitions.smooth}`,
          pointerEvents: showControls ? 'auto' : 'none'
        }}>
          {currentPhoto.caption && (
            <p style={{
              color: colors.text.primary,
              fontSize: 15,
              textAlign: 'center',
              margin: 0,
              fontWeight: 400,
              lineHeight: 1.5,
              maxWidth: 560,
              marginLeft: 'auto',
              marginRight: 'auto',
              marginBottom: currentPhoto.coordinates ? 12 : 0,
              textShadow: '0 1px 2px rgba(0,0,0,0.5)'
            }}>
              {currentPhoto.caption}
            </p>
          )}

          {currentPhoto.coordinates && onViewOnMap && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  triggerHaptic('light');
                  onClose();
                  onViewOnMap(currentPhoto);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: colors.glass.medium,
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: `1px solid ${colors.glass.border}`,
                  borderRadius: 20,
                  padding: '10px 18px',
                  color: colors.text.secondary,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: `all ${liquidTransitions.normal}`,
                  minHeight: 44, // Touch target
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                View on Map
              </button>
            </div>
          )}
        </div>
      )}

      {/* Progress indicator */}
      {photos.length > 1 && (
        <div style={{
          position: 'absolute',
          bottom: (currentPhoto.caption || currentPhoto.coordinates) ? 120 : 40,
          left: '50%',
          transform: 'translateX(-50%)',
          opacity: showControls ? 0.7 : 0,
          transition: `opacity ${liquidTransitions.normal}`
        }}>
          {photos.length <= 10 ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {photos.map((_, idx) => (
                <div
                  key={idx}
                  style={{
                    width: idx === currentIndex ? 20 : 6,
                    height: 6,
                    borderRadius: 3,
                    background: idx === currentIndex ? colors.text.primary : colors.text.subtle,
                    transition: `all ${liquidTransitions.smooth}`,
                    boxShadow: idx === currentIndex ? '0 0 8px rgba(255,255,255,0.3)' : 'none'
                  }}
                />
              ))}
            </div>
          ) : (
            <div style={{
              width: 120,
              height: 3,
              background: colors.glass.light,
              borderRadius: 2,
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${((currentIndex + 1) / photos.length) * 100}%`,
                height: '100%',
                background: colors.text.primary,
                borderRadius: 2,
                transition: `width ${liquidTransitions.smooth}`
              }} />
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
});

// Shared button styles
const actionButtonStyle: React.CSSProperties = {
  background: colors.glass.light,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: 'none',
  color: colors.text.primary,
  width: 44,
  height: 44,
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: `all ${liquidTransitions.normal}`,
  WebkitTapHighlightColor: 'transparent',
};

const navButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  background: colors.glass.medium,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: 'none',
  color: colors.text.primary,
  width: 52,
  height: 52,
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: `all ${liquidTransitions.normal}`,
  pointerEvents: 'auto',
  WebkitTapHighlightColor: 'transparent',
};

export default PhotoLightbox;
