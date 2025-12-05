import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { TrekData, Camp, ExtendedStats, ElevationProfile, CampMarker, HistoricalSite } from '../../types/trek';
import { Card } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { cn } from '@/lib/utils';

// Zoom constants
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

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
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [isPanning, setIsPanning] = useState(false);
    const [lastPanX, setLastPanX] = useState(0);
    const [pinchStartDist, setPinchStartDist] = useState<number | null>(null);
    const [pinchStartZoom, setPinchStartZoom] = useState(1);
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate viewBox based on zoom and pan
    const viewBoxWidth = 300 / zoom;
    const viewBoxX = Math.max(0, Math.min(panX, 300 - viewBoxWidth));
    const viewBox = `${viewBoxX} 0 ${viewBoxWidth} 120`;

    // Reset zoom handler
    const resetZoom = useCallback(() => {
        setZoom(1);
        setPanX(0);
    }, []);

    // Wheel zoom handler
    const handleWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta));

        if (newZoom !== zoom) {
            // Zoom towards mouse position
            const rect = svgRef.current?.getBoundingClientRect();
            if (rect) {
                const mouseXRatio = (e.clientX - rect.left) / rect.width;
                const currentViewWidth = 300 / zoom;
                const newViewWidth = 300 / newZoom;
                const mouseXInView = viewBoxX + mouseXRatio * currentViewWidth;
                const newPanX = mouseXInView - mouseXRatio * newViewWidth;
                setPanX(Math.max(0, Math.min(300 - newViewWidth, newPanX)));
            }
            setZoom(newZoom);
        }
    }, [zoom, viewBoxX]);

    // Attach wheel listener
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    // Pinch-to-zoom handlers
    const getTouchDistance = (touches: TouchList) => {
        if (touches.length < 2) return 0;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        if (e.touches.length === 2) {
            // Pinch start
            setPinchStartDist(getTouchDistance(e.touches));
            setPinchStartZoom(zoom);
        } else if (e.touches.length === 1 && zoom > 1) {
            // Pan start
            setIsPanning(true);
            setLastPanX(e.touches[0].clientX);
        }
    }, [zoom]);

    const handlePinchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        if (e.touches.length === 2 && pinchStartDist) {
            // Pinch zoom
            const currentDist = getTouchDistance(e.touches);
            const scale = currentDist / pinchStartDist;
            const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoom * scale));
            setZoom(newZoom);

            // Adjust pan to keep center point stable
            const rect = svgRef.current?.getBoundingClientRect();
            if (rect) {
                const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                const centerXRatio = (centerX - rect.left) / rect.width;
                const newViewWidth = 300 / newZoom;
                const newPanX = centerXRatio * 300 - centerXRatio * newViewWidth;
                setPanX(Math.max(0, Math.min(300 - newViewWidth, newPanX)));
            }
        } else if (e.touches.length === 1 && isPanning && zoom > 1) {
            // Panning
            const rect = svgRef.current?.getBoundingClientRect();
            if (rect) {
                const deltaX = (lastPanX - e.touches[0].clientX) * (300 / zoom / rect.width);
                const viewWidth = 300 / zoom;
                setPanX(prev => Math.max(0, Math.min(300 - viewWidth, prev + deltaX)));
                setLastPanX(e.touches[0].clientX);
            }
        }
    }, [pinchStartDist, pinchStartZoom, isPanning, lastPanX, zoom]);

    const handleTouchEndPinch = useCallback(() => {
        setPinchStartDist(null);
        setIsPanning(false);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;

        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = viewBoxWidth / rect.width;
        const mouseX = viewBoxX + (e.clientX - rect.left) * scaleX;

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
    }, [elevationProfile, viewBoxWidth, viewBoxX]);

    const handleMouseLeave = useCallback(() => {
        setHoverInfo(null);
    }, []);

    const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current) return;

        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = viewBoxWidth / rect.width;
        const mouseX = viewBoxX + (e.clientX - rect.left) * scaleX;

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
    }, [elevationProfile, camps, onCampSelect, viewBoxWidth, viewBoxX]);

    const handleTouchMoveHover = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        // Only handle single-touch for hover info (pinch is handled separately)
        if (!svgRef.current || e.touches.length !== 1 || isPanning) return;

        const touch = e.touches[0];
        const rect = svgRef.current.getBoundingClientRect();
        const scaleX = viewBoxWidth / rect.width;
        const touchX = viewBoxX + (touch.clientX - rect.left) * scaleX;

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
    }, [elevationProfile, isPanning, viewBoxWidth, viewBoxX]);

    // Combined touch move handler
    const handleCombinedTouchMove = useCallback((e: React.TouchEvent<SVGSVGElement>) => {
        if (e.touches.length >= 2 || isPanning) {
            handlePinchMove(e);
        } else {
            handleTouchMoveHover(e);
        }
    }, [handlePinchMove, handleTouchMoveHover, isPanning]);

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
        <div className={cn("relative w-full", !isMobile && "pr-8")}>
            {/* Zoom controls */}
            {zoom > 1 && (
                <button
                    onClick={resetZoom}
                    className="absolute top-0 right-0 z-10 px-2 py-1 text-[10px] text-white/60 bg-white/10 hover:bg-white/20 rounded-md transition-colors"
                    style={{ right: isMobile ? 0 : 32 }}
                >
                    Reset ({zoom.toFixed(1)}x)
                </button>
            )}
            <div ref={containerRef} className="h-[120px]">
            <svg
                ref={svgRef}
                width="100%"
                height="120"
                viewBox={viewBox}
                preserveAspectRatio="none"
                className="overflow-visible cursor-crosshair touch-none"
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleCombinedTouchMove}
                onTouchEnd={(e) => {
                    handleTouchEndPinch();
                    handleTouchEnd();
                }}
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
            </div>

            {/* Hover tooltip */}
            {hoverInfo && (
                <div
                    className="absolute top-[-8px] -translate-x-1/2 bg-black/85 border border-white/15 rounded-md px-2 py-1 text-[10px] text-white/90 whitespace-nowrap pointer-events-none z-10"
                    style={{ left: `${((hoverInfo.x - viewBoxX) / viewBoxWidth) * 100}%` }}
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
                {isMobile ? 'Pinch to zoom • Tap day marker to explore' : 'Scroll to zoom • Click day marker to explore'}
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
