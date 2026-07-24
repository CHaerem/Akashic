/**
 * Public-showcase footer (signed-out only).
 *
 * The signed-out visitor is looking at a shared, world-readable journey — the
 * marketing funnel. This adds a tasteful bottom-right cluster:
 *   - "Made with Akashic ↗", a subtle liquid-glass chip pointing at the landing
 *     anchor (LANDING_URL — the App Store link later, §4.6);
 *   - a discreet Privacy · Terms · Support row so the static legal/support pages
 *     are reachable without opening any modal (App Store + moderation want this).
 *
 * Placement is bottom-right to stay clear of AuthGuard's bottom-left "Family
 * sign-in" pill and the top-right quick-action bar. It mirrors that pill's fixed
 * z-index:50 layer, so the two read as a matched pair. Signed-in family members
 * never see this — AuthGuard only mounts it for genuine signed-out visitors.
 */

import { colors, radius } from '../../styles/liquidGlass';
import { APP_NAME, LANDING_URL, LEGAL_LINKS } from '../../lib/branding';

const legalLinkStyle: React.CSSProperties = {
    color: colors.text.subtle,
    textDecoration: 'none',
    transition: 'color 0.2s ease-out',
};

export function Attribution() {
    return (
        <div
            style={{
                position: 'fixed',
                bottom: 'max(20px, env(safe-area-inset-bottom))',
                right: 'max(20px, env(safe-area-inset-right))',
                zIndex: 50,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 8,
                pointerEvents: 'none',
            }}
        >
            {/* Legal / support links — very subtle, reachable without a modal. */}
            <nav
                aria-label="Legal and support"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 10.5,
                    letterSpacing: '0.02em',
                    pointerEvents: 'auto',
                }}
            >
                <a href={LEGAL_LINKS.privacy} style={legalLinkStyle}>Privacy</a>
                <span aria-hidden="true" style={{ color: colors.text.disabled }}>·</span>
                <a href={LEGAL_LINKS.terms} style={legalLinkStyle}>Terms</a>
                <span aria-hidden="true" style={{ color: colors.text.disabled }}>·</span>
                <a href={LEGAL_LINKS.support} style={legalLinkStyle}>Support</a>
            </nav>

            {/* "Made with Akashic" attribution chip. */}
            <a
                href={LANDING_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Made with ${APP_NAME} — learn more`}
                style={{
                    pointerEvents: 'auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: radius.pill,
                    border: `1px solid ${colors.glass.border}`,
                    background: 'rgba(20, 20, 24, 0.55)',
                    backdropFilter: 'blur(16px) saturate(180%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(180%)',
                    color: colors.text.secondary,
                    fontSize: 12,
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                    textDecoration: 'none',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                }}
            >
                Made with {APP_NAME}
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
                    style={{ opacity: 0.7 }}
                >
                    <path d="M7 17 17 7M7 7h10v10" />
                </svg>
            </a>
        </div>
    );
}
