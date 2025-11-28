import { memo, useCallback, useState, useMemo } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, TabType, Photo } from '../../types/trek';
import { useDragGesture } from '../../hooks/useDragGesture';
import { TabButton } from '../common/TabButton';
import { GlassButton } from '../common/GlassButton';
import { OverviewTab } from './OverviewTab';
import { JourneyTab } from './JourneyTab';
import { StatsTab } from './StatsTab';
import { PhotosTab } from './PhotosTab';
import { JourneyEditModal } from './JourneyEditModal';
import { colors, radius, transitions, typography } from '../../styles/liquidGlass';

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
    onViewPhotoOnMap?: (photo: Photo) => void;
}

// Snap points as vh percentages (from smallest to largest panel height)
// minimized: ~10vh, normal: 42vh, expanded: 88vh
const SNAP_POINTS_VH = [10, 42, 88];
const PANEL_STATES: PanelState[] = ['minimized', 'normal', 'expanded'];

export const InfoPanel = memo(function InfoPanel({
    trekData, activeTab, setActiveTab, selectedCamp, onCampSelect, onBack,
    extendedStats, elevationProfile, isMobile, panelState, onPanelStateChange,
    photos = [], getMediaUrl = (path) => path, onJourneyUpdate, onViewPhotoOnMap
}: InfoPanelProps) {
    const padding = isMobile ? 16 : 24;
    const [showEditModal, setShowEditModal] = useState(false);
    const [editMode, setEditMode] = useState(false);

    // Convert panel state to snap index
    const currentSnapIndex = useMemo(() =>
        PANEL_STATES.indexOf(panelState),
        [panelState]
    );

    // Handle snap changes from drag gesture
    const handleSnapChange = useCallback((index: number) => {
        onPanelStateChange(PANEL_STATES[index]);
    }, [onPanelStateChange]);

    // iOS-like drag gesture with velocity detection
    const [dragState, dragHandlers] = useDragGesture({
        snapPoints: SNAP_POINTS_VH,
        currentSnapIndex,
        onSnapChange: handleSnapChange,
        velocityThreshold: 0.4,  // Slightly lower for more responsive feel
        distanceThreshold: 40,   // 40px threshold for slow drags
    });

    // Panel height based on state - using dvh for better mobile support
    // During drag, compute actual pixel height for reliable real-time updates
    const getPanelHeight = (): string | number => {
        const baseHeights: Record<PanelState, string> = {
            minimized: '100px',
            normal: '42dvh',
            expanded: '88dvh'
        };

        if (!dragState.isDragging) {
            return baseHeights[panelState];
        }

        // During drag: compute pixel height for reliable updates
        // Using window.innerHeight for dvh equivalent
        const vh = typeof window !== 'undefined' ? window.innerHeight / 100 : 8;
        const baseHeightPx: Record<PanelState, number> = {
            minimized: 100,
            normal: 42 * vh,
            expanded: 88 * vh
        };

        // Dragging down (positive offset) = shorter panel
        // Dragging up (negative offset) = taller panel
        const newHeight = baseHeightPx[panelState] - dragState.dragOffset;

        // Clamp to reasonable bounds
        const minH = 80;
        const maxH = vh * 100 - 60; // 100dvh - 60px
        return Math.max(minH, Math.min(maxH, newHeight));
    };

    const maxHeight = 'calc(100dvh - 60px)';

    // Mobile bottom sheet style - Liquid Glass design
    const mobileStyle: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: getPanelHeight(),
        maxHeight: dragState.isDragging ? undefined : maxHeight, // Remove max during drag (already clamped)
        // Liquid Glass gradient background
        background: `linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 10%,
            rgba(12, 12, 18, 0.95) 40%
        )`,
        // Reduced blur for mobile performance (16px vs 32px on desktop)
        backdropFilter: 'blur(16px) saturate(150%)',
        WebkitBackdropFilter: 'blur(16px) saturate(150%)',
        willChange: 'height',
        borderTop: `1px solid ${colors.glass.border}`,
        borderRadius: `${radius.xxl}px ${radius.xxl}px 0 0`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        // iOS-like spring animation on release
        transition: dragState.isDragging
            ? 'none'  // No transition during drag for instant follow
            : `height 0.4s cubic-bezier(0.32, 0.72, 0, 1)`,
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: `
            0 -16px 48px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.15),
            inset 0 2px 20px rgba(255, 255, 255, 0.05)
        `,
    };

    // Desktop side panel style - Liquid Glass design
    const desktopStyle: React.CSSProperties = {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '38%',
        minWidth: 360,
        maxWidth: 480,
        // Liquid Glass gradient background
        background: `linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.1) 0%,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(10, 10, 15, 0.85) 100%
        )`,
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        borderLeft: `1px solid ${colors.glass.border}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        boxShadow: `
            -8px 0 40px rgba(0, 0, 0, 0.3),
            inset 1px 0 0 rgba(255, 255, 255, 0.1)
        `,
    };

    const handleDragHandleClick = useCallback(() => {
        // Cycle through states on tap
        if (panelState === 'minimized') onPanelStateChange('normal');
        else if (panelState === 'normal') onPanelStateChange('expanded');
        else onPanelStateChange('normal');
    }, [panelState, onPanelStateChange]);

    return (
        <div style={isMobile ? mobileStyle : desktopStyle} className="glass-scrollbar">
            {/* Mobile drag handle with iOS-like gesture support */}
            {isMobile && (
                <div
                    onClick={handleDragHandleClick}
                    onTouchStart={dragHandlers.onTouchStart}
                    onTouchMove={dragHandlers.onTouchMove}
                    onTouchEnd={dragHandlers.onTouchEnd}
                    style={{
                        padding: '14px 0 10px',
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: dragState.isDragging ? 'grabbing' : 'grab',
                        touchAction: 'none'
                    }}
                >
                    <div style={{
                        width: dragState.isDragging ? 52 : (panelState === 'expanded' ? 48 : 40),
                        height: 5,
                        background: dragState.isDragging
                            ? `linear-gradient(
                                90deg,
                                rgba(255, 255, 255, 0.3) 0%,
                                rgba(255, 255, 255, 0.6) 50%,
                                rgba(255, 255, 255, 0.3) 100%
                            )`
                            : `linear-gradient(
                                90deg,
                                rgba(255, 255, 255, 0.2) 0%,
                                rgba(255, 255, 255, 0.4) 50%,
                                rgba(255, 255, 255, 0.2) 100%
                            )`,
                        borderRadius: radius.pill,
                        transition: dragState.isDragging ? 'none' : `all ${transitions.smooth}`,
                        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                    }} />
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: isMobile ? `8px ${padding}px 16px` : `${padding}px`,
                borderBottom: panelState !== 'minimized' ? `1px solid ${colors.glass.borderSubtle}` : 'none',
                display: 'flex',
                flexDirection: isMobile ? 'row' : 'column',
                alignItems: isMobile ? 'center' : 'stretch',
                justifyContent: isMobile ? 'space-between' : 'flex-start',
                flexShrink: 0
            }}>
                {!isMobile && (
                    <GlassButton
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        style={{
                            alignSelf: 'flex-start',
                            marginBottom: 20,
                            ...typography.label,
                        }}
                    >
                        ← Globe
                    </GlassButton>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isMobile ? 4 : 8 }}>
                        <p style={{
                            ...typography.label,
                            fontSize: 10,
                            letterSpacing: '0.2em',
                            color: colors.text.subtle,
                            margin: 0
                        }}>
                            {trekData.country}
                        </p>
                        {!isMobile && (
                            <GlassButton
                                variant={editMode ? 'primary' : 'subtle'}
                                size="sm"
                                onClick={() => setEditMode(!editMode)}
                                icon={<PencilIcon />}
                                style={{ marginLeft: 'auto' }}
                            >
                                {editMode ? 'Editing' : ''}
                            </GlassButton>
                        )}
                    </div>
                    <h1 style={{
                        ...typography.display,
                        fontSize: isMobile ? 20 : 26,
                        fontWeight: 500,
                        margin: 0,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: colors.text.primary,
                    }}>
                        {trekData.name}
                    </h1>
                    {/* Edit Journey button - only in edit mode, desktop */}
                    {editMode && !isMobile && (
                        <GlassButton
                            variant="primary"
                            size="sm"
                            onClick={() => setShowEditModal(true)}
                            style={{ marginTop: 12 }}
                        >
                            Edit Journey Details
                        </GlassButton>
                    )}
                </div>
                {isMobile && (
                    <div style={{ display: 'flex', gap: 8, marginLeft: 12, flexShrink: 0 }}>
                        <GlassButton
                            variant={editMode ? 'primary' : 'subtle'}
                            size="sm"
                            onClick={() => setEditMode(!editMode)}
                            icon={<PencilIcon />}
                            style={{ minWidth: 44, padding: '10px' }}
                        />
                        <GlassButton
                            variant="subtle"
                            size="sm"
                            onClick={onBack}
                            style={{ minWidth: 44, padding: '10px' }}
                        >
                            ✕
                        </GlassButton>
                    </div>
                )}
            </div>

            {/* Edit Journey button for mobile - only in edit mode */}
            {editMode && isMobile && panelState !== 'minimized' && (
                <div style={{ padding: `0 ${padding}px 12px` }}>
                    <GlassButton
                        variant="primary"
                        size="md"
                        fullWidth
                        onClick={() => setShowEditModal(true)}
                    >
                        Edit Journey Details
                    </GlassButton>
                </div>
            )}

            {/* Tabs - hidden when minimized - Liquid Glass pill container */}
            {panelState !== 'minimized' && (
                <div style={{
                    display: 'flex',
                    gap: 6,
                    padding: `8px ${padding}px 12px`,
                    background: `linear-gradient(
                        180deg,
                        rgba(255, 255, 255, 0.04) 0%,
                        transparent 100%
                    )`,
                    borderBottom: `1px solid ${colors.glass.borderSubtle}`,
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
                }} className="glass-scrollbar">
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
                            onViewPhotoOnMap={onViewPhotoOnMap}
                        />
                    )}
                    {activeTab === 'stats' && (
                        <StatsTab
                            trekData={trekData}
                            extendedStats={extendedStats}
                            elevationProfile={elevationProfile}
                            isMobile={isMobile}
                            selectedCamp={selectedCamp}
                            onCampSelect={onCampSelect}
                        />
                    )}
                    {activeTab === 'photos' && (
                        <PhotosTab
                            trekData={trekData}
                            isMobile={isMobile}
                            editMode={editMode}
                            onViewPhotoOnMap={onViewPhotoOnMap}
                        />
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
