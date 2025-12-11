/**
 * Photo and video grid component for displaying day media
 * Shows a grid of photos/videos with a "+N more" indicator for overflow
 * Videos display a play icon overlay
 */

import { memo } from 'react';
import type { Photo } from '../../types/trek';
import { cn } from '@/lib/utils';

// Play icon SVG component for video thumbnails
function PlayIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M8 5v14l11-7z" />
        </svg>
    );
}

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
            {photos.slice(0, maxVisible).map((photo, index) => {
                const isVideo = photo.media_type === 'video';

                return (
                    <div
                        key={photo.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPhotoClick(index);
                        }}
                        className="aspect-square rounded-lg overflow-hidden bg-white/5 light:bg-black/5 cursor-pointer relative group"
                    >
                        <img
                            src={getMediaUrl(photo.thumbnail_url || photo.url)}
                            alt={photo.caption || (isVideo ? 'Journey video' : 'Journey photo')}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                            style={photo.rotation ? { transform: `rotate(${photo.rotation}deg)` } : undefined}
                        />
                        {isVideo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                                    <PlayIcon className="w-5 h-5 text-white ml-0.5" />
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
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
