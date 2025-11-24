import { Suspense, lazy } from 'react';

const AkashicApp = lazy(() => import('./components/AkashicApp'));

function App() {
    return (
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
    );
}

export default App;
