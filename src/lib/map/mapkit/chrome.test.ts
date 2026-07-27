import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    DESKTOP_PANEL_BAND_PX, MOBILE_SHEET_BAND_PX, SHOWCASE_CHROME_BAND_PX,
    arrivalFramePadding, attributionPadding, dayFramePadding, offRouteZoom,
} from './chrome';

const SRC = resolve(process.cwd(), 'src');

describe('attribution padding (MAP-03)', () => {
    it('lifts Apple\'s logo clear of the signed-out chips, and only when they are mounted', () => {
        // MEASURED (scripts/mapkit/surface-probe/?probe=attrib): map.padding.bottom = 80 moves the painted
        // " Maps · Legal" strip up by exactly 80 px, out from under the "Family sign-in" pill. There is no
        // DOM to select — Apple paints it onto canvas.rt-root — so this property is the ONLY lever.
        expect(attributionPadding({ signedOut: true, isMobile: false, panelOpen: false }))
            .toEqual({ top: 0, right: 0, bottom: 80, left: 0 });
        expect(attributionPadding({ signedOut: false, isMobile: false, panelOpen: false }))
            .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });

    it('clears the DESKTOP panel on the LEFT, which is the side it is actually on', () => {
        // Sidebar.tsx:102-106 is `position: fixed; top: 12; left: 12; bottom: 12; width: 340`, labelled
        // "Desktop: Left Sidebar". Measured in the running app at [12, 12, 340 x 696] — it covers the
        // bottom-left corner Apple paints into. The incumbent pads `right: 450` instead; see chrome.ts §2.
        const padding = attributionPadding({ signedOut: false, isMobile: false, panelOpen: true });
        expect(padding.left).toBe(DESKTOP_PANEL_BAND_PX);
        expect(padding.right).toBe(0);
        expect(padding.left).toBeGreaterThan(padding.right);
    });

    it('clears the MOBILE sheet at the bottom, taking the larger of sheet and chips', () => {
        // The sheet sits over the chips, so the two are not additive.
        expect(attributionPadding({ signedOut: true, isMobile: true, panelOpen: true }).bottom)
            .toBe(MOBILE_SHEET_BAND_PX);
        expect(attributionPadding({ signedOut: true, isMobile: true, panelOpen: false }).bottom)
            .toBe(SHOWCASE_CHROME_BAND_PX);
        expect(attributionPadding({ signedOut: false, isMobile: true, panelOpen: false }).bottom).toBe(0);
        // And nothing on the left: the mobile panel is a bottom sheet, not a sidebar.
        expect(attributionPadding({ signedOut: true, isMobile: true, panelOpen: true }).left).toBe(0);
    });

    it('derives the desktop band from Sidebar.tsx\'s own constants, not from a guess', () => {
        // If someone changes SIDEBAR_WIDTH, Apple's attribution silently slides back under the panel. This is
        // the cheapest possible tripwire for that.
        const sidebar = readFileSync(resolve(SRC, 'components/layout/Sidebar.tsx'), 'utf8');
        const width = sidebar.match(/const SIDEBAR_WIDTH = (\d+)/);
        const left = sidebar.match(/position: 'fixed',[\s\S]{0,120}?left: (\d+),/);
        expect(width, 'Sidebar.tsx no longer declares SIDEBAR_WIDTH — re-derive DESKTOP_PANEL_BAND_PX')
            .not.toBeNull();
        expect(left, 'Sidebar.tsx no longer positions itself with a numeric `left`').not.toBeNull();
        expect(DESKTOP_PANEL_BAND_PX).toBeGreaterThanOrEqual(Number(width![1]) + Number(left![1]));
    });

    it('uses the same 80 px band the Mapbox stylesheet rule does', () => {
        // Both surfaces are lifting clear of the same two chips. If they diverge, one vendor's attribution is
        // wrong — and the CSS one cannot be found by grepping for this constant, so assert against the file.
        const css = readFileSync(resolve(SRC, 'index.css'), 'utf8');
        const rule = css.match(/\.public-chrome \.mapboxgl-ctrl-bottom-left,[\s\S]{0,1600}?bottom: (\d+)px;/);
        expect(rule, 'the Mapbox attribution lift rule is gone from src/index.css — if MAP-05 removed it, '
            + 'delete this assertion; if something else did, Mapbox\'s attribution is now under the chips')
            .not.toBeNull();
        expect(Number(rule![1])).toBe(SHOWCASE_CHROME_BAND_PX);
    });
});

describe('frame padding (MAP-03)', () => {
    it('is symmetric on desktop, because the panel clearance lives in map.padding', () => {
        // The incumbent's asymmetric `right: 450` (useMapbox.ts:1150-1153) clears the EMPTY side and frames
        // the route INTO the left sidebar. Reproducing it here would have been porting a defect.
        const desktop = arrivalFramePadding({ isMobile: false });
        expect(desktop.left).toBe(desktop.right);
        expect(desktop).toEqual({ top: 100, right: 100, bottom: 100, left: 100 });
        expect(dayFramePadding({ isMobile: false }).left).toBe(dayFramePadding({ isMobile: false }).right);
    });

    it('keeps mobile room at the top for the brand chip', () => {
        const mobile = arrivalFramePadding({ isMobile: true });
        expect(mobile.top).toBeGreaterThan(mobile.bottom);
        expect(mobile).toEqual({ top: 80, right: 40, bottom: 40, left: 40 });
        expect(dayFramePadding({ isMobile: true })).toEqual({ top: 100, right: 50, bottom: 50, left: 50 });
    });
});

describe('off-route zoom (MAP-03)', () => {
    it('stays above the e2e branch threshold on both viewports', () => {
        // e2e/day-navigation.spec.ts:145 asserts cameraZoom > 14 to prove the off-route branch ran. These two
        // numbers and camera.test.ts's calibration are a matched pair.
        expect(offRouteZoom({ isMobile: false })).toBe(15);
        expect(offRouteZoom({ isMobile: true })).toBe(14.5);
        expect(offRouteZoom({ isMobile: true })).toBeGreaterThan(14);
    });
});
