import { memo, useState, useCallback, useRef } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, CampMarker, HistoricalSite } from '../../types/trek';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';

// Difficulty color mapping
const DIFFICULTY_COLORS: Record<string, string> = {
    'Easy': '#22c55e',
    'Moderate': '#eab308',
    'Hard': '#f97316',
    'Extreme': '#ef4444'
};

// Simple stat card for grids
function StatItem({
    label,
    value,
    sublabel,
    color
}: {
    label: string;
    value: string;
    sublabel?: string;
    color?: string;
}) {
    return (
        <Card variant="subtle" className="p-4">
            <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-1">
                {label}
            </p>
            <p
                className="text-xl font-light text-white/95 light:text-slate-900"
                style={color ? { color } : undefined}
            >
                {value}
            </p>
            {sublabel && (
                <p className="text-xs text-white/40 light:text-slate-400 mt-0.5">
                    {sublabel}
                </p>
            )}
        </Card>
    );
}

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

        let closestPoint = elevationProfile.points[0];
        let minDist = Math.abs(mouseX - closestPoint.x);

        for (const point of elevationProfile.points) {
            const dist = Math.abs(mouseX - point.x);
            if (dist < minDist) {
                minDist = dist;
                closestPoint = point;
            }
        }

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

        let closestMarker: CampMarker | null = null;
        let minDist = Infinity;

        for (const marker of elevationProfile.campMarkers) {
            const dist = Math.abs(mouseX - marker.x);
            if (dist < minDist) {
                minDist = dist;
                closestMarker = marker;
            }
        }

        if (closestMarker && minDist < 20) {
            const camp = camps.find(c => c.id === closestMarker!.campId);
            if (camp) {
                onCampSelect(camp);
            }
        }
    }, [elevationProfile, camps, onCampSelect]);

    const handleTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        if (!svgRef.current || e.touches.length === 0) return;

        const touch = e.touches[0];
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = 300 / rect.width;
        const touchX = (touch.clientX - rect.left) * scaleX;

        let closestPoint = elevationProfile.points[0];
        let minDist = Math.abs(touchX - closestPoint.x);

        for (const point of elevationProfile.points) {
            const dist = Math.abs(touchX - point.x);
            if (dist < minDist) {
                minDist = dist;
                closestPoint = point;
            }
        }

        let nearestCamp: CampMarker | undefined;
        for (const marker of elevationProfile.campMarkers) {
            if (Math.abs(touchX - marker.x) < 15) {
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

    const handleTouchEnd = useCallback(() => {
        if (hoverInfo?.campMarker) {
            const camp = camps.find(c => c.id === hoverInfo.campMarker!.campId);
            if (camp) {
                onCampSelect(camp);
            }
        }
        setTimeout(() => setHoverInfo(null), 300);
    }, [hoverInfo, camps, onCampSelect]);

    return (
        <div className={cn("relative h-[140px] w-full", !isMobile && "pr-8")}>
            <svg
                ref={svgRef}
                width="100%"
                height="120"
                viewBox="0 0 300 120"
                preserveAspectRatio="none"
                className="overflow-visible cursor-crosshair touch-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <defs>
                    <linearGradient id="elevationGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
                        <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                    </linearGradient>
                    <linearGradient id="selectedGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(59, 130, 246, 0.3)" />
                        <stop offset="100%" stopColor="rgba(59, 130, 246, 0)" />
                    </linearGradient>
                </defs>

                {/* Grid lines */}
                <line x1="0" y1="0" x2="300" y2="0" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                <line x1="0" y1="120" x2="300" y2="120" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

                {/* Main elevation area and line */}
                <path d={elevationProfile.areaPath} fill="url(#elevationGradient)" />
                <path d={elevationProfile.linePath} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" />

                {/* Selected camp highlight */}
                {selectedCamp && (() => {
                    const marker = elevationProfile.campMarkers.find(m => m.campId === selectedCamp.id);
                    if (!marker) return null;

                    const endX = marker.x;
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
                            {(isSelected || isHovered) && (
                                <circle
                                    cx={marker.x}
                                    cy={marker.y}
                                    r={isSelected ? 10 : 8}
                                    fill={isSelected ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.2)'}
                                />
                            )}
                            <circle
                                cx={marker.x}
                                cy={marker.y}
                                r={isSelected ? 5 : 4}
                                fill={isSelected ? '#3b82f6' : 'rgba(255,255,255,0.9)'}
                                stroke={isSelected ? '#60a5fa' : 'rgba(0, 0, 0, 0.5)'}
                                strokeWidth={isSelected ? 2 : 1}
                                className="cursor-pointer"
                            />
                            <text
                                x={marker.x}
                                y={marker.y - 12}
                                textAnchor="middle"
                                fill={isSelected ? '#60a5fa' : 'rgba(255,255,255,0.4)'}
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
                    className="absolute top-[-8px] -translate-x-1/2 bg-black/85 border border-white/15 rounded-md px-2 py-1 text-[10px] text-white/90 whitespace-nowrap pointer-events-none z-10"
                    style={{ left: `${(hoverInfo.x / 300) * 100}%` }}
                >
                    {hoverInfo.campMarker ? (
                        <span className="font-medium">{hoverInfo.campMarker.name}</span>
                    ) : (
                        <>
                            <span className="text-white/50">{hoverInfo.dist.toFixed(1)} km</span>
                            <span className="mx-1.5 text-white/20">·</span>
                            <span>{Math.round(hoverInfo.ele)}m</span>
                        </>
                    )}
                </div>
            )}

            {/* Distance labels */}
            <div className="flex justify-between mt-2 text-white/40 light:text-slate-400 text-[10px]">
                <span>0 km</span>
                <span>{Math.round(elevationProfile.totalDist)} km</span>
            </div>

            {/* Elevation labels */}
            {isMobile ? (
                <div className="flex justify-between mt-1 text-white/40 light:text-slate-400 text-[10px]">
                    <span>{Math.round(elevationProfile.minEle)}m min</span>
                    <span>{Math.round(elevationProfile.maxEle)}m max</span>
                </div>
            ) : (
                <>
                    <div className="absolute top-0 right-0 text-white/40 light:text-slate-400 text-[10px]">
                        {Math.round(elevationProfile.maxEle)}m
                    </div>
                    <div className="absolute top-[100px] right-0 text-white/40 light:text-slate-400 text-[10px]">
                        {Math.round(elevationProfile.minEle)}m
                    </div>
                </>
            )}

            {/* Click hint */}
            <p className={cn(
                "text-white/30 light:text-slate-400 text-[9px] text-center",
                isMobile ? "mt-2" : "mt-1"
            )}>
                Click a day marker to explore
            </p>
        </div>
    );
});

// Historical Site Card Component
interface HistoricalSiteCardProps {
    site: HistoricalSite;
    isExpanded: boolean;
    onToggle: () => void;
}

const HistoricalSiteCard = memo(function HistoricalSiteCard({
    site,
    isExpanded,
    onToggle
}: HistoricalSiteCardProps) {
    const significanceColors = {
        major: '#f59e0b',
        notable: '#3b82f6',
        minor: 'rgba(255,255,255,0.4)'
    };

    return (
        <Card variant="subtle" className="mb-3 overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full p-4 flex items-start gap-3 bg-transparent border-none cursor-pointer text-left"
            >
                <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: significanceColors[site.significance || 'minor'] }}
                />
                <div className="flex-1">
                    <div className="flex items-center gap-2">
                        <span className="text-white/95 light:text-slate-900 text-sm font-medium">
                            {site.name}
                        </span>
                        {site.routeDistanceKm != null && (
                            <span className="text-white/40 light:text-slate-400 text-[11px]">
                                {site.routeDistanceKm.toFixed(1)} km
                            </span>
                        )}
                    </div>
                    <p className="text-white/60 light:text-slate-600 text-xs mt-1 leading-snug">
                        {site.summary}
                    </p>
                    {site.period && (
                        <span className="inline-block mt-1.5 px-2 py-0.5 bg-white/5 light:bg-black/5 rounded text-[10px] text-white/40 light:text-slate-400">
                            {site.period}
                        </span>
                    )}
                </div>
                <span className={cn(
                    "text-white/40 light:text-slate-400 text-sm transition-transform duration-200",
                    isExpanded && "rotate-180"
                )}>
                    ▼
                </span>
            </button>

            {isExpanded && site.description && (
                <div className="px-4 pb-4 pl-9 border-t border-white/10 light:border-black/5">
                    <p className="text-white/60 light:text-slate-600 text-[13px] leading-relaxed mt-3">
                        {site.description}
                    </p>
                    {site.tags && site.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {site.tags.map(tag => (
                                <span
                                    key={tag}
                                    className="px-2 py-0.5 bg-blue-500/15 rounded text-[10px] text-blue-400"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                    {site.links && site.links.length > 0 && (
                        <div className="mt-3">
                            {site.links.map(link => (
                                <a
                                    key={link.url}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-blue-400 text-xs no-underline mr-4 hover:underline"
                                >
                                    {link.label} →
                                </a>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Card>
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
    const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);

    const historicalSites = trekData.historicalSites || [];
    const hasHistoricalSites = historicalSites.length > 0;

    return (
        <div>
            {/* Summit card */}
            <Card variant="elevated" className="p-5 mb-6">
                <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-2">Summit</p>
                <p className="text-3xl font-light text-white/95 light:text-slate-900">{trekData.stats.highestPoint.elevation}m</p>
                <p className="text-sm text-white/50 light:text-slate-500">{trekData.stats.highestPoint.name}</p>
            </Card>

            <div className="mb-8">
                <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-4">
                    Elevation Profile
                </p>
                {elevationProfile ? (
                    <InteractiveElevationProfile
                        elevationProfile={elevationProfile}
                        isMobile={isMobile}
                        selectedCamp={selectedCamp}
                        onCampSelect={onCampSelect}
                        camps={trekData.camps}
                    />
                ) : (
                    <div className="space-y-2">
                        <Skeleton variant="glass" className="h-[120px] w-full" />
                        <div className="flex justify-between">
                            <Skeleton variant="text" className="h-3 w-12" />
                            <Skeleton variant="text" className="h-3 w-12" />
                        </div>
                    </div>
                )}
            </div>

            {extendedStats && (
                <>
                    {/* Primary Stats Grid */}
                    <div className="mb-4">
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-3">
                            Journey Stats
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <StatItem label="Total Distance" value={`${trekData.stats.totalDistance} km`} />
                            <StatItem label="Duration" value={`${trekData.stats.duration} days`} />
                            <StatItem label="Est. Hiking Time" value={extendedStats.estimatedTotalTime} color="#8b5cf6" />
                            <StatItem
                                label="Difficulty"
                                value={extendedStats.difficulty}
                                color={DIFFICULTY_COLORS[extendedStats.difficulty]}
                            />
                        </div>
                    </div>

                    {/* Elevation Stats */}
                    <div className="mb-4">
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400 mb-3">
                            Elevation
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                            <StatItem label="Total Ascent" value={`+${extendedStats.totalElevationGain}m`} color="#22c55e" />
                            <StatItem label="Total Descent" value={`-${extendedStats.totalElevationLoss}m`} color="#ef4444" />
                            <StatItem label="Start Elev." value={`${extendedStats.startElevation}m`} />
                            <StatItem label="End Elev." value={`${extendedStats.endElevation}m`} />
                        </div>
                    </div>

                </>
            )}

            {/* Historical Sites Section */}
            {hasHistoricalSites && (
                <div className="mt-6">
                    <div className="flex items-center gap-2 mb-4">
                        <span className="text-amber-500 text-base">★</span>
                        <p className="text-[10px] tracking-[0.1em] uppercase text-white/40 light:text-slate-400">
                            Historical Sites
                        </p>
                        <span className="ml-auto px-2 py-0.5 bg-amber-500/15 rounded-full text-[11px] text-amber-500">
                            {historicalSites.length} sites
                        </span>
                    </div>
                    <p className="text-white/60 light:text-slate-600 text-xs leading-relaxed mb-4">
                        This journey passes through sites of historical and cultural significance.
                        Tap to learn more about each location.
                    </p>
                    {historicalSites
                        .sort((a, b) => (a.routeDistanceKm || 0) - (b.routeDistanceKm || 0))
                        .map(site => (
                            <HistoricalSiteCard
                                key={site.id}
                                site={site}
                                isExpanded={expandedSiteId === site.id}
                                onToggle={() => setExpandedSiteId(
                                    expandedSiteId === site.id ? null : site.id
                                )}
                            />
                        ))}
                </div>
            )}
        </div>
    );
});
