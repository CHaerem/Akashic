import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AuthContext, type AuthState } from '../../contexts/AuthContext';
import { ReportLink } from './ReportLink';
import { REPORT_EMAIL } from '../../lib/branding';

function renderWithAuth(state: AuthState) {
    return render(
        <AuthContext.Provider value={state}>
            <ReportLink slug="kilimanjaro" />
        </AuthContext.Provider>
    );
}

describe('ReportLink — public showcase moderation affordance', () => {
    it('renders for a signed-out visitor with a prefilled report mailto', () => {
        renderWithAuth({ signedIn: false, loading: false });

        const link = screen.getByRole('link', { name: /report this content/i });
        const href = link.getAttribute('href') ?? '';
        expect(href.startsWith(`mailto:${REPORT_EMAIL}`)).toBe(true);
        // Subject carries the journey slug so triage knows what was reported.
        expect(decodeURIComponent(href)).toContain('Report content: kilimanjaro');
    });

    it('is hidden for signed-in family members (owners never report their own journey)', () => {
        renderWithAuth({ signedIn: true, loading: false });

        expect(screen.queryByRole('link', { name: /report this content/i })).toBeNull();
    });
});
