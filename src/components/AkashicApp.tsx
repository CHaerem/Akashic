import { useCallback, useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useMedia } from '../hooks/useMedia';
import { useJourneys } from '../contexts/JourneysContext';
import { fetchPhotos, getJourneyIdBySlug } from '../lib/journeys';
import { hasPendingShares } from '../lib/shareTarget';
import type { Photo, Camp } from '../types/trek';
import { MapboxGlobe } from './MapboxGlobe';
import { OfflineIndicator } from './OfflineIndicator';
import { GlobeHint } from './home/GlobeHint';
import { ShareTargetModal } from './ShareTargetModal';
import { PhotoLightbox } from './common/PhotoLightbox';
import { DayGallery } from './common/DayGallery';
import { BottomSheet, SNAP_POINTS } from './layout/BottomSheet';
import { BottomSheetContent } from './layout/BottomSheetContent';
import { QuickActionBar, QuickActionIcons } from './layout/QuickActionBar';
import { NavigationPill } from './nav/NavigationPill';
import { colors, radius, transitions, typography } from '../styles/liquidGlass';

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [photos, setPhotos] = useState<Photo[]>([]);
    // Defer photo updates to prevent re-renders during camera animations
    const deferredPhotos = useDeferredValue(photos);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [showShareTarget, setShowShareTarget] = useState(false);
    const flyToPhotoRef = useRef<((photo: Photo) => void) | null>(null);
    const { getMediaUrl } = useMedia();
    const { refetch: refetchJourneys } = useJourneys();
    const stagingBranch = import.meta.env.VITE_STAGING_BRANCH;
    const deployTimeRaw = import.meta.env.VITE_DEPLOY_TIME;

    const formattedDeployTime = useMemo(() => {
        if (!deployTimeRaw) return null;

        const parsed = new Date(deployTimeRaw);
        if (Number.isNaN(parsed.getTime())) return null;

        return `${parsed.toLocaleString('en-US', {
            timeZone: 'UTC',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })} UTC`;
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
        setActiveTab,
        setSheetSnapPoint,
        setActiveMode,
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
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

    // Handle "View on Map" from lightbox - close lightbox and fly to photo
    const handleViewOnMap = useCallback((photo: Photo) => {
        setLightboxIndex(null); // Close lightbox
        if (flyToPhotoRef.current && photo.coordinates) {
            flyToPhotoRef.current(photo);
        }
    }, []);

    // Handle day selection from NavigationPill
    const handleDaySelect = useCallback((dayNumber: number) => {
        if (trekData) {
            const camp = trekData.camps.find((c: Camp) => c.dayNumber === dayNumber);
            if (camp) {
                handleCampSelect(camp);
            }
        }
    }, [trekData, handleCampSelect]);

    // Handle mode change - auto-expand sheet if minimized
    const handleModeChange = useCallback((mode: typeof activeMode) => {
        setActiveMode(mode);
        if (sheetSnapPoint === 'minimized') {
            setSheetSnapPoint('half');
        }
    }, [sheetSnapPoint, setActiveMode, setSheetSnapPoint]);

    // Handle start from overview - select day 1
    const handleStart = useCallback(() => {
        if (trekData && trekData.camps.length > 0) {
            const firstCamp = trekData.camps.find((c: Camp) => c.dayNumber === 1) || trekData.camps[0];
            handleCampSelect(firstCamp);
        }
    }, [trekData, handleCampSelect]);

    // Calculate bottom offset for pill based on sheet snap point
    const sheetHeight = useMemo(() => {
        const vh = typeof window !== 'undefined' ? window.innerHeight / 100 : 8;
        return SNAP_POINTS[sheetSnapPoint] * vh;
    }, [sheetSnapPoint]);

    // Show bottom sheet when trek is selected (globe view) or in trek view
    const showSheet = (view === 'globe' && selectedTrek !== null) || view === 'trek';

    // Filter photos with coordinates for map display
    // Use deferred photos to prevent map re-renders during camera animations
    const photosWithCoords = deferredPhotos.filter(p => p.coordinates && p.coordinates.length === 2);

    // Quick action buttons configuration
    const quickActions = useMemo(() => [
        {
            id: 'back-to-globe',
            icon: QuickActionIcons.globe,
            label: 'Back to globe',
            onClick: handleBackToGlobe,
            visible: view === 'trek',
        },
        {
            id: 'recenter',
            icon: QuickActionIcons.recenter,
            label: 'Recenter map',
            onClick: () => {
                // TODO: Implement recenter functionality
            },
            visible: true,
        },
    ], [view, handleBackToGlobe]);

    return (
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
                    onCampSelect={handleCampSelect}
                    getMediaUrl={getMediaUrl}
                />
            </div>

            {/* Offline Status */}
            <OfflineIndicator isMobile={isMobile} />

            {/* Brand Title - Top Left */}
            <div
                onClick={handleBackToGlobe}
                style={{
                    position: 'absolute',
                    top: isMobile ? 'max(16px, env(safe-area-inset-top))' : 24,
                    left: isMobile ? 16 : 24,
                    zIndex: 100,
                    cursor: 'pointer',
                    padding: isMobile ? '10px 16px' : '8px 14px',
                    minHeight: isMobile ? 44 : 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    transition: `all ${transitions.smooth}`,
                    // Liquid Glass styling when sheet is visible
                    ...(showSheet ? {
                        background: `linear-gradient(
                            135deg,
                            rgba(255, 255, 255, 0.08) 0%,
                            rgba(255, 255, 255, 0.04) 100%
                        )`,
                        backdropFilter: 'blur(12px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(12px) saturate(150%)',
                        border: `1px solid ${colors.glass.borderSubtle}`,
                        borderRadius: radius.lg,
                        boxShadow: `
                            0 4px 16px rgba(0, 0, 0, 0.15),
                            inset 0 1px 0 rgba(255, 255, 255, 0.1)
                        `,
                    } : {
                        background: 'transparent',
                        border: '1px solid transparent',
                        borderRadius: radius.lg,
                    }),
                }}
            >
                <span style={{
                    ...typography.brand,
                    fontSize: isMobile ? 12 : 13,
                    color: showSheet ? colors.text.secondary : colors.text.primary,
                    transition: `color ${transitions.smooth}`,
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

            {/* Quick Action Bar - Top Right */}
            <QuickActionBar actions={quickActions} isMobile={isMobile} />

            {/* Globe Hint - shown when no trek selected */}
            {!selectedTrek && view === 'globe' && <GlobeHint isMobile={isMobile} />}

            {/* Navigation Pill - positioned above bottom sheet */}
            {view === 'trek' && trekData && (
                <NavigationPill
                    selectedCamp={selectedCamp}
                    totalDays={trekData.stats.duration}
                    trekName={trekData.name}
                    activeMode={activeMode}
                    onModeChange={handleModeChange}
                    onDaySelect={handleDaySelect}
                    onStart={handleStart}
                    bottomOffset={sheetHeight}
                    isMobile={isMobile}
                />
            )}

            {/* Bottom Sheet - Find My inspired draggable sheet */}
            {showSheet && (
                <BottomSheet
                    snapPoint={sheetSnapPoint}
                    onSnapChange={setSheetSnapPoint}
                    onDismiss={view === 'globe' ? handleBackToSelection : undefined}
                    isOpen={showSheet}
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
                        isMobile={isMobile}
                    />
                </BottomSheet>
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
            <PhotoLightbox
                photos={photosWithCoords}
                initialIndex={lightboxIndex ?? 0}
                isOpen={lightboxIndex !== null}
                onClose={() => setLightboxIndex(null)}
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
    );
}
