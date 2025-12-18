/**
 * DayDiscoveries - Points of Interest and Historical Sites for a day
 *
 * Expandable section showing notable locations encountered during the day's trek
 */

import { memo, useState } from 'react';
import type { PointOfInterest, HistoricalSite, POICategory } from '../../types/trek';
import { colors, radius } from '../../styles/liquidGlass';

interface DayDiscoveriesProps {
    pointsOfInterest?: PointOfInterest[];
    historicalSites?: HistoricalSite[];
}

/** POI category icons and colors */
const POI_CONFIG: Record<POICategory, { icon: string; color: string }> = {
    viewpoint: { icon: '👁️', color: '#60a5fa' },
    water: { icon: '💧', color: '#38bdf8' },
    landmark: { icon: '🏛️', color: '#f59e0b' },
    shelter: { icon: '🏕️', color: '#a78bfa' },
    warning: { icon: '⚠️', color: '#ef4444' },
    info: { icon: 'ℹ️', color: '#8b5cf6' },
    wildlife: { icon: '🦒', color: '#fbbf24' },
    photo_spot: { icon: '📸', color: '#f472b6' },
    rest_area: { icon: '🪑', color: '#34d399' },
    summit: { icon: '⛰️', color: '#ef4444' },
};

/** Significance colors for historical sites */
const SIGNIFICANCE_COLORS = {
    major: '#f59e0b',
    notable: '#60a5fa',
    minor: 'rgba(255,255,255,0.4)',
} as const;

interface ExpandableCardProps {
    title: string;
    subtitle?: string;
    icon: string;
    color: string;
    children: React.ReactNode;
    defaultExpanded?: boolean;
}

const ExpandableCard = memo(function ExpandableCard({
    title,
    subtitle,
    icon,
    color,
    children,
    defaultExpanded = false,
}: ExpandableCardProps) {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div
            style={{
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: radius.sm,
                overflow: 'hidden',
                marginBottom: 8,
            }}
        >
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                    width: '100%',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                }}
            >
                <span
                    style={{
                        fontSize: 16,
                        width: 28,
                        height: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: `${color}20`,
                        borderRadius: 6,
                        flexShrink: 0,
                    }}
                >
                    {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                        style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: colors.text.primary,
                            display: 'block',
                        }}
                    >
                        {title}
                    </span>
                    {subtitle && (
                        <span
                            style={{
                                fontSize: 11,
                                color: colors.text.subtle,
                            }}
                        >
                            {subtitle}
                        </span>
                    )}
                </div>
                <span
                    style={{
                        fontSize: 12,
                        color: colors.text.subtle,
                        transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                    }}
                >
                    ▼
                </span>
            </button>

            {isExpanded && (
                <div
                    style={{
                        padding: '0 12px 12px',
                        borderTop: `1px solid ${colors.glass.borderSubtle}`,
                    }}
                >
                    {children}
                </div>
            )}
        </div>
    );
});

const POICard = memo(function POICard({ poi }: { poi: PointOfInterest }) {
    const config = POI_CONFIG[poi.category] || POI_CONFIG.landmark;
    const icon = poi.icon || config.icon;

    return (
        <ExpandableCard
            title={poi.name}
            subtitle={poi.elevation ? `${poi.elevation}m` : undefined}
            icon={icon}
            color={config.color}
        >
            {poi.description && (
                <p
                    style={{
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: colors.text.secondary,
                        margin: '10px 0 0',
                    }}
                >
                    {poi.description}
                </p>
            )}
            {poi.tips && poi.tips.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    <span
                        style={{
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: colors.text.subtle,
                        }}
                    >
                        Tips
                    </span>
                    <ul
                        style={{
                            margin: '6px 0 0',
                            paddingLeft: 16,
                        }}
                    >
                        {poi.tips.map((tip, idx) => (
                            <li
                                key={idx}
                                style={{
                                    fontSize: 12,
                                    color: colors.text.tertiary,
                                    marginBottom: 4,
                                }}
                            >
                                {tip}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {poi.timeFromPrevious && (
                <div
                    style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: colors.text.subtle,
                    }}
                >
                    ⏱ {poi.timeFromPrevious} from previous stop
                </div>
            )}
        </ExpandableCard>
    );
});

const HistoricalSiteCard = memo(function HistoricalSiteCard({ site }: { site: HistoricalSite }) {
    const significanceColor = SIGNIFICANCE_COLORS[site.significance || 'minor'];

    return (
        <ExpandableCard
            title={site.name}
            subtitle={site.period}
            icon="🏛️"
            color={significanceColor}
        >
            <p
                style={{
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: colors.text.secondary,
                    margin: '10px 0 0',
                }}
            >
                {site.summary}
            </p>

            {site.description && (
                <p
                    style={{
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: colors.text.tertiary,
                        margin: '10px 0 0',
                        paddingTop: 10,
                        borderTop: `1px solid ${colors.glass.borderSubtle}`,
                    }}
                >
                    {site.description}
                </p>
            )}

            {site.tags && site.tags.length > 0 && (
                <div
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 6,
                        marginTop: 10,
                    }}
                >
                    {site.tags.map((tag) => (
                        <span
                            key={tag}
                            style={{
                                padding: '3px 8px',
                                background: 'rgba(96, 165, 250, 0.15)',
                                borderRadius: 4,
                                fontSize: 10,
                                color: colors.accent.primary,
                            }}
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {site.links && site.links.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    {site.links.map((link) => (
                        <a
                            key={link.url}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                marginRight: 12,
                                fontSize: 12,
                                color: colors.accent.primary,
                                textDecoration: 'none',
                            }}
                        >
                            {link.label}
                            <span style={{ fontSize: 10 }}>→</span>
                        </a>
                    ))}
                </div>
            )}
        </ExpandableCard>
    );
});

export const DayDiscoveries = memo(function DayDiscoveries({
    pointsOfInterest = [],
    historicalSites = [],
}: DayDiscoveriesProps) {
    const hasPOIs = pointsOfInterest.length > 0;
    const hasHistoricalSites = historicalSites.length > 0;

    if (!hasPOIs && !hasHistoricalSites) {
        return null;
    }

    return (
        <div style={{ marginTop: 12 }}>
            {/* Section Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 10,
                }}
            >
                <span style={{ fontSize: 14 }}>🔍</span>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: colors.text.tertiary,
                    }}
                >
                    Discoveries
                </span>
                <span
                    style={{
                        marginLeft: 'auto',
                        padding: '2px 8px',
                        background: 'rgba(96, 165, 250, 0.15)',
                        borderRadius: 10,
                        fontSize: 10,
                        color: colors.accent.primary,
                    }}
                >
                    {pointsOfInterest.length + historicalSites.length} places
                </span>
            </div>

            {/* Historical Sites */}
            {hasHistoricalSites && (
                <div style={{ marginBottom: hasPOIs ? 12 : 0 }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 8,
                        }}
                    >
                        <span style={{ color: '#f59e0b', fontSize: 12 }}>★</span>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 500,
                                color: colors.text.subtle,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                            }}
                        >
                            Historical Sites
                        </span>
                    </div>
                    {historicalSites.map((site) => (
                        <HistoricalSiteCard key={site.id} site={site} />
                    ))}
                </div>
            )}

            {/* Points of Interest */}
            {hasPOIs && (
                <div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginBottom: 8,
                        }}
                    >
                        <span style={{ fontSize: 12 }}>📍</span>
                        <span
                            style={{
                                fontSize: 10,
                                fontWeight: 500,
                                color: colors.text.subtle,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                            }}
                        >
                            Points of Interest
                        </span>
                    </div>
                    {pointsOfInterest.map((poi) => (
                        <POICard key={poi.id} poi={poi} />
                    ))}
                </div>
            )}
        </div>
    );
});

export default DayDiscoveries;
