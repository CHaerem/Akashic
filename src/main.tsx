import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthGuard } from './components/AuthGuard';
import { ThemeProvider } from './contexts/ThemeContext';

import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (rootElement) {
    createRoot(rootElement).render(
        <ThemeProvider defaultTheme="system">
            <AuthGuard>
                <App />
            </AuthGuard>
        </ThemeProvider>
    );
}
