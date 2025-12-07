import { useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useDragGesture } from '../../hooks/useDragGesture';
import { colors, radius, transitions } from '../../styles/liquidGlass';

// Snap points as vh percentages
export const SNAP_POINTS = {
    minimized: 12,   // Just drag handle + hint
    half: 45,        // Half screen
    expanded: 88,    // Full content (leaving room for status bar)
};

export type SnapPoint = keyof typeof SNAP_POINTS;

const SNAP_VALUES = [SNAP_POINTS.minimized, SNAP_POINTS.half, SNAP_POINTS.expanded];

interface BottomSheetProps {
    children: ReactNode;
    snapPoint: SnapPoint;
    onSnapChange: (snap: SnapPoint) => void;
    onDismiss?: () => void;
    /** Header content shown in drag handle area */
    header?: ReactNode;
    /** Whether sheet is visible */
    isOpen?: boolean;
}

/**
 * iOS-style draggable bottom sheet with Liquid Glass styling.
 * Uses direct DOM manipulation for 60fps drag performance.
 */
export function BottomSheet({
    children,
    snapPoint,
    onSnapChange,
    onDismiss,
    header,
    isOpen = true,
}: BottomSheetProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    const snapIndex = SNAP_VALUES.indexOf(SNAP_POINTS[snapPoint]);

    const handleSnapChange = useCallback((index: number) => {
        const snapKeys: SnapPoint[] = ['minimized', 'half', 'expanded'];
        onSnapChange(snapKeys[index]);
    }, [onSnapChange]);

    const [dragState, dragHandlers] = useDragGesture({
        snapPoints: SNAP_VALUES,
        currentSnapIndex: snapIndex,
        onSnapChange: handleSnapChange,
        panelRef,
        onDismiss,
    });

    // Set initial height on mount and when snap point changes externally
    useEffect(() => {
        if (panelRef.current && !dragState.isDragging) {
            const vh = window.innerHeight / 100;
            const height = SNAP_POINTS[snapPoint] * vh;
            panelRef.current.style.transition = `height ${transitions.glass}`;
            panelRef.current.style.height = `${height}px`;
        }
    }, [snapPoint, dragState.isDragging]);

    // Handle tap on drag handle to toggle between minimized and half
    const handleDragHandleTap = useCallback(() => {
        if (snapPoint === 'minimized') {
            onSnapChange('half');
        } else if (snapPoint === 'half' || snapPoint === 'expanded') {
            onSnapChange('minimized');
        }
    }, [snapPoint, onSnapChange]);

    // Prevent scroll when at top and trying to scroll up
    const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const content = e.currentTarget;
        if (content.scrollTop <= 0) {
            content.scrollTop = 0;
        }
    }, []);

    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                zIndex: 50,
                // Liquid Glass styling
                background: `linear-gradient(
                    180deg,
                    rgba(255, 255, 255, 0.12) 0%,
                    rgba(255, 255, 255, 0.06) 30%,
                    rgba(255, 255, 255, 0.04) 100%
                )`,
                backdropFilter: 'blur(40px) saturate(180%)',
                WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                borderTopLeftRadius: radius.xxl,
                borderTopRightRadius: radius.xxl,
                boxShadow: `
                    0 -8px 40px rgba(0, 0, 0, 0.4),
                    0 0 0 1px rgba(255, 255, 255, 0.08),
                    inset 0 1px 0 rgba(255, 255, 255, 0.15)
                `,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                // Safe area padding at bottom
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
        >
            {/* Drag Handle Area */}
            <div
                {...dragHandlers}
                onClick={handleDragHandleTap}
                style={{
                    padding: '12px 16px',
                    cursor: 'grab',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    flexShrink: 0,
                }}
            >
                {/* Visual drag indicator */}
                <div
                    style={{
                        width: 36,
                        height: 5,
                        borderRadius: radius.pill,
                        background: colors.glass.light,
                        margin: '0 auto 12px',
                        opacity: dragState.isDragging ? 0.8 : 0.5,
                        transition: `opacity ${transitions.fast}`,
                    }}
                />

                {/* Optional header content */}
                {header && (
                    <div style={{ marginTop: 4 }}>
                        {header}
                    </div>
                )}
            </div>

            {/* Scrollable Content */}
            <div
                ref={contentRef}
                onScroll={handleContentScroll}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    // Hide scrollbar but keep functionality
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch',
                }}
            >
                <style>{`
                    .bottom-sheet-content::-webkit-scrollbar {
                        display: none;
                    }
                `}</style>
                <div className="bottom-sheet-content" style={{ height: '100%' }}>
                    {children}
                </div>
            </div>
        </div>
    );
}
