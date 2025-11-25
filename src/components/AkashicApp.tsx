import { useCallback, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { MapboxGlobe } from './MapboxGlobe';
import { OfflineIndicator } from './OfflineIndicator';
import { GlobeSelectionPanel } from './home/GlobeSelectionPanel';
import { GlobeHint } from './home/GlobeHint';
import { InfoPanel, type PanelState } from './trek/InfoPanel';

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [panelState, setPanelState] = useState<PanelState>('normal');

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

    const handlePanelStateChange = useCallback((state: PanelState) => {
        setPanelState(state);
    }, []);

    return (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0a0f' }}>
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

            {/* Title */}
            <div style={{
                position: 'absolute',
                top: isMobile ? 'max(16px, env(safe-area-inset-top))' : 24,
                left: isMobile ? 16 : 24,
                zIndex: 100,
                color: 'rgba(255,255,255,0.7)',
                fontSize: isMobile ? 12 : 14,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                padding: isMobile ? '8px 0' : 0,
                minHeight: isMobile ? 44 : 'auto',
                display: 'flex',
                alignItems: 'center'
            }} onClick={handleBackToGlobe}>
                Akashic
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
                />
            )}
        </div>
    );
}
