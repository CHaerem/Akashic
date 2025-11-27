import { useCallback, useState, useEffect } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useMedia } from '../hooks/useMedia';
import { useJourneys } from '../contexts/JourneysContext';
import { fetchPhotos, getJourneyIdBySlug } from '../lib/journeys';
import type { Photo } from '../types/trek';
import { MapboxGlobe } from './MapboxGlobe';
import { OfflineIndicator } from './OfflineIndicator';
import { GlobeSelectionPanel } from './home/GlobeSelectionPanel';
import { GlobeHint } from './home/GlobeHint';
import { InfoPanel, type PanelState } from './trek/InfoPanel';
import { colors, radius, transitions, typography } from '../styles/liquidGlass';

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [panelState, setPanelState] = useState<PanelState>('normal');
    const [photos, setPhotos] = useState<Photo[]>([]);
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

    // Fetch photos when trek changes
    useEffect(() => {
        if (!selectedTrek) {
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
    }, [selectedTrek]);

    const handlePanelStateChange = useCallback((state: PanelState) => {
        setPanelState(state);
    }, []);

    return (
        <div style={{ position: 'fixed', inset: 0, background: colors.background.base }}>
            {/* Mapbox Globe */}
            <div style={{ position: 'absolute', inset: 0 }}>
                <MapboxGlobe
                    selectedTrek={selectedTrek}
                    selectedCamp={selectedCamp}
                    onSelectTrek={selectTrek}
                    view={view}
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

            {/* Trek View Info Panel */}
            {view === 'trek' && trekData && (
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
                    photos={photos}
                    getMediaUrl={getMediaUrl}
                    onJourneyUpdate={refetchJourneys}
                />
            )}
        </div>
    );
}
