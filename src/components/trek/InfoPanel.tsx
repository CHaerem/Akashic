import { memo, useCallback, useState } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, TabType, Photo } from '../../types/trek';
import { useSwipeGesture } from '../../hooks/useSwipeGesture';
import { TabButton } from '../common/TabButton';
import { OverviewTab } from './OverviewTab';
import { JourneyTab } from './JourneyTab';
import { StatsTab } from './StatsTab';
import { PhotosTab } from './PhotosTab';
import { JourneyEditModal } from './JourneyEditModal';

export type PanelState = 'minimized' | 'normal' | 'expanded';

// Pencil icon SVG for edit mode toggle
const PencilIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        <path d="m15 5 4 4"/>
    </svg>
);

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
    onJourneyUpdate?: () => void;
}

export const InfoPanel = memo(function InfoPanel({
    trekData, activeTab, setActiveTab, selectedCamp, onCampSelect, onBack,
    extendedStats, elevationProfile, isMobile, panelState, onPanelStateChange,
    photos = [], getMediaUrl = (path) => path, onJourneyUpdate
}: InfoPanelProps) {
    const padding = isMobile ? 16 : 24;
    const [showEditModal, setShowEditModal] = useState(false);
    const [editMode, setEditMode] = useState(false);

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
    // Minimized is smaller to show more map, expanded is larger for immersive content
    const getPanelHeight = () => {
        switch (panelState) {
            case 'minimized': return '100px';
            case 'normal': return '42dvh';
            case 'expanded': return '88dvh';
        }
    };

    // Mobile bottom sheet style - calm design with subtle shadow
    const mobileStyle: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: getPanelHeight(),
        maxHeight: 'calc(100dvh - 60px)',
        background: 'rgba(8, 8, 12, 0.95)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '24px 24px 0 0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        transition: 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.4)'
    };

    // Desktop side panel style - slightly more transparent for better map visibility
    const desktopStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '38%',
        minWidth: 360,
        maxWidth: 480,
        background: 'rgba(8, 8, 12, 0.75)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderLeft: '1px solid rgba(255,255,255,0.04)',
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
            {/* Mobile drag handle with swipe support - subtle indicator */}
            {isMobile && (
                <div
                    onClick={handleDragHandleClick}
                    {...swipeHandlers}
                    style={{
                        padding: '14px 0 10px',
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: 'grab',
                        touchAction: 'none'
                    }}
                >
                    <div style={{
                        width: panelState === 'expanded' ? 48 : 36,
                        height: 4,
                        background: panelState === 'expanded'
                            ? 'rgba(255,255,255,0.25)'
                            : 'rgba(255,255,255,0.35)',
                        borderRadius: 2,
                        transition: 'all 0.3s ease'
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isMobile ? 4 : 8 }}>
                        <p style={{
                            color: 'rgba(255,255,255,0.4)',
                            fontSize: 10,
                            letterSpacing: '0.25em',
                            textTransform: 'uppercase',
                            margin: 0
                        }}>
                            {trekData.country}
                        </p>
                        {!isMobile && (
                            <button
                                onClick={() => setEditMode(!editMode)}
                                title={editMode ? 'Exit edit mode' : 'Enter edit mode'}
                                style={{
                                    background: editMode ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.1)',
                                    border: editMode ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                                    color: editMode ? '#3b82f6' : 'rgba(255,255,255,0.5)',
                                    cursor: 'pointer',
                                    padding: '6px 8px',
                                    borderRadius: 6,
                                    marginLeft: 'auto',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 11,
                                    transition: 'all 0.2s'
                                }}
                            >
                                <PencilIcon />
                                {editMode && <span>Editing</span>}
                            </button>
                        )}
                    </div>
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
                    {/* Edit Journey button - only in edit mode, desktop */}
                    {editMode && !isMobile && (
                        <button
                            onClick={() => setShowEditModal(true)}
                            style={{
                                background: 'rgba(59, 130, 246, 0.1)',
                                border: '1px solid rgba(59, 130, 246, 0.3)',
                                color: '#3b82f6',
                                fontSize: 12,
                                cursor: 'pointer',
                                padding: '6px 12px',
                                borderRadius: 6,
                                marginTop: 8,
                                transition: 'all 0.2s'
                            }}
                        >
                            Edit Journey Details
                        </button>
                    )}
                </div>
                {isMobile && (
                    <div style={{ display: 'flex', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                        <button
                            onClick={() => setEditMode(!editMode)}
                            title={editMode ? 'Exit edit mode' : 'Enter edit mode'}
                            style={{
                                background: editMode ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255,255,255,0.1)',
                                border: editMode ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid transparent',
                                color: editMode ? '#3b82f6' : 'rgba(255,255,255,0.7)',
                                cursor: 'pointer',
                                padding: '10px 14px',
                                borderRadius: 6,
                                minHeight: 44,
                                minWidth: 44,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                        >
                            <PencilIcon />
                        </button>
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
                                minHeight: 44
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>

            {/* Edit Journey button for mobile - only in edit mode */}
            {editMode && isMobile && panelState !== 'minimized' && (
                <div style={{ padding: `0 ${padding}px 12px` }}>
                    <button
                        onClick={() => setShowEditModal(true)}
                        style={{
                            width: '100%',
                            background: 'rgba(59, 130, 246, 0.1)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: '#3b82f6',
                            fontSize: 13,
                            cursor: 'pointer',
                            padding: '10px 16px',
                            borderRadius: 8,
                            transition: 'all 0.2s'
                        }}
                    >
                        Edit Journey Details
                    </button>
                </div>
            )}

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
                            onUpdate={onJourneyUpdate}
                            editMode={editMode}
                        />
                    )}
                    {activeTab === 'stats' && (
                        <StatsTab trekData={trekData} extendedStats={extendedStats} elevationProfile={elevationProfile} isMobile={isMobile} />
                    )}
                    {activeTab === 'photos' && (
                        <PhotosTab trekData={trekData} isMobile={isMobile} editMode={editMode} />
                    )}
                </div>
            )}

            {/* Edit Modal */}
            <JourneyEditModal
                slug={trekData.id}
                isOpen={showEditModal}
                onClose={() => setShowEditModal(false)}
                onSave={() => {
                    if (onJourneyUpdate) onJourneyUpdate();
                }}
                isMobile={isMobile}
            />
        </div>
    );
});
