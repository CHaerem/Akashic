import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
