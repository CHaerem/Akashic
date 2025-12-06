/**
 * Segment info component showing hiking details between two camps
 * Displays distance, time, elevation changes, and difficulty
 */

import { memo } from 'react';
import type { RouteSegment } from '../../types/trek';
import { getDifficultyColor } from '../../utils/routeUtils';
import { cn } from '@/lib/utils';

interface SegmentInfoProps {
    segment: RouteSegment;
    isMobile?: boolean;
}

export const SegmentInfo = memo(function SegmentInfo({
    segment,
    isMobile = false
}: SegmentInfoProps) {
    const difficultyColor = getDifficultyColor(segment.difficulty);

    return (
        <div className={cn(
            "py-3 border-y border-white/8 light:border-black/5",
            isMobile ? "-mx-4 px-4" : "-mx-6 px-6"
        )}
            style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, transparent 50%, rgba(255,255,255,0.03) 100%)' }}
        >
            <div className="flex items-center justify-between gap-3">
                {/* Distance & Time */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-white/70 light:text-slate-600 text-xs">
                        <span className="opacity-60">↓</span>
                        <span className="font-medium">{segment.distance} km</span>
                    </div>
                    <div className="w-px h-3 bg-white/10 light:bg-black/10" />
                    <div className="text-white/50 light:text-slate-500 text-[11px]">
                        {segment.estimatedTime}
                    </div>
                </div>

                {/* Elevation changes */}
                <div className="flex items-center gap-2">
                    {segment.elevationGain > 0 && (
                        <span className="text-[11px] text-green-400 font-medium">
                            +{segment.elevationGain}m
                        </span>
                    )}
                    {segment.elevationLoss > 0 && (
                        <span className="text-[11px] text-red-400 font-medium">
                            -{segment.elevationLoss}m
                        </span>
                    )}
                    <div
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
                        style={{
                            background: difficultyColor.replace('0.8', '0.15'),
                            color: difficultyColor
                        }}
                    >
                        {segment.difficulty}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default SegmentInfo;
