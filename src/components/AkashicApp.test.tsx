import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Mock journeys data/hooks so the app renders without the real provider
vi.mock('../contexts/JourneysContext', () => ({
    useJourneys: () => ({
        treks: [],
        trekDataMap: {},
        loading: false,
        error: null,
        refetch: vi.fn()
    })
}));

vi.mock('../hooks/useTrekData', () => ({
    useTrekData: () => ({
        view: 'globe',
        selectedTrek: null,
        selectedCamp: null,
        activeTab: 'overview',
        trekData: null,
        extendedStats: null,
        elevationProfile: null,
        loading: false,
        setView: vi.fn(),
        setActiveTab: vi.fn(),
        selectTrek: vi.fn(),
        handleExplore: vi.fn(),
        handleBackToGlobe: vi.fn(),
        handleBackToSelection: vi.fn(),
        handleCampSelect: vi.fn()
    })
}));

import AkashicApp from './AkashicApp';

// Mock Mapbox GL JS
vi.mock('mapbox-gl', () => ({
    default: {
        Map: vi.fn(() => ({
            on: vi.fn(),
            remove: vi.fn(),
            setFog: vi.fn(),
            setTerrain: vi.fn(),
            addSource: vi.fn(),
            addLayer: vi.fn(),
            flyTo: vi.fn(),
            fitBounds: vi.fn(),
            getCanvas: vi.fn(() => ({ style: {} })),
            getLayer: vi.fn(),
            getSource: vi.fn(),
            setLayoutProperty: vi.fn(),
        })),
        LngLatBounds: vi.fn(() => ({
            extend: vi.fn(),
        })),
        accessToken: '',
    },
}));

// Mock environment variables
vi.stubGlobal('import.meta', { env: { VITE_MAPBOX_TOKEN: 'test-token' } });

describe('AkashicApp', () => {
    it('renders without crashing', () => {
        render(<AkashicApp />);
        expect(screen.getByText('Akashic')).toBeInTheDocument();
    });
});
