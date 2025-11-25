import { memo } from 'react';
import type { TrekData } from '../../types/trek';
import { StatCard } from '../common/StatCard';

interface OverviewTabProps {
    trekData: TrekData;
}

export const OverviewTab = memo(function OverviewTab({ trekData }: OverviewTabProps) {
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
