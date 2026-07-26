/**
 * SegmentTransition - Shows trail info between two days
 */

import { memo } from 'react';
import type { RouteSegment } from '../../types/trek';
import { colors } from '../../styles/liquidGlass';

interface SegmentTransitionProps {
    segment: RouteSegment;
}

/**
 * This file used to `import { getDifficultyColor } from '../../utils/routeUtils'` — a symbol that
 * exists nowhere in the repo. The swallowed typecheck hid it; at runtime the call throws
 * "getDifficultyColor is not a function" the first time a journey with segments renders.
 *
 * The map lives here rather than in routeUtils on purpose: routeUtils is pure geometry and should
 * not gain a dependency on the style layer. Keys are exhaustive over RouteSegment['difficulty'],
 * so adding a difficulty band makes this a compile error rather than a silent `undefined`.
 */
const DIFFICULTY_COLORS: Record<RouteSegment['difficulty'], string> = {
    easy: colors.accent.secondary,      // green
    moderate: colors.accent.warning,    // amber
    challenging: colors.accent.error,   // red
    difficult: colors.accent.info,      // purple
};

export const SegmentTransition = memo(function SegmentTransition({
    segment,
}: SegmentTransitionProps) {
    const difficultyColor = DIFFICULTY_COLORS[segment.difficulty];

    return (
        <div style={{
            padding: '12px 20px',
            background: 'linear-gradient(90deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.02) 100%)',
            borderTop: `1px solid ${colors.glass.borderSubtle}`,
            borderBottom: `1px solid ${colors.glass.borderSubtle}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
        }}>
            {/* Left side - distance and time */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
            }}>
                {/* Down arrow icon */}
                <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.text.tertiary}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <polyline points="19 12 12 19 5 12"/>
                </svg>

                <div>
                    <div style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: colors.text.secondary,
                    }}>
                        {segment.distance} km
                    </div>
                    <div style={{
                        fontSize: 11,
                        color: colors.text.subtle,
                    }}>
                        {segment.estimatedTime}
                    </div>
                </div>
            </div>

            {/* Right side - elevation and difficulty */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
            }}>
                {segment.elevationGain > 0 && (
                    <span style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: '#22c55e',
                    }}>
                        +{segment.elevationGain}m
                    </span>
                )}
                {segment.elevationLoss > 0 && (
                    <span style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: '#ef4444',
                    }}>
                        -{segment.elevationLoss}m
                    </span>
                )}
                <span style={{
                    fontSize: 9,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 6px',
                    borderRadius: 4,
                    background: difficultyColor.replace('0.8', '0.15'),
                    color: difficultyColor,
                }}>
                    {segment.difficulty}
                </span>
            </div>
        </div>
    );
});

export default SegmentTransition;
