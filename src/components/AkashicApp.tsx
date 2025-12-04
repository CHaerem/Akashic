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
import { GlobeSelectionPanel } from './home/GlobeSelectionPanel';
import { GlobeHint } from './home/GlobeHint';
import { ShareTargetModal } from './ShareTargetModal';
import { PhotoLightbox } from './common/PhotoLightbox';
import { AdaptiveNavPill } from './nav/AdaptiveNavPill';
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
        setActiveTab,
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
        handleCampSelect
    } = useTrekData();

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

    // Handle day selection from AdaptiveNavPill
    const handleDaySelect = useCallback((dayNumber: number) => {
        if (trekData) {
            const camp = trekData.camps.find((c: Camp) => c.dayNumber === dayNumber);
            if (camp) {
                handleCampSelect(camp);
            }
        }
    }, [trekData, handleCampSelect]);

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

            {/* Globe View UI */}
            {selectedTrek && view === 'globe' && (
                <GlobeSelectionPanel
                    selectedTrek={selectedTrek}
                    onBack={handleBackToSelection}
                    onExplore={handleExplore}
                    isMobile={isMobile}
                />
            )}

            {!selectedTrek && view === 'globe' && <GlobeHint isMobile={isMobile} />}

            {/* Adaptive Nav Pill - floating glass navigation (mobile-first, works on desktop too) */}
            {view === 'trek' && trekData && (
                <AdaptiveNavPill
                    selectedCamp={selectedCamp}
                    totalDays={trekData.stats.duration}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onDaySelect={handleDaySelect}
                    trekData={trekData}
                    extendedStats={extendedStats}
                    photos={deferredPhotos}
                    getMediaUrl={getMediaUrl}
                    onViewPhotoOnMap={handleViewOnMap}
                    isMobile={isMobile}
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
