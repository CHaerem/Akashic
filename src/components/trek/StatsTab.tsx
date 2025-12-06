/**
 * Stats tab displaying journey statistics, elevation profile, and historical sites
 */

import { memo, useState } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile } from '../../types/trek';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { InteractiveElevationProfile } from './InteractiveElevationProfile';
import { HistoricalSiteCard } from './HistoricalSiteCard';

// Difficulty color mapping
const DIFFICULTY_COLORS: Record<string, string> = {
    'Easy': '#22c55e',
    'Moderate': '#eab308',
    'Hard': '#f97316',
    'Extreme': '#ef4444'
};

// Simple stat card for grids
function StatItem({
    label,
    value,
    sublabel,
    color
}: {
    label: string;
    value: string;
    sublabel?: string;
    color?: string;
}) {
    return (
        <Card variant="subtle" className="p-4">
            <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-1">
                {label}
            </p>
            <p
                className="text-xl font-light text-white/95 light:text-slate-900"
                style={color ? { color } : undefined}
            >
                {value}
            </p>
            {sublabel && (
                <p className="text-xs text-white/40 light:text-slate-400 mt-0.5">
                    {sublabel}
                </p>
            )}
        </Card>
    );
}

interface StatsTabProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    isMobile?: boolean;
    selectedCamp?: Camp | null;
    onCampSelect?: (camp: Camp) => void;
}

export const StatsTab = memo(function StatsTab({
    trekData,
    extendedStats,
    elevationProfile,
    isMobile = false,
    selectedCamp = null,
    onCampSelect = () => {}
}: StatsTabProps) {
    const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);

    const historicalSites = trekData.historicalSites || [];
    const hasHistoricalSites = historicalSites.length > 0;

    return (
        <div>
            {/* Summit card */}
            <Card variant="elevated" className="p-5 mb-6">
                <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-2">Summit</p>
                <p className="text-3xl font-light text-white/95 light:text-slate-900">{trekData.stats.highestPoint.elevation}m</p>
                <p className="text-sm text-white/50 light:text-slate-500">{trekData.stats.highestPoint.name}</p>
            </Card>

            <div className="mb-8">
                <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-4">
                    Elevation Profile
                </p>
                {elevationProfile ? (
                    <InteractiveElevationProfile
                        elevationProfile={elevationProfile}
                        isMobile={isMobile}
                        selectedCamp={selectedCamp}
                        onCampSelect={onCampSelect}
                        camps={trekData.camps}
                    />
                ) : (
                    <div className="space-y-2">
                        <Skeleton variant="glass" className="h-[120px] w-full" />
                        <div className="flex justify-between">
                            <Skeleton variant="text" className="h-3 w-12" />
                            <Skeleton variant="text" className="h-3 w-12" />
                        </div>
                    </div>
                )}
            </div>

            {extendedStats && (
                <>
                    {/* Primary Stats Grid */}
                    <div className="mb-4">
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-3">
                            Journey Stats
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <StatItem label="Total Distance" value={`${trekData.stats.totalDistance} km`} />
                            <StatItem label="Duration" value={`${trekData.stats.duration} days`} />
                            <StatItem label="Est. Hiking Time" value={extendedStats.estimatedTotalTime} color="#8b5cf6" />
                            <StatItem
                                label="Difficulty"
                                value={extendedStats.difficulty}
                                color={DIFFICULTY_COLORS[extendedStats.difficulty]}
                            />
                        </div>
                    </div>

                    {/* Elevation Stats */}
                    <div className="mb-4">
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-3">
                            Elevation
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <StatItem label="Total Ascent" value={`+${extendedStats.totalElevationGain}m`} color="#22c55e" />
                            <StatItem label="Total Descent" value={`-${extendedStats.totalElevationLoss}m`} color="#ef4444" />
                            <StatItem label="Start Elev." value={`${extendedStats.startElevation}m`} />
                            <StatItem label="End Elev." value={`${extendedStats.endElevation}m`} />
                        </div>
                    </div>

                </>
            )}

            {/* Historical Sites Section */}
            {hasHistoricalSites && (
                <div className="mt-6">
                    <div className="flex items-center gap-2 mb-4">
                        <span className="text-amber-500 text-base">★</span>
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400">
                            Historical Sites
                        </p>
                        <span className="ml-auto px-2 py-0.5 bg-amber-500/15 rounded-full text-[11px] text-amber-500">
                            {historicalSites.length} sites
                        </span>
                    </div>
                    <p className="text-white/60 light:text-slate-600 text-xs leading-relaxed mb-4">
                        This journey passes through sites of historical and cultural significance.
                        Tap to learn more about each location.
                    </p>
                    {historicalSites
                        .sort((a, b) => (a.routeDistanceKm || 0) - (b.routeDistanceKm || 0))
                        .map(site => (
                            <HistoricalSiteCard
                                key={site.id}
                                site={site}
                                isExpanded={expandedSiteId === site.id}
                                onToggle={() => setExpandedSiteId(
                                    expandedSiteId === site.id ? null : site.id
                                )}
                            />
                        ))}
                </div>
            )}
        </div>
    );
});
