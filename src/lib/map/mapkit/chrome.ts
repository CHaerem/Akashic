/**
 * Where Apple's mandatory attribution goes, and where the route is allowed to be. (MAP-03)
 *
 * ## 1. The brief's plan for the attribution was impossible. Here is the measurement.
 *
 * MAP-03 said to find MapKit's attribution DOM class names by inspecting a rendered map, and to translate
 * `src/index.css`'s `.public-chrome .mapboxgl-ctrl-bottom-left { bottom: 80px }` into the MapKit equivalent.
 * The instinct was right and the answer is that **there are no class names**: MapKit JS 5.81.65 paints the
 * Apple Maps logo and the Legal link as pixels onto `canvas.rt-root`.
 *
 * Measured 2026-07-27 (`scripts/mapkit/surface-probe/?probe=attrib`), inside the map container:
 *
 * - `<a>` count **0**, `<svg>` count **0**, `<img>` count **0**, shadow roots **0**
 * - nothing matching `/logo|attribut|legal|copyright|apple/i` in any `className`, `id` or leaf text
 * - `document.elementFromPoint` over the logo *and* over the Legal link both return the same
 *   `div.mk-map-node-element`, which covers the whole map — MapKit hit-tests the click internally
 *
 * So **CSS cannot move Apple's attribution at all.** `map.padding` can: verified by before/after screenshot,
 * `bottom: 80` moves the strip up by exactly 80 px and `left: 40` moves it 40 px right.
 *
 * ## 2. And the app's own chrome is on the LEFT, which the incumbent's camera padding has backwards
 *
 * Found while writing `e2e/mapkit-journey.spec.ts`'s attribution-clearance check, which failed on a `div`
 * with no class covering the band. That div is the desktop journey panel:
 * `src/components/layout/Sidebar.tsx:102-106` is `position: fixed; top: 12; left: 12; bottom: 12;
 * width: 340`, labelled "Desktop: Left Sidebar (Find My macOS style)" at
 * `src/components/AkashicApp.tsx:371`. Measured in the running app at 1280 x 720: rect
 * `[12, 12, 340 x 696]`. It covers the bottom-LEFT of the map, which is exactly where Apple paints.
 *
 * **The incumbent's camera padding clears the wrong side.** `src/hooks/mapbox/useMapbox.ts:1150-1153` pads
 * `right: 450` on the arrival fit and `:1094-1096` pads `right: 400` on a day — pushing the route away from
 * the empty right edge and *into* the sidebar. That is a real defect in the Mapbox surface too, not a MapKit
 * artefact, and it is left alone there: `src/hooks/mapbox/` is MAP-05's territory and may be owned by another
 * in-flight ledger entry. **MAP-03 does not reproduce it.** This is a deliberate deviation from behaviour
 * parity; faithfully porting a framing that hides the route under a panel would be the wrong kind of faithful.
 *
 * ## 3. So the panel clearance is `map.padding`, and it does both jobs at once
 *
 * `map.padding.left` moves Apple's attribution right AND redefines `map.region` as the inset rect, so the
 * camera frames into the visible part of the canvas. One property, both requirements, and the frame padding
 * below reduces to symmetric breathing room.
 *
 * Two consequences to carry:
 *
 * - **`map.padding` insets `map.region`** — measured, `latitudeDelta` 0.021000 → 0.017371 for an 80 px bottom
 *   padding on a 463 px container, with `cameraDistance` unchanged. `onViewportChange` is therefore derived
 *   from the container's corners, not from `region.toBoundingRegion()`, and `./camera.ts` takes the two
 *   paddings as separate arguments so they cannot be double-counted.
 * - **The lift belongs to the adapter, not the stylesheet.** `.public-chrome` is applied at
 *   `AkashicApp.tsx:245` only when signed out, and no CSS media query can see auth state.
 *
 * ## What is NOT verified here
 *
 * The e2e suite cannot reach the signed-out case at all: `src/components/AuthGuard.tsx:92` is
 * `signedIn = isE2ETestMode || user != null`, so every Playwright run is signed in and the 80 px chip band is
 * never applied. `chrome.test.ts` pins the value; the screenshot pair from the probe is the evidence for the
 * effect. `e2e/mapkit-journey.spec.ts` says so where it would otherwise look covered.
 */

import type { EdgeInsets } from './camera';

/**
 * Height of the band the signed-out showcase's own chrome occupies at the bottom of the map.
 *
 * Same value as `src/index.css`'s Mapbox rule, and for the same reason: the bottom-left "Family sign-in" pill
 * and the bottom-right "Made with Akashic" chip. `chrome.test.ts` asserts the two stay equal.
 */
export const SHOWCASE_CHROME_BAND_PX = 80;

/**
 * Horizontal band the desktop journey panel occupies: `left: 12` + `width: 340` + 12 px of clearance.
 * Derived from `Sidebar.tsx`'s own constants rather than eyeballed, and measured at `[12, 12, 340 x 696]`.
 */
export const DESKTOP_PANEL_BAND_PX = 12 + 340 + 12;

/**
 * Vertical band the mobile bottom sheet can occupy.
 *
 * Deliberately the sheet's *large* extent rather than its collapsed peek: the sheet is draggable, and Apple's
 * attribution being visible is a terms requirement, so the conservative inset is the correct one. Matches the
 * `bottom: 280` the incumbent already uses for the mobile arrival fit (`useMapbox.ts:1151`).
 */
export const MOBILE_SHEET_BAND_PX = 280;

export interface ChromeState {
    /** Signed out means the bottom-left sign-in pill and bottom-right "Made with Akashic" chip are mounted. */
    signedOut: boolean;
    isMobile: boolean;
    /** Whether the journey panel (desktop sidebar / mobile bottom sheet) is on screen. */
    panelOpen: boolean;
}

/**
 * What to put in `map.padding` so Apple's logo and Legal link stay visible and clickable, and so the camera
 * frames into the part of the canvas the app is not covering.
 */
export function attributionPadding(state: ChromeState): EdgeInsets {
    const chipBand = state.signedOut ? SHOWCASE_CHROME_BAND_PX : 0;
    if (state.isMobile) {
        return {
            top: 0,
            right: 0,
            // The sheet sits over the chips, so the larger of the two wins rather than their sum.
            bottom: Math.max(chipBand, state.panelOpen ? MOBILE_SHEET_BAND_PX : 0),
            left: 0,
        };
    }
    return {
        top: 0,
        right: 0,
        bottom: chipBand,
        left: state.panelOpen ? DESKTOP_PANEL_BAND_PX : 0,
    };
}

/**
 * Breathing room for the arrival framing — the whole-route fit with no day selected.
 *
 * Symmetric, because the panel clearance is already in {@link attributionPadding}. That is the one place this
 * diverges from `useMapbox.ts:1150-1153`, which pads `right: 450` on desktop — see §2 in the header.
 */
export function arrivalFramePadding(state: { isMobile: boolean }): EdgeInsets {
    return state.isMobile
        ? { top: 80, right: 40, bottom: 40, left: 40 }
        : { top: 100, right: 100, bottom: 100, left: 100 };
}

/** Breathing room for a selected day's segment fit. Same reasoning as {@link arrivalFramePadding}. */
export function dayFramePadding(state: { isMobile: boolean }): EdgeInsets {
    return state.isMobile
        ? { top: 100, right: 50, bottom: 50, left: 50 }
        : { top: 120, right: 120, bottom: 150, left: 120 };
}

/**
 * Zoom for the off-route day branch — a camp more than 10 km from its route gets a plain centred frame rather
 * than a fit over a segment it is not on (`useMapbox.ts:1112-1125`).
 *
 * `e2e/day-navigation.spec.ts:145` asserts `cameraZoom > 14` to prove this branch ran, so these two numbers
 * and `camera.test.ts`'s calibration are a matched pair.
 */
export function offRouteZoom(state: { isMobile: boolean }): number {
    return state.isMobile ? 14.5 : 15;
}

/** Zoom `flyToPhoto` lands on (`useMapbox.ts:1644-1656`). Its pitch 45 has no MapKit equivalent. */
export const PHOTO_ZOOM = 16;

/** Do not zoom in past this when fitting a day's segment (`useMapbox.ts:1103`). */
export const DAY_FIT_MAX_ZOOM = 16;
