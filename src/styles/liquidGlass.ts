/**
 * Liquid Glass Design System
 *
 * Inspired by Apple's iOS 26 Liquid Glass design language.
 * A translucent material that reflects and refracts its surroundings,
 * dynamically transforming to bring greater focus to content.
 */

import type { CSSProperties } from 'react';

// ============================================================================
// COLOR PALETTE
// ============================================================================

export const colors = {
  // Background layers
  background: {
    deep: '#050508',
    base: '#0a0a0f',
    elevated: '#12121a',
  },

  // Glass tints
  glass: {
    light: 'rgba(255, 255, 255, 0.12)',
    medium: 'rgba(255, 255, 255, 0.08)',
    subtle: 'rgba(255, 255, 255, 0.04)',
    border: 'rgba(255, 255, 255, 0.15)',
    borderSubtle: 'rgba(255, 255, 255, 0.08)',
    highlight: 'rgba(255, 255, 255, 0.25)',
  },

  // Text hierarchy
  text: {
    primary: 'rgba(255, 255, 255, 0.95)',
    secondary: 'rgba(255, 255, 255, 0.7)',
    tertiary: 'rgba(255, 255, 255, 0.5)',
    subtle: 'rgba(255, 255, 255, 0.35)',
    disabled: 'rgba(255, 255, 255, 0.2)',
  },

  // Accent colors (adjusted for Liquid Glass harmony)
  accent: {
    primary: '#60a5fa',      // Blue - softer for glass
    secondary: '#34d399',    // Green
    warning: '#fbbf24',      // Amber
    error: '#f87171',        // Red
    info: '#a78bfa',         // Purple
  },

  // Glow colors
  glow: {
    blue: 'rgba(96, 165, 250, 0.3)',
    white: 'rgba(255, 255, 255, 0.1)',
    subtle: 'rgba(255, 255, 255, 0.05)',
  }
} as const;

// ============================================================================
// GRADIENTS
// ============================================================================

export const gradients = {
  // Glass card backgrounds - most commonly used
  glass: {
    /** Standard glass card - 8% to 3% opacity */
    card: 'linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
    /** Subtle glass panel - 6% to 2% opacity */
    subtle: 'linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%)',
    /** Button/interactive - 12% to 6% opacity */
    button: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%)',
    /** Button hover state - 15% to 8% opacity */
    buttonHover: 'linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.08) 100%)',
    /** Primary button - 20% to 12% opacity */
    buttonPrimary: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.12) 100%)',
    /** Elevated panel - vertical, 12% to 4% opacity */
    panel: 'linear-gradient(180deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 30%, rgba(255, 255, 255, 0.04) 100%)',
  },

  // Overlay gradients for content over images/backgrounds
  overlay: {
    /** Top fade - for top bars over content */
    top: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, transparent 100%)',
    /** Bottom fade - for captions/info over images */
    bottom: 'linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, transparent 100%)',
    /** Subtle bottom fade - for metadata on thumbnails */
    bottomSubtle: 'linear-gradient(transparent, rgba(0, 0, 0, 0.7))',
  },

  // Elevation fill gradients (using color tokens)
  fill: {
    /** Area chart fill - light glass to transparent */
    area: `linear-gradient(to bottom, ${colors.glass.light} 0%, rgba(255, 255, 255, 0) 100%)`,
  },
} as const;

// ============================================================================
// BLUR & EFFECTS
// ============================================================================

export const effects = {
  blur: {
    none: 'blur(0px)',
    subtle: 'blur(8px)',
    medium: 'blur(16px)',
    strong: 'blur(24px)',
    intense: 'blur(40px)',
  },

  saturation: {
    normal: 'saturate(100%)',
    enhanced: 'saturate(180%)',
    vivid: 'saturate(200%)',
  },

  brightness: {
    normal: 'brightness(100%)',
    lifted: 'brightness(110%)',
    bright: 'brightness(120%)',
  }
} as const;

// ============================================================================
// SHADOWS
// ============================================================================

export const shadows = {
  // Outer shadows (depth)
  glow: {
    subtle: '0 0 20px rgba(255, 255, 255, 0.03)',
    medium: '0 0 40px rgba(255, 255, 255, 0.05)',
    strong: '0 0 60px rgba(255, 255, 255, 0.08)',
  },

  drop: {
    sm: '0 4px 12px rgba(0, 0, 0, 0.3)',
    md: '0 8px 24px rgba(0, 0, 0, 0.4)',
    lg: '0 16px 48px rgba(0, 0, 0, 0.5)',
    xl: '0 24px 64px rgba(0, 0, 0, 0.6)',
  },

  // Inner shadows (glass depth)
  inset: {
    subtle: 'inset 0 1px 1px rgba(255, 255, 255, 0.1)',
    medium: 'inset 0 2px 4px rgba(255, 255, 255, 0.15)',
    highlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.2)',
    depth: 'inset 0 -1px 0 rgba(0, 0, 0, 0.1)',
  },

  // Combined glass shadows
  glass: {
    card: `
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.15),
      inset 0 -1px 0 rgba(0, 0, 0, 0.1)
    `,
    elevated: `
      0 16px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.2),
      inset 0 -1px 0 rgba(0, 0, 0, 0.15)
    `,
    button: `
      0 4px 16px rgba(0, 0, 0, 0.25),
      0 0 0 1px rgba(255, 255, 255, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.2)
    `,
    buttonHover: `
      0 6px 20px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.25)
    `,
    panel: `
      0 -8px 40px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.06),
      inset 0 1px 0 rgba(255, 255, 255, 0.1)
    `,
  }
} as const;

// ============================================================================
// BORDER RADIUS
// ============================================================================

export const radius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 9999,
} as const;

// ============================================================================
// TRANSITIONS
// ============================================================================

export const transitions = {
  fast: '0.15s ease-out',
  normal: '0.25s ease-out',
  smooth: '0.35s cubic-bezier(0.32, 0.72, 0, 1)',
  spring: '0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
  glass: '0.4s cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

// ============================================================================
// GLASS STYLE PRESETS
// ============================================================================

/**
 * Base glass material - subtle frosted effect
 */
export const glassBase: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.1) 0%,
    rgba(255, 255, 255, 0.05) 50%,
    rgba(255, 255, 255, 0.08) 100%
  )`,
  backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
  WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
  border: `1px solid ${colors.glass.border}`,
  boxShadow: shadows.glass.card,
};

/**
 * Elevated glass panel - for main panels and modals
 */
export const glassPanel: CSSProperties = {
  background: `linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.06) 30%,
    rgba(255, 255, 255, 0.04) 100%
  )`,
  backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
  WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
  border: `1px solid ${colors.glass.border}`,
  boxShadow: shadows.glass.elevated,
};

/**
 * Subtle glass card - for stat cards and info blocks
 */
export const glassCard: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.08) 0%,
    rgba(255, 255, 255, 0.04) 100%
  )`,
  backdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
  WebkitBackdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
  border: `1px solid ${colors.glass.borderSubtle}`,
  boxShadow: `
    0 4px 16px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1)
  `,
};

/**
 * Glass button - interactive element
 */
export const glassButton: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(255, 255, 255, 0.08) 100%
  )`,
  backdropFilter: `${effects.blur.subtle} ${effects.saturation.enhanced}`,
  WebkitBackdropFilter: `${effects.blur.subtle} ${effects.saturation.enhanced}`,
  border: `1px solid ${colors.glass.border}`,
  boxShadow: shadows.glass.button,
  transition: `all ${transitions.smooth}`,
};

/**
 * Glass button hover state
 */
export const glassButtonHover: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.2) 0%,
    rgba(255, 255, 255, 0.12) 100%
  )`,
  border: `1px solid ${colors.glass.highlight}`,
  boxShadow: shadows.glass.buttonHover,
  transform: 'translateY(-1px)',
};

/**
 * Glass input field
 */
export const glassInput: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.3)',
  backdropFilter: `${effects.blur.subtle}`,
  WebkitBackdropFilter: `${effects.blur.subtle}`,
  border: `1px solid ${colors.glass.borderSubtle}`,
  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.2)',
  transition: `all ${transitions.normal}`,
};

/**
 * Glass input focus state
 */
export const glassInputFocus: CSSProperties = {
  border: `1px solid ${colors.accent.primary}`,
  boxShadow: `
    inset 0 2px 4px rgba(0, 0, 0, 0.2),
    0 0 0 3px rgba(96, 165, 250, 0.2)
  `,
};

/**
 * Floating glass element (for tooltips, dropdowns)
 */
export const glassFloating: CSSProperties = {
  background: `linear-gradient(
    135deg,
    rgba(30, 30, 40, 0.95) 0%,
    rgba(20, 20, 30, 0.9) 100%
  )`,
  backdropFilter: `${effects.blur.intense} ${effects.saturation.vivid}`,
  WebkitBackdropFilter: `${effects.blur.intense} ${effects.saturation.vivid}`,
  border: `1px solid ${colors.glass.border}`,
  boxShadow: shadows.glass.elevated,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a glass gradient with custom colors
 */
export function createGlassGradient(
  startOpacity: number = 0.1,
  endOpacity: number = 0.05,
  angle: number = 135
): string {
  return `linear-gradient(
    ${angle}deg,
    rgba(255, 255, 255, ${startOpacity}) 0%,
    rgba(255, 255, 255, ${endOpacity}) 100%
  )`;
}

/**
 * Create backdrop filter string
 */
export function createBackdropFilter(
  blurPx: number = 24,
  saturatePercent: number = 180
): string {
  return `blur(${blurPx}px) saturate(${saturatePercent}%)`;
}

/**
 * Merge glass styles with custom overrides
 */
export function mergeGlassStyles(
  baseStyle: CSSProperties,
  overrides: CSSProperties
): CSSProperties {
  return { ...baseStyle, ...overrides };
}

// ============================================================================
// TAB BAR STYLES (iOS-style shrinking tabs)
// ============================================================================

export const tabBar = {
  container: {
    background: `linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.04) 100%
    )`,
    backdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.medium} ${effects.saturation.enhanced}`,
    borderBottom: `1px solid ${colors.glass.borderSubtle}`,
  } as CSSProperties,

  tab: {
    inactive: {
      background: 'transparent',
      color: colors.text.tertiary,
      border: 'none',
      transition: `all ${transitions.smooth}`,
    } as CSSProperties,

    active: {
      background: `linear-gradient(
        135deg,
        rgba(255, 255, 255, 0.12) 0%,
        rgba(255, 255, 255, 0.06) 100%
      )`,
      color: colors.text.primary,
      border: 'none',
      boxShadow: `
        0 2px 8px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.15)
      `,
    } as CSSProperties,
  },
};

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const typography = {
  // Brand text - for "Akashic" title
  brand: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 500,
    fontSize: 11,
    letterSpacing: '0.25em',
    textTransform: 'uppercase' as const,
    color: colors.text.tertiary,
  } as CSSProperties,

  // Display text - for large headings
  display: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: colors.text.primary,
  } as CSSProperties,

  // Heading text
  heading: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 500,
    letterSpacing: '-0.01em',
    color: colors.text.primary,
  } as CSSProperties,

  // Body text
  body: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 400,
    letterSpacing: '0',
    color: colors.text.secondary,
  } as CSSProperties,

  // Label text - uppercase small
  label: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 500,
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: colors.text.tertiary,
  } as CSSProperties,

  // Caption text
  caption: {
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif",
    fontWeight: 400,
    fontSize: 12,
    color: colors.text.subtle,
  } as CSSProperties,
};

export default {
  colors,
  gradients,
  effects,
  shadows,
  radius,
  transitions,
  glassBase,
  glassPanel,
  glassCard,
  glassButton,
  glassButtonHover,
  glassInput,
  glassInputFocus,
  glassFloating,
  tabBar,
  typography,
  createGlassGradient,
  createBackdropFilter,
  mergeGlassStyles,
};
