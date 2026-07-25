/**
 * Report-content affordance for the public showcase (moderation, §4.5).
 *
 * Once strangers can publish world-readable journeys into our public database, we
 * own moderation. This is the "report button on web" from the plan: a discreet
 * flag link in the journey view that opens a prefilled `mailto:` to REPORT_EMAIL —
 * no backend, by design. The owner triages via the CloudKit dashboard + takedown
 * script.
 *
 * Signed-in family members never see it: they are the owners, not the public, and
 * a Report link in their own journey is noise. Gated on `useAuth().signedIn`.
 */

import { useAuth } from '../../contexts/AuthContext';
import { colors } from '../../styles/liquidGlass';
import { buildReportMailto } from '../../lib/branding';

interface ReportLinkProps {
    /** The journey slug — also the public record name. Goes into the mailto subject. */
    slug: string;
}

export function ReportLink({ slug }: ReportLinkProps) {
    const { signedIn } = useAuth();
    // Only the public sees this. Owners (signed in) never do.
    if (signedIn) return null;

    return (
        <a
            href={buildReportMailto(slug)}
            aria-label="Report this content"
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                marginTop: 16,
                fontSize: 11,
                color: colors.text.subtle,
                textDecoration: 'none',
                letterSpacing: '0.01em',
                transition: 'color 0.2s ease-out',
            }}
        >
            <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            Report content
        </a>
    );
}
