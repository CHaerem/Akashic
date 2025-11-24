import 'mapbox-gl/dist/mapbox-gl.css';
import { useTrekData } from '../hooks/useTrekData';
import { MapboxGlobe } from './MapboxGlobe';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, TabType } from '../types/trek';

// --- UI Components ---

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
}

function GlobeSelectionPanel({ selectedTrek, onBack, onExplore }: GlobeSelectionPanelProps) {
    return (
        <div style={{
            position: 'absolute',
            left: 24,
            bottom: 48,
            zIndex: 20,
            maxWidth: 400
        }}>
            <button
                onClick={onBack}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: 11,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    marginBottom: 24
                }}
            >
                ← Back
            </button>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 12 }}>
                {selectedTrek.country}
            </p>
            <h2 style={{ color: 'white', fontSize: 36, fontWeight: 300, marginBottom: 8 }}>
                {selectedTrek.name}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, marginBottom: 32 }}>
                Summit: {selectedTrek.elevation}
            </p>
            <button
                onClick={onExplore}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.5)',
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    cursor: 'pointer'
                }}
            >
                Explore Journey →
            </button>
        </div>
    );
}

function GlobeHint() {
    return (
        <div style={{
            position: 'absolute',
            bottom: 24,
            right: 24,
            color: 'rgba(255,255,255,0.2)',
            fontSize: 10,
            letterSpacing: '0.15em',
            textTransform: 'uppercase'
        }}>
            Click a marker to explore
        </div>
    );
}

interface TabButtonProps {
    tab: string;
    activeTab: TabType;
    onClick: (tab: TabType) => void;
}

function TabButton({ tab, activeTab, onClick }: TabButtonProps) {
    return (
        <button
            onClick={() => onClick(tab as TabType)}
            style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                color: activeTab === tab ? 'white' : 'rgba(255,255,255,0.4)',
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                padding: '16px 16px',
                cursor: 'pointer',
                marginBottom: -1
            }}
        >
            {tab}
        </button>
    );
}

interface StatCardProps {
    label: string;
    value: string;
    color?: string;
}

function StatCard({ label, value, color = 'rgba(255,255,255,0.8)' }: StatCardProps) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                {label}
            </p>
            <p style={{ color }}>{value}</p>
        </div>
    );
}

interface OverviewTabProps {
    trekData: TrekData;
}

function OverviewTab({ trekData }: OverviewTabProps) {
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
}

interface CampItemProps {
    camp: Camp;
    isSelected: boolean;
    onClick: (camp: Camp) => void;
    isLast: boolean;
}

function CampItem({ camp, isSelected, onClick, isLast }: CampItemProps) {
    return (
        <div
            onClick={() => onClick(camp)}
            style={{
                padding: '20px 0',
                borderBottom: !isLast ? '1px solid rgba(255,255,255,0.05)' : 'none',
                cursor: 'pointer',
                transition: 'background 0.2s',
                background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
                margin: '0 -24px',
                paddingLeft: 24,
                paddingRight: 24
            }}
        >
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
                        height: 160,
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
}

interface JourneyTabProps {
    trekData: TrekData;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
}

function JourneyTab({ trekData, selectedCamp, onCampSelect }: JourneyTabProps) {
    return (
        <div>
            {trekData.camps.map((camp, i) => (
                <CampItem
                    key={camp.id}
                    camp={camp}
                    isSelected={selectedCamp?.id === camp.id}
                    onClick={onCampSelect}
                    isLast={i === trekData.camps.length - 1}
                />
            ))}
        </div>
    );
}

interface ElevationProfileProps {
    elevationProfile: ElevationProfile | null;
}

function ElevationProfileChart({ elevationProfile }: ElevationProfileProps) {
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
}

interface StatsTabProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
}

function StatsTab({ trekData, extendedStats, elevationProfile }: StatsTabProps) {
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
}

interface InfoPanelProps {
    trekData: TrekData;
    activeTab: TabType;
    setActiveTab: (tab: TabType) => void;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    onBack: () => void;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
}

function InfoPanel({ trekData, activeTab, setActiveTab, selectedCamp, onCampSelect, onBack, extendedStats, elevationProfile }: InfoPanelProps) {
    return (
        <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '40%',
            background: 'rgba(10, 10, 15, 0.8)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(255,255,255,0.05)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 20
        }}>
            {/* Header */}
            <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
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
                        display: 'block'
                    }}
                >
                    ← Globe
                </button>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.25em', textTransform: 'uppercase', marginBottom: 8 }}>
                    {trekData.country}
                </p>
                <h1 style={{ color: 'white', fontSize: 24, fontWeight: 300 }}>
                    {trekData.name}
                </h1>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '0 24px' }}>
                {(['overview', 'journey', 'stats'] as const).map(tab => (
                    <TabButton key={tab} tab={tab} activeTab={activeTab} onClick={setActiveTab} />
                ))}
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                {activeTab === 'overview' && <OverviewTab trekData={trekData} />}
                {activeTab === 'journey' && (
                    <JourneyTab trekData={trekData} selectedCamp={selectedCamp} onCampSelect={onCampSelect} />
                )}
                {activeTab === 'stats' && (
                    <StatsTab trekData={trekData} extendedStats={extendedStats} elevationProfile={elevationProfile} />
                )}
            </div>
        </div>
    );
}

// --- Main Component ---

export default function AkashicApp() {
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
                top: 24,
                left: 24,
                zIndex: 100,
                color: 'rgba(255,255,255,0.7)',
                fontSize: 14,
                letterSpacing: '0.3em',
                textTransform: 'uppercase',
                cursor: 'pointer'
            }} onClick={handleBackToGlobe}>
                Akashic
            </div>

            {/* Globe View UI */}
            {selectedTrek && view === 'globe' && (
                <GlobeSelectionPanel
                    selectedTrek={selectedTrek}
                    onBack={handleBackToSelection}
                    onExplore={handleExplore}
                />
            )}

            {!selectedTrek && view === 'globe' && <GlobeHint />}

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
                />
            )}
        </div>
    );
}
