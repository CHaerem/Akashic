import type { TrekConfig } from '../../types/trek';
import { GlassButton } from '../common/GlassButton';
import { colors, radius, typography } from '../../styles/liquidGlass';

interface GlobeSelectionPanelProps {
    selectedTrek: TrekConfig;
    onBack: () => void;
    onExplore: () => void;
    isLoading?: boolean;
    isMobile: boolean;
}

export function GlobeSelectionPanel({ selectedTrek, onBack, onExplore, isLoading = false, isMobile }: GlobeSelectionPanelProps) {
    return (
        <div style={{
            position: 'absolute',
            left: isMobile ? 0 : 24,
            right: isMobile ? 0 : 'auto',
            bottom: 0,
            zIndex: 20,
            maxWidth: isMobile ? '100%' : 420,
            padding: isMobile ? '24px 20px 32px' : 0,
            paddingBottom: isMobile ? 'max(32px, env(safe-area-inset-bottom))' : 48,
            // Liquid Glass gradient for mobile
            background: isMobile
                ? `linear-gradient(
                    to top,
                    rgba(12, 12, 18, 0.98) 0%,
                    rgba(12, 12, 18, 0.9) 50%,
                    rgba(12, 12, 18, 0.6) 80%,
                    transparent 100%
                  )`
                : 'transparent',
        }}>
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
            <div style={isMobile ? {
                background: `linear-gradient(
                    135deg,
                    rgba(255, 255, 255, 0.08) 0%,
                    rgba(255, 255, 255, 0.03) 100%
                )`,
                backdropFilter: 'blur(16px) saturate(180%)',
                WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                border: `1px solid ${colors.glass.borderSubtle}`,
                borderRadius: radius.lg,
                padding: '20px',
                marginBottom: 20,
                boxShadow: `
                    0 8px 32px rgba(0, 0, 0, 0.25),
                    inset 0 1px 0 rgba(255, 255, 255, 0.1)
                `,
            } : { marginBottom: 12 }}>
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
                {isLoading ? 'Preparing Journey…' : 'Explore Journey →'}
            </GlassButton>
        </div>
    );
}
