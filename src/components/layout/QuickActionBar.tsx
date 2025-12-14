import { useState, type CSSProperties } from 'react';
import { colors, radius, transitions, glassButton, glassButtonHover } from '../../styles/liquidGlass';

interface QuickAction {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    /** Only show when this condition is true */
    visible?: boolean;
    /** Show active/highlighted state */
    active?: boolean;
    /** Make button more subtle/less prominent when inactive */
    subtle?: boolean;
}

interface QuickActionBarProps {
    actions: QuickAction[];
    isMobile?: boolean;
    /** Hide the action bar (e.g., when bottom sheet is expanded) */
    hidden?: boolean;
}

/**
 * Floating action buttons in top-right corner.
 * Find My-inspired quick access buttons with Liquid Glass styling.
 */
export function QuickActionBar({ actions, isMobile = false, hidden = false }: QuickActionBarProps) {
    const visibleActions = actions.filter(a => a.visible !== false);

    if (visibleActions.length === 0) return null;

    return (
        <div
            style={{
                position: 'absolute',
                top: isMobile ? 'max(16px, env(safe-area-inset-top))' : 24,
                right: isMobile ? 16 : 24,
                zIndex: 60,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                // Fade out when hidden (bottom sheet expanded)
                opacity: hidden ? 0 : 1,
                pointerEvents: hidden ? 'none' : 'auto',
                transform: hidden ? 'translateY(-10px)' : 'translateY(0)',
                transition: `opacity ${transitions.normal}, transform ${transitions.normal}`,
            }}
        >
            {visibleActions.map(action => (
                <QuickActionButton
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    onClick={action.onClick}
                    isMobile={isMobile}
                    active={action.active}
                    subtle={action.subtle}
                />
            ))}
        </div>
    );
}

interface QuickActionButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    isMobile?: boolean;
    active?: boolean;
    subtle?: boolean;
}

function QuickActionButton({ icon, label, onClick, isMobile, active, subtle }: QuickActionButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);

    const size = isMobile ? 44 : 40;

    // Subtle buttons are more transparent when inactive
    const isSubtleInactive = subtle && !active;

    const baseStyle: CSSProperties = {
        ...glassButton,
        width: size,
        height: size,
        borderRadius: radius.lg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        // Reset button styles
        padding: 0,
        margin: 0,
        outline: 'none',
        // Subtle inactive state - more transparent
        ...(isSubtleInactive && !isHovered ? {
            background: 'rgba(255, 255, 255, 0.03)',
            borderColor: 'rgba(255, 255, 255, 0.05)',
            opacity: 0.6,
        } : {}),
        transition: `opacity ${transitions.normal}, background ${transitions.normal}, border-color ${transitions.normal}, transform ${transitions.fast}`,
    };

    const activeStyle: CSSProperties = active ? {
        background: 'rgba(96, 165, 250, 0.25)',
        borderColor: 'rgba(96, 165, 250, 0.4)',
        opacity: 1,
    } : {};

    const hoverStyle: CSSProperties = isHovered ? {
        ...glassButtonHover,
        opacity: 1,
    } : {};

    const pressedStyle: CSSProperties = isPressed ? {
        transform: 'scale(0.95)',
    } : {};

    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                setIsPressed(false);
            }}
            onMouseDown={() => setIsPressed(true)}
            onMouseUp={() => setIsPressed(false)}
            onTouchStart={() => setIsPressed(true)}
            onTouchEnd={() => setIsPressed(false)}
            aria-label={label}
            aria-pressed={active}
            style={{
                ...baseStyle,
                ...activeStyle,
                ...hoverStyle,
                ...pressedStyle,
            }}
        >
            <span
                style={{
                    color: active ? colors.accent.primary : (isSubtleInactive && !isHovered ? colors.text.tertiary : colors.text.secondary),
                    fontSize: isMobile ? 20 : 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {icon}
            </span>
        </button>
    );
}

// Pre-built icons for common actions
export const QuickActionIcons = {
    globe: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            <path d="M2 12h20" />
        </svg>
    ),
    recenter: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
        </svg>
    ),
    back: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
        </svg>
    ),
    edit: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
    ),
    play: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M8 5v14l11-7z" />
        </svg>
    ),
    pause: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
    ),
    stop: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    ),
};
