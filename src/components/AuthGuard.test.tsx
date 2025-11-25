import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthGuard } from './AuthGuard';

const mockLoginWithRedirect = vi.fn();

vi.mock('@auth0/auth0-react', () => ({
    useAuth0: vi.fn(),
}));

import { useAuth0 } from '@auth0/auth0-react';

describe('AuthGuard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading spinner while Auth0 is loading', () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: true,
            isAuthenticated: false,
            loginWithRedirect: mockLoginWithRedirect,
            error: undefined,
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        expect(screen.getByText('Redirecting to login...')).toBeInTheDocument();
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('redirects to login when not authenticated', async () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
            loginWithRedirect: mockLoginWithRedirect,
            error: undefined,
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        await waitFor(() => {
            expect(mockLoginWithRedirect).toHaveBeenCalledTimes(1);
        });

        expect(screen.getByText('Redirecting to login...')).toBeInTheDocument();
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('renders children when authenticated', () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: false,
            isAuthenticated: true,
            loginWithRedirect: mockLoginWithRedirect,
            error: undefined,
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        expect(screen.getByText('Protected Content')).toBeInTheDocument();
        expect(screen.queryByText('Redirecting to login...')).not.toBeInTheDocument();
        expect(mockLoginWithRedirect).not.toHaveBeenCalled();
    });

    it('does not redirect while still loading', () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: true,
            isAuthenticated: false,
            loginWithRedirect: mockLoginWithRedirect,
            error: undefined,
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        expect(mockLoginWithRedirect).not.toHaveBeenCalled();
    });

    it('shows access denied when there is an auth error', () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
            loginWithRedirect: mockLoginWithRedirect,
            error: new Error('unauthorized_email'),
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        expect(screen.getByText('Access Denied')).toBeInTheDocument();
        expect(screen.getByText(/This is a private application/)).toBeInTheDocument();
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
        expect(mockLoginWithRedirect).not.toHaveBeenCalled();
    });

    it('does not redirect when there is an error', () => {
        vi.mocked(useAuth0).mockReturnValue({
            isLoading: false,
            isAuthenticated: false,
            loginWithRedirect: mockLoginWithRedirect,
            error: new Error('access_denied'),
        } as ReturnType<typeof useAuth0>);

        render(
            <AuthGuard>
                <div>Protected Content</div>
            </AuthGuard>
        );

        expect(mockLoginWithRedirect).not.toHaveBeenCalled();
    });
});
