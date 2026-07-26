import { describe, it, expect } from 'vitest';
import { WEB_WRITES_ENABLED, NATIVE_ONLY_MESSAGE, refuseNativeOnlyWrite } from './nativeOnly';

describe('the native-only guard', () => {
    /**
     * Six components used to await a write stub, ignore the `false` it returned, call
     * `onSave()` and animate shut — RouteEditor discarded an entire route redraw that way.
     * The flag is the single fact those call sites now share. If someone flips it, the
     * writes still do not happen (the adapter is stubbed); only the lying comes back.
     */
    it('keeps web writes off', () => {
        expect(WEB_WRITES_ENABLED).toBe(false);
    });

    it('points the user at the app rather than blaming them', () => {
        expect(NATIVE_ONLY_MESSAGE).toMatch(/iPhone/);
        expect(NATIVE_ONLY_MESSAGE).toMatch(/read-only showcase/);
    });

    /**
     * Loud, not silent: the whole bug this guard exists for was a rejected write that
     * resolved. A refusal must reject, and must name the action so the console tells the
     * owner which control is still wired up.
     */
    it('throws, naming the action', () => {
        expect(() => refuseNativeOnlyWrite('Photo upload')).toThrow(/Photo upload/);
        expect(() => refuseNativeOnlyWrite('Photo upload')).toThrow(/native-only/);
    });
});
