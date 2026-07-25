import { describe, it, expect } from 'vitest';
import {
    APP_NAME,
    LANDING_URL,
    REPORT_EMAIL,
    SUPPORT_EMAIL,
    LEGAL_LINKS,
    buildReportMailto,
} from './branding';

describe('branding constants', () => {
    it('exports the public-facing name and outbound targets', () => {
        expect(APP_NAME).toBe('Akashic');
        expect(LANDING_URL).toMatch(/^https?:\/\//);
        expect(REPORT_EMAIL).toContain('@');
        expect(SUPPORT_EMAIL).toContain('@');
    });

    it('points the legal/support links at the static pages', () => {
        expect(LEGAL_LINKS.privacy).toBe('/privacy.html');
        expect(LEGAL_LINKS.terms).toBe('/terms.html');
        expect(LEGAL_LINKS.support).toBe('/support.html');
    });

    it('builds a report mailto with an encoded subject carrying the slug', () => {
        const mailto = buildReportMailto('mont-blanc');
        expect(mailto.startsWith(`mailto:${REPORT_EMAIL}?`)).toBe(true);
        expect(mailto).toContain('subject=');
        expect(decodeURIComponent(mailto)).toContain('Report content: mont-blanc');
    });
});
