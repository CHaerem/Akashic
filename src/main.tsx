import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import './index.css';
import App from './App';
import { AuthGuard } from './components/AuthGuard';

import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;

const rootElement = document.getElementById('root');
if (rootElement) {
    // If Auth0 is not configured, render app without auth
    if (!domain || !clientId) {
        createRoot(rootElement).render(<App />);
    } else {
        createRoot(rootElement).render(
            <Auth0Provider
                domain={domain}
                clientId={clientId}
                authorizationParams={{
                    redirect_uri: window.location.origin + import.meta.env.BASE_URL,
                }}
            >
                <AuthGuard>
                    <App />
                </AuthGuard>
            </Auth0Provider>
        );
    }
}
