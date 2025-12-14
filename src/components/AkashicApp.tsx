import { useCallback, useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useMedia } from '../hooks/useMedia';
import { useJourneys } from '../contexts/JourneysContext';
import { fetchPhotos, getJourneyIdBySlug } from '../lib/journeys';
import { hasPendingShares } from '../lib/shareTarget';
import type { Photo, Camp, TrekData } from '../types/trek';
import type mapboxgl from 'mapbox-gl';
import type { PlaybackState } from '../hooks/mapbox/types';
import { MapboxGlobe } from './MapboxGlobe';
import { OfflineIndicator } from './OfflineIndicator';
import { GlobeHint } from './home/GlobeHint';
import { ShareTargetModal } from './ShareTargetModal';
import { PhotoLightbox } from './common/PhotoLightbox';
import { DayGallery } from './common/DayGallery';
import { BottomSheet } from './layout/BottomSheet';
import { Sidebar } from './layout/Sidebar';
import { BottomSheetContent } from './layout/BottomSheetContent';
import { QuickActionBar, QuickActionIcons } from './layout/QuickActionBar';
import { colors, typography } from '../styles/liquidGlass';
import { ErrorBoundary } from './common/ErrorBoundary';

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [mapViewportBounds, setMapViewportBounds] = useState<mapboxgl.LngLatBoundsLike | null>(null);
    const [mapViewportPhotoIds, setMapViewportPhotoIds] = useState<string[] | null>(null);
    // Defer photo updates to prevent re-renders during camera animations
    const deferredPhotos = useDeferredValue(photos);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [showShareTarget, setShowShareTarget] = useState(false);
    const flyToPhotoRef = useRef<((photo: Photo) => void) | null>(null);
    const recenterRef = useRef<(() => void) | null>(null);
    const playbackRef = useRef<{
        start: (trekData: TrekData, onCampReached?: (camp: Camp) => void) => void;
        stop: () => void;
    } | null>(null);
    const [playbackState, setPlaybackState] = useState<PlaybackState>({
        isPlaying: false,
        progress: 0,
        currentCampIndex: 0
    });
    const { getMediaUrl } = useMedia();
    const { treks, refetch: refetchJourneys } = useJourneys();
    const stagingBranch = import.meta.env.VITE_STAGING_BRANCH;
    const deployTimeRaw = import.meta.env.VITE_DEPLOY_TIME;

    const formattedDeployTime = useMemo(() => {
        if (!deployTimeRaw) return null;

        const parsed = new Date(deployTimeRaw);
        if (Number.isNaN(parsed.getTime())) return null;

        // Display in user's local timezone
        return parsed.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }, [deployTimeRaw]);

    const {
        view,
        selectedTrek,
        selectedCamp,
        activeTab,
        trekData,
        extendedStats,
        elevationProfile,
        // Sheet state (Find My redesign)
        sheetSnapPoint,
        activeMode,
        // Edit mode
        editMode,
        toggleEditMode,
        setActiveTab,
        setSheetSnapPoint,
        setActiveMode,
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
        handleBackToOverview,
        handleCampSelect
    } = useTrekData();

    // Day gallery state
    const [showDayGallery, setShowDayGallery] = useState(false);

    // Check for pending shared photos (from PWA share target)
    useEffect(() => {
        async function checkSharedFiles() {
            // Check URL for share target redirect
            const params = new URLSearchParams(window.location.search);
            if (params.get('shared') === 'pending') {
                // Clear the URL parameter
                window.history.replaceState({}, '', window.location.pathname);
            }

            // Check IndexedDB for pending files
            const hasPending = await hasPendingShares();
            if (hasPending) {
                setShowShareTarget(true);
            }
        }

        checkSharedFiles();
    }, []);

    // Fetch photos when in trek view
    // Native Mapbox layers handle photos efficiently - no delays needed
    useEffect(() => {
        if (!selectedTrek || view !== 'trek') {
            setPhotos([]);
            return;
        }

        let cancelled = false;

        async function loadPhotos() {
            const journeyId = await getJourneyIdBySlug(selectedTrek!.id);
            if (journeyId && !cancelled) {
                const journeyPhotos = await fetchPhotos(journeyId);
                if (!cancelled) {
                    setPhotos(journeyPhotos);
                }
            }
        }

        loadPhotos();

        return () => { cancelled = true; };
    }, [selectedTrek, view]);

    // Handle photo click from map markers - open lightbox
    const handleMapPhotoClick = useCallback((_photo: Photo, index: number) => {
        setLightboxIndex(index);
    }, []);

    // Close lightbox - stable callback to prevent re-renders
    const handleCloseLightbox = useCallback(() => {
        setLightboxIndex(null);
    }, []);

    // Handle "View on Map" from lightbox - close lightbox and fly to photo
    const handleViewOnMap = useCallback((photo: Photo) => {
        setLightboxIndex(null); // Close lightbox
        if (flyToPhotoRef.current && photo.coordinates) {
            flyToPhotoRef.current(photo);
        }
    }, []);

    // Handle day selection from BottomSheet navigation
    const handleDaySelect = useCallback((dayNumber: number) => {
        if (trekData) {
            const camp = trekData.camps.find((c: Camp) => c.dayNumber === dayNumber);
            if (camp) {
                handleCampSelect(camp);
            }
        }
    }, [trekData, handleCampSelect]);

    // Handle start from overview - select day 1
    const handleStart = useCallback(() => {
        if (trekData && trekData.camps.length > 0) {
            const firstCamp = trekData.camps.find((c: Camp) => c.dayNumber === 1) || trekData.camps[0];
            handleCampSelect(firstCamp);
        }
    }, [trekData, handleCampSelect]);

    // Journey navigation (globe view)
    const currentJourneyIndex = useMemo(() => {
        if (!selectedTrek || treks.length === 0) return 0;
        return treks.findIndex(t => t.id === selectedTrek.id);
    }, [selectedTrek, treks]);

    const handlePrevJourney = useCallback(() => {
        if (treks.length === 0) return;
        // Loop to last journey when at first
        const prevIndex = currentJourneyIndex > 0 ? currentJourneyIndex - 1 : treks.length - 1;
        selectTrek(treks[prevIndex]);
    }, [currentJourneyIndex, treks, selectTrek]);

    const handleNextJourney = useCallback(() => {
        if (treks.length === 0) return;
        // Loop to first journey when at last
        const nextIndex = currentJourneyIndex < treks.length - 1 ? currentJourneyIndex + 1 : 0;
        selectTrek(treks[nextIndex]);
    }, [currentJourneyIndex, treks, selectTrek]);

    // Toggle playback - start or stop the journey animation
    const togglePlayback = useCallback(() => {
        if (playbackState.isPlaying) {
            playbackRef.current?.stop();
        } else if (trekData) {
            playbackRef.current?.start(trekData, (camp) => {
                // Update selected camp as playback progresses
                handleCampSelect(camp);
            });
        }
    }, [playbackState.isPlaying, trekData, handleCampSelect]);

    // Show bottom sheet when trek is selected (globe view) or in trek view
    const showSheet = (view === 'globe' && selectedTrek !== null) || view === 'trek';

    // Filter photos with coordinates for map display
    // Use deferred photos to prevent map re-renders during camera animations
    // Memoized to prevent new array reference on every render (fixes React error #185)
    const photosWithCoords = useMemo(
        () => deferredPhotos.filter(p => p.coordinates && p.coordinates.length === 2),
        [deferredPhotos]
    );

    // Quick action buttons configuration
    const quickActions = useMemo(() => [
        {
            id: 'back-to-globe',
            icon: QuickActionIcons.globe,
            label: 'Back to globe',
            onClick: handleBackToGlobe,
            visible: true,
        },
        {
            id: 'recenter',
            icon: QuickActionIcons.recenter,
            label: 'Recenter map',
            onClick: () => {
                recenterRef.current?.();
            },
            visible: true,
        },
        {
            id: 'play-journey',
            icon: playbackState.isPlaying ? QuickActionIcons.pause : QuickActionIcons.play,
            label: playbackState.isPlaying ? 'Stop playback' : 'Play journey',
            onClick: togglePlayback,
            visible: view === 'trek' && trekData !== null,
            active: playbackState.isPlaying,
        },
    ], [handleBackToGlobe, playbackState.isPlaying, togglePlayback, view, trekData]);

    return (
        <ErrorBoundary>
        <div style={{ position: 'fixed', inset: 0, background: colors.background.base }}>
            {/* Mapbox Globe - Full screen hero */}
                    <div style={{ position: 'absolute', inset: 0 }}>
                        <MapboxGlobe
                            selectedTrek={selectedTrek}
                            selectedCamp={selectedCamp}
                            onSelectTrek={selectTrek}
                            view={view}
                            photos={photosWithCoords}
                            onPhotoClick={handleMapPhotoClick}
                            flyToPhotoRef={flyToPhotoRef}
                            recenterRef={recenterRef}
                            onCampSelect={handleCampSelect}
                            getMediaUrl={getMediaUrl}
                            onViewportChange={setMapViewportBounds}
                            onViewportVisiblePhotoIdsChange={setMapViewportPhotoIds}
                            playbackRef={playbackRef}
                            onPlaybackStateChange={setPlaybackState}
                        />
                    </div>

            {/* Offline Status */}
            <OfflineIndicator isMobile={isMobile} />

            {/* Brand Title - Top Left (only in zoomed-out globe view) */}
            {!selectedTrek && view === 'globe' && (
                <div
                    style={{
                        position: 'absolute',
                        top: isMobile ? 'max(16px, env(safe-area-inset-top))' : 24,
                        left: isMobile ? 16 : 24,
                        zIndex: 100,
                        padding: isMobile ? '10px 16px' : '8px 14px',
                    }}
                >
                    <span style={{
                        ...typography.brand,
                        fontSize: isMobile ? 12 : 13,
                        color: colors.text.primary,
                    }}>
                        Akashic
                        {stagingBranch && (
                            <span style={{
                                fontSize: isMobile ? 8 : 9,
                                letterSpacing: '0.1em',
                                opacity: 0.5,
                                marginLeft: 8,
                                fontWeight: 400,
                            }}>
                                [{stagingBranch}
                                {formattedDeployTime ? ` • ${formattedDeployTime}` : ''}]
                            </span>
                        )}
                    </span>
                </div>
            )}

            {/* Quick Action Bar - Top Right (hidden when sheet is expanded) */}
            <QuickActionBar
                actions={quickActions}
                isMobile={isMobile}
                hidden={sheetSnapPoint === 'expanded'}
            />

            {/* Globe Hint - shown when no trek selected */}
            {!selectedTrek && view === 'globe' && <GlobeHint isMobile={isMobile} />}

            {/* Content Panel - Bottom Sheet (mobile) or Sidebar (desktop) */}
            {showSheet && (
                isMobile ? (
                    // Mobile: Bottom Sheet with drag gestures
                    <BottomSheet
                        snapPoint={sheetSnapPoint}
                        onSnapChange={setSheetSnapPoint}
                        onDismiss={view === 'globe' ? handleBackToSelection : undefined}
                        isOpen={showSheet}
                        view={view}
                        selectedTrek={selectedTrek}
                        selectedCamp={selectedCamp}
                        totalDays={trekData?.stats.duration ?? 0}
                        activeMode={activeMode}
                        onModeChange={setActiveMode}
                        onDaySelect={handleDaySelect}
                        onStart={handleStart}
                        onExplore={handleExplore}
                        onBackToOverview={handleBackToOverview}
                        onPrevJourney={handlePrevJourney}
                        onNextJourney={handleNextJourney}
                        totalJourneys={treks.length}
                        editMode={editMode}
                        onToggleEditMode={toggleEditMode}
                        isMobile={isMobile}
                    >
                        <BottomSheetContent
                            view={view}
                            selectedTrek={selectedTrek}
                            selectedCamp={selectedCamp}
                            activeMode={activeMode}
                            trekData={trekData}
                            extendedStats={extendedStats}
                            elevationProfile={elevationProfile}
                            photos={deferredPhotos}
                            getMediaUrl={getMediaUrl}
                            onExplore={handleExplore}
                            onCampSelect={handleCampSelect}
                            onViewPhotoOnMap={handleViewOnMap}
                            onOpenDayGallery={() => setShowDayGallery(true)}
                            onJourneySaved={refetchJourneys}
                            editMode={editMode}
                            isMobile={isMobile}
                            mapViewportBounds={mapViewportBounds}
                            mapViewportPhotoIds={mapViewportPhotoIds}
                        />
                    </BottomSheet>
                ) : (
                    // Desktop: Left Sidebar (Find My macOS style)
                    <Sidebar
                        isOpen={showSheet}
                        view={view}
                        selectedTrek={selectedTrek}
                        selectedCamp={selectedCamp}
                        totalDays={trekData?.stats.duration ?? 0}
                        activeMode={activeMode}
                        onModeChange={setActiveMode}
                        onDaySelect={handleDaySelect}
                        onStart={handleStart}
                        onExplore={handleExplore}
                        onBackToOverview={handleBackToOverview}
                        onPrevJourney={handlePrevJourney}
                        onNextJourney={handleNextJourney}
                        totalJourneys={treks.length}
                        editMode={editMode}
                            onToggleEditMode={toggleEditMode}
                    >
                        <BottomSheetContent
                            view={view}
                            selectedTrek={selectedTrek}
                            selectedCamp={selectedCamp}
                            activeMode={activeMode}
                            trekData={trekData}
                            extendedStats={extendedStats}
                            elevationProfile={elevationProfile}
                            photos={deferredPhotos}
                            getMediaUrl={getMediaUrl}
                            onExplore={handleExplore}
                            onCampSelect={handleCampSelect}
                            onViewPhotoOnMap={handleViewOnMap}
                            onOpenDayGallery={() => setShowDayGallery(true)}
                            onJourneySaved={refetchJourneys}
                            editMode={editMode}
                            isMobile={false}
                            mapViewportBounds={mapViewportBounds}
                            mapViewportPhotoIds={mapViewportPhotoIds}
                        />
                    </Sidebar>
                )
            )}

            {/* Day Gallery - fullscreen photo exploration */}
            {trekData && (
                <DayGallery
                    isOpen={showDayGallery}
                    onClose={() => setShowDayGallery(false)}
                    trekData={trekData}
                    photos={deferredPhotos}
                    getMediaUrl={getMediaUrl}
                    initialDay={selectedCamp?.dayNumber ?? 1}
                    onDayChange={handleDaySelect}
                    onViewOnMap={handleViewOnMap}
                />
            )}

            {/* Photo Lightbox - triggered from map photo markers */}
            {/* Key forces remount when opening with different index - prevents stale state */}
            <PhotoLightbox
                key={lightboxIndex !== null ? `lightbox-${lightboxIndex}` : 'lightbox-closed'}
                photos={photosWithCoords}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={handleCloseLightbox}
                getMediaUrl={getMediaUrl}
                onViewOnMap={handleViewOnMap}
            />

            {/* Share Target Modal - for photos shared from other apps */}
            <ShareTargetModal
                isOpen={showShareTarget}
                onClose={() => setShowShareTarget(false)}
                onUploadComplete={refetchJourneys}
            />
        </div>
        </ErrorBoundary>
    );
}
