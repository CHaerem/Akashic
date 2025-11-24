import { Suspense, lazy } from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';

const AkashicApp = lazy(() => import('./components/AkashicApp'));

function App() {
    return (
        <ErrorBoundary>
            <Suspense fallback={
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: '#0a0a0f',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white'
                }}>
                    Loading...
                </div>
            }>
                <AkashicApp />
            </Suspense>
        </ErrorBoundary>
    );
}

export default App;
