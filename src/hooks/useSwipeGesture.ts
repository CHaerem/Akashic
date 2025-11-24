import { useRef, useCallback } from 'react';

interface SwipeGestureOptions {
    onSwipeUp?: () => void;
    onSwipeDown?: () => void;
    threshold?: number;
}

interface SwipeHandlers {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
}

export function useSwipeGesture({
    onSwipeUp,
    onSwipeDown,
    threshold = 50
}: SwipeGestureOptions): SwipeHandlers {
    const startY = useRef<number>(0);
    const currentY = useRef<number>(0);

    const onTouchStart = useCallback((e: React.TouchEvent) => {
        startY.current = e.touches[0].clientY;
        currentY.current = e.touches[0].clientY;
    }, []);

    const onTouchMove = useCallback((e: React.TouchEvent) => {
        currentY.current = e.touches[0].clientY;
    }, []);

    const onTouchEnd = useCallback(() => {
        const diff = startY.current - currentY.current;

        if (diff > threshold && onSwipeUp) {
            onSwipeUp();
        } else if (diff < -threshold && onSwipeDown) {
            onSwipeDown();
        }

        startY.current = 0;
        currentY.current = 0;
    }, [onSwipeUp, onSwipeDown, threshold]);

    return { onTouchStart, onTouchMove, onTouchEnd };
}
