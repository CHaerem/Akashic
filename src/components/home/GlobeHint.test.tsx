import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GlobeHint } from './GlobeHint';
import type { TrekConfig } from '../../types/trek';

/**
 * QUA-43 — the hint that told live visitors to click a marker that did not exist.
 *
 * This file exists because the defect shipped to production and no test could have caught it: the old
 * component took only `isMobile` and always rendered, so there was nothing to assert about. The gate is the
 * whole behaviour now, so it gets the coverage.
 */

const useJourneys = vi.hoisted(() => vi.fn());
vi.mock('../../contexts/JourneysContext', () => ({ useJourneys }));

/** Only the fields the component reads; a full TrekConfig is irrelevant here. */
const trek = (id: string) => ({ id }) as TrekConfig;

function state(over: Partial<{ treks: TrekConfig[]; loading: boolean }> = {}) {
    useJourneys.mockReturnValue({
        treks: [], trekDataMap: {}, loading: false, error: null, refetch: vi.fn(), ...over,
    });
}

beforeEach(() => useJourneys.mockReset());

describe('GlobeHint', () => {
    /**
     * **The regression this file is here for.** akashic.no held zero published journeys and the hint rendered
     * anyway, so the first thing every visitor to a paid product saw was an empty rotating Earth captioned
     * "CLICK A MARKER TO EXPLORE".
     */
    it('renders nothing when there are no journeys, because there is nothing to click', () => {
        state({ treks: [] });
        const { container } = render(<GlobeHint isMobile={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    /** Without this the hint appears, vanishes and reappears on first paint. */
    it('renders nothing while journeys are still loading', () => {
        state({ treks: [trek('kilimanjaro')], loading: true });
        const { container } = render(<GlobeHint isMobile={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('appears once there is at least one marker', () => {
        state({ treks: [trek('kilimanjaro')] });
        render(<GlobeHint isMobile={false} />);
        expect(screen.getByText('Click a marker to explore')).toBeInTheDocument();
    });

    it('says tap on mobile', () => {
        state({ treks: [trek('kilimanjaro')] });
        render(<GlobeHint isMobile />);
        expect(screen.getByText('Tap a marker to explore')).toBeInTheDocument();
    });

    /**
     * The second half of QUA-43. On desktop the hint sat at `right: 24` with no z-index, underneath the
     * "Made with Akashic" chip — measured at 1280×720 it occupied (1080, 681, 176×15) and
     * `document.elementFromPoint` at its right edge returned the chip's anchor, so the line read as "CLICK".
     * Bottom-right holds Mapbox's attribution bar, its Privacy/Terms/Support links and that chip; centring
     * removes the collision outright rather than negotiating pixels with three other elements.
     *
     * Asserted on the inline style because that is where the bug lived — a snapshot would drift with every
     * copy edit and tell us nothing about the overlap.
     */
    it.each([true, false])('centres itself rather than crowding the bottom-right (isMobile=%s)', isMobile => {
        state({ treks: [trek('kilimanjaro')] });
        render(<GlobeHint isMobile={isMobile} />);
        const el = screen.getByText(/a marker to explore/);
        expect(el.style.left).toBe('50%');
        expect(el.style.transform).toBe('translateX(-50%)');
        expect(el.style.right).toBe('');          // the old value was `24px` on desktop
    });

    /** A hint is decoration; it must not eat a drag meant for the globe underneath. */
    it('does not intercept pointer events', () => {
        state({ treks: [trek('kilimanjaro')] });
        render(<GlobeHint isMobile={false} />);
        expect(screen.getByText(/a marker to explore/).style.pointerEvents).toBe('none');
    });
});
