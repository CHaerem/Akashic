import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AkashicApp from './AkashicApp';

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
