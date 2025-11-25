import { memo } from 'react';

interface StatCardProps {
    label: string;
    value: string;
    color?: string;
}

export const StatCard = memo(function StatCard({ label, value, color = 'rgba(255,255,255,0.8)' }: StatCardProps) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 8 }}>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                {label}
            </p>
            <p style={{ color }}>{value}</p>
        </div>
    );
});
