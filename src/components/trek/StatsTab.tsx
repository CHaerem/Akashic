import { memo } from 'react';
import type { TrekData, ExtendedStats, ElevationProfile } from '../../types/trek';
import { StatCard } from '../common/StatCard';
import { colors, radius } from '../../styles/liquidGlass';

interface ElevationProfileProps {
    elevationProfile: ElevationProfile | null;
    isMobile?: boolean;
}

const ElevationProfileChart = memo(function ElevationProfileChart({ elevationProfile, isMobile = false }: ElevationProfileProps) {
    if (!elevationProfile) return null;

    return (
        <div style={{ position: 'relative', height: 120, width: '100%', paddingRight: isMobile ? 0 : 30 }}>
            <svg width="100%" height="100%" viewBox="0 0 300 120" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={colors.glass.light} />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                    </linearGradient>
                </defs>
                <line x1="0" y1="0" x2="300" y2="0" stroke={colors.glass.borderSubtle} strokeWidth="1" />
                <line x1="0" y1="60" x2="300" y2="60" stroke={colors.glass.borderSubtle} strokeWidth="1" />
                <line x1="0" y1="120" x2="300" y2="120" stroke={colors.glass.borderSubtle} strokeWidth="1" />
                <path d={elevationProfile.areaPath} fill="url(#elevationGradient)" />
                <path d={elevationProfile.linePath} fill="none" stroke={colors.text.primary} strokeWidth="1.5" />
            </svg>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                color: colors.text.subtle,
                fontSize: 10
            }}>
                <span>0 km</span>
                <span>{Math.round(elevationProfile.totalDist)} km</span>
            </div>
            {/* Elevation labels - inline on mobile, absolute positioned on desktop */}
            {isMobile ? (
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 4,
                    color: colors.text.subtle,
                    fontSize: 10
                }}>
                    <span>{Math.round(elevationProfile.minEle)}m min</span>
                    <span>{Math.round(elevationProfile.maxEle)}m max</span>
                </div>
            ) : (
                <>
                    <div style={{ position: 'absolute', top: 0, right: 0, color: colors.text.subtle, fontSize: 10 }}>
                        {Math.round(elevationProfile.maxEle)}m
                    </div>
                    <div style={{ position: 'absolute', bottom: 24, right: 0, color: colors.text.subtle, fontSize: 10 }}>
                        {Math.round(elevationProfile.minEle)}m
                    </div>
                </>
            )}
        </div>
    );
});

interface StatsTabProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    isMobile?: boolean;
}

export const StatsTab = memo(function StatsTab({ trekData, extendedStats, elevationProfile, isMobile = false }: StatsTabProps) {
    return (
        <div>
            {/* Summit card with glass styling */}
            <div style={{
                border: `1px solid ${colors.glass.borderSubtle}`,
                borderRadius: radius.md,
                padding: 20,
                marginBottom: 24,
                background: `linear-gradient(135deg, ${colors.glass.medium} 0%, ${colors.glass.subtle} 100%)`,
                boxShadow: `
                    0 4px 16px rgba(0, 0, 0, 0.2),
                    inset 0 1px 0 rgba(255, 255, 255, 0.08)
                `,
            }}>
                <p style={{ color: colors.text.subtle, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>Summit</p>
                <p style={{ color: colors.text.primary, fontSize: 28, fontWeight: 300 }}>{trekData.stats.highestPoint.elevation}m</p>
                <p style={{ color: colors.text.subtle, fontSize: 14 }}>{trekData.stats.highestPoint.name}</p>
            </div>

            <div style={{ marginBottom: 32 }}>
                <p style={{ color: colors.text.subtle, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 16 }}>
                    Elevation Profile
                </p>
                <ElevationProfileChart elevationProfile={elevationProfile} isMobile={isMobile} />
            </div>

            {extendedStats && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <StatCard label="Avg Daily Dist" value={`${extendedStats.avgDailyDistance} km`} />
                    <StatCard label="Max Daily Gain" value={`+${extendedStats.maxDailyGain}m`} color={colors.accent.secondary} />
                    <StatCard label="Start Elevation" value={`${extendedStats.startElevation}m`} />
                    <StatCard label="Difficulty" value={extendedStats.difficulty} color={colors.accent.warning} />
                </div>
            )}
        </div>
    );
});
