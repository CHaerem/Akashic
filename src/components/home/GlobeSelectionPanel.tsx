import type { TrekConfig } from '../../types/trek';

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isMobile: boolean;
}

export function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isMobile }: GlobeSelectionPanelProps) {
    return (
        <div style={{
            position: 'absolute',
            left: isMobile ? 0 : 24,
            right: isMobile ? 0 : 'auto',
            bottom: 0,
            zIndex: 20,
            maxWidth: isMobile ? '100%' : 400,
            padding: isMobile ? '24px 20px 32px' : 0,
            paddingBottom: isMobile ? 'max(32px, env(safe-area-inset-bottom))' : 48,
            background: isMobile ? 'linear-gradient(to top, rgba(10,10,15,0.95) 0%, rgba(10,10,15,0.8) 70%, transparent 100%)' : 'transparent'
        }}>
            <button
                onClick={onBack}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.4)',
                    fontSize: isMobile ? 12 : 11,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    marginBottom: isMobile ? 16 : 24,
                    padding: isMobile ? '12px 0' : 0,
                    minHeight: isMobile ? 44 : 'auto'
                }}
            >
                ← Back
            </button>
            <p style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: isMobile ? 11 : 10,
                letterSpacing: '0.25em',
                textTransform: 'uppercase',
                marginBottom: isMobile ? 8 : 12
            }}>
                {selectedTrek.country}
            </p>
            <h2 style={{
                color: 'white',
                fontSize: isMobile ? 28 : 36,
                fontWeight: 300,
                marginBottom: 8
            }}>
                {selectedTrek.name}
            </h2>
            <p style={{
                color: 'rgba(255,255,255,0.3)',
                fontSize: isMobile ? 13 : 14,
                marginBottom: isMobile ? 20 : 32
            }}>
                Summit: {selectedTrek.elevation}
            </p>
            <button
                onClick={onExplore}
                style={{
                    background: isMobile ? 'rgba(255,255,255,0.1)' : 'none',
                    border: 'none',
                    color: 'rgba(255,255,255,0.7)',
                    fontSize: isMobile ? 12 : 11,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    padding: isMobile ? '16px 24px' : 0,
                    borderRadius: isMobile ? 8 : 0,
                    width: isMobile ? '100%' : 'auto',
                    minHeight: isMobile ? 48 : 'auto'
                }}
            >
                Explore Journey →
            </button>
        </div>
    );
}
