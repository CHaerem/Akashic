/**
 * DayChapter - A single day's content in the journey timeline
 *
 * Shows:
 * - Hero photo (full width)
 * - Day header (day number, date, camp name, elevation)
 * - Photo strip (horizontal scroll)
 * - Description and highlights
 * - Fun facts for the day
 * - Points of interest and historical sites
 */

import { memo, useMemo } from 'react';
import type { Camp, Photo } from '../../types/trek';
import { colors, radius } from '../../styles/liquidGlass';
import { PhotoStrip } from './PhotoStrip';
import { FunFactCard } from './FunFactCard';
import { DayDiscoveries } from './DayDiscoveries';

interface DayChapterProps {
    camp: Camp;
    dayNumber: number;
    date: Date | null;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    onPhotoClick: (photo: Photo, index: number) => void;
    isSelected: boolean;
    onSelect: () => void;
}

export const DayChapter = memo(function DayChapter({
    camp,
    dayNumber,
    date,
    photos,
    getMediaUrl,
    onPhotoClick,
    isSelected,
    onSelect,
}: DayChapterProps) {
    // Find hero photo (is_hero flag or first photo)
    const heroPhoto = useMemo(() => {
        const hero = photos.find(p => p.is_hero);
        return hero || photos[0] || null;
    }, [photos]);

    // Remaining photos (excluding hero)
    const stripPhotos = useMemo(() => {
        if (!heroPhoto) return photos;
        return photos.filter(p => p.id !== heroPhoto.id);
    }, [photos, heroPhoto]);

    // Format date
    const dateStr = date
        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : null;

    return (
        <div
            data-day={dayNumber}
            onClick={onSelect}
            style={{
                margin: '0 16px 16px',
                borderRadius: radius.lg,
                overflow: 'hidden',
                background: `linear-gradient(135deg,
                    rgba(255, 255, 255, 0.08) 0%,
                    rgba(255, 255, 255, 0.04) 100%
                )`,
                border: `1px solid ${isSelected ? colors.accent.primary : colors.glass.borderSubtle}`,
                boxShadow: isSelected
                    ? `0 0 0 1px ${colors.accent.primary}, 0 4px 16px rgba(0,0,0,0.2)`
                    : '0 4px 16px rgba(0,0,0,0.2)',
                cursor: 'pointer',
                transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
        >
            {/* Hero Photo */}
            {heroPhoto && (
                <div
                    onClick={(e) => {
                        e.stopPropagation();
                        onPhotoClick(heroPhoto, 0);
                    }}
                    style={{
                        width: '100%',
                        aspectRatio: '16/9',
                        position: 'relative',
                        overflow: 'hidden',
                        background: 'rgba(0,0,0,0.3)',
                    }}
                >
                    <img
                        src={getMediaUrl(heroPhoto.url)}
                        alt={heroPhoto.caption || `Day ${dayNumber}`}
                        loading="lazy"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                        }}
                    />

                    {/* Day badge overlay */}
                    <div style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        background: 'rgba(0,0,0,0.6)',
                        backdropFilter: 'blur(8px)',
                        WebkitBackdropFilter: 'blur(8px)',
                        borderRadius: 8,
                        padding: '6px 10px',
                    }}>
                        <span style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: colors.accent.primary,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                        }}>
                            Day {dayNumber}
                        </span>
                    </div>

                    {/* Caption overlay */}
                    {heroPhoto.caption && (
                        <div style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            padding: '24px 12px 10px',
                            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                        }}>
                            <p style={{
                                fontSize: 12,
                                color: 'rgba(255,255,255,0.9)',
                                margin: 0,
                            }}>
                                {heroPhoto.caption}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Content area */}
            <div style={{ padding: 16 }}>
                {/* Day header - only show if no hero photo */}
                {!heroPhoto && (
                    <div style={{
                        marginBottom: 12,
                        padding: '8px 12px',
                        background: 'rgba(96, 165, 250, 0.1)',
                        borderRadius: 8,
                        display: 'inline-block',
                    }}>
                        <span style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: colors.accent.primary,
                            textTransform: 'uppercase',
                            letterSpacing: '0.08em',
                        }}>
                            Day {dayNumber}
                        </span>
                    </div>
                )}

                {/* Camp info */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 8,
                }}>
                    <div>
                        <h3 style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: colors.text.primary,
                            margin: 0,
                            marginBottom: 4,
                        }}>
                            {camp.name}
                        </h3>
                        {dateStr && (
                            <p style={{
                                fontSize: 12,
                                color: colors.text.tertiary,
                                margin: 0,
                            }}>
                                {dateStr}
                            </p>
                        )}
                    </div>
                    <span style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: colors.text.secondary,
                        background: 'rgba(255,255,255,0.05)',
                        padding: '4px 8px',
                        borderRadius: 6,
                    }}>
                        {camp.elevation}m
                    </span>
                </div>

                {/* Description/Notes */}
                {camp.notes && (
                    <p style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: colors.text.secondary,
                        margin: 0,
                        marginBottom: stripPhotos.length > 0 || (camp.highlights && camp.highlights.length > 0) ? 12 : 0,
                    }}>
                        {camp.notes}
                    </p>
                )}

                {/* Highlights */}
                {camp.highlights && camp.highlights.length > 0 && (
                    <ul style={{
                        margin: 0,
                        marginBottom: 12,
                        paddingLeft: 18,
                    }}>
                        {camp.highlights.map((highlight, idx) => (
                            <li
                                key={idx}
                                style={{
                                    fontSize: 13,
                                    color: colors.text.secondary,
                                    marginBottom: 4,
                                }}
                            >
                                {highlight}
                            </li>
                        ))}
                    </ul>
                )}

                {/* Fun Facts */}
                {camp.funFacts && camp.funFacts.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                marginBottom: 10,
                            }}
                        >
                            <span style={{ fontSize: 14 }}>💡</span>
                            <span
                                style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: colors.text.tertiary,
                                }}
                            >
                                Did you know?
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {camp.funFacts.map((fact) => (
                                <FunFactCard key={fact.id} fact={fact} compact />
                            ))}
                        </div>
                    </div>
                )}

                {/* Points of Interest & Historical Sites */}
                <DayDiscoveries
                    pointsOfInterest={camp.pointsOfInterest}
                    historicalSites={camp.historicalSites}
                />

                {/* Photo strip */}
                {stripPhotos.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                        <PhotoStrip
                            photos={stripPhotos}
                            getMediaUrl={getMediaUrl}
                            onPhotoClick={(photo, idx) => {
                                // Adjust index to account for hero photo
                                const actualIndex = heroPhoto ? idx + 1 : idx;
                                onPhotoClick(photo, actualIndex);
                            }}
                        />
                    </div>
                )}

                {/* No photos state */}
                {photos.length === 0 && !camp.funFacts?.length && !camp.pointsOfInterest?.length && !camp.historicalSites?.length && (
                    <div style={{
                        padding: '20px 0',
                        textAlign: 'center',
                        color: colors.text.subtle,
                        fontSize: 12,
                    }}>
                        No photos for this day
                    </div>
                )}
            </div>
        </div>
    );
});

export default DayChapter;
