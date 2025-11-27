/**
 * Immersive photo lightbox with swipe navigation and calm design
 * - Full-screen viewing with minimal UI
 * - Swipe left/right to navigate between photos
 * - Auto-hiding controls that appear on tap
 * - Smooth animations following calm design principles
 */

import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Photo } from '../../types/trek';
import { colors, gradients, transitions } from '../../styles/liquidGlass';

interface PhotoLightboxProps {
    photos: Photo[];
    initialIndex: number;
    isOpen: boolean;
    onClose: () => void;
    getMediaUrl: (path: string) => string;
    onDelete?: (photo: Photo) => void;
    editMode?: boolean;
    onViewOnMap?: (photo: Photo) => void;
}

export const PhotoLightbox = memo(function PhotoLightbox({
    photos,
    initialIndex,
    isOpen,
    onClose,
    getMediaUrl,
    onDelete,
    editMode = false,
    onViewOnMap
}: PhotoLightboxProps) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [showControls, setShowControls] = useState(true);
    const [isAnimating, setIsAnimating] = useState(false);
    const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
    const [touchDelta, setTouchDelta] = useState(0);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [isEntering, setIsEntering] = useState(true);
    const controlsTimeoutRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Reset index and trigger enter animation when opening
    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex);
            setImageLoaded(false);
            setIsEntering(true);
            // Small delay to allow the fade-in
            const timer = setTimeout(() => setIsEntering(false), 50);
            return () => clearTimeout(timer);
        }
    }, [initialIndex, isOpen]);

    // Reset loaded state when changing photos
    useEffect(() => {
        setImageLoaded(false);
    }, [currentIndex]);

    // Auto-hide controls after 5 seconds of inactivity (longer for calm UX)
    const resetControlsTimeout = useCallback(() => {
        if (controlsTimeoutRef.current) {
            clearTimeout(controlsTimeoutRef.current);
        }
        setShowControls(true);
        controlsTimeoutRef.current = window.setTimeout(() => {
            setShowControls(false);
        }, 5000);
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
            setCurrentIndex(prev => prev + 1);
            resetControlsTimeout();
            setTimeout(() => setIsAnimating(false), 250);
        }
    }, [currentIndex, photos.length, isAnimating, resetControlsTimeout]);

    const navigatePrev = useCallback(() => {
        if (currentIndex > 0 && !isAnimating) {
            setIsAnimating(true);
            setCurrentIndex(prev => prev - 1);
            resetControlsTimeout();
            setTimeout(() => setIsAnimating(false), 250);
        }
    }, [currentIndex, isAnimating, resetControlsTimeout]);

    // Touch handlers for swipe
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        setTouchStart({
            x: e.touches[0].clientX,
            y: e.touches[0].clientY
        });
        setTouchDelta(0);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchStart) return;
        const deltaX = e.touches[0].clientX - touchStart.x;
        const deltaY = Math.abs(e.touches[0].clientY - touchStart.y);

        // Only track horizontal swipes (ignore vertical)
        if (deltaY < Math.abs(deltaX) * 0.5) {
            setTouchDelta(deltaX);
        }
    }, [touchStart]);

    const handleTouchEnd = useCallback(() => {
        if (!touchStart) return;

        const threshold = 60;

        if (touchDelta < -threshold) {
            navigateNext();
        } else if (touchDelta > threshold) {
            navigatePrev();
        }

        setTouchStart(null);
        setTouchDelta(0);
    }, [touchStart, touchDelta, navigateNext, navigatePrev]);

    const handleContainerClick = useCallback((e: React.MouseEvent) => {
        // Close when clicking the backdrop (outside the image)
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

    // Use portal to render at document root, avoiding stacking context issues from parent transforms/filters
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
                background: 'rgb(0, 0, 0)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                touchAction: 'pan-y',
                opacity: isEntering ? 0 : 1,
                transition: 'opacity 0.2s ease-out'
            }}
        >
            {/* Top bar - fades in/out */}
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
                transition: `opacity ${transitions.normal}`,
                pointerEvents: showControls ? 'auto' : 'none'
            }}>
                {/* Photo counter */}
                <span style={{
                    color: colors.text.primary,
                    fontSize: 14,
                    fontWeight: 400,
                    letterSpacing: '0.02em',
                    fontVariantNumeric: 'tabular-nums'
                }}>
                    {currentIndex + 1} / {photos.length}
                </span>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 12 }}>
                    {editMode && onDelete && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this photo?')) {
                                    handleDelete();
                                }
                            }}
                            style={{
                                background: `rgba(248, 113, 113, 0.2)`,
                                border: 'none',
                                color: colors.accent.error,
                                width: 44,
                                height: 44,
                                borderRadius: '50%',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: `background ${transitions.normal}`
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
                            onClose();
                        }}
                        style={{
                            background: colors.glass.light,
                            border: 'none',
                            color: colors.text.primary,
                            width: 44,
                            height: 44,
                            borderRadius: '50%',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: `background ${transitions.normal}`
                        }}
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
                        position: 'absolute',
                        left: 20,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: colors.glass.medium,
                        border: 'none',
                        color: colors.text.primary,
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: showControls ? 1 : 0,
                        transition: `opacity ${transitions.normal}, background ${transitions.normal}`,
                        pointerEvents: showControls ? 'auto' : 'none'
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
                        position: 'absolute',
                        right: 20,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: colors.glass.medium,
                        border: 'none',
                        color: colors.text.primary,
                        width: 52,
                        height: 52,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: showControls ? 1 : 0,
                        transition: `opacity ${transitions.normal}, background ${transitions.normal}`,
                        pointerEvents: showControls ? 'auto' : 'none'
                    }}
                    aria-label="Next photo"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            )}

            {/* Photo container with swipe animation */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transform: `translateX(${touchDelta * 0.4}px)`,
                    transition: touchDelta === 0 ? 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none',
                    cursor: 'default',
                    pointerEvents: 'none'
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
                        maxWidth: 'calc(100vw - 160px)',
                        maxHeight: 'calc(100vh - 180px)',
                        objectFit: 'contain',
                        userSelect: 'none',
                        WebkitUserDrag: 'none',
                        opacity: imageLoaded && !isAnimating ? 1 : 0,
                        transform: imageLoaded ? 'scale(1)' : 'scale(0.98)',
                        transition: 'opacity 0.2s ease, transform 0.2s ease',
                        borderRadius: 2,
                        pointerEvents: 'auto',
                        cursor: 'default'
                    } as React.CSSProperties}
                    draggable={false}
                />
            </div>

            {/* Bottom info bar - caption and location */}
            {(currentPhoto.caption || currentPhoto.coordinates) && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    padding: '32px 24px max(24px, env(safe-area-inset-bottom))',
                    background: gradients.overlay.bottom,
                    opacity: showControls ? 1 : 0,
                    transition: `opacity ${transitions.normal}`,
                    pointerEvents: showControls ? 'auto' : 'none'
                }}>
                    {/* Caption */}
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
                            marginBottom: currentPhoto.coordinates ? 12 : 0
                        }}>
                            {currentPhoto.caption}
                        </p>
                    )}

                    {/* Location info and View on Map button */}
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
                                    onClose(); // Close lightbox first
                                    onViewOnMap(currentPhoto);
                                }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    background: colors.glass.medium,
                                    border: `1px solid ${colors.glass.border}`,
                                    borderRadius: 20,
                                    padding: '8px 16px',
                                    color: colors.text.secondary,
                                    fontSize: 12,
                                    cursor: 'pointer',
                                    transition: `all ${transitions.normal}`
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

            {/* Progress indicator - simple dots for few photos, line for many */}
            {photos.length > 1 && (
                <div style={{
                    position: 'absolute',
                    bottom: (currentPhoto.caption || currentPhoto.coordinates) ? 110 : 32,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    opacity: showControls ? 0.7 : 0,
                    transition: `opacity ${transitions.normal}`
                }}>
                    {photos.length <= 10 ? (
                        // Dots for few photos
                        <div style={{ display: 'flex', gap: 6 }}>
                            {photos.map((_, idx) => (
                                <div
                                    key={idx}
                                    style={{
                                        width: idx === currentIndex ? 20 : 6,
                                        height: 6,
                                        borderRadius: 3,
                                        background: idx === currentIndex ? colors.text.primary : colors.text.subtle,
                                        transition: `all ${transitions.normal}`
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        // Progress bar for many photos
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
                                transition: `width ${transitions.normal}`
                            }} />
                        </div>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
});
