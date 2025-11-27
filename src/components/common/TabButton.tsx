/**
 * Tab Button - Liquid Glass Design System
 *
 * Touch-optimized tab button with:
 * - Minimum 44px touch target
 * - Haptic feedback on press
 * - Illuminating press state
 * - Smooth spring animations
 */

import { memo, useCallback, useState, useRef } from 'react';
import type { TabType } from '../../types/trek';
import { colors, radius, transitions } from '../../styles/liquidGlass';
import { triggerHaptic, liquidTransitions } from '../../hooks/useTouchFeedback';

interface TabButtonProps {
  tab: string;
  activeTab: TabType;
  onClick: (tab: TabType) => void;
  isMobile?: boolean;
}

export const TabButton = memo(function TabButton({
  tab,
  activeTab,
  onClick,
  isMobile = false
}: TabButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const isActive = activeTab === tab;

  const handleClick = useCallback(() => {
    if (!isActive) {
      triggerHaptic('selection');
    }
    onClick(tab as TabType);
  }, [onClick, tab, isActive]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setIsPressed(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);

    // Cancel press if moved too far
    if (dx > 10 || dy > 10) {
      setIsPressed(false);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsPressed(false);
    touchStartRef.current = null;
  }, []);

  // Liquid Glass pill-style tabs
  const baseStyle: React.CSSProperties = {
    background: isActive
      ? `linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.15) 0%,
          rgba(255, 255, 255, 0.08) 100%
        )`
      : 'transparent',
    backdropFilter: isActive ? 'blur(8px) saturate(180%)' : 'none',
    WebkitBackdropFilter: isActive ? 'blur(8px) saturate(180%)' : 'none',
    border: isActive
      ? `1px solid ${colors.glass.border}`
      : '1px solid transparent',
    boxShadow: isActive
      ? `
          0 2px 8px rgba(0, 0, 0, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.15)
        `
      : 'none',
    color: isActive ? colors.text.primary : colors.text.tertiary,
    fontSize: isMobile ? 12 : 11,
    fontWeight: isActive ? 500 : 400,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    padding: isMobile ? '10px 16px' : '10px 14px',
    cursor: 'pointer',
    borderRadius: radius.lg,
    flex: isMobile ? 1 : 'none',
    minHeight: 44, // Always 44px for touch
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: `all ${liquidTransitions.smooth}`,
    position: 'relative' as const,
    overflow: 'hidden',
    // Touch optimizations
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  // Hover state enhancement
  const hoverStyle: React.CSSProperties = !isActive && isHovered ? {
    background: 'rgba(255, 255, 255, 0.06)',
    color: colors.text.secondary,
    border: `1px solid ${colors.glass.borderSubtle}`,
  } : {};

  // Press state - Liquid Glass illumination
  const pressStyle: React.CSSProperties = isPressed ? {
    transform: 'scale(0.97)',
    background: isActive
      ? `linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.2) 0%,
          rgba(255, 255, 255, 0.12) 100%
        )`
      : 'rgba(255, 255, 255, 0.1)',
    boxShadow: `
      0 1px 4px rgba(0, 0, 0, 0.1),
      inset 0 0 15px rgba(255, 255, 255, 0.15)
    `,
    transition: `all ${liquidTransitions.fast}`,
  } : {};

  return (
    <button
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
      style={{ ...baseStyle, ...hoverStyle, ...pressStyle }}
    >
      {tab}
    </button>
  );
});

export default TabButton;
