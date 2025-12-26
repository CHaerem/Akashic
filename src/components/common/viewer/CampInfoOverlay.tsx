/**
 * CampInfoOverlay - Shows current day/camp information
 * Positioned at top of photo viewer with gradient background
 */

import type { Camp, TrekData } from '../../../types/trek';

interface CampInfoOverlayProps {
    camp: Camp;
    trekData: TrekData;
}

export function CampInfoOverlay({ camp, trekData }: CampInfoOverlayProps) {
    // Calculate date for the camp's day
    const getDayDate = (dayNumber: number): Date | null => {
        if (!trekData.dateStarted) return null;
        const start = new Date(trekData.dateStarted);
        start.setDate(start.getDate() + (dayNumber - 1));
        return start;
    };

    const date = getDayDate(camp.dayNumber);
    const dateStr = date ? date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }) : null;

    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                padding: '20px 20px 40px',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0) 100%)',
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
            }}
        >
            <div style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.7)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
            }}>
                Day {camp.dayNumber}
                {dateStr && ` · ${dateStr}`}
            </div>
            <div style={{
                fontSize: '20px',
                fontWeight: 700,
                color: '#fff',
            }}>
                {camp.name}
            </div>
            {camp.elevation && (
                <div style={{
                    fontSize: '14px',
                    color: 'rgba(255,255,255,0.8)',
                }}>
                    {camp.elevation.toLocaleString()}m elevation
                </div>
            )}
        </div>
    );
}
