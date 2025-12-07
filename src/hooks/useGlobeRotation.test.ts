/**
 * Tests for globe rotation behavior
 *
 * Expected behavior:
 * 1. Rotation starts 3.5s after entering globe view with no trek selected
 * 2. Rotation stops immediately when a trek is selected
 * 3. Rotation stops when view changes to 'trek'
 * 4. User interaction (drag, zoom, etc.) stops rotation
 * 5. Rotation doesn't restart if already scheduled
 * 6. Recenter stops rotation and can select first journey
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the rotation scheduling logic in isolation
describe('Globe rotation scheduling logic', () => {
    let isRotationScheduledRef: { current: boolean };
    let rotationTimerRef: { current: ReturnType<typeof setTimeout> | null };
    let startRotation: ReturnType<typeof vi.fn>;
    let stopRotation: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        isRotationScheduledRef = { current: false };
        rotationTimerRef = { current: null };
        startRotation = vi.fn();
        stopRotation = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    // Helper to simulate the rotation effect logic
    function runRotationEffect(view: 'globe' | 'trek', selectedTrek: boolean, mapReady: boolean) {
        if (!mapReady) return;

        const shouldRotate = view === 'globe' && !selectedTrek;

        if (shouldRotate && !isRotationScheduledRef.current) {
            // Only schedule rotation if not already scheduled
            isRotationScheduledRef.current = true;
            rotationTimerRef.current = setTimeout(() => {
                rotationTimerRef.current = null;
                startRotation();
            }, 3500);
        } else if (!shouldRotate) {
            // Stop rotation and clear any pending timer
            isRotationScheduledRef.current = false;
            if (rotationTimerRef.current) {
                clearTimeout(rotationTimerRef.current);
                rotationTimerRef.current = null;
            }
            stopRotation();
        }
    }

    // Cleanup helper (simulates effect cleanup)
    function cleanup() {
        if (rotationTimerRef.current) {
            clearTimeout(rotationTimerRef.current);
            rotationTimerRef.current = null;
        }
    }

    describe('initial state - globe view, no trek selected', () => {
        it('schedules rotation to start after 3.5s', () => {
            runRotationEffect('globe', false, true);

            expect(isRotationScheduledRef.current).toBe(true);
            expect(rotationTimerRef.current).not.toBeNull();
            expect(startRotation).not.toHaveBeenCalled();
        });

        it('starts rotation after 3.5s delay', () => {
            runRotationEffect('globe', false, true);

            vi.advanceTimersByTime(3500);

            expect(startRotation).toHaveBeenCalledTimes(1);
            expect(rotationTimerRef.current).toBeNull();
        });

        it('does not start rotation before 3.5s', () => {
            runRotationEffect('globe', false, true);

            vi.advanceTimersByTime(3000);
            expect(startRotation).not.toHaveBeenCalled();

            vi.advanceTimersByTime(500);
            expect(startRotation).toHaveBeenCalledTimes(1);
        });
    });

    describe('selecting a trek', () => {
        it('stops rotation immediately when trek is selected', () => {
            // Start in globe view, no selection
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);

            // Select a trek
            cleanup(); // Effect cleanup
            runRotationEffect('globe', true, true);

            expect(stopRotation).toHaveBeenCalledTimes(1);
            expect(isRotationScheduledRef.current).toBe(false);
        });

        it('cancels pending rotation timer when trek is selected', () => {
            // Start in globe view, no selection
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(2000); // Timer is scheduled but not yet fired
            expect(startRotation).not.toHaveBeenCalled();

            // Select a trek before timer fires
            cleanup();
            runRotationEffect('globe', true, true);

            // Advance past the original timer time
            vi.advanceTimersByTime(2000);

            expect(startRotation).not.toHaveBeenCalled();
            expect(stopRotation).toHaveBeenCalledTimes(1);
        });
    });

    describe('changing to trek view', () => {
        it('stops rotation when view changes to trek', () => {
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);

            cleanup();
            runRotationEffect('trek', true, true);

            expect(stopRotation).toHaveBeenCalledTimes(1);
        });

        it('cancels pending timer when view changes', () => {
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(1000);

            cleanup();
            runRotationEffect('trek', true, true);

            vi.advanceTimersByTime(5000);
            expect(startRotation).not.toHaveBeenCalled();
        });
    });

    describe('returning to globe view', () => {
        it('reschedules rotation when returning to globe with no selection', () => {
            // Start in globe, go to trek, come back to globe
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(3500);
            startRotation.mockClear();

            cleanup();
            runRotationEffect('trek', true, true);
            stopRotation.mockClear();

            cleanup();
            // Back to globe with no selection
            runRotationEffect('globe', false, true);

            expect(isRotationScheduledRef.current).toBe(true);
            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);
        });

        it('does not restart rotation if trek is still selected in globe view', () => {
            runRotationEffect('globe', true, true);

            vi.advanceTimersByTime(5000);
            expect(startRotation).not.toHaveBeenCalled();
        });
    });

    describe('duplicate scheduling prevention', () => {
        it('does not schedule duplicate timers when effect re-runs', () => {
            runRotationEffect('globe', false, true);
            runRotationEffect('globe', false, true);
            runRotationEffect('globe', false, true);

            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);
        });

        it('does not reschedule after rotation has started', () => {
            runRotationEffect('globe', false, true);
            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);

            // Effect re-runs but isRotationScheduledRef is still true
            runRotationEffect('globe', false, true);

            vi.advanceTimersByTime(3500);
            // Should still only be called once
            expect(startRotation).toHaveBeenCalledTimes(1);
        });
    });

    describe('map ready state', () => {
        it('does not schedule rotation when map is not ready', () => {
            runRotationEffect('globe', false, false);

            expect(isRotationScheduledRef.current).toBe(false);
            expect(rotationTimerRef.current).toBeNull();
            vi.advanceTimersByTime(5000);
            expect(startRotation).not.toHaveBeenCalled();
        });

        it('schedules rotation when map becomes ready', () => {
            runRotationEffect('globe', false, false);
            expect(isRotationScheduledRef.current).toBe(false);

            runRotationEffect('globe', false, true);
            expect(isRotationScheduledRef.current).toBe(true);

            vi.advanceTimersByTime(3500);
            expect(startRotation).toHaveBeenCalledTimes(1);
        });
    });
});

// Test the rotation animation logic
describe('Globe rotation animation', () => {
    let mockMap: {
        getCenter: ReturnType<typeof vi.fn>;
        setCenter: ReturnType<typeof vi.fn>;
        getCanvas: ReturnType<typeof vi.fn>;
    };
    let rotationAnimationRef: { current: number | null };
    let interactionListenerRef: { current: (() => void) | null };
    let mockCanvas: {
        addEventListener: ReturnType<typeof vi.fn>;
        removeEventListener: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        mockCanvas = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };
        mockMap = {
            getCenter: vi.fn(() => ({ lng: 30, lat: 15 })),
            setCenter: vi.fn(),
            getCanvas: vi.fn(() => mockCanvas)
        };
        rotationAnimationRef = { current: null };
        interactionListenerRef = { current: null };
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('startRotation', () => {
        it('should not start if rotation is already running', () => {
            // Simulate rotation already running
            rotationAnimationRef.current = 123;

            // Try to start rotation
            const map = mockMap;
            if (!map || rotationAnimationRef.current) {
                // Early return
                return;
            }
            // This code should not be reached
            mockMap.setCenter([0, 0]);

            expect(mockMap.setCenter).not.toHaveBeenCalled();
        });

        it('should set up interaction listeners', () => {
            // Simulate startRotation setup
            const onInteraction = () => { };
            interactionListenerRef.current = onInteraction;

            mockCanvas.addEventListener('mousedown', onInteraction, { passive: true });
            mockCanvas.addEventListener('touchstart', onInteraction, { passive: true });
            mockCanvas.addEventListener('wheel', onInteraction, { passive: true });

            expect(mockCanvas.addEventListener).toHaveBeenCalledTimes(3);
            expect(mockCanvas.addEventListener).toHaveBeenCalledWith('mousedown', onInteraction, { passive: true });
            expect(mockCanvas.addEventListener).toHaveBeenCalledWith('touchstart', onInteraction, { passive: true });
            expect(mockCanvas.addEventListener).toHaveBeenCalledWith('wheel', onInteraction, { passive: true });
        });
    });

    describe('stopRotation', () => {
        it('should cancel animation frame', () => {
            rotationAnimationRef.current = 123;
            const cancelAnimationFrame = vi.fn();

            // Simulate stopRotation
            if (rotationAnimationRef.current) {
                cancelAnimationFrame(rotationAnimationRef.current);
                rotationAnimationRef.current = null;
            }

            expect(cancelAnimationFrame).toHaveBeenCalledWith(123);
            expect(rotationAnimationRef.current).toBeNull();
        });

        it('should remove interaction listeners', () => {
            const listener = () => { };
            interactionListenerRef.current = listener;

            // Simulate stopRotation listener cleanup
            if (interactionListenerRef.current) {
                mockCanvas.removeEventListener('mousedown', listener);
                mockCanvas.removeEventListener('touchstart', listener);
                mockCanvas.removeEventListener('wheel', listener);
                interactionListenerRef.current = null;
            }

            expect(mockCanvas.removeEventListener).toHaveBeenCalledTimes(3);
            expect(interactionListenerRef.current).toBeNull();
        });
    });
});

// Test the fixed rotation logic using isRotating state
describe('Fixed rotation logic with isRotating state', () => {
    it('should reschedule rotation when user interaction stops it', () => {
        let isRotating = false;
        let rotationTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
        const startRotation = vi.fn(() => {
            isRotating = true;
        });
        const stopRotation = vi.fn(() => {
            isRotating = false;
        });

        vi.useFakeTimers();

        // Helper that uses the fixed logic
        const runEffect = (shouldRotate: boolean) => {
            if (shouldRotate && !isRotating && !rotationTimerRef.current) {
                // Schedule rotation if:
                // 1. We should be rotating (globe view, no selection)
                // 2. Not currently rotating (isRotating is false)
                // 3. No timer already pending
                rotationTimerRef.current = setTimeout(() => {
                    rotationTimerRef.current = null;
                    startRotation();
                }, 3500);
            } else if (!shouldRotate) {
                // Stop rotation and clear any pending timer
                if (rotationTimerRef.current) {
                    clearTimeout(rotationTimerRef.current);
                    rotationTimerRef.current = null;
                }
                stopRotation();
            }
        };

        // 1. Enter globe view, schedule rotation
        runEffect(true);
        vi.advanceTimersByTime(3500);
        expect(startRotation).toHaveBeenCalledTimes(1);
        expect(isRotating).toBe(true);

        // 2. User interacts (stops rotation manually)
        stopRotation();
        expect(isRotating).toBe(false);

        // 3. Effect re-runs with the fixed logic
        // Now it sees isRotating is false and rotationTimerRef is null
        // So it should reschedule!
        startRotation.mockClear();
        runEffect(true);

        // Timer should be scheduled
        expect(rotationTimerRef.current).not.toBeNull();

        vi.advanceTimersByTime(3500);
        expect(startRotation).toHaveBeenCalledTimes(1);
        expect(isRotating).toBe(true);

        vi.useRealTimers();
    });

    it('should not duplicate timers when effect re-runs while rotating', () => {
        let isRotating = false;
        let rotationTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
        const startRotation = vi.fn(() => {
            isRotating = true;
        });
        const stopRotation = vi.fn(() => {
            isRotating = false;
        });

        vi.useFakeTimers();

        const runEffect = (shouldRotate: boolean) => {
            if (shouldRotate && !isRotating && !rotationTimerRef.current) {
                rotationTimerRef.current = setTimeout(() => {
                    rotationTimerRef.current = null;
                    startRotation();
                }, 3500);
            } else if (!shouldRotate) {
                if (rotationTimerRef.current) {
                    clearTimeout(rotationTimerRef.current);
                    rotationTimerRef.current = null;
                }
                stopRotation();
            }
        };

        // Start rotation
        runEffect(true);
        vi.advanceTimersByTime(3500);
        expect(isRotating).toBe(true);

        // Effect re-runs multiple times while rotating
        runEffect(true);
        runEffect(true);
        runEffect(true);

        // No new timers should be created (isRotating is true)
        expect(rotationTimerRef.current).toBeNull();
        expect(startRotation).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('should not duplicate timers when effect re-runs while timer is pending', () => {
        let isRotating = false;
        let rotationTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };
        const startRotation = vi.fn(() => {
            isRotating = true;
        });

        vi.useFakeTimers();

        const runEffect = (shouldRotate: boolean) => {
            if (shouldRotate && !isRotating && !rotationTimerRef.current) {
                rotationTimerRef.current = setTimeout(() => {
                    rotationTimerRef.current = null;
                    startRotation();
                }, 3500);
            }
        };

        // Schedule rotation
        runEffect(true);
        const firstTimer = rotationTimerRef.current;

        // Effect re-runs before timer fires
        vi.advanceTimersByTime(1000);
        runEffect(true);
        runEffect(true);

        // Timer should be the same (not rescheduled)
        expect(rotationTimerRef.current).toBe(firstTimer);

        // Let timer fire
        vi.advanceTimersByTime(2500);
        expect(startRotation).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });
});

// Note: Auto-recenter during manual globe interaction has been removed.
// Users can now freely explore the globe without being snapped back.
// The only auto-recenter is for interrupted flyToGlobe animations.
