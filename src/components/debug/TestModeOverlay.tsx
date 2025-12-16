/**
 * Debug overlay for E2E/visual testing
 * Shows current app state to help AI testers understand what's happening
 */

import { colors } from '../../styles/liquidGlass';

const isE2ETestMode = import.meta.env.VITE_E2E_TEST_MODE === 'true';

interface TestModeOverlayProps {
    view: 'globe' | 'trek';
    selectedJourney: string | null;
    selectedDay: number | null;
    totalDays: number;
    activeMode: string;
}

export function TestModeOverlay({
    view,
    selectedJourney,
    selectedDay,
    totalDays,
    activeMode
}: TestModeOverlayProps) {
    // Only show in E2E test mode
    if (!isE2ETestMode) return null;

    return (
        <div
            data-testid="test-mode-overlay"
            style={{
                position: 'fixed',
                top: 8,
                right: 8,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 11,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                color: colors.text.secondary,
                pointerEvents: 'none',
                maxWidth: 200,
            }}
        >
            <div style={{ color: '#22c55e', marginBottom: 4, fontWeight: 600 }}>
                🧪 TEST MODE
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>View: <strong style={{ color: colors.text.primary }}>{view}</strong></span>
                <span>Journey: <strong style={{ color: colors.text.primary }}>{selectedJourney || 'none'}</strong></span>
                {view === 'trek' && (
                    <>
                        <span>Day: <strong style={{ color: colors.text.primary }}>{selectedDay ?? 'overview'}</strong> / {totalDays}</span>
                        <span>Tab: <strong style={{ color: colors.text.primary }}>{activeMode}</strong></span>
                    </>
                )}
            </div>
            <div style={{ marginTop: 6, fontSize: 9, opacity: 0.6, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4 }}>
                URL hints:<br />
                ?journey=kilimanjaro<br />
                ?journey=kili&day=3
            </div>
        </div>
    );
}
