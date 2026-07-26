import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { AuthGuard } from './components/AuthGuard';
import { ThemeProvider } from './contexts/ThemeContext';

import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const rootElement = document.getElementById('root');
if (rootElement) {
    // No defaultTheme prop: the Liquid Glass design is dark-only, so ThemeProvider hard-codes
    // 'dark' and accepts no theme prop. Passing one implied a choice that does not exist.
    createRoot(rootElement).render(
        <ThemeProvider>
            <AuthGuard>
                <App />
            </AuthGuard>
        </ThemeProvider>
    );
}
