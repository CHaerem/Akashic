import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AkashicApp from './AkashicApp';

// Mock Mapbox GL JS
vi.mock('mapbox-gl', () => ({
    default: {
        Map: vi.fn(() => ({
            on: vi.fn(),
            off: vi.fn(),
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
            getContainer: vi.fn(() => document.createElement('div')),
            getBearing: vi.fn(() => 0),
            getPitch: vi.fn(() => 0),
            getZoom: vi.fn(() => 2),
            getCenter: vi.fn(() => ({ lng: 0, lat: 0 })),
            getStyle: vi.fn(() => ({ layers: [] })),
            setPaintProperty: vi.fn(),
            easeTo: vi.fn(),
            rotateTo: vi.fn(),
            isMoving: vi.fn(() => false),
            isStyleLoaded: vi.fn(() => true),
            loaded: vi.fn(() => true),
            resize: vi.fn(),
        })),
        LngLatBounds: vi.fn(() => ({
            extend: vi.fn().mockReturnThis(),
            isEmpty: vi.fn(() => false),
        })),
        accessToken: '',
    },
}));

// Mock contexts and hooks
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
        setActiveTab: vi.fn(),
        selectTrek: vi.fn(),
        handleExplore: vi.fn(),
        handleBackToGlobe: vi.fn(),
        handleBackToSelection: vi.fn(),
        handleCampSelect: vi.fn()
    })
}));

vi.mock('../hooks/useMedia', () => ({
    useMedia: () => ({
        getMediaUrl: vi.fn((path: string) => `https://example.com/${path}`)
    })
}));

vi.mock('../hooks/useMediaQuery', () => ({
    useIsMobile: () => false
}));

vi.mock('../lib/shareTarget', () => ({
    hasPendingShares: vi.fn().mockResolvedValue(false)
}));

vi.mock('../lib/journeys', () => ({
    fetchPhotos: vi.fn().mockResolvedValue([]),
    getJourneyIdBySlug: vi.fn().mockResolvedValue(null)
}));

// Mock child components to avoid their own hook requirements
vi.mock('./MapboxGlobe', () => ({
    MapboxGlobe: () => <div data-testid="mapbox-globe">MapboxGlobe</div>
}));

vi.mock('./home/GlobeSelectionPanel', () => ({
    GlobeSelectionPanel: () => <div data-testid="globe-selection-panel">GlobeSelectionPanel</div>
}));

vi.mock('./home/GlobeHint', () => ({
    GlobeHint: () => null
}));

vi.mock('./OfflineIndicator', () => ({
    OfflineIndicator: () => null
}));

describe('AkashicApp', () => {
    it('renders without crashing', () => {
        render(<AkashicApp />);
        expect(screen.getByText('Akashic')).toBeInTheDocument();
    });
});
