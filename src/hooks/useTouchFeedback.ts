/**
 * Touch Feedback Hook - Liquid Glass Design System
 *
 * Provides haptic feedback, visual press states, and smooth touch interactions
 * following Apple's Liquid Glass principles:
 * - Material illuminates from within as feedback
 * - Glow spreads from fingertip
 * - Gel-like flexibility with spring physics
 * - Instant responsiveness
 */

import { useState, useCallback, useRef, type CSSProperties } from 'react';

// ============================================================================
// TOUCH THRESHOLD CONSTANTS
// ============================================================================

/** Distance (px) user must move before press is cancelled (indicates scrolling) */
export const SCROLL_CANCEL_THRESHOLD = 10;

/** Minimum movement (px) to detect gesture direction */
export const MIN_MOVEMENT_THRESHOLD = 5;

/** Direction detection threshold - movement in primary direction must exceed this ratio */
export const DIRECTION_RATIO_THRESHOLD = 10;

// ============================================================================
// HAPTIC FEEDBACK
// ============================================================================

type HapticIntensity = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';

const hapticPatterns: Record<HapticIntensity, number[]> = {
  light: [10],
  medium: [20],
  heavy: [30],
  selection: [5],
  success: [10, 50, 10],
  warning: [20, 50, 20],
  error: [30, 50, 30, 50, 30],
};

/**
 * Trigger haptic feedback if supported
 */
export function triggerHaptic(intensity: HapticIntensity = 'light'): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(hapticPatterns[intensity]);
    } catch {
      // Haptic not supported or blocked
    }
  }
}

// ============================================================================
// TOUCH PRESS STATE HOOK
// ============================================================================

interface UseTouchPressOptions {
  /** Enable haptic feedback on press */
  haptic?: boolean;
  /** Haptic intensity */
  hapticIntensity?: HapticIntensity;
  /** Delay before press state activates (ms) - helps distinguish scroll from tap */
  pressDelay?: number;
  /** Whether the element is disabled */
  disabled?: boolean;
  /** Callback when press starts */
  onPressStart?: () => void;
  /** Callback when press ends */
  onPressEnd?: () => void;
}

interface TouchPressState {
  isPressed: boolean;
  isHovered: boolean;
  pressPoint: { x: number; y: number } | null;
}

interface TouchPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onMouseEnter: () => void;
}

export function useTouchPress(options: UseTouchPressOptions = {}): [TouchPressState, TouchPressHandlers] {
  const {
    haptic = true,
    hapticIntensity = 'light',
    pressDelay = 0,
    disabled = false,
    onPressStart,
    onPressEnd,
  } = options;

  const [state, setState] = useState<TouchPressState>({
    isPressed: false,
    isHovered: false,
    pressPoint: null,
  });

  const pressTimeoutRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const isPressedRef = useRef(false);

  const clearPressTimeout = useCallback(() => {
    if (pressTimeoutRef.current) {
      clearTimeout(pressTimeoutRef.current);
      pressTimeoutRef.current = null;
    }
  }, []);

  const startPress = useCallback((x: number, y: number) => {
    if (disabled) return;

    isPressedRef.current = true;
    setState(prev => ({
      ...prev,
      isPressed: true,
      pressPoint: { x, y },
    }));

    if (haptic) {
      triggerHaptic(hapticIntensity);
    }

    onPressStart?.();
  }, [disabled, haptic, hapticIntensity, onPressStart]);

  const endPress = useCallback(() => {
    clearPressTimeout();
    isPressedRef.current = false;
    setState(prev => ({
      ...prev,
      isPressed: false,
      pressPoint: null,
    }));
    onPressEnd?.();
  }, [clearPressTimeout, onPressEnd]);

  const handlers: TouchPressHandlers = {
    onTouchStart: useCallback((e: React.TouchEvent) => {
      if (disabled) return;

      const touch = e.touches[0];
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;

      touchStartRef.current = { x: touch.clientX, y: touch.clientY };

      if (pressDelay > 0) {
        pressTimeoutRef.current = window.setTimeout(() => {
          startPress(x, y);
        }, pressDelay);
      } else {
        startPress(x, y);
      }
    }, [disabled, pressDelay, startPress]),

    onTouchMove: useCallback((e: React.TouchEvent) => {
      if (!touchStartRef.current || !isPressedRef.current) return;

      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartRef.current.x);
      const dy = Math.abs(touch.clientY - touchStartRef.current.y);

      // Cancel press if moved too far (indicates scrolling)
      if (dx > SCROLL_CANCEL_THRESHOLD || dy > SCROLL_CANCEL_THRESHOLD) {
        endPress();
      }
    }, [endPress]),

    onTouchEnd: endPress,
    onTouchCancel: endPress,

    onMouseDown: useCallback((e: React.MouseEvent) => {
      if (disabled) return;

      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      startPress(x, y);
    }, [disabled, startPress]),

    onMouseUp: endPress,

    onMouseLeave: useCallback(() => {
      endPress();
      setState(prev => ({ ...prev, isHovered: false }));
    }, [endPress]),

    onMouseEnter: useCallback(() => {
      if (!disabled) {
        setState(prev => ({ ...prev, isHovered: true }));
      }
    }, [disabled]),
  };

  return [state, handlers];
}

// ============================================================================
// LIQUID GLASS PRESS STYLES
// ============================================================================

interface GlassPressStyleOptions {
  /** Base glow color */
  glowColor?: string;
  /** Press scale (0.95 - 1.0) */
  pressScale?: number;
  /** Whether element should lift on hover */
  liftOnHover?: boolean;
  /** Intensity of the glow effect */
  glowIntensity?: 'subtle' | 'medium' | 'strong';
}

const glowIntensities = {
  subtle: { spread: 15, opacity: 0.15 },
  medium: { spread: 25, opacity: 0.25 },
  strong: { spread: 40, opacity: 0.35 },
};

/**
 * Generate Liquid Glass press styles based on touch state
 */
export function getGlassPressStyles(
  state: TouchPressState,
  options: GlassPressStyleOptions = {}
): CSSProperties {
  const {
    glowColor = 'rgba(255, 255, 255, 0.5)',
    pressScale = 0.97,
    liftOnHover = true,
    glowIntensity = 'medium',
  } = options;

  const intensity = glowIntensities[glowIntensity];

  if (state.isPressed && state.pressPoint) {
    // Pressed state - scale down, glow from press point
    return {
      transform: `scale(${pressScale})`,
      boxShadow: `
        0 2px 8px rgba(0, 0, 0, 0.3),
        inset 0 0 ${intensity.spread}px ${glowColor.replace('0.5', String(intensity.opacity))},
        0 0 0 1px rgba(255, 255, 255, 0.1)
      `,
      transition: 'transform 0.1s cubic-bezier(0.2, 0, 0.2, 1), box-shadow 0.1s ease-out',
    };
  }

  if (state.isHovered && liftOnHover) {
    // Hover state - lift up slightly
    return {
      transform: 'translateY(-1px) scale(1.01)',
      boxShadow: `
        0 8px 24px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.25),
        0 0 0 1px rgba(255, 255, 255, 0.15)
      `,
      transition: 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.25s ease-out',
    };
  }

  // Default state
  return {
    transform: 'translateY(0) scale(1)',
    transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.35s ease-out',
  };
}

// ============================================================================
// SPRING PHYSICS ANIMATION
// ============================================================================

interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

export const springPresets: Record<string, SpringConfig> = {
  // Snappy, responsive - good for buttons
  snappy: { stiffness: 400, damping: 30, mass: 1 },
  // Smooth, gentle - good for panels
  gentle: { stiffness: 200, damping: 20, mass: 1 },
  // Bouncy - good for success states
  bouncy: { stiffness: 300, damping: 10, mass: 1 },
  // Stiff - good for precise interactions
  stiff: { stiffness: 500, damping: 40, mass: 1 },
};

/**
 * Convert spring config to CSS cubic-bezier approximation
 */
export function springToCubicBezier(config: SpringConfig): string {
  const { stiffness, damping, mass } = config;

  // Simplified approximation - for true spring physics, use a JS animation library
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  if (zeta < 1) {
    // Under-damped (bouncy)
    return `cubic-bezier(0.34, 1.56, 0.64, 1)`;
  } else if (zeta === 1) {
    // Critically damped
    return `cubic-bezier(0.32, 0.72, 0, 1)`;
  } else {
    // Over-damped
    return `cubic-bezier(0.4, 0, 0.2, 1)`;
  }
}

/**
 * Get spring animation duration based on config
 */
export function getSpringDuration(config: SpringConfig): number {
  const { stiffness, damping, mass } = config;
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // Approximate settling time
  if (zeta < 1) {
    return Math.min(800, Math.max(200, 4000 / (zeta * omega)));
  }
  return Math.min(600, Math.max(150, 3000 / omega));
}

// ============================================================================
// VELOCITY TRACKING
// ============================================================================

interface VelocityState {
  x: number;
  y: number;
  timestamp: number;
}

export class VelocityTracker {
  private history: VelocityState[] = [];
  private maxHistory = 5;

  addPoint(x: number, y: number): void {
    const now = performance.now();
    this.history.push({ x, y, timestamp: now });

    // Keep only recent points
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getVelocity(): { vx: number; vy: number } {
    if (this.history.length < 2) {
      return { vx: 0, vy: 0 };
    }

    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const dt = (last.timestamp - first.timestamp) / 1000; // Convert to seconds

    if (dt === 0) {
      return { vx: 0, vy: 0 };
    }

    return {
      vx: (last.x - first.x) / dt,
      vy: (last.y - first.y) / dt,
    };
  }

  reset(): void {
    this.history = [];
  }
}

// ============================================================================
// GESTURE UTILITIES
// ============================================================================

/**
 * Determine if a touch movement is primarily horizontal or vertical
 */
export function getSwipeDirection(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): 'horizontal' | 'vertical' | 'none' {
  const dx = Math.abs(endX - startX);
  const dy = Math.abs(endY - startY);

  const threshold = 10;

  if (dx < threshold && dy < threshold) {
    return 'none';
  }

  return dx > dy ? 'horizontal' : 'vertical';
}

/**
 * Calculate rubber band effect for over-scroll
 *
 * @param offset - The current drag offset in pixels
 * @param limit - Maximum offset before rubber banding begins
 * @param elasticity - Resistance factor (0-1). Values closer to 0 produce stiffer
 *                     resistance, values closer to 1 produce more elastic behavior.
 *                     Default: 0.55 (balanced feel)
 * @returns The adjusted offset with rubber band resistance applied
 */
export function rubberBand(
  offset: number,
  limit: number,
  elasticity: number = 0.55
): number {
  if (offset < 0) {
    return -rubberBand(-offset, limit, elasticity);
  }

  if (offset > limit) {
    const overflow = offset - limit;
    const resistance = Math.pow(overflow, elasticity);
    return limit + resistance;
  }

  return offset;
}

// ============================================================================
// CSS TRANSITION PRESETS FOR LIQUID GLASS
// ============================================================================

export const liquidTransitions = {
  /** Ultra-fast feedback - 100ms */
  instant: '0.1s cubic-bezier(0.2, 0, 0.2, 1)',
  /** Fast response - 150ms */
  fast: '0.15s cubic-bezier(0.25, 0.1, 0.25, 1)',
  /** Standard interaction - 250ms */
  normal: '0.25s cubic-bezier(0.32, 0.72, 0, 1)',
  /** Smooth, deliberate - 350ms */
  smooth: '0.35s cubic-bezier(0.32, 0.72, 0, 1)',
  /** Spring bounce - 400ms */
  spring: '0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
  /** Glass material feel - 450ms */
  glass: '0.45s cubic-bezier(0.32, 0.72, 0, 1)',
  /** Gentle settle - 500ms */
  settle: '0.5s cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export default {
  triggerHaptic,
  useTouchPress,
  getGlassPressStyles,
  springPresets,
  springToCubicBezier,
  getSpringDuration,
  VelocityTracker,
  getSwipeDirection,
  rubberBand,
  liquidTransitions,
};
