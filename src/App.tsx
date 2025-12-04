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
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
    }}>
        {/* Animated globe skeleton */}
        <div style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
            border: '1px solid rgba(255,255,255,0.1)',
            animation: 'pulse 2s ease-in-out infinite',
        }} />
        {/* Brand text */}
        <div style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: 11,
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
            Akashic
        </div>
        <style>{`
            @keyframes pulse {
                0%, 100% { opacity: 0.5; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.05); }
            }
        `}</style>
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
