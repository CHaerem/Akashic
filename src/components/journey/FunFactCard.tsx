/**
 * FunFactCard - Display interesting facts about the journey day
 *
 * Shows educational trivia with category icons and optional "learn more" links
 */

import { memo } from 'react';
import type { FunFact, FunFactCategory } from '../../types/trek';
import { colors, radius } from '../../styles/liquidGlass';

interface FunFactCardProps {
    fact: FunFact;
    compact?: boolean;
}

/** Category icons and colors */
const CATEGORY_CONFIG: Record<FunFactCategory, { icon: string; color: string; label: string }> = {
    geology: { icon: '🪨', color: '#a78bfa', label: 'Geology' },
    wildlife: { icon: '🦁', color: '#fbbf24', label: 'Wildlife' },
    flora: { icon: '🌿', color: '#34d399', label: 'Flora' },
    history: { icon: '📜', color: '#f59e0b', label: 'History' },
    culture: { icon: '🎭', color: '#f472b6', label: 'Culture' },
    climate: { icon: '🌤️', color: '#60a5fa', label: 'Climate' },
    adventure: { icon: '⛰️', color: '#ef4444', label: 'Adventure' },
    science: { icon: '🔬', color: '#8b5cf6', label: 'Science' },
    geography: { icon: '🗺️', color: '#14b8a6', label: 'Geography' },
    survival: { icon: '🧭', color: '#f97316', label: 'Survival' },
};

export const FunFactCard = memo(function FunFactCard({ fact, compact = false }: FunFactCardProps) {
    const config = CATEGORY_CONFIG[fact.category] || CATEGORY_CONFIG.geography;
    const icon = fact.icon || config.icon;

    if (compact) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    borderRadius: radius.sm,
                    borderLeft: `3px solid ${config.color}`,
                }}
            >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                <p
                    style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: colors.text.secondary,
                        margin: 0,
                    }}
                >
                    {fact.content}
                </p>
            </div>
        );
    }

    return (
        <div
            style={{
                padding: 14,
                background: `linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)`,
                borderRadius: radius.md,
                border: `1px solid ${colors.glass.borderSubtle}`,
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                }}
            >
                <span
                    style={{
                        fontSize: 20,
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `${config.color}20`,
                        borderRadius: radius.sm,
                    }}
                >
                    {icon}
                </span>
                <span
                    style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: config.color,
                    }}
                >
                    {config.label}
                </span>
            </div>

            {/* Content */}
            <p
                style={{
                    fontSize: 14,
                    lineHeight: 1.6,
                    color: colors.text.secondary,
                    margin: 0,
                }}
            >
                {fact.content}
            </p>

            {/* Source & Learn More */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: `1px solid ${colors.glass.borderSubtle}`,
                }}
            >
                {fact.source && (
                    <span
                        style={{
                            fontSize: 11,
                            color: colors.text.subtle,
                            fontStyle: 'italic',
                        }}
                    >
                        Source: {fact.source}
                    </span>
                )}
                {fact.learnMoreUrl && (
                    <a
                        href={fact.learnMoreUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            fontSize: 12,
                            color: colors.accent.primary,
                            textDecoration: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                    >
                        Learn more
                        <span style={{ fontSize: 10 }}>→</span>
                    </a>
                )}
            </div>
        </div>
    );
});

export default FunFactCard;
