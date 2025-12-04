/**
 * PhotoStrip - Horizontal scrolling row of photo thumbnails
 */

import { memo } from 'react';
import type { Photo } from '../../types/trek';
import { colors } from '../../styles/liquidGlass';

interface PhotoStripProps {
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    onPhotoClick: (photo: Photo, index: number) => void;
    maxVisible?: number;
}

export const PhotoStrip = memo(function PhotoStrip({
    photos,
    getMediaUrl,
    onPhotoClick,
    maxVisible = 8,
}: PhotoStripProps) {
    if (photos.length === 0) return null;

    const visiblePhotos = photos.slice(0, maxVisible);
    const remainingCount = photos.length - maxVisible;

    return (
        <div style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            padding: '4px 0',
            margin: '0 -4px',
        }}>
            {visiblePhotos.map((photo, index) => (
                <div
                    key={photo.id}
                    onClick={() => onPhotoClick(photo, index)}
                    style={{
                        flexShrink: 0,
                        width: 72,
                        height: 72,
                        borderRadius: 8,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        background: 'rgba(255,255,255,0.05)',
                        border: `1px solid ${colors.glass.borderSubtle}`,
                    }}
                >
                    <img
                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                        alt={photo.caption || 'Photo'}
                        loading="lazy"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />
                </div>
            ))}

            {/* More photos indicator */}
            {remainingCount > 0 && (
                <div
                    onClick={() => onPhotoClick(photos[maxVisible], maxVisible)}
                    style={{
                        flexShrink: 0,
                        width: 72,
                        height: 72,
                        borderRadius: 8,
                        background: 'rgba(255,255,255,0.05)',
                        border: `1px solid ${colors.glass.borderSubtle}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: colors.text.tertiary,
                        fontSize: 13,
                        fontWeight: 500,
                    }}
                >
                    +{remainingCount}
                </div>
            )}
        </div>
    );
});

export default PhotoStrip;
