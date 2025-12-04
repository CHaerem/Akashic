import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { colors, radius, transitions, shadows, effects } from '../../styles/liquidGlass';
import type { Camp, TabType } from '../../types/trek';

// Icons as simple SVG components
const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const MapIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
);

const PhotoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const StatsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const InfoIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
);

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

type NavMode = 'collapsed' | 'expanded' | 'days';

interface NavOption {
  id: TabType | 'search';
  icon: React.ReactNode;
  label: string;
}

const NAV_OPTIONS: NavOption[] = [
  { id: 'journey', icon: <CalendarIcon />, label: 'Days' },
  { id: 'overview', icon: <MapIcon />, label: 'Map' },
  { id: 'photos', icon: <PhotoIcon />, label: 'Photos' },
  { id: 'stats', icon: <StatsIcon />, label: 'Stats' },
];

interface AdaptiveNavPillProps {
  /** Current selected camp (for context display) */
  selectedCamp: Camp | null;
  /** Total number of days in the journey */
  totalDays: number;
  /** Current active tab */
  activeTab: TabType;
  /** Callback when tab changes */
  onTabChange: (tab: TabType) => void;
  /** Callback when day is selected */
  onDaySelect: (dayNumber: number) => void;
  /** Callback for search action */
  onSearch?: () => void;
  /** Whether the main panel is visible */
  panelVisible?: boolean;
}

export const AdaptiveNavPill = memo(function AdaptiveNavPill({
  selectedCamp,
  totalDays,
  activeTab,
  onTabChange,
  onDaySelect,
  onSearch,
  panelVisible = true,
}: AdaptiveNavPillProps) {
  const [mode, setMode] = useState<NavMode>('collapsed');
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Current day context
  const currentDay = selectedCamp?.dayNumber ?? 1;
  const currentCampName = selectedCamp?.name ?? 'Start';

  // Close pill when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (pillRef.current && !pillRef.current.contains(e.target as Node)) {
        setMode('collapsed');
      }
    };

    if (mode !== 'collapsed') {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [mode]);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handlePillClick = useCallback(() => {
    if (mode === 'collapsed') {
      setMode('expanded');
    }
  }, [mode]);

  const handleOptionClick = useCallback((optionId: TabType | 'search') => {
    if (optionId === 'search') {
      onSearch?.();
      setMode('collapsed');
    } else if (optionId === 'journey') {
      // Show day selector
      setMode('days');
    } else {
      onTabChange(optionId);
      // Delay collapse for visual feedback
      timeoutRef.current = setTimeout(() => setMode('collapsed'), 150);
    }
  }, [onTabChange, onSearch]);

  const handleDayClick = useCallback((dayNumber: number) => {
    onDaySelect(dayNumber);
    // Delay collapse for visual feedback
    timeoutRef.current = setTimeout(() => setMode('collapsed'), 150);
  }, [onDaySelect]);

  const handleBackFromDays = useCallback(() => {
    setMode('expanded');
  }, []);

  // Generate days array
  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Glass style for the pill container
  const glassStyle: React.CSSProperties = {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.12) 0%,
      rgba(255, 255, 255, 0.06) 100%
    )`,
    backdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    WebkitBackdropFilter: `${effects.blur.strong} ${effects.saturation.enhanced}`,
    border: `1px solid ${colors.glass.border}`,
    boxShadow: shadows.glass.elevated,
  };

  // Selection bubble style (for active item)
  const selectionBubbleStyle: React.CSSProperties = {
    background: `linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.18) 0%,
      rgba(255, 255, 255, 0.08) 100%
    )`,
    boxShadow: `
      0 4px 12px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.25),
      0 0 0 1px rgba(255, 255, 255, 0.15)
    `,
  };

  return (
    <div
      ref={pillRef}
      style={{
        position: 'absolute',
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        right: 16,
        zIndex: 50,
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
        transition: `all ${transitions.glass}`,
        opacity: panelVisible ? 0.95 : 1,
      }}
    >
      {/* Main Nav Pill */}
      <div
        onClick={mode === 'collapsed' ? handlePillClick : undefined}
        style={{
          ...glassStyle,
          borderRadius: mode === 'collapsed' ? radius.pill : radius.xl,
          padding: mode === 'collapsed' ? '10px 16px' : '12px 16px',
          cursor: mode === 'collapsed' ? 'pointer' : 'default',
          transition: `all ${transitions.glass}`,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* Collapsed State */}
        {mode === 'collapsed' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: colors.text.primary,
            }}
          >
            <CalendarIcon />
            <span style={{
              fontSize: 14,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}>
              Day {currentDay} <span style={{ color: colors.text.tertiary }}>•</span> {currentCampName}
            </span>
          </div>
        )}

        {/* Expanded State - Navigation Options */}
        {mode === 'expanded' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {NAV_OPTIONS.map((option) => {
              const isActive = option.id === activeTab || (option.id === 'journey' && activeTab === 'journey');
              const isHovered = hoveredOption === option.id;
              const scale = isHovered ? 1.1 : isActive ? 1.05 : 1;

              return (
                <button
                  key={option.id}
                  onClick={() => handleOptionClick(option.id)}
                  onMouseEnter={() => setHoveredOption(option.id)}
                  onMouseLeave={() => setHoveredOption(null)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 14px',
                    background: isActive ? undefined : 'transparent',
                    border: 'none',
                    borderRadius: radius.lg,
                    cursor: 'pointer',
                    color: isActive ? colors.text.primary : colors.text.secondary,
                    transition: `all ${transitions.smooth}`,
                    transform: `scale(${scale})`,
                    position: 'relative',
                    ...(isActive && selectionBubbleStyle),
                  }}
                >
                  {option.icon}
                  <span style={{
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                  }}>
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Days Selector State */}
        {mode === 'days' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {/* Back button */}
            <button
              onClick={handleBackFromDays}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                background: 'transparent',
                border: 'none',
                borderRadius: radius.md,
                cursor: 'pointer',
                color: colors.text.secondary,
                transition: `all ${transitions.smooth}`,
                fontSize: 18,
              }}
            >
              ←
            </button>

            {/* Day pills */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '4px 8px',
              }}
            >
              {days.map((day) => {
                const isActive = day === currentDay;
                const isHovered = hoveredDay === day;
                const scale = isHovered ? 1.15 : isActive ? 1.1 : 1;

                return (
                  <button
                    key={day}
                    onClick={() => handleDayClick(day)}
                    onMouseEnter={() => setHoveredDay(day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    onTouchStart={() => setHoveredDay(day)}
                    onTouchEnd={() => setHoveredDay(null)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: isActive ? 40 : 32,
                      height: isActive ? 40 : 32,
                      background: isActive ? undefined : 'transparent',
                      border: 'none',
                      borderRadius: radius.pill,
                      cursor: 'pointer',
                      color: isActive ? colors.text.primary : colors.text.secondary,
                      fontSize: isActive ? 16 : 14,
                      fontWeight: isActive ? 600 : 500,
                      transition: `all ${transitions.spring}`,
                      transform: `scale(${scale})`,
                      ...(isActive && selectionBubbleStyle),
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Search Pill (separate, always visible when not collapsed) */}
      {mode !== 'collapsed' && onSearch && (
        <button
          onClick={() => {
            onSearch();
            setMode('collapsed');
          }}
          style={{
            ...glassStyle,
            width: 48,
            height: 48,
            borderRadius: radius.pill,
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: colors.text.secondary,
            transition: `all ${transitions.smooth}`,
          }}
        >
          <SearchIcon />
        </button>
      )}
    </div>
  );
});

export default AdaptiveNavPill;
