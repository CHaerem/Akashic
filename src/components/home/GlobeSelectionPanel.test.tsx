import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GlobeSelectionPanel } from './GlobeSelectionPanel';
import { TrekConfig } from '../../types/trek';

const mockTrek: TrekConfig = {
    id: 'test-trek',
    name: 'Test Trek',
    country: 'Test Country',
    elevation: '5000m',
    coordinates: [0, 0],
    zoom: 10,
    pitch: 45,
    bearing: 0
};

describe('GlobeSelectionPanel', () => {
    it('renders trek details', () => {
        render(
            <GlobeSelectionPanel
                selectedTrek={mockTrek}
                onBack={() => {}}
                onExplore={() => {}}
                isMobile={false}
            />
        );
        expect(screen.getByText('Test Trek')).toBeInTheDocument();
        expect(screen.getByText('Test Country')).toBeInTheDocument();
        expect(screen.getByText('Summit: 5000m')).toBeInTheDocument();
    });

    it('calls onBack when back button clicked', () => {
        const handleBack = vi.fn();
        render(
            <GlobeSelectionPanel
                selectedTrek={mockTrek}
                onBack={handleBack}
                onExplore={() => {}}
                isMobile={false}
            />
        );
        fireEvent.click(screen.getByText('← Back'));
        expect(handleBack).toHaveBeenCalled();
    });

    it('calls onExplore when explore button clicked', () => {
        const handleExplore = vi.fn();
        render(
            <GlobeSelectionPanel
                selectedTrek={mockTrek}
                onBack={() => {}}
                onExplore={handleExplore}
                isMobile={false}
            />
        );
        fireEvent.click(screen.getByText('Explore Journey →'));
        expect(handleExplore).toHaveBeenCalled();
    });
});
