/**
 * Enhanced Swipe Gesture Hook - Liquid Glass Design System
 *
 * Physics-based swipe detection with velocity tracking for smooth,
 * responsive bottom sheets and panels following Liquid Glass principles.
 */

import { useRef, useCallback, useState } from 'react';
import {
  VelocityTracker,
  triggerHaptic,
  rubberBand,
  SCROLL_CANCEL_THRESHOLD,
  MIN_MOVEMENT_THRESHOLD,
} from './useTouchFeedback';

// ============================================================================
// TYPES
// ============================================================================

interface SwipeGestureOptions {
  /** Callback when swiping up */
  onSwipeUp?: () => void;
  /** Callback when swiping down */
  onSwipeDown?: () => void;
  /** Minimum distance to trigger swipe (px) */
  threshold?: number;
  /** Velocity threshold to trigger swipe regardless of distance (px/s) */
  velocityThreshold?: number;
  /** Enable haptic feedback on swipe triggers */
  haptic?: boolean;
  /** Callback with current drag offset during gesture */
  onDragUpdate?: (offset: number, velocity: number) => void;
  /** Callback when drag starts (for performance optimization) */
  onDragStart?: () => void;
  /** Callback when drag ends (with final velocity) */
  onDragEnd?: (velocity: number) => void;
}

interface SwipeHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
}

interface SwipeState {
  isDragging: boolean;
  dragOffset: number;
  velocity: number;
}

// ============================================================================
// SIMPLE HOOK (Original API, enhanced)
// ============================================================================

export function useSwipeGesture({
  onSwipeUp,
  onSwipeDown,
  threshold = 50,
  velocityThreshold = 300,
  haptic = true,
  onDragStart,
  onDragEnd,
}: SwipeGestureOptions): SwipeHandlers {
  const startY = useRef<number>(0);
  const startX = useRef<number>(0);
  const currentY = useRef<number>(0);
  const velocityTracker = useRef(new VelocityTracker());
  const isTracking = useRef(false);
  const hasFiredDragStart = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startY.current = touch.clientY;
    startX.current = touch.clientX;
    currentY.current = touch.clientY;
    velocityTracker.current.reset();
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);
    isTracking.current = true;
    hasFiredDragStart.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTracking.current) return;

    const touch = e.touches[0];
    currentY.current = touch.clientY;
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);

    // Check if this is primarily a horizontal scroll - if so, stop tracking
    const dx = Math.abs(touch.clientX - startX.current);
    const dy = Math.abs(touch.clientY - startY.current);

    if (dx > dy && dx > SCROLL_CANCEL_THRESHOLD) {
      isTracking.current = false;
      return;
    }

    // Fire dragStart once we detect vertical movement
    if (!hasFiredDragStart.current && dy > MIN_MOVEMENT_THRESHOLD) {
      hasFiredDragStart.current = true;
      onDragStart?.();
    }
  }, [onDragStart]);

  const onTouchEnd = useCallback(() => {
    const wasTracking = isTracking.current;
    const wasDragging = hasFiredDragStart.current;

    if (!wasTracking) {
      isTracking.current = false;
      return;
    }

    const diff = startY.current - currentY.current;
    const { vy } = velocityTracker.current.getVelocity();

    // Check velocity first (allows quick flicks)
    const velocityTriggered = Math.abs(vy) > velocityThreshold;

    // Swipe up (negative velocity = moving up)
    if ((diff > threshold || (velocityTriggered && vy < 0)) && onSwipeUp) {
      if (haptic) triggerHaptic('light');
      onSwipeUp();
    }
    // Swipe down (positive velocity = moving down)
    else if ((diff < -threshold || (velocityTriggered && vy > 0)) && onSwipeDown) {
      if (haptic) triggerHaptic('light');
      onSwipeDown();
    }

    startY.current = 0;
    startX.current = 0;
    currentY.current = 0;
    isTracking.current = false;
    hasFiredDragStart.current = false;

    // Fire dragEnd if we were actually dragging
    if (wasDragging) {
      onDragEnd?.(vy);
    }
  }, [onSwipeUp, onSwipeDown, threshold, velocityThreshold, haptic, onDragEnd]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}

// ============================================================================
// ADVANCED HOOK (with drag tracking)
// ============================================================================

interface AdvancedSwipeOptions extends SwipeGestureOptions {
  /** Maximum drag offset before rubber banding */
  maxOffset?: number;
  /** Elasticity of rubber band effect (0-1) */
  elasticity?: number;
  /** Direction to track: 'vertical' | 'horizontal' | 'both' */
  direction?: 'vertical' | 'horizontal' | 'both';
}

export function useAdvancedSwipeGesture({
  onSwipeUp,
  onSwipeDown,
  threshold = 50,
  velocityThreshold = 300,
  haptic = true,
  onDragUpdate,
  onDragStart,
  onDragEnd,
  maxOffset = 200,
  elasticity = 0.55,
  direction = 'vertical',
}: AdvancedSwipeOptions): [SwipeState, SwipeHandlers] {
  const [state, setState] = useState<SwipeState>({
    isDragging: false,
    dragOffset: 0,
    velocity: 0,
  });

  const startY = useRef<number>(0);
  const startX = useRef<number>(0);
  const velocityTracker = useRef(new VelocityTracker());
  const isTracking = useRef(false);
  const hasStartedDrag = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startY.current = touch.clientY;
    startX.current = touch.clientX;
    velocityTracker.current.reset();
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);
    isTracking.current = true;
    hasStartedDrag.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTracking.current) return;

    const touch = e.touches[0];
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);

    const dx = touch.clientX - startX.current;
    const dy = touch.clientY - startY.current;

    // Determine if we should track this gesture
    if (!hasStartedDrag.current) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx < MIN_MOVEMENT_THRESHOLD && absDy < MIN_MOVEMENT_THRESHOLD) return; // Not enough movement yet

      if (direction === 'vertical' && absDx > absDy) {
        isTracking.current = false;
        return;
      }
      if (direction === 'horizontal' && absDy > absDx) {
        isTracking.current = false;
        return;
      }

      hasStartedDrag.current = true;
      onDragStart?.();
    }

    let offset = direction === 'horizontal' ? dx : dy;
    const { vx, vy } = velocityTracker.current.getVelocity();
    const velocity = direction === 'horizontal' ? vx : vy;

    // Apply rubber band effect at limits
    offset = rubberBand(offset, maxOffset, elasticity);

    setState({
      isDragging: true,
      dragOffset: offset,
      velocity,
    });

    onDragUpdate?.(offset, velocity);
  }, [direction, maxOffset, elasticity, onDragUpdate, onDragStart]);

  const onTouchEnd = useCallback(() => {
    if (!isTracking.current) {
      isTracking.current = false;
      return;
    }

    const { vx, vy } = velocityTracker.current.getVelocity();
    const velocity = direction === 'horizontal' ? vx : vy;
    const offset = state.dragOffset;

    // Check velocity first (allows quick flicks)
    const velocityTriggered = Math.abs(velocity) > velocityThreshold;

    // For vertical: negative offset = dragged up, positive = dragged down
    if (direction === 'vertical') {
      if ((offset < -threshold || (velocityTriggered && velocity < 0)) && onSwipeUp) {
        if (haptic) triggerHaptic('light');
        onSwipeUp();
      } else if ((offset > threshold || (velocityTriggered && velocity > 0)) && onSwipeDown) {
        if (haptic) triggerHaptic('light');
        onSwipeDown();
      }
    }

    onDragEnd?.(velocity);

    setState({
      isDragging: false,
      dragOffset: 0,
      velocity: 0,
    });

    isTracking.current = false;
    hasStartedDrag.current = false;
  }, [direction, threshold, velocityThreshold, haptic, state.dragOffset, onSwipeUp, onSwipeDown, onDragEnd]);

  return [state, { onTouchStart, onTouchMove, onTouchEnd }];
}

// ============================================================================
// BOTTOM SHEET HOOK
// ============================================================================

type SheetState = 'minimized' | 'partial' | 'expanded';

interface BottomSheetConfig {
  /** Heights for each state in pixels or viewport percentage */
  heights: {
    minimized: number | string;
    partial: number | string;
    expanded: number | string;
  };
  /** Current state */
  currentState: SheetState;
  /** Callback when state should change */
  onStateChange: (state: SheetState) => void;
  /** Enable haptic feedback */
  haptic?: boolean;
}

interface BottomSheetResult {
  handlers: SwipeHandlers;
  isDragging: boolean;
  dragOffset: number;
  /** Get the current height including drag offset */
  getCurrentHeight: () => string;
}

export function useBottomSheet({
  heights,
  currentState,
  onStateChange,
  haptic = true,
}: BottomSheetConfig): BottomSheetResult {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const velocityTracker = useRef(new VelocityTracker());
  const startY = useRef(0);
  const startX = useRef(0);
  const isTracking = useRef(false);

  const handleSwipeUp = useCallback(() => {
    if (currentState === 'minimized') {
      onStateChange('partial');
    } else if (currentState === 'partial') {
      onStateChange('expanded');
    }
  }, [currentState, onStateChange]);

  const handleSwipeDown = useCallback(() => {
    if (currentState === 'expanded') {
      onStateChange('partial');
    } else if (currentState === 'partial') {
      onStateChange('minimized');
    }
  }, [currentState, onStateChange]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startY.current = touch.clientY;
    startX.current = touch.clientX;
    velocityTracker.current.reset();
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);
    isTracking.current = true;
    setIsDragging(true);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTracking.current) return;

    const touch = e.touches[0];
    velocityTracker.current.addPoint(touch.clientX, touch.clientY);

    const dx = Math.abs(touch.clientX - startX.current);
    const dy = touch.clientY - startY.current;

    // Cancel if horizontal scroll
    if (dx > Math.abs(dy) && dx > SCROLL_CANCEL_THRESHOLD) {
      isTracking.current = false;
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    // Apply rubber band at extremes
    const rubberBandOffset = rubberBand(dy, 100, 0.4);
    setDragOffset(rubberBandOffset);
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!isTracking.current) {
      setIsDragging(false);
      setDragOffset(0);
      return;
    }

    const { vy } = velocityTracker.current.getVelocity();
    const offset = dragOffset;

    // Velocity threshold for quick flicks
    const velocityThreshold = 400;
    const distanceThreshold = 40;

    if (offset < -distanceThreshold || vy < -velocityThreshold) {
      if (haptic) triggerHaptic('light');
      handleSwipeUp();
    } else if (offset > distanceThreshold || vy > velocityThreshold) {
      if (haptic) triggerHaptic('light');
      handleSwipeDown();
    }

    setIsDragging(false);
    setDragOffset(0);
    isTracking.current = false;
  }, [dragOffset, haptic, handleSwipeUp, handleSwipeDown]);

  const getCurrentHeight = useCallback(() => {
    const baseHeight = heights[currentState];
    if (typeof baseHeight === 'number') {
      return `${Math.max(0, baseHeight - dragOffset)}px`;
    }
    // For string values (like '42dvh'), we can't easily adjust, so just return as-is
    return baseHeight;
  }, [heights, currentState, dragOffset]);

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
    isDragging,
    dragOffset,
    getCurrentHeight,
  };
}

export default useSwipeGesture;
