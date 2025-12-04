/**
 * SegmentTransition - Shows trail info between two days
 */

import { memo } from 'react';
import type { RouteSegment } from '../../types/trek';
import { colors } from '../../styles/liquidGlass';
import { getDifficultyColor } from '../../utils/routeUtils';

interface SegmentTransitionProps {
    segment: RouteSegment;
}

export const SegmentTransition = memo(function SegmentTransition({
    segment,
}: SegmentTransitionProps) {
    const difficultyColor = getDifficultyColor(segment.difficulty);

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
