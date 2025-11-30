import { useRef, useCallback, useState, type RefObject } from 'react';

interface DragGestureOptions {
    /** Snap points as percentages of viewport height (0-100) */
    snapPoints: number[];
    /** Current snap point index */
    currentSnapIndex: number;
    /** Called when snap point changes */
    onSnapChange: (index: number) => void;
    /** Ref to the panel element for direct DOM manipulation */
    panelRef: RefObject<HTMLDivElement | null>;
    /** Called when user drags down past minimum to dismiss */
    onDismiss?: () => void;
    /** Minimum velocity (px/ms) to trigger a snap */
    velocityThreshold?: number;
    /** Distance threshold to trigger snap without velocity */
    distanceThreshold?: number;
    /** Distance to drag past minimum to trigger dismiss */
    dismissThreshold?: number;
}

interface DragState {
    isDragging: boolean;
}

interface DragHandlers {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
}

/**
 * iOS-like drag gesture hook with direct DOM manipulation for instant feedback.
 * Uses refs to update panel height directly during drag, bypassing React's
 * rendering cycle for smooth 60fps interactions.
 */
export function useDragGesture({
    snapPoints,
    currentSnapIndex,
    onSnapChange,
    panelRef,
    onDismiss,
    velocityThreshold = 0.5,
    distanceThreshold = 50,
    dismissThreshold = 100,
}: DragGestureOptions): [DragState, DragHandlers] {
    const [isDragging, setIsDragging] = useState(false);

    const startY = useRef<number>(0);
    const lastY = useRef<number>(0);
    const lastTime = useRef<number>(0);
    const velocity = useRef<number>(0);
    const currentIndexRef = useRef(currentSnapIndex);

    // Keep ref in sync with prop
    currentIndexRef.current = currentSnapIndex;

    // Get base height in pixels for current snap point
    const getBaseHeightPx = useCallback(() => {
        const vh = window.innerHeight / 100;
        return snapPoints[currentIndexRef.current] * vh;
    }, [snapPoints]);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        const touch = e.touches[0];
        startY.current = touch.clientY;
        lastY.current = touch.clientY;
        lastTime.current = Date.now();
        velocity.current = 0;

        // Mark as dragging and disable transitions
        setIsDragging(true);
        if (panelRef.current) {
            panelRef.current.style.transition = 'none';
        }
    }, [panelRef]);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        const panel = panelRef.current;
        if (!panel) return;

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

        // Calculate new height
        const vh = window.innerHeight / 100;
        const baseHeight = getBaseHeightPx();
        const minHeight = 80;
        const maxHeight = vh * 100 - 60;

        // Dragging down (positive offset) = shorter panel
        // Dragging up (negative offset) = taller panel
        let newHeight = baseHeight - totalOffset;

        // Apply rubber banding at boundaries
        if (newHeight < minHeight) {
            const excess = minHeight - newHeight;
            newHeight = minHeight - Math.sqrt(excess) * 5;
        } else if (newHeight > maxHeight) {
            const excess = newHeight - maxHeight;
            newHeight = maxHeight + Math.sqrt(excess) * 5;
        }

        // Direct DOM update for instant feedback
        panel.style.height = `${Math.max(60, newHeight)}px`;
    }, [panelRef, getBaseHeightPx]);

    const onTouchEnd = useCallback(() => {
        const panel = panelRef.current;
        const totalOffset = lastY.current - startY.current;
        const finalVelocity = velocity.current;

        // Check for dismiss gesture: at minimized (index 0) and dragged down enough
        const isAtMinimized = currentIndexRef.current === 0;
        const draggedDownEnough = totalOffset > dismissThreshold;
        const fastSwipeDown = finalVelocity > velocityThreshold;

        if (isAtMinimized && (draggedDownEnough || fastSwipeDown) && onDismiss) {
            // Animate panel off screen then dismiss
            if (panel) {
                panel.style.transition = 'height 0.3s cubic-bezier(0.32, 0.72, 0, 1)';
                panel.style.height = '0px';
            }
            setIsDragging(false);
            setTimeout(() => onDismiss(), 300);

            // Reset refs
            startY.current = 0;
            lastY.current = 0;
            velocity.current = 0;
            return;
        }

        // Determine target snap point based on velocity and distance
        let targetIndex = currentIndexRef.current;

        // Fast swipe - use velocity to determine direction
        if (Math.abs(finalVelocity) > velocityThreshold) {
            if (finalVelocity > 0 && currentIndexRef.current > 0) {
                // Swiping down (positive velocity) - go to smaller snap point
                targetIndex = currentIndexRef.current - 1;
            } else if (finalVelocity < 0 && currentIndexRef.current < snapPoints.length - 1) {
                // Swiping up (negative velocity) - go to larger snap point
                targetIndex = currentIndexRef.current + 1;
            }
        }
        // Slow drag - use distance threshold
        else if (Math.abs(totalOffset) > distanceThreshold) {
            if (totalOffset > 0 && currentIndexRef.current > 0) {
                // Dragged down - go to smaller snap point
                targetIndex = currentIndexRef.current - 1;
            } else if (totalOffset < 0 && currentIndexRef.current < snapPoints.length - 1) {
                // Dragged up - go to larger snap point
                targetIndex = currentIndexRef.current + 1;
            }
        }

        // Re-enable transitions for snap animation
        if (panel) {
            panel.style.transition = 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1)';

            // Animate to target snap point
            const vh = window.innerHeight / 100;
            const targetHeight = snapPoints[targetIndex] * vh;
            panel.style.height = `${targetHeight}px`;
        }

        setIsDragging(false);

        // Trigger snap change if needed (after a small delay to let animation start)
        if (targetIndex !== currentIndexRef.current) {
            // Use setTimeout to avoid state update during animation setup
            setTimeout(() => onSnapChange(targetIndex), 10);
        }

        // Reset refs
        startY.current = 0;
        lastY.current = 0;
        velocity.current = 0;
    }, [snapPoints, velocityThreshold, distanceThreshold, dismissThreshold, onSnapChange, onDismiss, panelRef]);

    return [{ isDragging }, { onTouchStart, onTouchMove, onTouchEnd }];
}
