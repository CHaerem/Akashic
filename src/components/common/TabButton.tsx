import { memo, useCallback } from 'react';
import type { TabType } from '../../types/trek';

interface TabButtonProps {
    tab: string;
    activeTab: TabType;
    onClick: (tab: TabType) => void;
    isMobile?: boolean;
}

export const TabButton = memo(function TabButton({ tab, activeTab, onClick, isMobile = false }: TabButtonProps) {
    const handleClick = useCallback(() => onClick(tab as TabType), [onClick, tab]);
    const isActive = activeTab === tab;

    return (
        <button
            onClick={handleClick}
            style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
                color: isActive ? 'white' : 'rgba(255,255,255,0.4)',
                fontSize: isMobile ? 12 : 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                padding: isMobile ? '16px 12px' : '16px 16px',
                cursor: 'pointer',
                marginBottom: -1,
                flex: isMobile ? 1 : 'none',
                minHeight: 48
            }}
        >
            {tab}
        </button>
    );
});
