/**
 * Photo and video lightbox using yet-another-react-lightbox (YARL)
 * - Native React component with clean API
 * - Built-in zoom plugin with pinch-to-zoom for images
 * - Video support with HTML5 player
 * - Handles unknown image dimensions automatically
 */

import { useState, useCallback, useMemo } from 'react';
import Lightbox, { Slide } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Video from 'yet-another-react-lightbox/plugins/video';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { Photo } from '../../types/trek';

// Helper to get video MIME type from URL
function getVideoMimeType(url: string): string {
    const ext = url.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
        'mov': 'video/quicktime',
        'mp4': 'video/mp4',
        'm4v': 'video/x-m4v',
        'webm': 'video/webm',
    };
    return types[ext || ''] || 'video/mp4';
}

// Helper to check if a video format may have browser compatibility issues
function isIncompatibleVideoFormat(url: string): boolean {
    const ext = url.split('.').pop()?.toLowerCase();
    // .mov (QuickTime) only works in Safari
    // .m4v also has limited support
    return ext === 'mov' || ext === 'm4v';
}

// Static YARL config objects - defined outside component to prevent recreating on each render
// This is critical to avoid infinite loops caused by YARL detecting "new" config objects
const LIGHTBOX_PLUGINS = [Zoom, Counter, Video];

const LIGHTBOX_ZOOM_CONFIG = {
    maxZoomPixelRatio: 4,
    zoomInMultiplier: 2,
    doubleTapDelay: 300,
    doubleClickDelay: 300,
    doubleClickMaxStops: 2,
    keyboardMoveDistance: 50,
    wheelZoomDistanceFactor: 100,
    pinchZoomDistanceFactor: 100,
    scrollToZoom: true
};

const LIGHTBOX_CAROUSEL_CONFIG = {
    finite: true,
    preload: 2
};

const LIGHTBOX_ANIMATION_CONFIG = {
    fade: 200,
    swipe: 200,
    easing: {
        fade: 'ease',
        swipe: 'ease-out',
        navigation: 'ease-in-out'
    }
};

const LIGHTBOX_CONTROLLER_CONFIG = {
    closeOnBackdropClick: true,
    closeOnPullDown: true,
    closeOnPullUp: true
};

const LIGHTBOX_STYLES = {
    container: { backgroundColor: 'rgba(0, 0, 0, 0.95)' }
};

// Video player configuration
// Note: crossOrigin needed for authenticated URLs from different origin (R2 Worker)
// playsInline is critical for iOS to play inline instead of fullscreen
// preload="metadata" helps iOS load video info without downloading entire file
const LIGHTBOX_VIDEO_CONFIG = {
    controls: true,
    playsInline: true,
    autoPlay: false,
    muted: false,
    crossOrigin: 'anonymous' as const,
    preload: 'metadata' as const,
};

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

export function PhotoLightbox({
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
    // Local state for navigation within lightbox - initialized from initialIndex
    // NO useEffect sync - parent controls via key prop to force remount when needed
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    // Convert photos to YARL slides format (supports both images and videos)
    const slides = useMemo<Slide[]>(() =>
        photos.map(photo => {
            const mediaUrl = getMediaUrl(photo.url);

            // Check if this is a video
            if (photo.media_type === 'video') {
                return {
                    type: 'video' as const,
                    sources: [{ src: mediaUrl, type: getVideoMimeType(photo.url) }],
                    poster: photo.thumbnail_url ? getMediaUrl(photo.thumbnail_url) : undefined,
                };
            }

            // Default to image
            return {
                src: mediaUrl,
                alt: photo.caption || 'Photo',
                // YARL handles unknown dimensions automatically
            };
        }),
        [photos, getMediaUrl]
    );

    // Get current photo for actions
    const currentPhoto = photos[currentIndex];

    // Handle delete
    const handleDelete = useCallback(() => {
        if (onDelete && currentPhoto) {
            if (confirm('Delete this photo?')) {
                onDelete(currentPhoto);
                if (photos.length === 1) {
                    onClose();
                }
            }
        }
    }, [onDelete, currentPhoto, photos.length, onClose]);

    // Handle edit
    const handleEdit = useCallback(() => {
        if (onEdit && currentPhoto) {
            onClose();
            setTimeout(() => onEdit(currentPhoto), 100);
        }
    }, [onEdit, currentPhoto, onClose]);

    // Handle view on map
    const handleViewOnMap = useCallback(() => {
        if (onViewOnMap && currentPhoto?.coordinates) {
            onClose();
            setTimeout(() => onViewOnMap(currentPhoto), 100);
        }
    }, [onViewOnMap, currentPhoto, onClose]);

    // Stable handler for view changes - prevents re-renders from creating new callback references
    const handleViewChange = useCallback(({ index }: { index: number }) => {
        setCurrentIndex(index);
    }, []);

    // Memoize the on handlers object to prevent YARL from re-initializing
    const onHandlers = useMemo(() => ({
        view: handleViewChange
    }), [handleViewChange]);

    // Custom toolbar buttons
    const toolbar = useMemo(() => {
        const buttons: React.ReactNode[] = [];

        // View on map button
        if (onViewOnMap && currentPhoto?.coordinates) {
            buttons.push(
                <button
                    key="map"
                    type="button"
                    className="yarl__button"
                    onClick={handleViewOnMap}
                    aria-label="View on map"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                    </svg>
                </button>
            );
        }

        // Edit button (edit mode only)
        if (editMode && onEdit) {
            buttons.push(
                <button
                    key="edit"
                    type="button"
                    className="yarl__button"
                    onClick={handleEdit}
                    aria-label="Edit photo"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                </button>
            );
        }

        // Delete button (edit mode only)
        if (editMode && onDelete) {
            buttons.push(
                <button
                    key="delete"
                    type="button"
                    className="yarl__button"
                    onClick={handleDelete}
                    aria-label="Delete photo"
                    style={{ color: '#ef4444' }}
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
                    </svg>
                </button>
            );
        }

        return { buttons };
    }, [editMode, onEdit, onDelete, onViewOnMap, currentPhoto, handleDelete, handleEdit, handleViewOnMap]);

    // Check if current photo is an incompatible video format
    const showCompatibilityWarning = currentPhoto?.media_type === 'video' &&
        isIncompatibleVideoFormat(currentPhoto.url);

    if (!isOpen || photos.length === 0) {
        return null;
    }

    return (
        <>
            <Lightbox
                open={isOpen}
                close={onClose}
                slides={slides}
                index={currentIndex}
                on={onHandlers}
                plugins={LIGHTBOX_PLUGINS}
                zoom={LIGHTBOX_ZOOM_CONFIG}
                carousel={LIGHTBOX_CAROUSEL_CONFIG}
                animation={LIGHTBOX_ANIMATION_CONFIG}
                controller={LIGHTBOX_CONTROLLER_CONFIG}
                toolbar={toolbar}
                styles={LIGHTBOX_STYLES}
                video={LIGHTBOX_VIDEO_CONFIG}
            />
            {/* Warning banner for incompatible video formats */}
            {showCompatibilityWarning && (
                <div
                    style={{
                        position: 'fixed',
                        bottom: '80px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        backgroundColor: 'rgba(234, 179, 8, 0.95)',
                        color: '#000',
                        padding: '12px 20px',
                        borderRadius: '8px',
                        zIndex: 10001,
                        maxWidth: '90vw',
                        textAlign: 'center',
                        fontSize: '14px',
                        fontWeight: 500,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                >
                    <span style={{ marginRight: '8px' }}>⚠️</span>
                    This video format (.mov) may not play in all browsers.
                    <br />
                    <span style={{ fontSize: '12px', opacity: 0.8 }}>
                        Works best in Safari. Use Chrome/Firefox for .mp4 videos.
                    </span>
                </div>
            )}
        </>
    );
}
