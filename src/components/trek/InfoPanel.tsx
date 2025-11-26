import { memo, useCallback } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, TabType, Photo } from '../../types/trek';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { TabButton } from '../common/TabButton';
import { OverviewTab } from './OverviewTab';
import { JourneyTab } from './JourneyTab';
import { StatsTab } from './StatsTab';
import { PhotosTab } from './PhotosTab';

export type PanelState = 'minimized' | 'normal' | 'expanded';

interface InfoPanelProps {
    trekData: TrekData;
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    onBack: () => void;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    isMobile: boolean;
    panelState: PanelState;
    onPanelStateChange: (state: PanelState) => void;
    photos?: Photo[];
    getMediaUrl?: (path: string) => string;
}

export const InfoPanel = memo(function InfoPanel({
    trekData, activeTab, setActiveTab, selectedCamp, onCampSelect, onBack,
    extendedStats, elevationProfile, isMobile, panelState, onPanelStateChange,
    photos = [], getMediaUrl = (path) => path
}: InfoPanelProps) {
    const padding = isMobile ? 16 : 24;

    // Swipe gestures for mobile bottom sheet
    const handleSwipeUp = useCallback(() => {
        if (panelState === 'minimized') onPanelStateChange('normal');
        else if (panelState === 'normal') onPanelStateChange('expanded');
    }, [panelState, onPanelStateChange]);

    const handleSwipeDown = useCallback(() => {
        if (panelState === 'expanded') onPanelStateChange('normal');
        else if (panelState === 'normal') onPanelStateChange('minimized');
    }, [panelState, onPanelStateChange]);

    const swipeHandlers = useSwipeGesture({
        onSwipeUp: handleSwipeUp,
        onSwipeDown: handleSwipeDown,
        threshold: 30
    });

    // Panel height based on state - using dvh for better mobile support
    const getPanelHeight = () => {
        switch (panelState) {
            case 'minimized': return '120px';
            case 'normal': return '45dvh';
            case 'expanded': return '85dvh';
        }
    };

    // Mobile bottom sheet style
    const mobileStyle: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: getPanelHeight(),
        maxHeight: 'calc(100dvh - 60px)',
        background: 'rgba(10, 10, 15, 0.98)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '20px 20px 0 0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        transition: 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -4px 30px rgba(0,0,0,0.5)'
    };

    // Desktop side panel style
    const desktopStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '40%',
        minWidth: 380,
        background: 'rgba(10, 10, 15, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20
    };

    const handleDragHandleClick = useCallback(() => {
        // Cycle through states on tap
        if (panelState === 'minimized') onPanelStateChange('normal');
        else if (panelState === 'normal') onPanelStateChange('expanded');
        else onPanelStateChange('normal');
    }, [panelState, onPanelStateChange]);

    return (
        <div style={isMobile ? mobileStyle : desktopStyle}>
            {/* Mobile drag handle with swipe support */}
            {isMobile && (
                <div
                    onClick={handleDragHandleClick}
                    {...swipeHandlers}
                    style={{
                        padding: '12px 0 8px',
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: 'grab',
                        touchAction: 'none'
                    }}
                >
                    <div style={{
                        width: 40,
                        height: 4,
                        background: 'rgba(255,255,255,0.4)',
                        borderRadius: 2,
                        transition: 'width 0.2s ease'
                    }} />
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: isMobile ? `8px ${padding}px 16px` : `${padding}px`,
                borderBottom: panelState !== 'minimized' ? '1px solid rgba(255,255,255,0.05)' : 'none',
                display: 'flex',
                flexDirection: isMobile ? 'row' : 'column',
                alignItems: isMobile ? 'center' : 'stretch',
                justifyContent: isMobile ? 'space-between' : 'flex-start',
                flexShrink: 0
            }}>
                {!isMobile && (
                    <button
                        onClick={onBack}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: 11,
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            marginBottom: 24,
                            display: 'block',
                            padding: '8px 0',
                            minHeight: 44
                        }}
                    >
                        ← Globe
                    </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                        color: 'rgba(255,255,255,0.4)',
                        fontSize: 10,
                        letterSpacing: '0.25em',
                        textTransform: 'uppercase',
                        marginBottom: isMobile ? 4 : 8
                    }}>
                        {trekData.country}
                    </p>
                    <h1 style={{
                        color: 'white',
                        fontSize: isMobile ? 18 : 24,
                        fontWeight: 300,
                        margin: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        {trekData.name}
                    </h1>
                </div>
                {isMobile && (
                    <button
                        onClick={onBack}
                        style={{
                            background: 'rgba(255,255,255,0.1)',
                            border: 'none',
                            color: 'rgba(255,255,255,0.7)',
                            fontSize: 11,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                            padding: '10px 16px',
                            borderRadius: 6,
                            minHeight: 44,
                            marginLeft: 12,
                            flexShrink: 0
                        }}
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Tabs - hidden when minimized */}
            {panelState !== 'minimized' && (
                <div style={{
                    display: 'flex',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    padding: `0 ${padding}px`,
                    flexShrink: 0
                }}>
                    {(['overview', 'journey', 'stats', 'photos'] as const).map(tab => (
                        <TabButton
                            key={tab}
                            tab={tab}
                            activeTab={activeTab}
                            onClick={setActiveTab}
                            isMobile={isMobile}
                        />
                    ))}
                </div>
            )}

            {/* Tab Content - hidden when minimized */}
            {panelState !== 'minimized' && (
                <div style={{
                    flex: 1,
                    overflow: 'auto',
                    padding: padding,
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain'
                }}>
                    {activeTab === 'overview' && <OverviewTab trekData={trekData} />}
                    {activeTab === 'journey' && (
                        <JourneyTab
                            trekData={trekData}
                            selectedCamp={selectedCamp}
                            onCampSelect={onCampSelect}
                            isMobile={isMobile}
                            photos={photos}
                            getMediaUrl={getMediaUrl}
                        />
                    )}
                    {activeTab === 'stats' && (
                        <StatsTab trekData={trekData} extendedStats={extendedStats} elevationProfile={elevationProfile} isMobile={isMobile} />
                    )}
                    {activeTab === 'photos' && (
                        <PhotosTab trekData={trekData} isMobile={isMobile} />
                    )}
                </div>
            )}
        </div>
    );
});
