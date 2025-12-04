import { memo, useCallback, useState, useMemo, useRef } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, TabType, Photo } from '../../types/trek';
import { useDragGesture } from '../../hooks/useDragGesture';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { OverviewTab } from './OverviewTab';
import { JourneyTab } from './JourneyTab';
import { StatsTab } from './StatsTab';
import { PhotosTab } from './PhotosTab';
import { JourneyEditModal } from './JourneyEditModal';
import { cn } from '@/lib/utils';

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
    const [showEditModal, setShowEditModal] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // Convert panel state to snap index
    const currentSnapIndex = useMemo(() =>
        PANEL_STATES.indexOf(panelState),
        [panelState]
    );

    // Handle snap changes from drag gesture
    const handleSnapChange = useCallback((index: number) => {
        onPanelStateChange(PANEL_STATES[index]);
    }, [onPanelStateChange]);

    // iOS-like drag gesture with direct DOM manipulation for instant feedback
    const [dragState, dragHandlers] = useDragGesture({
        snapPoints: SNAP_POINTS_VH,
        currentSnapIndex,
        onSnapChange: handleSnapChange,
        panelRef,
        onDismiss: onBack,
        velocityThreshold: 0.4,
        distanceThreshold: 40,
        dismissThreshold: 80,
    });

    // Panel height based on state
    const getPanelHeight = (): string => {
        const baseHeights: Record<PanelState, string> = {
            minimized: '100px',
            normal: '42dvh',
            expanded: '88dvh'
        };
        return baseHeights[panelState];
    };

    const handleDragHandleClick = useCallback(() => {
        if (panelState === 'minimized') onPanelStateChange('normal');
        else if (panelState === 'normal') onPanelStateChange('expanded');
        else onPanelStateChange('normal');
    }, [panelState, onPanelStateChange]);

    const handleTabChange = useCallback((value: string) => {
        setActiveTab(value as TabType);
    }, [setActiveTab]);

    return (
        <div
            ref={isMobile ? panelRef : null}
            className={cn(
                "flex flex-col z-20",
                // Glass morphism
                "backdrop-blur-2xl saturate-[180%]",
                isMobile ? [
                    // Mobile bottom sheet
                    "absolute inset-x-0 bottom-0",
                    "rounded-t-2xl",
                    "border-t border-white/15 light:border-black/10",
                    "pb-[env(safe-area-inset-bottom)]",
                    "transition-[height] duration-400 ease-[cubic-bezier(0.32,0.72,0,1)]",
                    "will-change-[height]",
                ] : [
                    // Desktop side panel
                    "absolute top-0 right-0 bottom-0",
                    "w-[38%] min-w-[360px] max-w-[480px]",
                    "border-l border-white/15 light:border-black/10",
                ]
            )}
            style={{
                // Gradient backgrounds for dark liquid glass
                background: isMobile
                    ? `linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.06) 10%, rgba(12,12,18,0.95) 40%)`
                    : `linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 30%, rgba(10,10,15,0.85) 100%)`,
                height: isMobile ? getPanelHeight() : undefined,
                maxHeight: isMobile ? 'calc(100dvh - 60px)' : undefined,
                boxShadow: isMobile
                    ? '0 -16px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)'
                    : '-8px 0 40px rgba(0,0,0,0.3), inset 1px 0 0 rgba(255,255,255,0.1)',
            }}
        >
            {/* Mobile drag handle */}
            {isMobile && (
                <div
                    onClick={handleDragHandleClick}
                    onTouchStart={dragHandlers.onTouchStart}
                    onTouchMove={dragHandlers.onTouchMove}
                    onTouchEnd={dragHandlers.onTouchEnd}
                    className={cn(
                        // Larger touch target (48px min height)
                        "py-4 min-h-[48px] flex justify-center items-center touch-none",
                        dragState.isDragging ? "cursor-grabbing" : "cursor-grab"
                    )}
                >
                    <div className={cn(
                        "h-1.5 rounded-full transition-all duration-200",
                        // Higher contrast handle
                        "bg-gradient-to-r from-white/25 via-white/45 to-white/25",
                        "light:from-black/20 light:via-black/35 light:to-black/20",
                        // Wider handle when dragging
                        dragState.isDragging ? "w-16" : (panelState === 'expanded' ? "w-14" : "w-10")
                    )} />
                </div>
            )}

            {/* Header */}
            <div
                onTouchStart={isMobile ? dragHandlers.onTouchStart : undefined}
                onTouchMove={isMobile ? dragHandlers.onTouchMove : undefined}
                onTouchEnd={isMobile ? dragHandlers.onTouchEnd : undefined}
                className={cn(
                    "flex-shrink-0",
                    isMobile ? [
                        "px-4 pt-2 pb-4",
                        "flex flex-row items-center justify-between",
                        "touch-none",
                        dragState.isDragging ? "cursor-grabbing" : "cursor-grab"
                    ] : [
                        "p-6 flex flex-col",
                        panelState !== 'minimized' && "border-b border-white/10 light:border-black/5"
                    ]
                )}
            >
                {/* Desktop back button */}
                {!isMobile && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onBack}
                        className="self-start mb-5 text-xs tracking-wider"
                    >
                        ← Globe
                    </Button>
                )}

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-white/35 light:text-slate-400 m-0">
                            {trekData.country}
                        </p>
                        {/* Desktop edit toggle */}
                        {!isMobile && (
                            <Button
                                variant={editMode ? 'primary' : 'subtle'}
                                size="sm"
                                onClick={() => setEditMode(!editMode)}
                                className="ml-auto"
                            >
                                <PencilIcon />
                                {editMode && <span className="ml-1">Editing</span>}
                            </Button>
                        )}
                    </div>
                    <h1 className={cn(
                        "font-medium m-0 truncate text-white/95 light:text-slate-900",
                        isMobile ? "text-xl" : "text-2xl"
                    )}>
                        {trekData.name}
                    </h1>
                    {/* Desktop edit button */}
                    {editMode && !isMobile && (
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setShowEditModal(true)}
                            className="mt-3"
                        >
                            Edit Journey Details
                        </Button>
                    )}
                </div>

                {/* Mobile buttons */}
                {isMobile && (
                    <div className="flex gap-2 ml-3 flex-shrink-0">
                        <Button
                            variant={editMode ? 'primary' : 'subtle'}
                            size="icon"
                            onClick={() => setEditMode(!editMode)}
                        >
                            <PencilIcon />
                        </Button>
                        <Button
                            variant="subtle"
                            size="icon"
                            onClick={onBack}
                        >
                            ✕
                        </Button>
                    </div>
                )}
            </div>

            {/* Mobile edit journey button */}
            {editMode && isMobile && panelState !== 'minimized' && (
                <div className="px-4 pb-3">
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => setShowEditModal(true)}
                        className="w-full"
                    >
                        Edit Journey Details
                    </Button>
                </div>
            )}

            {/* Tabs - hidden when minimized */}
            {panelState !== 'minimized' && (
                <div className={cn(
                    "flex-shrink-0 border-b border-white/10 light:border-black/5",
                    isMobile ? "px-4 py-2" : "px-6 py-2"
                )}>
                    <Tabs value={activeTab} onValueChange={handleTabChange}>
                        <TabsList className="w-full justify-start">
                            <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
                            <TabsTrigger value="journey" className="flex-1">Journey</TabsTrigger>
                            <TabsTrigger value="stats" className="flex-1">Stats</TabsTrigger>
                            <TabsTrigger value="photos" className="flex-1">Photos</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
            )}

            {/* Tab Content */}
            {panelState !== 'minimized' && (
                <div className={cn(
                    "flex-1 overflow-auto glass-scrollbar",
                    "overscroll-contain",
                    isMobile ? "p-4" : "p-6"
                )}
                    style={{ WebkitOverflowScrolling: 'touch' }}
                >
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
