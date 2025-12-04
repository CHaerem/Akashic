/**
 * JourneyHeader - Top section of the sheet with trek info and mini elevation profile
 *
 * Compact mode: Just trek name and current day
 * Full mode: Name, dates, quick stats, and mini elevation profile
 */

import { memo, useMemo } from 'react';
import type { TrekData, ExtendedStats, ElevationProfile, Camp } from '../../types/trek';
import { colors } from '../../styles/liquidGlass';
import { MiniElevationProfile } from './MiniElevationProfile';

interface JourneyHeaderProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    selectedCamp: Camp | null;
    onDaySelect: (dayNumber: number) => void;
    isCompact: boolean;
}

export const JourneyHeader = memo(function JourneyHeader({
    trekData,
    extendedStats,
    elevationProfile,
    selectedCamp,
    onDaySelect,
    isCompact,
}: JourneyHeaderProps) {
    // Format date range
    const dateRange = useMemo(() => {
        if (!trekData.dateStarted) return null;
        const start = new Date(trekData.dateStarted);
        const end = new Date(start);
        end.setDate(end.getDate() + trekData.stats.duration - 1);

        const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${formatDate(start)} - ${formatDate(end)}`;
    }, [trekData.dateStarted, trekData.stats.duration]);

    const currentDay = selectedCamp?.dayNumber ?? 1;
    const currentCampName = selectedCamp?.name ?? trekData.camps[0]?.name ?? 'Start';

    if (isCompact) {
        // Compact mode - just current day info
        return (
            <div style={{
                padding: '0 20px 12px',
                borderBottom: `1px solid ${colors.glass.borderSubtle}`,
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div>
                        <span style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: colors.accent.primary,
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                        }}>
                            Day {currentDay}
                        </span>
                        <span style={{
                            color: colors.text.tertiary,
                            margin: '0 8px',
                        }}>•</span>
                        <span style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.text.primary,
                        }}>
                            {currentCampName}
                        </span>
                    </div>
                    <span style={{
                        fontSize: 12,
                        color: colors.text.tertiary,
                    }}>
                        {selectedCamp?.elevation ?? trekData.stats.highestPoint.elevation}m
                    </span>
                </div>
            </div>
        );
    }

    // Full mode
    return (
        <div style={{
            padding: '0 20px 16px',
            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
        }}>
            {/* Trek name and dates */}
            <div style={{ marginBottom: 12 }}>
                <h2 style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: colors.text.primary,
                    margin: 0,
                    marginBottom: 4,
                }}>
                    {trekData.name}
                </h2>
                {dateRange && (
                    <p style={{
                        fontSize: 13,
                        color: colors.text.tertiary,
                        margin: 0,
                    }}>
                        {dateRange}
                    </p>
                )}
            </div>

            {/* Quick stats row */}
            <div style={{
                display: 'flex',
                gap: 16,
                marginBottom: 16,
            }}>
                <QuickStat
                    label="Days"
                    value={String(trekData.stats.duration)}
                />
                <QuickStat
                    label="Distance"
                    value={`${trekData.stats.totalDistance}km`}
                />
                <QuickStat
                    label="Summit"
                    value={`${trekData.stats.highestPoint.elevation}m`}
                />
                {extendedStats && (
                    <QuickStat
                        label="Ascent"
                        value={`+${extendedStats.totalElevationGain}m`}
                        color="#22c55e"
                    />
                )}
            </div>

            {/* Mini elevation profile */}
            {elevationProfile && (
                <MiniElevationProfile
                    elevationProfile={elevationProfile}
                    camps={trekData.camps}
                    selectedDay={currentDay}
                    onDaySelect={onDaySelect}
                />
            )}
        </div>
    );
});

interface QuickStatProps {
    label: string;
    value: string;
    color?: string;
}

function QuickStat({ label, value, color }: QuickStatProps) {
    return (
        <div>
            <div style={{
                fontSize: 9,
                fontWeight: 500,
                color: colors.text.subtle,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 2,
            }}>
                {label}
            </div>
            <div style={{
                fontSize: 14,
                fontWeight: 600,
                color: color ?? colors.text.primary,
            }}>
                {value}
            </div>
        </div>
    );
}

export default JourneyHeader;
