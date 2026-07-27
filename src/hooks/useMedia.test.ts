import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMedia } from './useMedia';

describe('useMedia', () => {
    /**
     * The hook used to fetch a Supabase session before it could build any URL, so
     * every consumer rendered a spinner first. CloudKit assets need no token, so
     * there is nothing to wait for — `loading` must never start true, or the photo
     * grid flashes empty on every mount.
     */
    it('is ready immediately, with no token', () => {
        const { result } = renderHook(() => useMedia());
        expect(result.current.loading).toBe(false);
        expect(result.current.token).toBeNull();
    });

    it('passes CloudKit asset URLs through', () => {
        const { result } = renderHook(() => useMedia());
        const assetUrl = 'https://cvws.icloud-content.com/B/xyz/photo.jpg?o=tok';
        expect(result.current.getMediaUrl(assetUrl)).toBe(assetUrl);
    });

    /**
     * A photo whose asset fields are missing maps to `url: ''` (`recordToPhoto`), and
     * every caller passes `photo.thumbnail_url || photo.url`. That must stay an empty
     * `<img>` rather than becoming a request to the retired media Worker. LEG-05.
     */
    it('resolves an unusable reference to nothing, not to a host', () => {
        const { result } = renderHook(() => useMedia());
        expect(result.current.getMediaUrl('')).toBe('');
        expect(result.current.getMediaUrl('journeys/j-1/photos/p-1.jpg')).toBe('');
    });
});
