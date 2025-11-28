import { useRef, useCallback, useState } from 'react';

interface DragGestureOptions {
    /** Snap points as percentages of viewport height (0-100) */
    snapPoints: number[];
    /** Current snap point index */
    currentSnapIndex: number;
    /** Called when snap point changes */
    onSnapChange: (index: number) => void;
    /** Minimum velocity (px/ms) to trigger a snap */
    velocityThreshold?: number;
    /** Distance threshold to trigger snap without velocity */
    distanceThreshold?: number;
    /** Rubber band resistance (0-1, lower = more resistance) */
    rubberBandResistance?: number;
}

interface DragState {
    isDragging: boolean;
    dragOffset: number;
}

interface DragHandlers {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
}

/**
 * iOS-like drag gesture hook with:
 * - Drag-to-follow (panel follows finger)
 * - Velocity-based snap decisions
 * - Rubber-banding at boundaries
 * - Spring physics animation
 */
export function useDragGesture({
    snapPoints,
    currentSnapIndex,
    onSnapChange,
    velocityThreshold = 0.5,
    distanceThreshold = 50,
    rubberBandResistance = 0.4
}: DragGestureOptions): [DragState, DragHandlers] {
    const [dragState, setDragState] = useState<DragState>({
        isDragging: false,
        dragOffset: 0
    });

    const startY = useRef<number>(0);
    const startTime = useRef<number>(0);
    const lastY = useRef<number>(0);
    const lastTime = useRef<number>(0);
    const velocity = useRef<number>(0);

    // Calculate rubber band effect for overscroll
    const rubberBand = useCallback((offset: number, maxOffset: number): number => {
        if (offset >= 0 && offset <= maxOffset) return offset;

        const excess = offset < 0 ? -offset : offset - maxOffset;
        const dampened = Math.pow(excess, rubberBandResistance) * 10;

        return offset < 0 ? -dampened : maxOffset + dampened;
    }, [rubberBandResistance]);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        startY.current = touch.clientY;
        lastY.current = touch.clientY;
        startTime.current = Date.now();
        lastTime.current = Date.now();
        velocity.current = 0;

        setDragState({
            isDragging: true,
            dragOffset: 0
        });
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        const currentTime = Date.now();
        const deltaTime = currentTime - lastTime.current;
        const deltaY = touch.clientY - lastY.current;

        // Calculate instantaneous velocity (px/ms)
        if (deltaTime > 0) {
            velocity.current = deltaY / deltaTime;
        }

        lastY.current = touch.clientY;
        lastTime.current = currentTime;

        // Calculate drag offset from start
        const totalOffset = touch.clientY - startY.current;

        // Get current snap point height in pixels
        const vh = window.innerHeight / 100;
        const currentHeight = snapPoints[currentSnapIndex] * vh;
        const minHeight = snapPoints[0] * vh;
        const maxHeight = snapPoints[snapPoints.length - 1] * vh;

        // Calculate the new height if we were to apply the offset
        // Positive offset (drag down) = smaller panel
        // Negative offset (drag up) = taller panel
        const newHeight = currentHeight - totalOffset;

        // Apply rubber banding at boundaries
        const clampedHeight = rubberBand(newHeight, maxHeight - minHeight);
        const adjustedOffset = currentHeight - clampedHeight - minHeight;

        setDragState({
            isDragging: true,
            dragOffset: totalOffset
        });
    }, [snapPoints, currentSnapIndex, rubberBand]);

    const onTouchEnd = useCallback(() => {
        const totalOffset = lastY.current - startY.current;
        const finalVelocity = velocity.current;

        // Determine target snap point based on velocity and distance
        let targetIndex = currentSnapIndex;

        // Fast swipe - use velocity to determine direction
        if (Math.abs(finalVelocity) > velocityThreshold) {
            if (finalVelocity > 0 && currentSnapIndex > 0) {
                // Swiping down (positive velocity) - go to smaller snap point
                targetIndex = currentSnapIndex - 1;
            } else if (finalVelocity < 0 && currentSnapIndex < snapPoints.length - 1) {
                // Swiping up (negative velocity) - go to larger snap point
                targetIndex = currentSnapIndex + 1;
            }
        }
        // Slow drag - use distance threshold
        else if (Math.abs(totalOffset) > distanceThreshold) {
            if (totalOffset > 0 && currentSnapIndex > 0) {
                // Dragged down - go to smaller snap point
                targetIndex = currentSnapIndex - 1;
            } else if (totalOffset < 0 && currentSnapIndex < snapPoints.length - 1) {
                // Dragged up - go to larger snap point
                targetIndex = currentSnapIndex + 1;
            }
        }

        // Reset drag state
        setDragState({
            isDragging: false,
            dragOffset: 0
        });

        // Trigger snap change if needed
        if (targetIndex !== currentSnapIndex) {
            onSnapChange(targetIndex);
        }

        // Reset refs
        startY.current = 0;
        lastY.current = 0;
        velocity.current = 0;
    }, [currentSnapIndex, snapPoints.length, velocityThreshold, distanceThreshold, onSnapChange]);

    return [dragState, { onTouchStart, onTouchMove, onTouchEnd }];
}
