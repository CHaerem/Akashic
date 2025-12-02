import { useCallback, useState, useEffect, useRef, lazy, Suspense, useDeferredValue } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useMedia } from '../hooks/useMedia';
import { useJourneys } from '../contexts/JourneysContext';
import { fetchPhotos, getJourneyIdBySlug } from '../lib/journeys';
import type { Photo } from '../types/trek';
import { preloadPhotoImagesAsync } from '../utils/photoPrefetch';
import { MapboxGlobe } from './MapboxGlobe';
import { OfflineIndicator } from './OfflineIndicator';
import { GlobeSelectionPanel } from './home/GlobeSelectionPanel';
import { GlobeHint } from './home/GlobeHint';
import type { PanelState } from './trek/InfoPanel';
import { PhotoLightbox } from './common/PhotoLightbox';
import { MobileExperience } from './mobile/MobileExperience';
import { colors, radius, transitions, typography } from '../styles/liquidGlass';

// Lazy load InfoPanel to prevent blocking Mapbox animations during transition
const InfoPanel = lazy(() => import('./trek/InfoPanel').then(m => ({ default: m.InfoPanel })));

// Preload function for InfoPanel - call when trek is selected to avoid chunk load during animation
const preloadInfoPanel = () => {
    import('./trek/InfoPanel');
};

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [panelState, setPanelState] = useState<PanelState>('normal');
    const [photos, setPhotos] = useState<Photo[]>([]);
    const photoCacheRef = useRef<Record<string, Photo[]>>({});
    const imageCacheRef = useRef<Set<string>>(new Set());
    const thumbnailWarmPromisesRef = useRef<Record<string, Promise<Set<string>>>>({});
    const [isPreparingTrek, setIsPreparingTrek] = useState(false);
    // Defer photo updates to prevent re-renders during camera animations
    const deferredPhotos = useDeferredValue(photos);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const flyToPhotoRef = useRef<((photo: Photo) => void) | null>(null);
    const { getMediaUrl } = useMedia();
    const { refetch: refetchJourneys } = useJourneys();

    const {
        view,
        selectedTrek,
        selectedCamp,
        activeTab,
        trekData,
        extendedStats,
        elevationProfile,
        setActiveTab,
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
        handleCampSelect
    } = useTrekData();

    const warmPhotoThumbnails = useCallback((journeyPhotos: Photo[], trekId?: string) => {
        const warmPromise = preloadPhotoImagesAsync(journeyPhotos, getMediaUrl, {
            cache: imageCacheRef.current,
        });

        if (trekId) {
            thumbnailWarmPromisesRef.current[trekId] = warmPromise;
        }

        warmPromise.catch(() => {});
        return warmPromise;
    }, [getMediaUrl]);

    const awaitWarmthWithTimeout = useCallback(async (trekId: string, timeoutMs = 800) => {
        const warmPromise = thumbnailWarmPromisesRef.current[trekId];
        if (!warmPromise) return;

        await Promise.race([
            warmPromise,
            new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
        ]);
    }, []);

    const ensurePhotosReady = useCallback(async (trekId: string) => {
        const cachedPhotos = photoCacheRef.current[trekId];
        if (cachedPhotos) {
            warmPhotoThumbnails(cachedPhotos, trekId);
            await awaitWarmthWithTimeout(trekId);
            return cachedPhotos;
        }

        const journeyId = await getJourneyIdBySlug(trekId);
        if (!journeyId) return [];

        const journeyPhotos = await fetchPhotos(journeyId);
        photoCacheRef.current[trekId] = journeyPhotos;
        warmPhotoThumbnails(journeyPhotos, trekId);
        await awaitWarmthWithTimeout(trekId, 1200);
        return journeyPhotos;
    }, [awaitWarmthWithTimeout, warmPhotoThumbnails]);

    // Preload InfoPanel when a trek is selected (before explore is clicked)
    // This ensures the chunk is loaded before the camera animation starts
    useEffect(() => {
        if (selectedTrek) {
            preloadInfoPanel();
        }
    }, [selectedTrek]);

    // Prefetch photos in the background when a trek is selected to avoid UI jank during transition
    useEffect(() => {
        if (!selectedTrek) return;

        const trekId = selectedTrek.id;
        if (photoCacheRef.current[trekId]) return;

        let cancelled = false;

        (async () => {
            const journeyId = await getJourneyIdBySlug(trekId);
            if (!journeyId || cancelled) return;

            const journeyPhotos = await fetchPhotos(journeyId);
            if (cancelled) return;

            photoCacheRef.current[trekId] = journeyPhotos;
            warmPhotoThumbnails(journeyPhotos, trekId);

            // If user explored while we were prefetching, hydrate the UI immediately after thumbnails are ready
            if (view === 'trek' && selectedTrek?.id === trekId) {
                await awaitWarmthWithTimeout(trekId);
                if (!cancelled) {
                    setPhotos(journeyPhotos);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [awaitWarmthWithTimeout, selectedTrek, view, warmPhotoThumbnails]);

    // Fetch photos when in trek view, using cache first to keep transition smooth
    useEffect(() => {
        if (!selectedTrek || view !== 'trek') {
            setPhotos([]);
            return;
        }

        const trekId = selectedTrek.id;
        const cachedPhotos = photoCacheRef.current[trekId];
        let cancelled = false;

        async function loadPhotos() {
            const journeyPhotos = cachedPhotos ?? await ensurePhotosReady(trekId);
            if (cancelled) return;

            await awaitWarmthWithTimeout(trekId);
            if (!cancelled) {
                setPhotos(journeyPhotos);
            }
        }

        loadPhotos();

        return () => { cancelled = true; };
    }, [awaitWarmthWithTimeout, ensurePhotosReady, selectedTrek, view]);


    const handleExploreWithPrefetch = useCallback(async () => {
        if (!selectedTrek) return;

        const trekId = selectedTrek.id;
        setIsPreparingTrek(true);

        try {
            const journeyPhotos = await ensurePhotosReady(trekId);
            await awaitWarmthWithTimeout(trekId, 1200);
            setPhotos(journeyPhotos);
        } finally {
            setIsPreparingTrek(false);
        }

        handleExplore();
    }, [awaitWarmthWithTimeout, ensurePhotosReady, handleExplore, selectedTrek]);


    const handlePanelStateChange = useCallback((state: PanelState) => {
        setPanelState(state);
    }, []);

    // On mobile, entering trek view should start with more map focus
    const lastViewRef = useRef<typeof view>(view);
    useEffect(() => {
        if (isMobile && view === 'trek' && lastViewRef.current !== 'trek') {
            setPanelState('minimized');
        }
        lastViewRef.current = view;
    }, [isMobile, view]);

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

    // Filter photos with coordinates for map display
    // Use deferred photos to prevent map re-renders during camera animations
    const photosWithCoords = deferredPhotos.filter(p => p.coordinates && p.coordinates.length === 2);

    return (
        <div style={{ position: 'fixed', inset: 0, background: colors.background.base }}>
            {/* Mapbox Globe */}
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

            {/* Mobile-first experience layer */}
            {isMobile && view === 'trek' && trekData && panelState === 'minimized' && (
                <MobileExperience
                    trekData={trekData}
                    selectedCamp={selectedCamp}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    onCampSelect={handleCampSelect}
                    panelState={panelState}
                    onPanelStateChange={handlePanelStateChange}
                    photos={deferredPhotos}
                    getMediaUrl={getMediaUrl}
                    onBack={handleBackToGlobe}
                />
            )}

            {/* Title - Liquid Glass pill style when viewing trek */}
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
                    // Liquid Glass styling when in trek view
                    ...(view === 'trek' ? {
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
                    ...typography.label,
                    fontSize: isMobile ? 12 : 13,
                    letterSpacing: '0.25em',
                    color: view === 'trek' ? colors.text.secondary : colors.text.primary,
                    transition: `color ${transitions.smooth}`,
                }}>
                    Akashic
                    {import.meta.env.VITE_STAGING_BRANCH && (
                        <span style={{
                            fontSize: isMobile ? 8 : 9,
                            letterSpacing: '0.1em',
                            opacity: 0.5,
                            marginLeft: 8,
                            fontWeight: 400,
                        }}>
                            [{import.meta.env.VITE_STAGING_BRANCH}]
                        </span>
                    )}
                </span>
            </div>

            {/* Globe View UI */}
            {selectedTrek && view === 'globe' && (
                <GlobeSelectionPanel
                    selectedTrek={selectedTrek}
                    onBack={handleBackToSelection}
                    onExplore={handleExploreWithPrefetch}
                    isLoading={isPreparingTrek}
                    isMobile={isMobile}
                />
            )}

            {!selectedTrek && view === 'globe' && <GlobeHint isMobile={isMobile} />}

            {/* Trek View Info Panel - lazy loaded to not block Mapbox camera animation */}
            {view === 'trek' && trekData && (
                <Suspense fallback={null}>
                    <InfoPanel
                        trekData={trekData}
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        selectedCamp={selectedCamp}
                        onCampSelect={handleCampSelect}
                        onBack={handleBackToGlobe}
                        extendedStats={extendedStats}
                        elevationProfile={elevationProfile}
                        isMobile={isMobile}
                        panelState={panelState}
                        onPanelStateChange={handlePanelStateChange}
                        photos={deferredPhotos}
                        getMediaUrl={getMediaUrl}
                        onJourneyUpdate={refetchJourneys}
                        onViewPhotoOnMap={handleViewOnMap}
                    />
                </Suspense>
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
        </div>
    );
}
