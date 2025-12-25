/**
 * BottomSheetContent - Routes to correct content based on view + mode
 *
 * Globe view + trek selected: Journey overview with "Explore" button
 * Trek view: Day details, Photos, Stats, or Info based on activeMode
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { colors, radius } from '../../styles/liquidGlass';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, Photo, ViewMode } from '../../types/trek';
import type mapboxgl from 'mapbox-gl';
import type { ContentMode } from '../../hooks/useTrekData';
import { StatsTab } from '../trek/StatsTab';
import { OverviewTab } from '../trek/OverviewTab';
import { PhotosTab } from '../trek/PhotosTab';
import { Button } from '../ui/button';
import { ErrorBoundary, ComponentErrorFallback } from '../common/ErrorBoundary';
import { usePhotoDay } from '../../hooks/usePhotoDay';
import { PhotoIcon, PencilIcon } from '../icons';
import { getCountryFlag } from '../../utils/countryFlags';
import { WaypointEditModal } from '../trek/WaypointEditModal';
import { PhotoAssignModal } from '../trek/PhotoAssignModal';
import { JourneyEditModal } from '../trek/JourneyEditModal';
import { RouteEditor } from '../trek/RouteEditor';
import { FunFactCard } from '../journey/FunFactCard';
import { DayDiscoveries } from '../journey/DayDiscoveries';
import { DayCommentsSection } from '../comments';

interface BottomSheetContentProps {
    view: ViewMode;
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    activeMode: ContentMode;
    trekData: TrekData | null;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    onExplore: () => void;
    onCampSelect: (camp: Camp) => void;
    onViewPhotoOnMap: (photo: Photo) => void;
    onOpenDayGallery: () => void;
    onJourneySaved?: () => void;
    editMode?: boolean;
    isMobile?: boolean;
    mapViewportBounds?: mapboxgl.LngLatBoundsLike | null;
    mapViewportPhotoIds?: string[] | null;
}

// Mountain peak icon
const MountainIcon = () => (
    <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: colors.text.tertiary }}
    >
        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
);

export function BottomSheetContent({
    view,
    selectedTrek,
    selectedCamp,
    activeMode,
    trekData,
    extendedStats,
    elevationProfile,
    photos,
    getMediaUrl,
    onExplore,
    onCampSelect,
    onViewPhotoOnMap,
    onOpenDayGallery,
    onJourneySaved,
    editMode = false,
    isMobile = false,
    mapViewportBounds,
    mapViewportPhotoIds,
}: BottomSheetContentProps) {
    // Globe view with trek selected: Journey overview (pre-explore)
    if (view === 'globe' && selectedTrek) {
        return (
            <JourneyOverviewContent
                trek={selectedTrek}
                onExplore={onExplore}
                isMobile={isMobile}
                editMode={editMode}
                onJourneySaved={onJourneySaved || (() => {})}
            />
        );
    }

    // Trek view with no camp selected: Full journey info
    if (view === 'trek' && trekData && !selectedCamp) {
        return (
            <div style={{ padding: 16 }}>
                <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load info" />}>
                    <OverviewTab trekData={trekData} />
                </ErrorBoundary>
            </div>
        );
    }

    // Trek view with camp selected: Content based on active mode
    if (view === 'trek' && trekData) {
        return (
                <TrekViewContent
                    activeMode={activeMode}
                    trekData={trekData}
                    selectedCamp={selectedCamp}
                    extendedStats={extendedStats}
                    elevationProfile={elevationProfile}
                    photos={photos}
                    getMediaUrl={getMediaUrl}
                    onCampSelect={onCampSelect}
                    onViewPhotoOnMap={onViewPhotoOnMap}
                    onOpenDayGallery={onOpenDayGallery}
                    onJourneySaved={onJourneySaved || (() => {})}
                    editMode={editMode}
                    isMobile={isMobile}
                    mapViewportBounds={mapViewportBounds}
                    mapViewportPhotoIds={mapViewportPhotoIds}
                />
            );
    }

    // No content to show
    return null;
}

// Journey overview for globe view
interface JourneyOverviewContentProps {
    trek: TrekConfig;
    onExplore: () => void;
    isMobile: boolean;
    editMode: boolean;
    onJourneySaved: () => void;
}

function JourneyOverviewContent({ trek, onExplore, isMobile, editMode, onJourneySaved }: JourneyOverviewContentProps) {
    const [showJourneyEdit, setShowJourneyEdit] = useState(false);

    return (
        <div style={{ padding: 16 }}>
            {/* Country label */}
            <p
                style={{
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: colors.text.tertiary,
                    marginBottom: 8,
                }}
            >
                <span style={{ marginRight: 6 }}>{getCountryFlag(trek.country)}</span>
                {trek.country}
            </p>

            {/* Trek name */}
            <h2
                style={{
                    fontSize: isMobile ? 24 : 28,
                    fontWeight: 500,
                    color: colors.text.primary,
                    marginBottom: 12,
                }}
            >
                {trek.name}
            </h2>

            {/* Summit elevation */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: colors.text.secondary,
                    marginBottom: 20,
                }}
            >
                <MountainIcon />
                <span style={{ fontSize: 14 }}>
                    Summit: {trek.elevation}
                </span>
            </div>

            {/* Explore button */}
            <Button
                variant="default"
                size={isMobile ? 'lg' : 'md'}
                onClick={onExplore}
                className="w-full tracking-[0.15em]"
            >
                Explore Journey →
            </Button>

            {/* Edit button - only shown in edit mode */}
            {editMode && (
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowJourneyEdit(true)}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        marginTop: 12,
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: radius.md,
                        cursor: 'pointer',
                        color: colors.text.secondary,
                        fontSize: 13,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                    }}
                >
                    <PencilIcon size={14} />
                    Edit Journey Details
                </motion.button>
            )}

            {/* Journey Edit Modal */}
            <JourneyEditModal
                slug={trek.id}
                isOpen={showJourneyEdit}
                onClose={() => setShowJourneyEdit(false)}
                onSave={() => {
                    setShowJourneyEdit(false);
                    onJourneySaved();
                }}
                isMobile={isMobile}
            />
        </div>
    );
}

// Trek view content based on mode
interface TrekViewContentProps {
    activeMode: ContentMode;
    trekData: TrekData;
    selectedCamp: Camp | null;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    photos: Photo[];
    getMediaUrl: (path: string) => string;
    onCampSelect: (camp: Camp) => void;
    onViewPhotoOnMap: (photo: Photo) => void;
    onOpenDayGallery: () => void;
    onJourneySaved: () => void;
    editMode: boolean;
    isMobile: boolean;
    mapViewportBounds?: mapboxgl.LngLatBoundsLike | null;
    mapViewportPhotoIds?: string[] | null;
}

function TrekViewContent({
    activeMode,
    trekData,
    selectedCamp,
    extendedStats,
    elevationProfile,
    photos,
    getMediaUrl,
    onCampSelect,
    onViewPhotoOnMap,
    onOpenDayGallery,
    onJourneySaved,
    editMode,
    isMobile,
    mapViewportBounds,
    mapViewportPhotoIds,
}: TrekViewContentProps) {
    const [showRouteEditor, setShowRouteEditor] = useState(false);
    const { getPhotosForDay } = usePhotoDay(trekData, photos);

    // Calculate date for current day
    const currentDayDate = useMemo(() => {
        if (!trekData.dateStarted || !selectedCamp) return null;
        const start = new Date(trekData.dateStarted);
        start.setDate(start.getDate() + (selectedCamp.dayNumber - 1));
        return start;
    }, [trekData.dateStarted, selectedCamp]);

    // Get photos for current day
    const dayPhotos = useMemo(() => {
        if (!selectedCamp) return [];
        return getPhotosForDay(selectedCamp.dayNumber);
    }, [selectedCamp, getPhotosForDay]);

    return (
        <div style={{ padding: 16 }}>
            {/* Edit Route button - shown when edit mode is active */}
            {editMode && (
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowRouteEditor(true)}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        marginBottom: 16,
                        background: 'rgba(96, 165, 250, 0.15)',
                        border: '1px solid rgba(96, 165, 250, 0.3)',
                        borderRadius: radius.md,
                        cursor: 'pointer',
                        color: colors.accent.primary,
                        fontSize: 14,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                    }}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6l3-3 3 3"/>
                        <path d="M6 3v18"/>
                        <path d="M21 18l-3 3-3-3"/>
                        <path d="M18 21V3"/>
                    </svg>
                    Edit Route & Camp Positions
                </motion.button>
            )}

            {activeMode === 'day' && (
                <DayContent
                    camp={selectedCamp}
                    currentDayDate={currentDayDate}
                    dayPhotos={dayPhotos}
                    allPhotos={photos}
                    getMediaUrl={getMediaUrl}
                    onOpenDayGallery={onOpenDayGallery}
                    editMode={editMode}
                    isMobile={isMobile}
                    journeyId={trekData.uuid}
                />
            )}

            {activeMode === 'photos' && (
                <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load photos" />}>
                    <PhotosTab
                        trekData={trekData}
                        isMobile={isMobile}
                        editMode={editMode}
                        onViewPhotoOnMap={onViewPhotoOnMap}
                        mapViewportBounds={mapViewportBounds}
                        mapViewportPhotoIds={mapViewportPhotoIds}
                    />
                </ErrorBoundary>
            )}

            {activeMode === 'stats' && (
                <ErrorBoundary fallback={<ComponentErrorFallback message="Failed to load stats" />}>
                    <StatsTab
                        trekData={trekData}
                        extendedStats={extendedStats}
                        elevationProfile={elevationProfile}
                        isMobile={isMobile}
                        selectedCamp={selectedCamp}
                        onCampSelect={onCampSelect}
                    />
                </ErrorBoundary>
            )}

            {/* Route Editor Modal */}
            <RouteEditor
                trekData={trekData}
                isOpen={showRouteEditor}
                onClose={() => setShowRouteEditor(false)}
                onSave={() => {
                    setShowRouteEditor(false);
                    onJourneySaved();
                }}
                isMobile={isMobile}
            />
        </div>
    );
}

// Day details content
/**
 * Get weather emoji based on WMO weather code
 */
function getWeatherEmoji(code: number): string {
    if (code === 0) return '☀️'; // Clear sky
    if (code <= 3) return '⛅'; // Partly cloudy
    if (code <= 49) return '🌫️'; // Fog
    if (code <= 59) return '🌧️'; // Drizzle
    if (code <= 69) return '🌧️'; // Rain
    if (code <= 79) return '🌨️'; // Snow
    if (code <= 99) return '⛈️'; // Thunderstorm
    return '🌤️';
}

interface DayContentProps {
    camp: Camp | null;
    currentDayDate: Date | null;
    dayPhotos: Photo[];
    allPhotos: Photo[];
    getMediaUrl: (path: string) => string;
    onOpenDayGallery: () => void;
    editMode: boolean;
    isMobile: boolean;
    journeyId: string;
}

function DayContent({ camp, currentDayDate, dayPhotos, allPhotos, getMediaUrl, onOpenDayGallery, editMode, isMobile, journeyId }: DayContentProps) {
    const [showWaypointEdit, setShowWaypointEdit] = useState(false);
    const [showPhotoAssign, setShowPhotoAssign] = useState(false);
    if (!camp) {
        return (
            <div style={{ textAlign: 'center', color: colors.text.secondary, padding: 20 }}>
                <p style={{ fontSize: 14 }}>Select a day to see details</p>
                <p style={{ fontSize: 12, color: colors.text.tertiary, marginTop: 8 }}>
                    Use the navigation pill above to choose a day
                </p>
            </div>
        );
    }

    return (
        <>
            {/* Header */}
            <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    {currentDayDate && (
                        <span style={{ fontSize: 12, color: colors.text.tertiary }}>
                            {currentDayDate.toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric'
                            })}
                        </span>
                    )}
                    {camp.weather && (
                        <span
                            style={{
                                fontSize: 12,
                                color: colors.text.secondary,
                                background: 'rgba(255, 255, 255, 0.08)',
                                padding: '2px 8px',
                                borderRadius: 4,
                            }}
                            title={`${camp.weather.temperatureMin}°–${camp.weather.temperatureMax}°C`}
                        >
                            {getWeatherEmoji(camp.weather.weatherCode)} {Math.round(camp.weather.temperatureMax)}°C
                        </span>
                    )}
                    <span
                        style={{
                            fontSize: 12,
                            color: colors.text.secondary,
                            background: 'rgba(255, 255, 255, 0.08)',
                            padding: '2px 8px',
                            borderRadius: 4,
                        }}
                    >
                        {camp.elevation}m
                    </span>
                </div>
                <h3
                    style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: colors.text.primary,
                        margin: 0,
                    }}
                >
                    {camp.name}
                </h3>

                {/* Day Stats - distance, elevation gain/loss */}
                {(camp.dayDistance > 0 || camp.elevationGainFromPrevious > 0 || camp.elevationLossFromPrevious > 0) && (
                    <div
                        style={{
                            display: 'flex',
                            gap: 16,
                            marginTop: 12,
                            padding: '10px 12px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            borderRadius: radius.md,
                            border: `1px solid ${colors.glass.borderSubtle}`,
                        }}
                    >
                        {camp.dayDistance > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={colors.accent.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <polyline points="12 6 12 12 16 14"/>
                                </svg>
                                <span style={{ fontSize: 13, color: colors.text.secondary }}>
                                    <span style={{ fontWeight: 600, color: colors.text.primary }}>{camp.dayDistance}</span> km
                                </span>
                            </div>
                        )}
                        {camp.elevationGainFromPrevious > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5">
                                    <path d="M12 19V5M5 12l7-7 7 7"/>
                                </svg>
                                <span style={{ fontSize: 13, color: colors.text.secondary }}>
                                    <span style={{ fontWeight: 600, color: '#22c55e' }}>{camp.elevationGainFromPrevious}</span>m
                                </span>
                            </div>
                        )}
                        {camp.elevationLossFromPrevious > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                                    <path d="M12 5v14M5 12l7 7 7-7"/>
                                </svg>
                                <span style={{ fontSize: 13, color: colors.text.secondary }}>
                                    <span style={{ fontWeight: 600, color: '#ef4444' }}>{camp.elevationLossFromPrevious}</span>m
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Notes */}
            {camp.notes && (
                <p
                    style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        color: colors.text.secondary,
                        margin: '0 0 16px 0',
                    }}
                >
                    {camp.notes}
                </p>
            )}

            {/* Photo strip */}
            {dayPhotos.length > 0 && (
                <motion.div
                    whileTap={{ scale: 0.99 }}
                    onClick={onOpenDayGallery}
                    style={{
                        display: 'flex',
                        gap: 8,
                        overflowX: 'auto',
                        cursor: 'pointer',
                        padding: 8,
                        margin: '0 -8px 16px -8px',
                        borderRadius: radius.md,
                        background: 'rgba(255, 255, 255, 0.03)',
                    }}
                >
                    {dayPhotos.slice(0, 5).map((photo, idx) => (
                        <div
                            key={photo.id}
                            style={{
                                flexShrink: 0,
                                width: 60,
                                height: 60,
                                borderRadius: radius.md,
                                overflow: 'hidden',
                                border: `1px solid ${colors.glass.borderSubtle}`,
                            }}
                        >
                            <img
                                src={getMediaUrl(photo.thumbnail_url || photo.url)}
                                alt={photo.caption || `Photo ${idx + 1}`}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    transform: photo.rotation ? `rotate(${photo.rotation}deg)` : undefined,
                                }}
                            />
                        </div>
                    ))}
                    {dayPhotos.length > 5 && (
                        <div
                            style={{
                                flexShrink: 0,
                                width: 60,
                                height: 60,
                                borderRadius: radius.md,
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: `1px solid ${colors.glass.borderSubtle}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: colors.text.secondary,
                                fontSize: 13,
                                fontWeight: 500,
                            }}
                        >
                            +{dayPhotos.length - 5}
                        </div>
                    )}
                </motion.div>
            )}

            {/* Highlights */}
            {camp.highlights && camp.highlights.length > 0 && (
                <ul style={{ margin: '0 0 16px 0', paddingLeft: 16 }}>
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
                <div style={{ marginBottom: 16 }}>
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

            {/* Comments Section */}
            <div style={{ marginTop: 16, marginBottom: 16 }}>
                <DayCommentsSection
                    camp={camp}
                    journeyId={journeyId}
                />
            </div>

            {/* View gallery button */}
            {dayPhotos.length > 0 && (
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onOpenDayGallery}
                    style={{
                        width: '100%',
                        padding: '12px 16px',
                        background: 'rgba(96, 165, 250, 0.15)',
                        border: 'none',
                        borderRadius: radius.md,
                        cursor: 'pointer',
                        color: colors.accent.primary,
                        fontSize: 13,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                    }}
                >
                    <PhotoIcon size={16} />
                    View Day {camp.dayNumber} Photos ({dayPhotos.length})
                </motion.button>
            )}

            {/* Edit buttons - only shown in edit mode */}
            {editMode && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowWaypointEdit(true)}
                        style={{
                            flex: 1,
                            padding: '10px 12px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: radius.md,
                            cursor: 'pointer',
                            color: colors.text.secondary,
                            fontSize: 12,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                        }}
                    >
                        <PencilIcon size={14} />
                        Edit Day
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowPhotoAssign(true)}
                        style={{
                            flex: 1,
                            padding: '10px 12px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: radius.md,
                            cursor: 'pointer',
                            color: colors.text.secondary,
                            fontSize: 12,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                        }}
                    >
                        <PhotoIcon size={14} />
                        Assign Photos
                    </motion.button>
                </div>
            )}

            {/* Edit Modals */}
            <WaypointEditModal
                isOpen={showWaypointEdit}
                onClose={() => setShowWaypointEdit(false)}
                onSave={() => setShowWaypointEdit(false)}
                camp={camp}
                isMobile={isMobile}
                photos={allPhotos}
                getMediaUrl={getMediaUrl}
            />
            <PhotoAssignModal
                isOpen={showPhotoAssign}
                onClose={() => setShowPhotoAssign(false)}
                onAssign={() => setShowPhotoAssign(false)}
                camp={camp}
                photos={allPhotos}
                isMobile={isMobile}
                getMediaUrl={getMediaUrl}
            />
        </>
    );
}
