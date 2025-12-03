import { memo } from 'react';
import type { TrekData } from '../../types/trek';
import { Card } from '../ui/card';

interface OverviewTabProps {
    trekData: TrekData;
}

// Simple stat card for the overview grid
function StatItem({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <Card variant="subtle" className="p-4">
            <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-1">
                {label}
            </p>
            <p
                className="text-2xl font-light text-white/95 light:text-slate-900"
                style={color ? { color } : undefined}
            >
                {value}
            </p>
        </Card>
    );
}

export const OverviewTab = memo(function OverviewTab({ trekData }: OverviewTabProps) {
    return (
        <div>
            <p className="text-sm text-white/70 light:text-slate-600 leading-relaxed mb-7">
                {trekData.description}
            </p>
            <div className="grid grid-cols-2 gap-3">
                <StatItem label="Duration" value={`${trekData.stats.duration} days`} />
                <StatItem label="Distance" value={`${trekData.stats.totalDistance} km`} />
                <StatItem label="Ascent" value={`+${trekData.stats.totalElevationGain}m`} color="#22c55e" />
                <StatItem label="Summit" value={`${trekData.stats.highestPoint.elevation}m`} />
            </div>
        </div>
    );
});
