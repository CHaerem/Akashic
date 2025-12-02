import type { CSSProperties } from 'react';
import type { TrekConfig } from '../../types/trek';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, typography } from '../../styles/liquidGlass';

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isMobile: boolean;
    isLoading?: boolean;
}

export function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isMobile, isLoading = false }: GlobeSelectionPanelProps) {
    const containerStyle: CSSProperties = isMobile ? {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 'max(18px, env(safe-area-inset-bottom))',
        zIndex: 20,
        padding: '18px 16px 26px',
        background: `linear-gradient(
            175deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(10, 10, 15, 0.88) 50%,
            rgba(8, 8, 12, 0.94) 100%
        )`,
        backdropFilter: 'blur(18px) saturate(180%)',
        WebkitBackdropFilter: 'blur(18px) saturate(180%)',
        border: `1px solid ${colors.glass.border}`,
        borderRadius: radius.xxl,
        boxShadow: `
            0 18px 52px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.12)
        `,
    } : {
        position: 'absolute',
        left: 24,
        bottom: 0,
        zIndex: 20,
        maxWidth: 420,
        paddingBottom: 48,
    };

    const nameCardStyle: CSSProperties = isMobile ? {
        background: colors.glass.subtle,
        border: `1px solid ${colors.glass.borderSubtle}`,
        borderRadius: radius.lg,
        padding: '18px',
        marginBottom: 18,
        boxShadow: `
            0 10px 26px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.08)
        `,
    } : { marginBottom: 12 };

    return (
        <div style={containerStyle}>
            {/* Back button with glass styling */}
            <GlassButton
                variant="ghost"
                size={isMobile ? 'md' : 'sm'}
                onClick={onBack}
                style={{
                    marginBottom: isMobile ? 20 : 28,
                    ...typography.label,
                }}
            >
                ← Back
            </GlassButton>

            {/* Country label */}
            <p style={{
                ...typography.label,
                fontSize: isMobile ? 11 : 10,
                letterSpacing: '0.2em',
                color: colors.text.subtle,
                marginBottom: isMobile ? 10 : 14
            }}>
                {selectedTrek.country}
            </p>

            {/* Trek name with glass card effect on mobile */}
            <div style={nameCardStyle}>
                <h2 style={{
                    ...typography.display,
                    fontSize: isMobile ? 28 : 38,
                    fontWeight: 500,
                    marginBottom: 8,
                    color: colors.text.primary,
                }}>
                    {selectedTrek.name}
                </h2>
                <p style={{
                    ...typography.body,
                    fontSize: isMobile ? 14 : 15,
                    color: colors.text.tertiary,
                    margin: 0,
                }}>
                    Summit: {selectedTrek.elevation}
                </p>
            </div>

            {/* Explore button */}
            <GlassButton
            variant={isMobile ? 'default' : 'ghost'}
            size={isMobile ? 'lg' : 'md'}
            fullWidth={isMobile}
            onClick={onExplore}
            disabled={isLoading}
            style={{
                ...typography.label,
                letterSpacing: '0.15em',
            }}
        >
            {isLoading ? 'Preparing…' : 'Explore Journey →'}
        </GlassButton>
    </div>
);
}
