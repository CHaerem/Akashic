import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InfoPanel } from './InfoPanel';
import { TrekData } from '../../types/trek';

const mockTrekData: TrekData = {
    id: 'test-trek',
    name: 'Test Trek',
    country: 'Test Country',
    description: 'Test Description',
    stats: {
        duration: 5,
        totalDistance: 50,
        totalElevationGain: 3000,
        highestPoint: { name: 'Summit', elevation: 5000 }
    },
    camps: []
};

describe('InfoPanel', () => {
    it('renders trek title and country', () => {
        render(
            <InfoPanel
                trekData={mockTrekData}
                activeTab="overview"
                setActiveTab={() => {}}
                selectedCamp={null}
                onCampSelect={() => {}}
                onBack={() => {}}
                extendedStats={null}
                elevationProfile={null}
                isMobile={false}
                panelState="normal"
                onPanelStateChange={() => {}}
            />
        );
        expect(screen.getByText('Test Trek')).toBeInTheDocument();
        expect(screen.getByText('Test Country')).toBeInTheDocument();
    });

    it('renders overview tab content by default', () => {
        render(
            <InfoPanel
                trekData={mockTrekData}
                activeTab="overview"
                setActiveTab={() => {}}
                selectedCamp={null}
                onCampSelect={() => {}}
                onBack={() => {}}
                extendedStats={null}
                elevationProfile={null}
                isMobile={false}
                panelState="normal"
                onPanelStateChange={() => {}}
            />
        );
        expect(screen.getByText('Test Description')).toBeInTheDocument();
    });

    it('calls setActiveTab when tab clicked', () => {
        const handleSetActiveTab = vi.fn();
        render(
            <InfoPanel
                trekData={mockTrekData}
                activeTab="overview"
                setActiveTab={handleSetActiveTab}
                selectedCamp={null}
                onCampSelect={() => {}}
                onBack={() => {}}
                extendedStats={null}
                elevationProfile={null}
                isMobile={false}
                panelState="normal"
                onPanelStateChange={() => {}}
            />
        );
        fireEvent.click(screen.getByText('journey'));
        expect(handleSetActiveTab).toHaveBeenCalledWith('journey');
    });
});
