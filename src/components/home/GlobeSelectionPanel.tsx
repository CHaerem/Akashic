import type { TrekConfig } from '../../types/trek';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '@/lib/utils';

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isMobile: boolean;
}

export function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isMobile }: GlobeSelectionPanelProps) {
    return (
        <div
            className={cn(
                "absolute bottom-0 z-20",
                isMobile
                    ? "left-0 right-0 px-5 pt-6 pb-8 pb-[max(32px,env(safe-area-inset-bottom))]"
                    : "left-6 pb-12 max-w-[420px]"
            )}
            style={isMobile ? {
                background: `linear-gradient(
                    to top,
                    rgba(12, 12, 18, 0.98) 0%,
                    rgba(12, 12, 18, 0.9) 50%,
                    rgba(12, 12, 18, 0.6) 80%,
                    transparent 100%
                )`
            } : undefined}
        >
            {/* Back button */}
            <Button
                variant="ghost"
                size={isMobile ? 'md' : 'sm'}
                onClick={onBack}
                className={cn(
                    "tracking-[0.15em] uppercase text-[10px]",
                    isMobile ? "mb-5" : "mb-7"
                )}
            >
                ← Back
            </Button>

            {/* Country label */}
            <p className={cn(
                "tracking-[0.2em] uppercase text-white/40 light:text-slate-400",
                isMobile ? "text-[11px] mb-2.5" : "text-[10px] mb-3.5"
            )}>
                {selectedTrek.country}
            </p>

            {/* Trek name with glass card effect on mobile */}
            {isMobile ? (
                <Card variant="elevated" className="p-5 mb-5">
                    <h2 className="text-[28px] font-medium mb-2 text-white/95 light:text-slate-900">
                        {selectedTrek.name}
                    </h2>
                    <p className="text-sm text-white/50 light:text-slate-500 m-0">
                        Summit: {selectedTrek.elevation}
                    </p>
                </Card>
            ) : (
                <div className="mb-3">
                    <h2 className="text-[38px] font-medium mb-2 text-white/95 light:text-slate-900">
                        {selectedTrek.name}
                    </h2>
                    <p className="text-[15px] text-white/50 light:text-slate-500 m-0">
                        Summit: {selectedTrek.elevation}
                    </p>
                </div>
            )}

            {/* Explore button */}
            <Button
                variant={isMobile ? 'default' : 'ghost'}
                size={isMobile ? 'lg' : 'md'}
                onClick={onExplore}
                className={cn(
                    "tracking-[0.15em]",
                    isMobile && "w-full"
                )}
            >
                Explore Journey →
            </Button>
        </div>
    );
}
