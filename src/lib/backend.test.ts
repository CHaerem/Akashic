import { describe, it, expect, vi, afterEach } from 'vitest';

describe('data backend flag', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('defaults to supabase when VITE_DATA_BACKEND is unset', async () => {
        vi.resetModules();
        const mod = await import('./backend');
        expect(mod.dataBackend).toBe('supabase');
        expect(mod.isCloudKitBackend).toBe(false);
    });

    it('selects cloudkit when VITE_DATA_BACKEND=cloudkit', async () => {
        vi.stubEnv('VITE_DATA_BACKEND', 'cloudkit');
        vi.resetModules();
        const mod = await import('./backend');
        expect(mod.dataBackend).toBe('cloudkit');
        expect(mod.isCloudKitBackend).toBe(true);
    });

    it('falls back to supabase for any other value', async () => {
        vi.stubEnv('VITE_DATA_BACKEND', 'firebase');
        vi.resetModules();
        const mod = await import('./backend');
        expect(mod.dataBackend).toBe('supabase');
        expect(mod.isCloudKitBackend).toBe(false);
    });
});
