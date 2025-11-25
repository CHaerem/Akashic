import { memo, useCallback, useMemo } from 'react';
import type { TrekData, Camp } from '../../types/trek';

interface CampItemProps {
    camp: Camp;
    isSelected: boolean;
    onClick: (camp: Camp) => void;
    isLast: boolean;
    isMobile?: boolean;
}

const CampItem = memo(function CampItem({ camp, isSelected, onClick, isLast, isMobile = false }: CampItemProps) {
    const handleClick = useCallback(() => onClick(camp), [onClick, camp]);
    const padding = isMobile ? 16 : 24;

    const containerStyle = useMemo(() => ({
        padding: '20px 0',
        borderBottom: !isLast ? '1px solid rgba(255,255,255,0.05)' : 'none',
        cursor: 'pointer',
        transition: 'background 0.2s',
        background: isSelected ? 'rgba(255,255,255,0.03)' : 'transparent',
        margin: `0 -${padding}px`,
        paddingLeft: padding,
        paddingRight: padding,
        minHeight: 44
    }), [isLast, isSelected, padding]);

    return (
        <div onClick={handleClick} style={containerStyle}>
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
                        height: isMobile ? 120 : 160,
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
});

interface JourneyTabProps {
    trekData: TrekData;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    isMobile?: boolean;
}

export const JourneyTab = memo(function JourneyTab({ trekData, selectedCamp, onCampSelect, isMobile = false }: JourneyTabProps) {
    return (
        <div>
            {trekData.camps.map((camp, i) => (
                <CampItem
                    key={camp.id}
                    camp={camp}
                    isSelected={selectedCamp?.id === camp.id}
                    onClick={onCampSelect}
                    isLast={i === trekData.camps.length - 1}
                    isMobile={isMobile}
                />
            ))}
        </div>
    );
});
