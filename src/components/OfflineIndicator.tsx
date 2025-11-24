import { memo, useState, useEffect } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

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
                gap: 6,
                animation: 'fadeIn 0.3s ease'
            }}
        >
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>

            {/* Minimal dot indicator */}
            <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isOnline ? '#22c55e' : '#f87171'
            }} />

            <span style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase'
            }}>
                {isOnline ? 'Online' : 'Offline'}
            </span>
        </div>
    );
});
