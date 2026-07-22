import { describe, it, expect, vi } from 'vitest';

// Default (supabase) backend is NOT mocked here, proving the absolute-URL
// passthrough is safe in supabase mode too (relative paths keep their token).
vi.mock('./supabase', () => ({ supabase: null, isAuthEnabled: false }));

import { buildMediaUrl } from './media';

describe('buildMediaUrl absolute passthrough (supabase mode)', () => {
    it('returns absolute http(s) URLs unchanged', () => {
        const url = 'https://example.com/x.jpg';
        expect(buildMediaUrl(url)).toBe(url);
        expect(buildMediaUrl(url, 'tok')).toBe(url);
        expect(buildMediaUrl('http://example.com/y.jpg', 'tok')).toBe('http://example.com/y.jpg');
    });

    it('still appends the token for relative paths', () => {
        expect(buildMediaUrl('journeys/1/photos/a.jpg', 'tok')).toBe(
            'https://akashic-media.chris-haerem.workers.dev/journeys/1/photos/a.jpg?token=tok'
        );
    });
});
