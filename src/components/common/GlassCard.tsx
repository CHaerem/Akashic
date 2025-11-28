/**
 * Glass Card - Liquid Glass Design System
 *
 * A versatile card component with:
 * - Multiple visual variants
 * - Touch-optimized interactive states
 * - Smooth hover and press animations
 * - Haptic feedback for interactive cards
 */

import { memo, useState, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import { glassCard, colors, radius, transitions } from '../../styles/liquidGlass';
import { triggerHaptic, liquidTransitions, SCROLL_CANCEL_THRESHOLD } from '../../hooks/useTouchFeedback';

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
  /** Disable haptic feedback */
  noHaptic?: boolean;
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
    transition: `all ${liquidTransitions.smooth}`,
  },
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
  noHaptic = false,
}: GlassCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const baseStyle = variantStyles[variant];
  const isInteractive = variant === 'interactive' || hoverable || onClick;

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isInteractive) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsPressed(true);
  }, [isInteractive]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);

    if (dx > SCROLL_CANCEL_THRESHOLD || dy > SCROLL_CANCEL_THRESHOLD) {
      setIsPressed(false);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsPressed(false);
    touchStartRef.current = null;
  }, []);

  const handleClick = useCallback(() => {
    if (onClick) {
      if (!noHaptic) {
        triggerHaptic('light');
      }
      onClick();
    }
  }, [onClick, noHaptic]);

  // Hover styles
  const hoverStyles: CSSProperties = isHovered && isInteractive ? {
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
  } : {};

  // Press styles - Liquid Glass illumination
  const pressStyles: CSSProperties = isPressed && isInteractive ? {
    transform: 'scale(0.98)',
    boxShadow: `
      0 4px 12px rgba(0, 0, 0, 0.2),
      inset 0 0 20px rgba(255, 255, 255, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.2)
    `,
    transition: `all ${liquidTransitions.fast}`,
  } : {};

  const combinedStyle: CSSProperties = {
    ...baseStyle,
    padding,
    ...(borderRadius !== undefined && { borderRadius }),
    ...(isInteractive && {
      cursor: 'pointer',
      transition: `all ${liquidTransitions.smooth}`,
      WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    }),
    ...hoverStyles,
    ...pressStyles,
    ...style,
  };

  if (isInteractive) {
    return (
      <div
        className={`glass-card-interactive ${className}`}
        style={combinedStyle}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setIsPressed(false);
        }}
        onMouseDown={() => setIsPressed(true)}
        onMouseUp={() => setIsPressed(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        } : undefined}
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
