/**
 * Branding & outbound links — one place to swap public-facing URLs and addresses.
 *
 * The public showcase (signed-out) is a marketing funnel: every published journey
 * is a shareable page carrying a discreet "Made with Akashic" chip, a moderation
 * "Report" affordance, and links to the static legal/support pages. Those targets
 * are collected here so they are one-line-swappable — most importantly, when the
 * App Store listing goes live, `LANDING_URL` becomes the store link without hunting
 * through components.
 */

/** Product name, used in attribution and mailto copy. */
export const APP_NAME = 'Akashic';

/**
 * Where the attribution chip points. For now the marketing anchor on the site;
 * swap to the App Store URL at launch (§4.6). Single source of truth — change here.
 */
export const LANDING_URL = 'https://akashic.no/#about';

/** Moderation inbox for the public-showcase "Report" affordance (§4.5). No backend. */
export const REPORT_EMAIL = 'report@akashic.no';

/** General support inbox, surfaced on /support.html and the public footer. */
export const SUPPORT_EMAIL = 'support@akashic.no';

/** Static legal/support pages served by GitHub Pages (see public/*.html). */
export const LEGAL_LINKS = {
    privacy: '/privacy.html',
    terms: '/terms.html',
    support: '/support.html',
} as const;

/**
 * Build the prefilled `mailto:` for reporting a public journey. No server: the
 * report is a plain email the visitor sends, the owner triages via the CloudKit
 * dashboard + takedown script (§4.5).
 */
export function buildReportMailto(journeySlug: string): string {
    const subject = `Report content: ${journeySlug}`;
    const body = [
        `Journey: ${journeySlug}`,
        `Link: ${typeof window !== 'undefined' ? window.location.href : ''}`,
        '',
        'Please describe the reason for your report (e.g. inappropriate,',
        'inaccurate, or infringing content):',
        '',
    ].join('\n');
    return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
