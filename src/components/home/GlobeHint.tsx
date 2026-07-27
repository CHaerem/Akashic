import { useJourneys } from '../../contexts/JourneysContext';

interface GlobeHintProps {
    isMobile: boolean;
}

/**
 * The one line that tells a visitor the globe is interactive. (QUA-43)
 *
 * ## It used to lie, on the live site
 *
 * Found on akashic.no minutes after HTTPS came up, 2026-07-27: the production mirror holds zero published
 * journeys, and this rendered anyway — an empty rotating Earth captioned "CLICK A MARKER TO EXPLORE". That
 * was the first thing every visitor to a paid product saw, and it asked them to do something impossible.
 *
 * The gate lives HERE rather than at the call site on purpose. `AkashicApp` knew only
 * `!selectedTrek && view === 'globe'`, which is about navigation state; whether there is anything to click
 * is this component's own business, and reading it from `useJourneys` means the next person who mounts the
 * hint somewhere else cannot reintroduce the bug by forgetting a condition.
 *
 * Deliberately silent rather than apologetic when the showcase is empty. A rotating Earth with the wordmark
 * reads as a product landing page, which is what it is; "no journeys published yet" would advertise
 * emptiness to someone with no reason to care. NOTE the limit of that choice: `treks` is also empty when the
 * CloudKit fetch FAILED, because the adapter returns an empty result on error — so silence here hides a
 * failed load as well as an empty one. Surfacing that is a separate concern and does not belong in a hint.
 *
 * ## Position
 *
 * Bottom-centre on every viewport, not just mobile. It used to sit at `right: 24` on desktop with no
 * z-index, which put it underneath the "Made with Akashic" chip — measured at 1280×720, the hint occupied
 * (1080, 681, 176×15) and `document.elementFromPoint` at its right edge returned the chip's anchor, so the
 * line read as "CLICK" with the rest covered. Bottom-right is the crowded corner: Mapbox's attribution bar,
 * its Privacy/Terms/Support links and that chip all live there. Centring removes the collision outright
 * instead of negotiating pixels with three other elements, and it collapses a mobile/desktop divergence
 * that existed for no reason.
 */
export function GlobeHint({ isMobile }: GlobeHintProps) {
    const { treks, loading } = useJourneys();

    // Nothing to click, or we do not yet know — either way the instruction would be false. `loading` is
    // checked separately from the count because without it the hint flashes in and out on first paint.
    if (loading || treks.length === 0) return null;

    return (
        <div style={{
            position: 'absolute',
            bottom: isMobile ? 'max(24px, env(safe-area-inset-bottom))' : 24,
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.3)',
            fontSize: isMobile ? 11 : 10,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            textAlign: 'center',
            // Bottom-centre is clear of the sign-in pill and Mapbox logo (both bottom-left) and of the
            // attribution and chip (bottom-right), but without this a cursor crossing the line would still
            // steal a drag from the globe underneath.
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
        }}>
            {isMobile ? 'Tap a marker to explore' : 'Click a marker to explore'}
        </div>
    );
}
