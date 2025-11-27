import { memo, useCallback, useState } from 'react';
import type { TabType } from '../../types/trek';
import { colors, radius, transitions } from '../../styles/liquidGlass';

interface TabButtonProps {
    tab: string;
    activeTab: TabType;
    onClick: (tab: TabType) => void;
    isMobile?: boolean;
}

export const TabButton = memo(function TabButton({ tab, activeTab, onClick, isMobile = false }: TabButtonProps) {
    const handleClick = useCallback(() => onClick(tab as TabType), [onClick, tab]);
    const isActive = activeTab === tab;
    const [isHovered, setIsHovered] = useState(false);

    // Liquid Glass pill-style tabs
    const baseStyle: React.CSSProperties = {
        background: isActive
            ? `linear-gradient(
                135deg,
                rgba(255, 255, 255, 0.15) 0%,
                rgba(255, 255, 255, 0.08) 100%
              )`
            : 'transparent',
        backdropFilter: isActive ? 'blur(8px) saturate(180%)' : 'none',
        WebkitBackdropFilter: isActive ? 'blur(8px) saturate(180%)' : 'none',
        border: isActive
            ? `1px solid ${colors.glass.border}`
            : '1px solid transparent',
        boxShadow: isActive
            ? `
                0 2px 8px rgba(0, 0, 0, 0.15),
                inset 0 1px 0 rgba(255, 255, 255, 0.15)
              `
            : 'none',
        color: isActive ? colors.text.primary : colors.text.tertiary,
        fontSize: isMobile ? 12 : 11,
        fontWeight: isActive ? 500 : 400,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        padding: isMobile ? '10px 16px' : '10px 14px',
        cursor: 'pointer',
        borderRadius: radius.lg,
        flex: isMobile ? 1 : 'none',
        minHeight: isMobile ? 44 : 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: `all ${transitions.smooth}`,
        position: 'relative' as const,
        overflow: 'hidden',
    };

    // Hover state enhancement
    const hoverStyle: React.CSSProperties = !isActive && isHovered ? {
        background: 'rgba(255, 255, 255, 0.06)',
        color: colors.text.secondary,
        border: `1px solid ${colors.glass.borderSubtle}`,
    } : {};

    return (
        <button
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{ ...baseStyle, ...hoverStyle }}
        >
            {tab}
        </button>
    );
});
