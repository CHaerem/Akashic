/**
 * Expandable card for displaying historical site information
 */

import { memo } from 'react';
import type { HistoricalSite } from '../../types/trek';
import { Card } from '../ui/card';
import { cn } from '@/lib/utils';

interface HistoricalSiteCardProps {
    site: HistoricalSite;
    isExpanded: boolean;
    onToggle: () => void;
}

const SIGNIFICANCE_COLORS = {
    major: '#f59e0b',
    notable: '#3b82f6',
    minor: 'rgba(255,255,255,0.4)'
} as const;

export const HistoricalSiteCard = memo(function HistoricalSiteCard({
    site,
    isExpanded,
    onToggle
}: HistoricalSiteCardProps) {
    return (
        <Card variant="subtle" className="mb-3 overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full p-4 flex items-start gap-3 bg-transparent border-none cursor-pointer text-left"
            >
                <div
                    className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                    style={{ background: SIGNIFICANCE_COLORS[site.significance || 'minor'] }}
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

export default HistoricalSiteCard;
