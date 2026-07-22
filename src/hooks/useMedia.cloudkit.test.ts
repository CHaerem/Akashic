import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// CloudKit mode: no Supabase session wiring, no bearer token.
vi.mock('../lib/backend', () => ({ isCloudKitBackend: true, dataBackend: 'cloudkit' }));
vi.mock('../lib/supabase', () => ({ supabase: null, isAuthEnabled: false }));

import { useMedia } from './useMedia';

describe('useMedia (cloudkit mode)', () => {
    it('skips supabase wiring: not loading, null token', async () => {
        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.token).toBeNull();
    });

    it('getMediaUrl passes through absolute CKAsset URLs unchanged', async () => {
        const { result } = renderHook(() => useMedia());

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const assetUrl = 'https://cvws.icloud-content.com/B/abc/photo.jpg?o=signed';
        expect(result.current.getMediaUrl(assetUrl)).toBe(assetUrl);
    });
});
