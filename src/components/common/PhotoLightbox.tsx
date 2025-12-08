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
import { cn } from '@/lib/utils';

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
            const timer = setTimeout(() => setIsEntering(false), 50);
            return () => clearTimeout(timer);
        }
    }, [initialIndex, isOpen]);

    // Reset loaded state when changing photos
    useEffect(() => {
        setImageLoaded(false);
    }, [currentIndex]);

    // Auto-hide controls after 5 seconds of inactivity
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

    return createPortal(
        <div
            ref={containerRef}
            onClick={handleContainerClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className={cn(
                "fixed inset-0 bg-black z-[9999] flex items-center justify-center cursor-pointer",
                "touch-pan-y transition-opacity duration-200",
                isEntering ? "opacity-0" : "opacity-100"
            )}
        >
            {/* Top bar */}
            <div className={cn(
                "absolute top-0 left-0 right-0 flex justify-between items-center transition-opacity duration-300",
                "pt-[max(16px,env(safe-area-inset-top))] px-4 pb-6",
                showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
                style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}
            >
                {/* Photo counter */}
                <span className="text-white/95 text-sm font-normal tracking-wide tabular-nums">
                    {currentIndex + 1} / {photos.length}
                </span>

                {/* Action buttons */}
                <div className="flex gap-3">
                    {editMode && onEdit && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                                onEdit(currentPhoto);
                            }}
                            className="w-11 h-11 rounded-full bg-white/15 border-none text-white flex items-center justify-center cursor-pointer transition-colors hover:bg-white/25"
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
                                if (confirm('Delete this photo?')) {
                                    handleDelete();
                                }
                            }}
                            className="w-11 h-11 rounded-full bg-red-400/20 border-none text-red-400 flex items-center justify-center cursor-pointer transition-colors hover:bg-red-400/30"
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
                        className="w-11 h-11 rounded-full bg-white/15 border-none text-white flex items-center justify-center cursor-pointer transition-colors hover:bg-white/25"
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
                    className={cn(
                        "absolute left-5 top-1/2 -translate-y-1/2 w-13 h-13 rounded-full",
                        "bg-white/20 border-none text-white flex items-center justify-center cursor-pointer",
                        "transition-opacity duration-300 hover:bg-white/30",
                        showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                    )}
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
                    className={cn(
                        "absolute right-5 top-1/2 -translate-y-1/2 w-13 h-13 rounded-full",
                        "bg-white/20 border-none text-white flex items-center justify-center cursor-pointer",
                        "transition-opacity duration-300 hover:bg-white/30",
                        showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                    )}
                    aria-label="Next photo"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            )}

            {/* Photo container with swipe animation */}
            <div
                className="flex items-center justify-center cursor-default pointer-events-none"
                style={{
                    transform: `translateX(${touchDelta * 0.4}px)`,
                    transition: touchDelta === 0 ? 'transform 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none'
                }}
            >
                {/* Loading indicator */}
                {!imageLoaded && (
                    <div className="absolute flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white/20 border-t-white/50 rounded-full animate-spin" />
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
                    className={cn(
                        "max-w-[calc(100vw-160px)] max-h-[calc(100vh-180px)] object-contain",
                        "select-none rounded-sm pointer-events-auto cursor-default",
                        "transition-all duration-200",
                        imageLoaded && !isAnimating ? "opacity-100 scale-100" : "opacity-0 scale-[0.98]"
                    )}
                    style={{
                        WebkitUserDrag: 'none',
                        transform: currentPhoto.rotation ? `rotate(${currentPhoto.rotation}deg)` : undefined,
                    } as React.CSSProperties}
                    draggable={false}
                />
            </div>

            {/* Bottom info bar - caption and location */}
            {(currentPhoto.caption || currentPhoto.coordinates) && (
                <div
                    className={cn(
                        "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
                        "pt-8 px-6 pb-[max(24px,env(safe-area-inset-bottom))]",
                        showControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                    )}
                    style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}
                >
                    {currentPhoto.caption && (
                        <p className={cn(
                            "text-white/95 text-[15px] text-center font-normal leading-relaxed",
                            "max-w-[560px] mx-auto m-0",
                            currentPhoto.coordinates ? "mb-3" : "mb-0"
                        )}>
                            {currentPhoto.caption}
                        </p>
                    )}

                    {currentPhoto.coordinates && onViewOnMap && (
                        <div className="flex items-center justify-center gap-3">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose();
                                    onViewOnMap(currentPhoto);
                                }}
                                className="flex items-center gap-1.5 bg-white/20 border border-white/20 rounded-full px-4 py-2 text-white/70 text-xs cursor-pointer transition-colors hover:bg-white/30"
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
                <div className={cn(
                    "absolute left-1/2 -translate-x-1/2 transition-opacity duration-300",
                    (currentPhoto.caption || currentPhoto.coordinates) ? "bottom-[110px]" : "bottom-8",
                    showControls ? "opacity-70" : "opacity-0"
                )}>
                    {photos.length <= 10 ? (
                        <div className="flex gap-1.5">
                            {photos.map((_, idx) => (
                                <div
                                    key={idx}
                                    className={cn(
                                        "h-1.5 rounded-sm transition-all duration-300",
                                        idx === currentIndex
                                            ? "w-5 bg-white/95"
                                            : "w-1.5 bg-white/40"
                                    )}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="w-30 h-[3px] bg-white/20 rounded-sm overflow-hidden">
                            <div
                                className="h-full bg-white/95 rounded-sm transition-all duration-300"
                                style={{ width: `${((currentIndex + 1) / photos.length) * 100}%` }}
                            />
                        </div>
                    )}
                </div>
            )}
        </div>,
        document.body
    );
});
