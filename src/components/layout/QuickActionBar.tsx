import { useState, type CSSProperties } from 'react';
import { colors, radius, transitions, glassButton, glassButtonHover } from '../../styles/liquidGlass';

interface QuickAction {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    /** Only show when this condition is true */
    visible?: boolean;
}

interface QuickActionBarProps {
    actions: QuickAction[];
    isMobile?: boolean;
}

/**
 * Floating action buttons in top-right corner.
 * Find My-inspired quick access buttons with Liquid Glass styling.
 */
export function QuickActionBar({ actions, isMobile = false }: QuickActionBarProps) {
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
            }}
        >
            {visibleActions.map(action => (
                <QuickActionButton
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    onClick={action.onClick}
                    isMobile={isMobile}
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
}

function QuickActionButton({ icon, label, onClick, isMobile }: QuickActionButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isPressed, setIsPressed] = useState(false);

    const size = isMobile ? 44 : 40;

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
    };

    const hoverStyle: CSSProperties = isHovered ? {
        ...glassButtonHover,
    } : {};

    const pressedStyle: CSSProperties = isPressed ? {
        transform: 'scale(0.95)',
        transition: `transform ${transitions.fast}`,
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
            style={{
                ...baseStyle,
                ...hoverStyle,
                ...pressedStyle,
            }}
        >
            <span
                style={{
                    color: colors.text.secondary,
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
};
