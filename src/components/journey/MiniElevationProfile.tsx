/**
 * MiniElevationProfile - Compact interactive elevation chart
 * Shows journey elevation with tappable day markers
 */

import { memo, useMemo } from 'react';
import type { ElevationProfile, Camp } from '../../types/trek';
import { colors } from '../../styles/liquidGlass';

interface MiniElevationProfileProps {
    elevationProfile: ElevationProfile;
    camps: Camp[];
    selectedDay: number;
    onDaySelect: (dayNumber: number) => void;
}

export const MiniElevationProfile = memo(function MiniElevationProfile({
    elevationProfile,
    camps,
    selectedDay,
    onDaySelect,
}: MiniElevationProfileProps) {
    const { points, minElevation, maxElevation, totalDistance } = elevationProfile;

    // Calculate SVG dimensions
    const width = 100; // percentage
    const height = 48;
    const padding = { top: 8, bottom: 16, left: 0, right: 0 };
    const chartWidth = 100 - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Generate path for elevation line
    const elevationPath = useMemo(() => {
        if (points.length < 2) return '';

        const elevRange = maxElevation - minElevation || 1;
        const distRange = totalDistance || 1;

        const pathPoints = points.map((p, i) => {
            const x = padding.left + (p.distance / distRange) * chartWidth;
            const y = padding.top + chartHeight - ((p.elevation - minElevation) / elevRange) * chartHeight;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        });

        return pathPoints.join(' ');
    }, [points, minElevation, maxElevation, totalDistance, chartWidth, chartHeight, padding]);

    // Generate area fill path
    const areaPath = useMemo(() => {
        if (!elevationPath) return '';
        const lastPoint = points[points.length - 1];
        const distRange = totalDistance || 1;
        const lastX = padding.left + (lastPoint.distance / distRange) * chartWidth;
        const bottomY = padding.top + chartHeight;
        return `${elevationPath} L ${lastX} ${bottomY} L ${padding.left} ${bottomY} Z`;
    }, [elevationPath, points, totalDistance, chartWidth, chartHeight, padding]);

    // Calculate camp marker positions
    const campMarkers = useMemo(() => {
        const elevRange = maxElevation - minElevation || 1;
        const distRange = totalDistance || 1;

        return camps.map(camp => {
            // Find the closest elevation point to this camp
            const campPoint = points.reduce((closest, p) => {
                const campDist = Math.abs(p.distance - (camp.distanceFromStart || 0));
                const closestDist = Math.abs(closest.distance - (camp.distanceFromStart || 0));
                return campDist < closestDist ? p : closest;
            }, points[0]);

            const x = padding.left + ((camp.distanceFromStart || campPoint.distance) / distRange) * chartWidth;
            const y = padding.top + chartHeight - ((camp.elevation - minElevation) / elevRange) * chartHeight;

            return {
                camp,
                x,
                y,
                isSelected: camp.dayNumber === selectedDay,
            };
        });
    }, [camps, points, minElevation, maxElevation, totalDistance, selectedDay, chartWidth, chartHeight, padding]);

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height,
            borderRadius: 8,
            background: 'rgba(255,255,255,0.03)',
            overflow: 'hidden',
        }}>
            <svg
                width="100%"
                height={height}
                viewBox={`0 0 100 ${height}`}
                preserveAspectRatio="none"
                style={{ display: 'block' }}
            >
                {/* Gradient definition */}
                <defs>
                    <linearGradient id="elevationGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(96, 165, 250, 0.3)" />
                        <stop offset="100%" stopColor="rgba(96, 165, 250, 0)" />
                    </linearGradient>
                </defs>

                {/* Area fill */}
                <path
                    d={areaPath}
                    fill="url(#elevationGradient)"
                />

                {/* Elevation line */}
                <path
                    d={elevationPath}
                    fill="none"
                    stroke="rgba(96, 165, 250, 0.6)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Camp markers */}
                {campMarkers.map(({ camp, x, y, isSelected }) => (
                    <g key={camp.id}>
                        {/* Vertical line to bottom */}
                        <line
                            x1={x}
                            y1={y}
                            x2={x}
                            y2={height - 4}
                            stroke={isSelected ? colors.accent.primary : 'rgba(255,255,255,0.2)'}
                            strokeWidth={isSelected ? 1.5 : 0.5}
                            strokeDasharray={isSelected ? 'none' : '2,2'}
                        />
                        {/* Marker dot */}
                        <circle
                            cx={x}
                            cy={y}
                            r={isSelected ? 4 : 2.5}
                            fill={isSelected ? colors.accent.primary : 'rgba(255,255,255,0.5)'}
                            stroke={isSelected ? 'white' : 'none'}
                            strokeWidth={isSelected ? 1 : 0}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onDaySelect(camp.dayNumber)}
                        />
                        {/* Day label */}
                        <text
                            x={x}
                            y={height - 2}
                            textAnchor="middle"
                            fontSize="7"
                            fill={isSelected ? colors.text.primary : colors.text.subtle}
                            fontWeight={isSelected ? 600 : 400}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onDaySelect(camp.dayNumber)}
                        >
                            {camp.dayNumber}
                        </text>
                    </g>
                ))}
            </svg>

            {/* Touch overlay for easier tapping */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 24,
                display: 'flex',
            }}>
                {campMarkers.map(({ camp, x }) => (
                    <div
                        key={camp.id}
                        onClick={() => onDaySelect(camp.dayNumber)}
                        style={{
                            position: 'absolute',
                            left: `calc(${x}% - 16px)`,
                            width: 32,
                            height: 24,
                            cursor: 'pointer',
                        }}
                    />
                ))}
            </div>
        </div>
    );
});

export default MiniElevationProfile;
