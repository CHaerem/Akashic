import { memo } from 'react';
import type { TrekData } from '../../types/trek';
import { StatCard } from '../common/StatCard';
import { colors, typography } from '../../styles/liquidGlass';

interface OverviewTabProps {
    trekData: TrekData;
}

export const OverviewTab = memo(function OverviewTab({ trekData }: OverviewTabProps) {
    return (
        <div>
            <p style={{
                ...typography.body,
                color: colors.text.secondary,
                lineHeight: 1.8,
                marginBottom: 28,
                fontSize: 14,
            }}>
                {trekData.description}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <StatCard label="Duration" value={`${trekData.stats.duration} days`} />
                <StatCard label="Distance" value={`${trekData.stats.totalDistance} km`} />
                <StatCard label="Ascent" value={`+${trekData.stats.totalElevationGain}m`} color={colors.accent.secondary} />
                <StatCard label="Summit" value={`${trekData.stats.highestPoint.elevation}m`} />
            </div>
        </div>
    );
});
