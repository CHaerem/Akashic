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
 * Where the attribution chip points — the return path of the whole share funnel.
 *
 * Was `https://akashic.no/#about`, and `grep -rn 'id="about"' src public index.html` returned
 * nothing: there has never been an `#about` section anywhere, so the one link that turns a
 * visitor into a customer scrolled to the top of the page and did nothing (DIFF-03).
 *
 * Now the showcase root, which exists and is itself the pitch: a rotating globe of real
 * journeys. That is a real target, not a placeholder. It is still not a *strong* one — there is
 * no "what is Akashic / get the app" surface yet — but the destination that closes the funnel is
 * the App Store listing, and building an interim marketing page that the listing will immediately
 * supersede is work with a short shelf life. Swap this to the store URL at launch (§4.6); it is
 * the single source of truth, so that is a one-line change.
 */
export const LANDING_URL = 'https://akashic.no/';

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
