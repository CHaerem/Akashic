import { memo, useState, useEffect } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { colors, radius, typography } from '../styles/liquidGlass';

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
            style={{
                position: 'fixed',
                top: isMobile ? 'max(60px, calc(env(safe-area-inset-top) + 50px))' : 70,
                left: isMobile ? 16 : 24,
                zIndex: 200,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                // Liquid Glass pill styling
                background: `linear-gradient(
                    135deg,
                    rgba(255, 255, 255, 0.1) 0%,
                    rgba(255, 255, 255, 0.05) 100%
                )`,
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                border: `1px solid ${colors.glass.border}`,
                borderRadius: radius.pill,
                padding: '8px 14px',
                boxShadow: `
                    0 4px 16px rgba(0, 0, 0, 0.2),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15)
                `,
                animation: 'scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)'
            }}
        >
            {/* Status dot with glow effect */}
            <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isOnline ? colors.accent.secondary : colors.accent.error,
                boxShadow: isOnline
                    ? `0 0 12px ${colors.accent.secondary}`
                    : `0 0 12px ${colors.accent.error}`,
            }} />

            <span style={{
                ...typography.label,
                fontSize: 10,
                color: colors.text.secondary,
            }}>
                {isOnline ? 'Online' : 'Offline'}
            </span>
        </div>
    );
});
