import { memo, type ReactNode, type CSSProperties } from 'react';
import { glassCard, colors, radius, transitions } from '../../styles/liquidGlass';

export type GlassCardVariant = 'default' | 'subtle' | 'elevated' | 'interactive';

interface GlassCardProps {
  children: ReactNode;
  variant?: GlassCardVariant;
  padding?: number | string;
  borderRadius?: number;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  hoverable?: boolean;
}

const variantStyles: Record<GlassCardVariant, CSSProperties> = {
  default: {
    ...glassCard,
    borderRadius: radius.md,
  },
  subtle: {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.05) 0%,
      rgba(255, 255, 255, 0.02) 100%
    )`,
    backdropFilter: 'blur(12px) saturate(150%)',
    WebkitBackdropFilter: 'blur(12px) saturate(150%)',
    border: `1px solid ${colors.glass.borderSubtle}`,
    boxShadow: `
      0 2px 8px rgba(0, 0, 0, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.06)
    `,
    borderRadius: radius.md,
  },
  elevated: {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.12) 0%,
      rgba(255, 255, 255, 0.06) 50%,
      rgba(255, 255, 255, 0.08) 100%
    )`,
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: `1px solid ${colors.glass.border}`,
    boxShadow: `
      0 12px 40px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1)
    `,
    borderRadius: radius.lg,
  },
  interactive: {
    ...glassCard,
    borderRadius: radius.md,
    cursor: 'pointer',
    transition: `all ${transitions.smooth}`,
  },
};

const hoverStyles: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.06) 100%
  )`,
  border: `1px solid ${colors.glass.border}`,
  boxShadow: `
    0 8px 24px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.15)
  `,
  transform: 'translateY(-2px)',
};

export const GlassCard = memo(function GlassCard({
  children,
  variant = 'default',
  padding = 16,
  borderRadius,
  className = '',
  style,
  onClick,
  hoverable = false,
}: GlassCardProps) {
  const baseStyle = variantStyles[variant];
  const isInteractive = variant === 'interactive' || hoverable || onClick;

  const combinedStyle: CSSProperties = {
    ...baseStyle,
    padding,
    ...(borderRadius !== undefined && { borderRadius }),
    ...style,
  };

  if (isInteractive) {
    return (
      <div
        className={`glass-card-interactive ${className}`}
        style={combinedStyle}
        onClick={onClick}
        onMouseEnter={(e) => {
          Object.assign(e.currentTarget.style, hoverStyles);
        }}
        onMouseLeave={(e) => {
          Object.assign(e.currentTarget.style, {
            background: baseStyle.background,
            border: baseStyle.border,
            boxShadow: baseStyle.boxShadow,
            transform: 'translateY(0)',
          });
        }}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={className} style={combinedStyle}>
      {children}
    </div>
  );
});

export default GlassCard;
