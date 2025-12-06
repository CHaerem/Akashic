/**
 * Interactive elevation profile with zoom, pan, and camp markers
 *
 * Features:
 * - SVG-based elevation chart
 * - Mouse hover tooltips
 * - Pinch-to-zoom on mobile
 * - Pan when zoomed
 * - Clickable camp markers
 */

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import type { Camp, ElevationProfile, CampMarker } from '../../types/trek';
import { cn } from '@/lib/utils';

// Zoom constants
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

interface InteractiveElevationProfileProps {
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

export const InteractiveElevationProfile = memo(function InteractiveElevationProfile({
    elevationProfile,
    isMobile = false,
    selectedCamp,
    onCampSelect,
    camps
}: InteractiveElevationProfileProps) {
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
                onTouchEnd={() => {
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

export default InteractiveElevationProfile;
