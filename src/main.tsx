import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthGuard } from './components/AuthGuard';

import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <AuthGuard>
            <App />
        </AuthGuard>
    );
}
