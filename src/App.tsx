import { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { JourneysProvider } from './contexts/JourneysContext';

const AkashicApp = lazy(() => import('./components/AkashicApp'));

const LoadingFallback = () => (
    <div style={{
        position: 'fixed',
        inset: 0,
        background: '#0a0a0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255,255,255,0.4)',
        fontSize: 12,
        letterSpacing: '0.2em',
        textTransform: 'uppercase'
    }}>
        Loading...
    </div>
);

function App() {
    return (
        <ErrorBoundary>
            <JourneysProvider>
                <Suspense fallback={<LoadingFallback />}>
                    <AkashicApp />
                </Suspense>
            </JourneysProvider>
        </ErrorBoundary>
    );
}

export default App;
