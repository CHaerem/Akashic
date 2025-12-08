/**
 * Photo grid component for displaying day photos
 * Shows a grid of photos with a "+N more" indicator for overflow
 */

import { memo } from 'react';
import type { Photo } from '../../types/trek';
import { cn } from '@/lib/utils';

interface DayPhotosProps {
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    isMobile: boolean;
    onPhotoClick: (index: number) => void;
}

export const DayPhotos = memo(function DayPhotos({
    photos,
    getMediaUrl,
    isMobile,
    onPhotoClick
}: DayPhotosProps) {
    if (photos.length === 0) {
        return null;
    }

    const maxVisible = isMobile ? 6 : 8;

    return (
        <div className={cn(
            "grid gap-1.5",
            isMobile ? "grid-cols-3" : "grid-cols-4"
        )}>
            {photos.slice(0, maxVisible).map((photo, index) => (
                <div
                    key={photo.id}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(index);
                    }}
                    className="aspect-square rounded-lg overflow-hidden bg-white/5 light:bg-black/5 cursor-pointer"
                >
                    <img
                        src={getMediaUrl(photo.thumbnail_url || photo.url)}
                        alt={photo.caption || 'Journey photo'}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        style={photo.rotation ? { transform: `rotate(${photo.rotation}deg)` } : undefined}
                    />
                </div>
            ))}
            {photos.length > maxVisible && (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(maxVisible);
                    }}
                    className="aspect-square rounded-lg bg-white/5 light:bg-black/5 flex items-center justify-center text-white/40 light:text-slate-400 text-xs cursor-pointer"
                >
                    +{photos.length - maxVisible}
                </div>
            )}
        </div>
    );
});

export default DayPhotos;
