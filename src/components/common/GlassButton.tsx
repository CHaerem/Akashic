/**
 * Glass Button - Liquid Glass Design System
 *
 * A touch-optimized button following Apple's Liquid Glass principles:
 * - Material illuminates from within on touch
 * - Glow spreads from the touch point
 * - Spring physics for natural feel
 * - Haptic feedback on mobile
 * - Minimum 44px touch target
 */

import { memo, useState, useCallback, useRef, type ReactNode, type CSSProperties, type ButtonHTMLAttributes } from 'react';
import { colors, radius, transitions } from '../../styles/liquidGlass';
import { triggerHaptic, liquidTransitions } from '../../hooks/useTouchFeedback';

export type GlassButtonVariant = 'default' | 'primary' | 'subtle' | 'ghost' | 'danger';
export type GlassButtonSize = 'sm' | 'md' | 'lg';

interface GlassButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'> {
  children?: ReactNode;
  variant?: GlassButtonVariant;
  size?: GlassButtonSize;
  fullWidth?: boolean;
  icon?: ReactNode;
  iconPosition?: 'left' | 'right';
  style?: CSSProperties;
  /** Disable haptic feedback */
  noHaptic?: boolean;
}

// Size configurations - all meet 44px minimum touch target
const sizeStyles: Record<GlassButtonSize, CSSProperties & { touchPadding: number }> = {
  sm: {
    padding: '10px 16px',
    fontSize: 12,
    minHeight: 44, // Increased from 36 for touch
    minWidth: 44,
    borderRadius: radius.md,
    gap: 6,
    touchPadding: 4,
  },
  md: {
    padding: '12px 20px',
    fontSize: 13,
    minHeight: 48,
    minWidth: 48,
    borderRadius: radius.md,
    gap: 8,
    touchPadding: 2,
  },
  lg: {
    padding: '16px 28px',
    fontSize: 14,
    minHeight: 52,
    minWidth: 52,
    borderRadius: radius.lg,
    gap: 10,
    touchPadding: 0,
  },
};

// Variant styles with base, hover, and pressed states
const variantStyles: Record<GlassButtonVariant, {
  base: CSSProperties;
  hover: CSSProperties;
  pressed: CSSProperties;
  glowColor: string;
}> = {
  default: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.12) 0%,
        rgba(255, 255, 255, 0.06) 100%
      )`,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
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
        0 8px 24px rgba(0, 0, 0, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.2),
        0 0 0 1px rgba(255, 255, 255, 0.1)
      `,
      transform: 'translateY(-1px)',
    },
    pressed: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.2) 0%,
        rgba(255, 255, 255, 0.12) 100%
      )`,
      boxShadow: `
        0 2px 8px rgba(0, 0, 0, 0.2),
        inset 0 0 20px rgba(255, 255, 255, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.25)
      `,
      transform: 'scale(0.97)',
    },
    glowColor: 'rgba(255, 255, 255, 0.4)',
  },
  primary: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(96, 165, 250, 0.25) 0%,
        rgba(96, 165, 250, 0.15) 100%
      )`,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
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
        0 8px 28px rgba(96, 165, 250, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.25),
        0 0 20px rgba(96, 165, 250, 0.2)
      `,
      transform: 'translateY(-1px)',
    },
    pressed: {
      background: `linear-gradient(
        135deg,
        rgba(96, 165, 250, 0.4) 0%,
        rgba(96, 165, 250, 0.25) 100%
      )`,
      boxShadow: `
        0 2px 8px rgba(96, 165, 250, 0.2),
        inset 0 0 25px rgba(96, 165, 250, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.3)
      `,
      transform: 'scale(0.97)',
    },
    glowColor: 'rgba(96, 165, 250, 0.5)',
  },
  subtle: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.06) 0%,
        rgba(255, 255, 255, 0.03) 100%
      )`,
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
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
        0 4px 16px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.1)
      `,
      color: colors.text.primary,
    },
    pressed: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.12) 0%,
        rgba(255, 255, 255, 0.06) 100%
      )`,
      boxShadow: `
        0 2px 6px rgba(0, 0, 0, 0.1),
        inset 0 0 15px rgba(255, 255, 255, 0.1)
      `,
      transform: 'scale(0.97)',
    },
    glowColor: 'rgba(255, 255, 255, 0.3)',
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
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      color: colors.text.primary,
    },
    pressed: {
      background: 'rgba(255, 255, 255, 0.12)',
      boxShadow: 'inset 0 0 12px rgba(255, 255, 255, 0.1)',
      transform: 'scale(0.97)',
    },
    glowColor: 'rgba(255, 255, 255, 0.25)',
  },
  danger: {
    base: {
      background: `linear-gradient(
        135deg,
        rgba(248, 113, 113, 0.2) 0%,
        rgba(248, 113, 113, 0.1) 100%
      )`,
      backdropFilter: 'blur(12px) saturate(180%)',
      WebkitBackdropFilter: 'blur(12px) saturate(180%)',
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
        0 8px 28px rgba(248, 113, 113, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.2),
        0 0 20px rgba(248, 113, 113, 0.15)
      `,
      transform: 'translateY(-1px)',
    },
    pressed: {
      background: `linear-gradient(
        135deg,
        rgba(248, 113, 113, 0.35) 0%,
        rgba(248, 113, 113, 0.2) 100%
      )`,
      boxShadow: `
        0 2px 8px rgba(248, 113, 113, 0.15),
        inset 0 0 25px rgba(248, 113, 113, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.25)
      `,
      transform: 'scale(0.97)',
    },
    glowColor: 'rgba(248, 113, 113, 0.5)',
  },
};

const disabledStyle: CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
  transform: 'none',
  pointerEvents: 'none',
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
  noHaptic = false,
  onClick,
  ...props
}: GlassButtonProps) {
  const [isPressed, setIsPressed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [pressPoint, setPressPoint] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  // Handle touch start - capture press point for glow origin
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;

    const touch = e.touches[0];
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const x = ((touch.clientX - rect.left) / rect.width) * 100;
      const y = ((touch.clientY - rect.top) / rect.height) * 100;
      setPressPoint({ x, y });
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }

    setIsPressed(true);
    if (!noHaptic) {
      triggerHaptic('light');
    }
  }, [disabled, noHaptic]);

  // Handle touch move - cancel if scrolling
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);

    // Cancel press if moved too far (user is scrolling)
    if (dx > 10 || dy > 10) {
      setIsPressed(false);
      setPressPoint(null);
    }
  }, []);

  // Handle touch end
  const handleTouchEnd = useCallback(() => {
    setIsPressed(false);
    setPressPoint(null);
    touchStartRef.current = null;
  }, []);

  // Handle mouse events for desktop
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;

    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setPressPoint({ x, y });
    }

    setIsPressed(true);
  }, [disabled]);

  const handleMouseUp = useCallback(() => {
    setIsPressed(false);
    setPressPoint(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
    setPressPoint(null);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!disabled) {
      setIsHovered(true);
    }
  }, [disabled]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    onClick?.(e);
  }, [disabled, onClick]);

  // Build the radial glow gradient for the press point
  const getGlowGradient = () => {
    if (!isPressed || !pressPoint) return '';
    const { glowColor } = variantStyle;
    return `radial-gradient(circle at ${pressPoint.x}% ${pressPoint.y}%, ${glowColor} 0%, transparent 60%)`;
  };

  // Determine current visual state
  const currentStyles = isPressed
    ? variantStyle.pressed
    : isHovered
    ? variantStyle.hover
    : variantStyle.base;

  const buttonStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 500,
    letterSpacing: '0.02em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    width: fullWidth ? '100%' : 'auto',
    overflow: 'hidden',
    // Smooth transitions
    transition: `
      transform ${liquidTransitions.fast},
      box-shadow ${liquidTransitions.normal},
      background ${liquidTransitions.normal},
      border-color ${liquidTransitions.normal}
    `,
    ...sizeStyle,
    ...variantStyle.base,
    ...currentStyles,
    ...(disabled ? disabledStyle : {}),
    ...style,
  };

  return (
    <button
      ref={buttonRef}
      className={className}
      style={buttonStyle}
      disabled={disabled}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onMouseEnter={handleMouseEnter}
      {...props}
    >
      {/* Liquid Glass glow overlay - illuminates from touch point */}
      {isPressed && pressPoint && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background: getGlowGradient(),
            pointerEvents: 'none',
            opacity: 0.8,
            transition: `opacity ${liquidTransitions.fast}`,
            borderRadius: 'inherit',
          }}
        />
      )}

      {/* Content */}
      {icon && iconPosition === 'left' && (
        <span style={{ display: 'flex', position: 'relative', zIndex: 1 }}>{icon}</span>
      )}
      {children && (
        <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
      )}
      {icon && iconPosition === 'right' && (
        <span style={{ display: 'flex', position: 'relative', zIndex: 1 }}>{icon}</span>
      )}
    </button>
  );
});

export default GlassButton;
