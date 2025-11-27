import { memo, type ReactNode, type CSSProperties } from 'react';
import { GlassButton } from './GlassButton';
import { colors, radius, transitions, typography } from '../../styles/liquidGlass';

interface GlassModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    footer?: ReactNode;
    isMobile?: boolean;
    maxWidth?: number;
}

export const GlassModal = memo(function GlassModal({
    isOpen,
    onClose,
    title,
    children,
    footer,
    isMobile = false,
    maxWidth = 500
}: GlassModalProps) {
    if (!isOpen) return null;

    const modalStyle: CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24
    };

    const overlayStyle: CSSProperties = {
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
    };

    const contentStyle: CSSProperties = {
        position: 'relative',
        // Liquid Glass gradient
        background: `linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.12) 0%,
            rgba(255, 255, 255, 0.06) 5%,
            rgba(15, 15, 22, 0.97) 30%
        )`,
        backdropFilter: 'blur(32px) saturate(180%)',
        WebkitBackdropFilter: 'blur(32px) saturate(180%)',
        borderRadius: isMobile ? `${radius.xxl}px ${radius.xxl}px 0 0` : radius.xl,
        width: isMobile ? '100%' : '100%',
        maxWidth,
        maxHeight: isMobile ? '90dvh' : '80vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${colors.glass.border}`,
        boxShadow: `
            0 24px 80px rgba(0, 0, 0, 0.5),
            0 0 0 1px rgba(255, 255, 255, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.2),
            inset 0 2px 20px rgba(255, 255, 255, 0.05)
        `,
        animation: 'scaleIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)',
    };

    const headerStyle: CSSProperties = {
        padding: isMobile ? '20px 20px 16px' : '24px 24px 20px',
        borderBottom: `1px solid ${colors.glass.borderSubtle}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: `linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.06) 0%,
            transparent 100%
        )`,
    };

    const bodyStyle: CSSProperties = {
        flex: 1,
        overflow: 'auto',
        padding: isMobile ? 20 : 24,
        WebkitOverflowScrolling: 'touch'
    };

    const footerStyle: CSSProperties = {
        padding: isMobile ? '16px 20px' : '16px 24px',
        paddingBottom: isMobile ? 'calc(16px + env(safe-area-inset-bottom))' : 16,
        borderTop: `1px solid ${colors.glass.borderSubtle}`,
        display: 'flex',
        gap: 12,
        justifyContent: 'flex-end',
        background: `linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.2) 0%,
            transparent 100%
        )`,
    };

    return (
        <div style={modalStyle}>
            <div style={overlayStyle} onClick={onClose} />
            <div style={contentStyle} className="glass-scrollbar">
                {/* Header */}
                <div style={headerStyle}>
                    <h2 style={{
                        ...typography.heading,
                        fontSize: 18,
                        margin: 0,
                        color: colors.text.primary,
                    }}>
                        {title}
                    </h2>
                    <GlassButton
                        variant="subtle"
                        size="sm"
                        onClick={onClose}
                        style={{
                            width: 36,
                            height: 36,
                            padding: 0,
                            fontSize: 18,
                            borderRadius: radius.md,
                        }}
                    >
                        ×
                    </GlassButton>
                </div>

                {/* Body */}
                <div style={bodyStyle} className="glass-scrollbar">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div style={footerStyle}>
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
});

// Liquid Glass styled input
export const glassInputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    background: 'rgba(0, 0, 0, 0.3)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: `1px solid ${colors.glass.borderSubtle}`,
    borderRadius: radius.md,
    color: colors.text.primary,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: `all ${transitions.normal}`,
};

export const glassInputFocusStyle: CSSProperties = {
    borderColor: colors.accent.primary,
    boxShadow: `
        inset 0 2px 4px rgba(0, 0, 0, 0.2),
        0 0 0 3px rgba(96, 165, 250, 0.2)
    `,
};

export const glassLabelStyle: CSSProperties = {
    ...typography.label,
    display: 'block',
    color: colors.text.tertiary,
    marginBottom: 8
};

// Info box style
export const glassInfoBoxStyle: CSSProperties = {
    background: `linear-gradient(
        135deg,
        rgba(96, 165, 250, 0.15) 0%,
        rgba(96, 165, 250, 0.08) 100%
    )`,
    border: `1px solid rgba(96, 165, 250, 0.25)`,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 13,
    color: colors.text.secondary,
    lineHeight: 1.5
};

// Error box style
export const glassErrorBoxStyle: CSSProperties = {
    background: `linear-gradient(
        135deg,
        rgba(248, 113, 113, 0.15) 0%,
        rgba(248, 113, 113, 0.08) 100%
    )`,
    border: `1px solid rgba(248, 113, 113, 0.25)`,
    borderRadius: radius.md,
    padding: 14,
    fontSize: 13,
    color: '#fca5a5',
    lineHeight: 1.5,
    textAlign: 'center' as const,
};

export default GlassModal;
