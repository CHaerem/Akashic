interface GlobeHintProps {
    isMobile: boolean;
}

export function GlobeHint({ isMobile }: GlobeHintProps) {
    return (
        <div style={{
            position: 'absolute',
            bottom: isMobile ? 'max(24px, env(safe-area-inset-bottom))' : 24,
            left: isMobile ? '50%' : 'auto',
            right: isMobile ? 'auto' : 24,
            transform: isMobile ? 'translateX(-50%)' : 'none',
            color: 'rgba(255,255,255,0.3)',
            fontSize: isMobile ? 11 : 10,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            textAlign: 'center'
        }}>
            {isMobile ? 'Tap a marker to explore' : 'Click a marker to explore'}
        </div>
    );
}
