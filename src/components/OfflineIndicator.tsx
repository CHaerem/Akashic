import { memo, useState, useEffect } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { cn } from '@/lib/utils';

interface OfflineIndicatorProps {
    isMobile: boolean;
}

export const OfflineIndicator = memo(function OfflineIndicator({ isMobile }: OfflineIndicatorProps) {
    const { isOnline, wasOffline } = useOnlineStatus();
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!isOnline) {
            setVisible(true);
        } else if (wasOffline) {
            // Show reconnected briefly then fade out
            setVisible(true);
            const timer = setTimeout(() => setVisible(false), 2000);
            return () => clearTimeout(timer);
        } else {
            setVisible(false);
        }
    }, [isOnline, wasOffline]);

    if (!visible) return null;

    return (
        <div
            className={cn(
                "fixed z-[200] flex items-center gap-2",
                "backdrop-blur-xl saturate-[180%]",
                "border border-white/15 light:border-black/10",
                "rounded-full px-3.5 py-2",
                "shadow-[0_4px_16px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]",
                "animate-in zoom-in-95 duration-400"
            )}
            style={{
                top: isMobile ? 'max(60px, calc(env(safe-area-inset-top) + 50px))' : 70,
                left: isMobile ? 16 : 24,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)'
            }}
        >
            {/* Status dot with glow effect */}
            <div
                className={cn(
                    "w-2 h-2 rounded-full",
                    isOnline ? "bg-green-400" : "bg-red-400"
                )}
                style={{
                    boxShadow: isOnline
                        ? '0 0 12px #22c55e'
                        : '0 0 12px #ef4444'
                }}
            />

            <span className="text-[10px] uppercase tracking-[0.1em] text-white/70 light:text-slate-600">
                {isOnline ? 'Online' : 'Offline'}
            </span>
        </div>
    );
});
