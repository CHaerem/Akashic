import { memo, useState, useCallback, useRef } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, CampMarker } from '../../types/trek';
import { StatCard } from '../common/StatCard';
import { colors, radius } from '../../styles/liquidGlass';

interface ElevationProfileProps {
    elevationProfile: ElevationProfile;
    isMobile?: boolean;
    selectedCamp: Camp | null;
    onCampSelect: (camp: Camp) => void;
    camps: Camp[];
}

interface HoverInfo {
    x: number;
    y: number;
    dist: number;
    ele: number;
    campMarker?: CampMarker;
}

const InteractiveElevationProfile = memo(function InteractiveElevationProfile({
    elevationProfile,
    isMobile = false,
    selectedCamp,
    onCampSelect,
    camps
}: ElevationProfileProps) {
    const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;

        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 300 / rect.width;
        const mouseX = (e.clientX - rect.left) * scaleX;

        // Find closest point
        let closestPoint = elevationProfile.points[0];
        let minDist = Math.abs(mouseX - closestPoint.x);

        for (const point of elevationProfile.points) {
            const dist = Math.abs(mouseX - point.x);
            if (dist < minDist) {
                minDist = dist;
                closestPoint = point;
            }
        }

        // Check if near a camp marker
        let nearestCamp: CampMarker | undefined;
        for (const marker of elevationProfile.campMarkers) {
            if (Math.abs(mouseX - marker.x) < 10) {
                nearestCamp = marker;
                break;
            }
        }

        setHoverInfo({
            x: closestPoint.x,
            y: closestPoint.y,
            dist: closestPoint.dist,
            ele: closestPoint.ele,
            campMarker: nearestCamp
        });
    }, [elevationProfile]);

    const handleMouseLeave = useCallback(() => {
        setHoverInfo(null);
    }, []);

    const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;

        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 300 / rect.width;
        const mouseX = (e.clientX - rect.left) * scaleX;

        // Find closest camp marker
        let closestMarker: CampMarker | null = null;
        let minDist = Infinity;

        for (const marker of elevationProfile.campMarkers) {
            const dist = Math.abs(mouseX - marker.x);
            if (dist < minDist) {
                minDist = dist;
                closestMarker = marker;
            }
        }

        // If clicked within reasonable distance of a camp, select it
        if (closestMarker && minDist < 20) {
            const camp = camps.find(c => c.id === closestMarker!.campId);
            if (camp) {
                onCampSelect(camp);
            }
        }
    }, [elevationProfile, camps, onCampSelect]);

    // Touch handlers for mobile
    const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        if (!svgRef.current || e.touches.length === 0) return;

        const touch = e.touches[0];
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 300 / rect.width;
        const touchX = (touch.clientX - rect.left) * scaleX;

        // Find closest point
        let closestPoint = elevationProfile.points[0];
        let minDist = Math.abs(touchX - closestPoint.x);

        for (const point of elevationProfile.points) {
            const dist = Math.abs(touchX - point.x);
            if (dist < minDist) {
                minDist = dist;
                closestPoint = point;
            }
        }

        // Check if near a camp marker
        let nearestCamp: CampMarker | undefined;
        for (const marker of elevationProfile.campMarkers) {
            if (Math.abs(touchX - marker.x) < 15) { // Larger touch target
                nearestCamp = marker;
                break;
            }
        }

        setHoverInfo({
            x: closestPoint.x,
            y: closestPoint.y,
            dist: closestPoint.dist,
            ele: closestPoint.ele,
            campMarker: nearestCamp
        });
    }, [elevationProfile]);

    const handleTouchEnd = useCallback((_e: React.TouchEvent<SVGSVGElement>) => {
        // If there's a hovered camp marker, select it on touch end
        if (hoverInfo?.campMarker) {
            const camp = camps.find(c => c.id === hoverInfo.campMarker!.campId);
            if (camp) {
                onCampSelect(camp);
            }
        }
        // Clear hover info after a short delay (allows user to see selection)
        setTimeout(() => setHoverInfo(null), 300);
    }, [hoverInfo, camps, onCampSelect]);

    return (
        <div style={{ position: 'relative', height: 140, width: '100%', paddingRight: isMobile ? 0 : 30 }}>
            <svg
                ref={svgRef}
                width="100%"
                height="120"
                viewBox="0 0 300 120"
                preserveAspectRatio="none"
                style={{ overflow: 'visible', cursor: 'crosshair', touchAction: 'none' }}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <defs>
                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={colors.glass.light} />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                    </linearGradient>
                    <linearGradient id="selectedGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.3)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </linearGradient>
                </defs>

                {/* Grid lines */}
                <line x1="0" y1="0" x2="300" y2="0" stroke={colors.glass.borderSubtle} strokeWidth="1" />
                <line x1="0" y1="60" x2="300" y2="60" stroke={colors.glass.borderSubtle} strokeWidth="1" />
                <line x1="0" y1="120" x2="300" y2="120" stroke={colors.glass.borderSubtle} strokeWidth="1" />

                {/* Main elevation area and line */}
                <path d={elevationProfile.areaPath} fill="url(#elevationGradient)" />
                <path d={elevationProfile.linePath} fill="none" stroke={colors.text.primary} strokeWidth="1.5" />

                {/* Selected camp highlight */}
                {selectedCamp && (() => {
                    const marker = elevationProfile.campMarkers.find(m => m.campId === selectedCamp.id);
                    if (!marker) return null;

                    const endX = marker.x;

                    // Draw highlighted segment from start to selected camp
                    const segmentPoints = elevationProfile.points.filter(p => p.x <= endX);
                    if (segmentPoints.length < 2) return null;

                    const segmentLine = `M ${segmentPoints.map(p => `${p.x},${p.y}`).join(' L ')}`;
                    const segmentArea = `${segmentLine} L ${endX},120 L 0,120 Z`;

                    return (
                        <g>
                            <path d={segmentArea} fill="url(#selectedGradient)" />
                            <path d={segmentLine} fill="none" stroke="rgba(59, 130, 246, 0.6)" strokeWidth="2" />
                        </g>
                    );
                })()}

                {/* Camp markers */}
                {elevationProfile.campMarkers.map((marker) => {
                    const isSelected = selectedCamp?.id === marker.campId;
                    const isHovered = hoverInfo?.campMarker?.campId === marker.campId;

                    return (
                        <g key={marker.campId}>
                            {/* Marker glow when selected/hovered */}
                            {(isSelected || isHovered) && (
                                <circle
                                    cx={marker.x}
                                    cy={marker.y}
                                    r={isSelected ? 10 : 8}
                                    fill={isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.2)'}
                                />
                            )}
                            {/* Main marker */}
                            <circle
                                cx={marker.x}
                                cy={marker.y}
                                r={isSelected ? 5 : 4}
                                fill={isSelected ? '#3b82f6' : colors.text.primary}
                                stroke={isSelected ? '#60a5fa' : 'rgba(0, 0, 0, 0.5)'}
                                strokeWidth={isSelected ? 2 : 1}
                                style={{ cursor: 'pointer' }}
                            />
                            {/* Day number label */}
                            <text
                                x={marker.x}
                                y={marker.y - 12}
                                textAnchor="middle"
                                fill={isSelected ? '#60a5fa' : colors.text.subtle}
                                fontSize="8"
                                fontWeight={isSelected ? 600 : 400}
                            >
                                D{marker.dayNumber}
                            </text>
                        </g>
                    );
                })}

                {/* Hover crosshair */}
                {hoverInfo && (
                    <g>
                        <line
                            x1={hoverInfo.x}
                            y1="0"
                            x2={hoverInfo.x}
                            y2="120"
                            stroke="rgba(255, 255, 255, 0.3)"
                            strokeWidth="1"
                            strokeDasharray="4,4"
                        />
                        <circle
                            cx={hoverInfo.x}
                            cy={hoverInfo.y}
                            r={3}
                            fill="#fff"
                            stroke="rgba(0, 0, 0, 0.3)"
                            strokeWidth="1"
                        />
                    </g>
                )}
            </svg>

            {/* Hover tooltip */}
            {hoverInfo && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${(hoverInfo.x / 300) * 100}%`,
                        top: -8,
                        transform: 'translateX(-50%)',
                        background: 'rgba(0, 0, 0, 0.85)',
                        border: `1px solid ${colors.glass.border}`,
                        borderRadius: radius.sm,
                        padding: '4px 8px',
                        fontSize: 10,
                        color: colors.text.primary,
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        zIndex: 10,
                    }}
                >
                    {hoverInfo.campMarker ? (
                        <span style={{ fontWeight: 500 }}>{hoverInfo.campMarker.name}</span>
                    ) : (
                        <>
                            <span style={{ color: colors.text.subtle }}>{hoverInfo.dist.toFixed(1)} km</span>
                            <span style={{ margin: '0 6px', color: colors.glass.border }}>·</span>
                            <span>{Math.round(hoverInfo.ele)}m</span>
                        </>
                    )}
                </div>
            )}

            {/* Distance labels */}
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

            {/* Elevation labels */}
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
                    <div style={{ position: 'absolute', top: 100, right: 0, color: colors.text.subtle, fontSize: 10 }}>
                        {Math.round(elevationProfile.minEle)}m
                    </div>
                </>
            )}

            {/* Click hint */}
            <p style={{
                color: colors.text.subtle,
                fontSize: 9,
                marginTop: isMobile ? 8 : 4,
                textAlign: 'center',
                opacity: 0.6
            }}>
                Click a day marker to explore
            </p>
        </div>
    );
});

interface StatsTabProps {
    trekData: TrekData;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    isMobile?: boolean;
    selectedCamp?: Camp | null;
    onCampSelect?: (camp: Camp) => void;
}

export const StatsTab = memo(function StatsTab({
    trekData,
    extendedStats,
    elevationProfile,
    isMobile = false,
    selectedCamp = null,
    onCampSelect = () => {}
}: StatsTabProps) {
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
                {elevationProfile && (
                    <InteractiveElevationProfile
                        elevationProfile={elevationProfile}
                        isMobile={isMobile}
                        selectedCamp={selectedCamp}
                        onCampSelect={onCampSelect}
                        camps={trekData.camps}
                    />
                )}
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
