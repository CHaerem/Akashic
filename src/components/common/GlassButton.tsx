import { memo, useState, type ReactNode, type CSSProperties, type ButtonHTMLAttributes } from 'react';
import { colors, radius, transitions } from '../../styles/liquidGlass';

export type GlassButtonVariant = 'default' | 'primary' | 'subtle' | 'ghost' | 'danger';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

interface GlassButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  children: ReactNode;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  style?: CSSProperties;
}

const sizeStyles: Record<GlassButtonSize, CSSProperties> = {
  sm: {
    padding: '8px 14px',
    fontSize: 12,
    minHeight: 36,
    borderRadius: radius.sm,
    gap: 6,
  },
  md: {
    padding: '12px 20px',
    fontSize: 13,
    minHeight: 44,
    borderRadius: radius.md,
    gap: 8,
  },
  lg: {
    padding: '16px 28px',
    fontSize: 14,
    minHeight: 52,
    borderRadius: radius.lg,
    gap: 10,
  },
};

const variantStyles: Record<GlassButtonVariant, { base: CSSProperties; hover: CSSProperties }> = {
  default: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.12) 0%,
        rgba(255, 255, 255, 0.06) 100%
      )`,
      backdropFilter: 'blur(8px) saturate(180%)',
      WebkitBackdropFilter: 'blur(8px) saturate(180%)',
      border: `1px solid ${colors.glass.border}`,
      boxShadow: `
        0 4px 16px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.15)
      `,
      color: colors.text.primary,
    },
    hover: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.18) 0%,
        rgba(255, 255, 255, 0.1) 100%
      )`,
      border: `1px solid ${colors.glass.highlight}`,
      boxShadow: `
        0 6px 20px rgba(0, 0, 0, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.2)
      `,
      transform: 'translateY(-1px)',
    },
  },
  primary: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(96, 165, 250, 0.25) 0%,
        rgba(96, 165, 250, 0.15) 100%
      )`,
      backdropFilter: 'blur(8px) saturate(180%)',
      WebkitBackdropFilter: 'blur(8px) saturate(180%)',
      border: `1px solid rgba(96, 165, 250, 0.4)`,
      boxShadow: `
        0 4px 16px rgba(96, 165, 250, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.2)
      `,
      color: '#93c5fd',
    },
    hover: {
      background: `linear-gradient(
        135deg,
        rgba(96, 165, 250, 0.35) 0%,
        rgba(96, 165, 250, 0.2) 100%
      )`,
      border: `1px solid rgba(96, 165, 250, 0.6)`,
      boxShadow: `
        0 6px 24px rgba(96, 165, 250, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.25)
      `,
      transform: 'translateY(-1px)',
    },
  },
  subtle: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.06) 0%,
        rgba(255, 255, 255, 0.03) 100%
      )`,
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      border: `1px solid ${colors.glass.borderSubtle}`,
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      color: colors.text.secondary,
    },
    hover: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.1) 0%,
        rgba(255, 255, 255, 0.05) 100%
      )`,
      border: `1px solid ${colors.glass.border}`,
      boxShadow: `
        0 4px 12px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.1)
      `,
      color: colors.text.primary,
    },
  },
  ghost: {
    base: {
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      border: '1px solid transparent',
      boxShadow: 'none',
      color: colors.text.tertiary,
    },
    hover: {
      background: 'rgba(255, 255, 255, 0.08)',
      border: `1px solid ${colors.glass.borderSubtle}`,
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
      color: colors.text.primary,
    },
  },
  danger: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(248, 113, 113, 0.2) 0%,
        rgba(248, 113, 113, 0.1) 100%
      )`,
      backdropFilter: 'blur(8px) saturate(180%)',
      WebkitBackdropFilter: 'blur(8px) saturate(180%)',
      border: `1px solid rgba(248, 113, 113, 0.3)`,
      boxShadow: `
        0 4px 16px rgba(248, 113, 113, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.15)
      `,
      color: '#fca5a5',
    },
    hover: {
      background: `linear-gradient(
        135deg,
        rgba(248, 113, 113, 0.3) 0%,
        rgba(248, 113, 113, 0.15) 100%
      )`,
      border: `1px solid rgba(248, 113, 113, 0.5)`,
      boxShadow: `
        0 6px 24px rgba(248, 113, 113, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.2)
      `,
      transform: 'translateY(-1px)',
    },
  },
};

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
  transform: 'none',
};

export const GlassButton = memo(function GlassButton({
  children,
  variant = 'default',
  size = 'md',
  fullWidth = false,
  icon,
  iconPosition = 'left',
  style,
  disabled,
  className = '',
  ...props
}: GlassButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  const buttonStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 500,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    transition: `all ${transitions.smooth}`,
    width: fullWidth ? '100%' : 'auto',
    ...sizeStyle,
    ...variantStyle.base,
    ...(isHovered && !disabled ? variantStyle.hover : {}),
    ...(disabled ? disabledStyle : {}),
    ...style,
  };

  return (
    <button
      className={className}
      style={buttonStyle}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...props}
    >
      {icon && iconPosition === 'left' && <span style={{ display: 'flex' }}>{icon}</span>}
      {children}
      {icon && iconPosition === 'right' && <span style={{ display: 'flex' }}>{icon}</span>}
    </button>
  );
});

export default GlassButton;
