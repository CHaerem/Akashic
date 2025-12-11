/**
 * Photo lightbox using yet-another-react-lightbox (YARL)
 * - Native React component with clean API
 * - Built-in zoom plugin with pinch-to-zoom
 * - Handles unknown image dimensions automatically
 * - Future video support via plugin
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import Lightbox, { SlideImage } from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import type { Photo } from '../../types/trek';

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
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    // Sync currentIndex when lightbox opens with a new initialIndex
    // This fixes the bug where clicking different photos on the map
    // would show the wrong photo (state persisted from previous open)
    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex);
        }
    }, [isOpen, initialIndex]);

    // Convert photos to YARL slides format
    const slides = useMemo<SlideImage[]>(() =>
        photos.map(photo => ({
            src: getMediaUrl(photo.url),
            alt: photo.caption || 'Photo',
            // YARL handles unknown dimensions automatically
        })),
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

    if (!isOpen || photos.length === 0) {
        return null;
    }

    return (
        <Lightbox
            open={isOpen}
            close={onClose}
            slides={slides}
            index={currentIndex}
            on={{
                view: ({ index }) => setCurrentIndex(index)
            }}
            plugins={[Zoom, Counter]}
            zoom={{
                maxZoomPixelRatio: 4,
                zoomInMultiplier: 2,
                doubleTapDelay: 300,
                doubleClickDelay: 300,
                doubleClickMaxStops: 2,
                keyboardMoveDistance: 50,
                wheelZoomDistanceFactor: 100,
                pinchZoomDistanceFactor: 100,
                scrollToZoom: true
            }}
            carousel={{
                finite: true,
                preload: 2
            }}
            animation={{
                fade: 200,
                swipe: 200,
                easing: {
                    fade: 'ease',
                    swipe: 'ease-out',
                    navigation: 'ease-in-out'
                }
            }}
            controller={{
                closeOnBackdropClick: true,
                closeOnPullDown: true,
                closeOnPullUp: true
            }}
            toolbar={toolbar}
            styles={{
                container: { backgroundColor: 'rgba(0, 0, 0, 0.95)' }
            }}
        />
    );
}
