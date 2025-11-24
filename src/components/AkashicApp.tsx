import { memo, useCallback, useMemo, useState } from 'react';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { useIsMobile } from '../hooks/useMediaQuery';
import { MapboxGlobe } from './MapboxGlobe';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, TabType } from '../types/trek';

// --- UI Components ---

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isMobile: boolean;
}

function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isMobile }: GlobeSelectionPanelProps) {
    return (
        <div style={{
            position: 'absolute',
            left: isMobile ? 0 : 24,
            right: isMobile ? 0 : 'auto',
            bottom: 0,
            zIndex: 20,
            maxWidth: isMobile ? '100%' : 400,
            padding: isMobile ? '24px 20px 32px' : 0,
            paddingBottom: isMobile ? 'max(32px, env(safe-area-inset-bottom))' : 48,
            background: isMobile ? 'linear-gradient(to top, rgba(10,10,15,0.95) 0%, rgba(10,10,15,0.8) 70%, transparent 100%)' : 'transparent'
        }}>
            <button
                onClick={onBack}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: isMobile ? 12 : 11,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    marginBottom: isMobile ? 16 : 24,
                    padding: isMobile ? '12px 0' : 0,
                    minHeight: isMobile ? 44 : 'auto'
                }}
            >
                ← Back
            </button>
            <p style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: isMobile ? 11 : 10,
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                marginBottom: isMobile ? 8 : 12
            }}>
                {selectedTrek.country}
            </p>
            <h2 style={{
                color: 'white',
                fontSize: isMobile ? 28 : 36,
                fontWeight: 300,
                marginBottom: 8
            }}>
                {selectedTrek.name}
            </h2>
            <p style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: isMobile ? 13 : 14,
                marginBottom: isMobile ? 20 : 32
            }}>
                Summit: {selectedTrek.elevation}
            </p>
            <button
                onClick={onExplore}
                style={{
                    background: isMobile ? 'rgba(255,255,255,0.1)' : 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: isMobile ? 12 : 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    padding: isMobile ? '16px 24px' : 0,
                    borderRadius: isMobile ? 8 : 0,
                    width: isMobile ? '100%' : 'auto',
                    minHeight: isMobile ? 48 : 'auto'
                }}
            >
                Explore Journey →
            </button>
        </div>
    );
}

interface GlobeHintProps {
    isMobile: boolean;
}

function GlobeHint({ isMobile }: GlobeHintProps) {
    return (
        <div style={{
            position: 'absolute',
            bottom: isMobile ? 'max(24px, env(safe-area-inset-bottom))' : 24,
            left: isMobile ? '50%' : 'auto',
            right: isMobile ? 'auto' : 24,
            transform: isMobile ? 'translateX(-50%)' : 'none',
            color: 'rgba(255,255,255,0.3)',
            fontSize: isMobile ? 11 : 10,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            textAlign: 'center'
        }}>
            {isMobile ? 'Tap a marker to explore' : 'Click a marker to explore'}
        </div>
    );
}

interface TabButtonProps {
    tab: string;
    activeTab: TabType;
    onClick: (tab: TabType) => void;
    isMobile?: boolean;
}

const TabButton = memo(function TabButton({ tab, activeTab, onClick, isMobile = false }: TabButtonProps) {
    const handleClick = useCallback(() => onClick(tab as TabType), [onClick, tab]);
    const isActive = activeTab === tab;

    return (
        <button
            onClick={handleClick}
            style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                color: isActive ? 'white' : 'rgba(255,255,255,0.4)',
                fontSize: isMobile ? 12 : 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                padding: isMobile ? '16px 12px' : '16px 16px',
                cursor: 'pointer',
                marginBottom: -1,
                flex: isMobile ? 1 : 'none',
                minHeight: 48
            }}
        >
            {tab}
        </button>
    );
});

interface StatCardProps {
    label: string;
    value: string;
    color?: string;
}

const StatCard = memo(function StatCard({ label, value, color = 'rgba(255,255,255,0.8)' }: StatCardProps) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                {label}
            </p>
            <p style={{ color }}>{value}</p>
        </div>
    );
});

interface OverviewTabProps {
    trekData: TrekData;
}

const OverviewTab = memo(function OverviewTab({ trekData }: OverviewTabProps) {
    return (
        <div>
            <p style={{ color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginBottom: 24 }}>
                {trekData.description}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <StatCard label="Duration" value={`${trekData.stats.duration} days`} />
                <StatCard label="Distance" value={`${trekData.stats.totalDistance} km`} />
                <StatCard label="Ascent" value={`+${trekData.stats.totalElevationGain}m`} color="#4ade80" />
                <StatCard label="Summit" value={`${trekData.stats.highestPoint.elevation}m`} />
            </div>
        </div>
    );
});

interface CampItemProps {
    camp: Camp;
    isSelected: boolean;
    onClick: (camp: Camp) => void;
    isLast: boolean;
    isMobile?: boolean;
}

const CampItem = memo(function CampItem({ camp, isSelected, onClick, isLast, isMobile = false }: CampItemProps) {
    const handleClick = useCallback(() => onClick(camp), [onClick, camp]);
    const padding = isMobile ? 16 : 24;

    const containerStyle = useMemo(() => ({
        padding: '20px 0',
        borderBottom: !isLast ? '1px solid rgba(255,255,255,0.05)' : 'none',
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
        margin: `0 -${padding}px`,
        paddingLeft: padding,
        paddingRight: padding,
        minHeight: 44
    }), [isLast, isSelected, padding]);

    return (
        <div onClick={handleClick} style={containerStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: isSelected ? '#3b82f6' : 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Day {camp.dayNumber}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                    {camp.elevation}m
                </span>
            </div>
            <p style={{ color: isSelected ? 'white' : 'rgba(255,255,255,0.7)', fontSize: 16, marginBottom: isSelected ? 12 : 0 }}>
                {camp.name}
            </p>

            {isSelected && (
                <div style={{ animation: 'fadeIn 0.3s ease' }}>
                    <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
                        {camp.notes}
                    </p>
                    {camp.highlights && (
                        <ul style={{ marginBottom: 20, paddingLeft: 16 }}>
                            {camp.highlights.map((highlight, idx) => (
                                <li key={idx} style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 4 }}>
                                    {highlight}
                                </li>
                            ))}
                        </ul>
                    )}
                    <div style={{
                        width: '100%',
                        height: isMobile ? 120 : 160,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px dashed rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'rgba(255,255,255,0.3)',
                        fontSize: 12,
                        letterSpacing: '0.05em'
                    }}>
                        PHOTOS COMING SOON
                    </div>
                </div>
            )}
        </div>
    );
});

interface JourneyTabProps {
    trekData: TrekData;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    isMobile?: boolean;
}

const JourneyTab = memo(function JourneyTab({ trekData, selectedCamp, onCampSelect, isMobile = false }: JourneyTabProps) {
    return (
        <div>
            {trekData.camps.map((camp, i) => (
                <CampItem
                    key={camp.id}
                    camp={camp}
                    isSelected={selectedCamp?.id === camp.id}
                    onClick={onCampSelect}
                    isLast={i === trekData.camps.length - 1}
                    isMobile={isMobile}
                />
            ))}
        </div>
    );
});

interface ElevationProfileProps {
    elevationProfile: ElevationProfile | null;
}

const ElevationProfileChart = memo(function ElevationProfileChart({ elevationProfile }: ElevationProfileProps) {
    if (!elevationProfile) return null;

    return (
        <div style={{ position: 'relative', height: 120, width: '100%' }}>
            <svg width="100%" height="100%" viewBox="0 0 300 120" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255, 255, 255, 0.2)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                    </linearGradient>
                </defs>
                <line x1="0" y1="0" x2="300" y2="0" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <line x1="0" y1="120" x2="300" y2="120" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                <path d={elevationProfile.areaPath} fill="url(#elevationGradient)" />
                <path d={elevationProfile.linePath} fill="none" stroke="white" strokeWidth="1.5" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                <span>0 km</span>
                <span>{Math.round(elevationProfile.totalDist)} km</span>
            </div>
            <div style={{ position: 'absolute', top: 0, right: -24, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                {Math.round(elevationProfile.maxEle)}m
            </div>
            <div style={{ position: 'absolute', bottom: 0, right: -24, color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>
                {Math.round(elevationProfile.minEle)}m
            </div>
        </div>
    );
});

interface StatsTabProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
}

const StatsTab = memo(function StatsTab({ trekData, extendedStats, elevationProfile }: StatsTabProps) {
    return (
        <div>
            <div style={{
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: 20,
                marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)'
            }}>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Summit</p>
                <p style={{ color: 'white', fontSize: 28, fontWeight: 300 }}>{trekData.stats.highestPoint.elevation}m</p>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>{trekData.stats.highestPoint.name}</p>
            </div>

            <div style={{ marginBottom: 32 }}>
                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                    Elevation Profile
                </p>
                <ElevationProfileChart elevationProfile={elevationProfile} />
            </div>

            {extendedStats && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <StatCard label="Avg Daily Dist" value={`${extendedStats.avgDailyDistance} km`} />
                    <StatCard label="Max Daily Gain" value={`+${extendedStats.maxDailyGain}m`} color="#4ade80" />
                    <StatCard label="Start Elevation" value={`${extendedStats.startElevation}m`} />
                    <StatCard label="Difficulty" value={extendedStats.difficulty} color="#facc15" />
                </div>
            )}
        </div>
    );
});

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
    isExpanded: boolean;
    onToggleExpand: () => void;
}

const InfoPanel = memo(function InfoPanel({
    trekData, activeTab, setActiveTab, selectedCamp, onCampSelect, onBack,
    extendedStats, elevationProfile, isMobile, isExpanded, onToggleExpand
}: InfoPanelProps) {
    const padding = isMobile ? 16 : 24;

    // Mobile bottom sheet style
    const mobileStyle: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: isExpanded ? '85%' : '45%',
        background: 'rgba(10, 10, 15, 0.95)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '20px 20px 0 0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        transition: 'height 0.3s ease',
        paddingBottom: 'env(safe-area-inset-bottom)'
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
        borderLeft: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20
    };

    return (
        <div style={isMobile ? mobileStyle : desktopStyle}>
            {/* Mobile drag handle */}
            {isMobile && (
                <div
                    onClick={onToggleExpand}
                    style={{
                        padding: '12px 0 8px',
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{
                        width: 40,
                        height: 4,
                        background: 'rgba(255,255,255,0.3)',
                        borderRadius: 2
                    }} />
                </div>
            )}

            {/* Header */}
            <div style={{
                padding: isMobile ? `8px ${padding}px 16px` : `${padding}px`,
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex',
                flexDirection: isMobile ? 'row' : 'column',
                alignItems: isMobile ? 'center' : 'stretch',
                justifyContent: isMobile ? 'space-between' : 'flex-start'
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
                <div style={{ flex: 1 }}>
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
                        fontSize: isMobile ? 20 : 24,
                        fontWeight: 300,
                        margin: 0
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
                            minHeight: 44
                        }}
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                padding: `0 ${padding}px`
            }}>
                {(['overview', 'journey', 'stats'] as const).map(tab => (
                    <TabButton
                        key={tab}
                        tab={tab}
                        activeTab={activeTab}
                        onClick={setActiveTab}
                        isMobile={isMobile}
                    />
                ))}
            </div>

            {/* Tab Content */}
            <div style={{
                flex: 1,
                overflow: 'auto',
                padding: padding,
                WebkitOverflowScrolling: 'touch'
            }}>
                {activeTab === 'overview' && <OverviewTab trekData={trekData} />}
                {activeTab === 'journey' && (
                    <JourneyTab
                        trekData={trekData}
                        selectedCamp={selectedCamp}
                        onCampSelect={onCampSelect}
                        isMobile={isMobile}
                    />
                )}
                {activeTab === 'stats' && (
                    <StatsTab trekData={trekData} extendedStats={extendedStats} elevationProfile={elevationProfile} />
                )}
            </div>
        </div>
    );
});

// --- Main Component ---

export default function AkashicApp() {
    const isMobile = useIsMobile();
    const [isPanelExpanded, setIsPanelExpanded] = useState(false);

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

    const togglePanelExpand = useCallback(() => {
        setIsPanelExpanded(prev => !prev);
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
                    isExpanded={isPanelExpanded}
                    onToggleExpand={togglePanelExpand}
                />
            )}
        </div>
    );
}
