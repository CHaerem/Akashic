/**
 * Immersive photo lightbox using PhotoSwipe - the industry standard for iOS-native gestures
 * - Native pinch-to-zoom, pan, swipe navigation
 * - Smooth 60fps animations
 * - Battle-tested on iOS for 10+ years
 */

import { useEffect, useRef, useCallback, memo } from 'react';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
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
    const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
    const pswpRef = useRef<PhotoSwipe | null>(null);
    const currentIndexRef = useRef(initialIndex);

    // Get current photo for custom buttons
    const getCurrentPhoto = useCallback(() => {
        return photos[currentIndexRef.current];
    }, [photos]);

    // Handle delete action
    const handleDelete = useCallback(() => {
        const photo = getCurrentPhoto();
        if (onDelete && photo) {
            if (confirm('Delete this photo?')) {
                onDelete(photo);
                // Close if last photo, otherwise PhotoSwipe handles it
                if (photos.length === 1) {
                    pswpRef.current?.close();
                }
            }
        }
    }, [getCurrentPhoto, onDelete, photos.length]);

    // Handle edit action
    const handleEdit = useCallback(() => {
        const photo = getCurrentPhoto();
        if (onEdit && photo) {
            pswpRef.current?.close();
            setTimeout(() => onEdit(photo), 100);
        }
    }, [getCurrentPhoto, onEdit]);

    // Handle view on map action
    const handleViewOnMap = useCallback(() => {
        const photo = getCurrentPhoto();
        if (onViewOnMap && photo?.coordinates) {
            pswpRef.current?.close();
            setTimeout(() => onViewOnMap(photo), 100);
        }
    }, [getCurrentPhoto, onViewOnMap]);

    useEffect(() => {
        if (!isOpen || photos.length === 0) {
            // Clean up if closed
            if (lightboxRef.current) {
                lightboxRef.current.destroy();
                lightboxRef.current = null;
            }
            return;
        }

        // Prepare data source - dimensions will be detected dynamically
        const dataSource = photos.map(photo => ({
            src: getMediaUrl(photo.url),
            msrc: photo.thumbnail_url ? getMediaUrl(photo.thumbnail_url) : undefined,
            alt: photo.caption || 'Photo',
            photo // Store reference for our custom actions
        }));

        const lightbox = new PhotoSwipeLightbox({
            dataSource,
            pswpModule: PhotoSwipe,

            // iOS-native feeling options
            spacing: 0.1,
            allowPanToNext: true,
            loop: false,
            pinchToClose: true,
            closeOnVerticalDrag: true,

            // Zoom settings
            initialZoomLevel: 'fit',
            secondaryZoomLevel: 2,
            maxZoomLevel: 4,

            // Animation settings for smooth feel
            showHideAnimationType: 'fade',
            zoomAnimationDuration: 300,

            // Hide default UI elements we'll replace
            imageClickAction: 'zoom',
            tapAction: 'toggle-controls',
            doubleTapAction: 'zoom',

            // Preload for smooth navigation
            preload: [1, 2],

            // Padding for safe areas
            paddingFn: () => ({
                top: 60,
                bottom: 60,
                left: 0,
                right: 0
            })
        });

        // Handle unknown image dimensions - PhotoSwipe v5 recommended approach
        lightbox.addFilter('itemData', (itemData, index) => {
            // Use viewport-based placeholder dimensions for proper initial layout
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            if (!itemData.width) {
                itemData.width = viewportWidth;
            }
            if (!itemData.height) {
                itemData.height = viewportHeight;
            }
            return itemData;
        });

        // Update to actual dimensions once image loads
        lightbox.on('contentLoadImage', ({ content, isLazy }) => {
            const img = content.element as HTMLImageElement;
            if (img && img.complete && img.naturalWidth) {
                // Image already loaded (cached)
                content.width = img.naturalWidth;
                content.height = img.naturalHeight;
            } else if (img) {
                // Wait for image to load
                img.addEventListener('load', () => {
                    content.width = img.naturalWidth;
                    content.height = img.naturalHeight;
                    content.state = 'loaded';
                    lightbox.pswp?.updateSize(true);
                }, { once: true });
            }
        });

        // Track current index
        lightbox.on('change', () => {
            if (pswpRef.current) {
                currentIndexRef.current = pswpRef.current.currIndex;
            }
        });

        // Handle close
        lightbox.on('close', () => {
            onClose();
        });

        // Add custom UI when PhotoSwipe opens
        lightbox.on('uiRegister', function() {
            // Counter element
            lightbox.pswp?.ui?.registerElement({
                name: 'custom-counter',
                order: 5,
                isButton: false,
                appendTo: 'bar',
                html: `<span class="pswp__counter"></span>`,
                onInit: (el, pswp) => {
                    const updateCounter = () => {
                        el.innerHTML = `${pswp.currIndex + 1} / ${pswp.getNumItems()}`;
                    };
                    pswp.on('change', updateCounter);
                    updateCounter();
                }
            });

            // Edit button (when in edit mode)
            if (editMode && onEdit) {
                lightbox.pswp?.ui?.registerElement({
                    name: 'edit-button',
                    order: 7,
                    isButton: true,
                    appendTo: 'bar',
                    html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
                    onClick: () => handleEdit()
                });
            }

            // Delete button (when in edit mode)
            if (editMode && onDelete) {
                lightbox.pswp?.ui?.registerElement({
                    name: 'delete-button',
                    order: 8,
                    isButton: true,
                    appendTo: 'bar',
                    html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>',
                    onClick: () => handleDelete()
                });
            }

            // View on map button
            if (onViewOnMap) {
                lightbox.pswp?.ui?.registerElement({
                    name: 'map-button',
                    order: 6,
                    isButton: true,
                    appendTo: 'bar',
                    html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
                    onClick: () => handleViewOnMap()
                });
            }
        });

        // Store reference and init
        lightboxRef.current = lightbox;
        lightbox.init();

        // Open at specified index
        lightbox.loadAndOpen(initialIndex);

        // Store pswp instance when available
        lightbox.on('openingAnimationEnd', () => {
            pswpRef.current = lightbox.pswp || null;
        });

        return () => {
            if (lightboxRef.current) {
                lightboxRef.current.destroy();
                lightboxRef.current = null;
            }
            pswpRef.current = null;
        };
    }, [isOpen, photos, initialIndex, getMediaUrl, onClose, editMode, onDelete, onEdit, onViewOnMap, handleDelete, handleEdit, handleViewOnMap]);

    // PhotoSwipe renders into its own container, we don't return anything
    return null;
});
