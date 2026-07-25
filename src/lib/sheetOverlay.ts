/**
 * Tiny shared signal: is a bottom-anchored sheet currently covering the
 * bottom-right public chrome (the "Made with Akashic" chip + legal links)?
 *
 * The chip is mounted by `AuthGuard`, a sibling of the app that owns the sheet
 * state, so the two can't prop-drill. On mobile the full-width `BottomSheet`
 * sits exactly where the chip does; when it is open the chip would overlay —
 * and steal taps from — the sheet's controls (qg-web finding #2, and its legal
 * links would navigate away mid-browse). `AkashicApp` pushes `true` while the
 * mobile sheet is open; `Attribution` reads it and steps aside so the sheet
 * owns every tap in that region. On the plain globe the signal is `false` and
 * the chip stays visible.
 */
import { useSyncExternalStore } from 'react';

let covered = false;
const listeners = new Set<() => void>();

/** Called by the app: true while a bottom sheet covers the public chrome. */
export function setSheetCoversChrome(value: boolean): void {
    if (covered === value) return;
    covered = value;
    for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
    listeners.add(callback);
    return () => {
        listeners.delete(callback);
    };
}

/** Read whether a bottom sheet currently covers the bottom-right chrome. */
export function useSheetCoversChrome(): boolean {
    return useSyncExternalStore(subscribe, () => covered, () => false);
}
