/**
 * DayProgressDots - Shows clickable dots for each day with photos
 * Positioned at bottom of photo viewer
 */

interface DayProgressDotsProps {
    daysWithPhotos: number[];
    currentDay: number | null;
    onDayClick: (dayNumber: number) => void;
}

export function DayProgressDots({
    daysWithPhotos,
    currentDay,
    onDayClick,
}: DayProgressDotsProps) {
    if (daysWithPhotos.length <= 1) {
        return null; // Don't show if only one day
    }

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '12px',
                padding: '12px 20px',
                borderRadius: '24px',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(10px)',
                pointerEvents: 'auto',
            }}
        >
            {daysWithPhotos.map(day => {
                const isCurrent = day === currentDay;
                return (
                    <button
                        key={day}
                        onClick={() => onDayClick(day)}
                        aria-label={`Go to Day ${day}`}
                        style={{
                            width: isCurrent ? '32px' : '10px',
                            height: '10px',
                            borderRadius: '5px',
                            border: 'none',
                            background: isCurrent ? '#fff' : 'rgba(255,255,255,0.4)',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            padding: 0,
                        }}
                    />
                );
            })}
        </div>
    );
}
