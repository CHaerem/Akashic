/**
 * The one place that decides whether the web client may write.
 *
 * It may not. The web client is frozen as a **showcase view** (decision, 2026-07-26):
 * signed-out viewing and day comments stay; everything that mutates a journey is
 * native-only.
 *
 * That is not a policy we are choosing to enforce here — it is already physically true,
 * and this module exists so the UI stops lying about it. `journeyAPI.ts` makes the
 * CloudKit adapter the only backend, and every mutating function in that adapter is
 * `console.warn(CK_UNSUPPORTED); return false` (`adapters/cloudkit/journeyAdapter.ts:168`,
 * pinned by `adapters/cloudkit/writeStubs.test.ts`). A web control that offers a write
 * therefore cannot perform one. It can only *look* like it did — await the stub, ignore
 * the `false`, call `onSave()`, and animate shut over the user's discarded work.
 *
 * So: do not render the affordance. Render {@link NativeOnlyNotice} instead
 * (`components/common/NativeOnlyNotice.tsx`), and if a code path can still reach an
 * upload or delete, make it throw via {@link refuseNativeOnlyWrite} rather than resolve.
 * A loud failure is recoverable; a silent one is not.
 */

/**
 * Whether the web client may perform journey writes. Constant `false` — the flag is here
 * so the reason is greppable and lives in exactly one file, not so it can be flipped.
 * Flipping it does not create a backend; see the module note above.
 */
export const WEB_WRITES_ENABLED = false;

/** Shown to the user wherever an edit control used to be. */
export const NATIVE_ONLY_MESSAGE =
    'Editing happens in the Akashic app for iPhone. This page is a read-only showcase.';

/**
 * Fail a native-only write loudly.
 *
 * Callers must not catch this into a success path. `action` should name what the user
 * was trying to do, in words they would recognise ("Photo upload", "Photo deletion").
 */
export function refuseNativeOnlyWrite(action: string): never {
    throw new Error(`[native-only] ${action} is not available on the web — ${NATIVE_ONLY_MESSAGE}`);
}
