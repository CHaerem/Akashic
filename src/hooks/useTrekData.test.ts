import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { TrekConfig, Camp, TrekData } from '../types/trek';

// Provide a stable journeys context for the hook
const mockTrekData: TrekData = {
    id: 'kilimanjaro',
    name: 'Kilimanjaro',
    country: 'Tanzania',
    description: 'Summit the roof of Africa',
    stats: {
        duration: 7,
        totalDistance: 70,
        totalElevationGain: 3000,
        highestPoint: { name: 'Uhuru Peak', elevation: 5895 }
    },
    camps: [
        { id: 'c1', name: 'Machame Camp', dayNumber: 1, elevation: 2835, coordinates: [37.35, -3.06], elevationGainFromPrevious: 1000, notes: 'Forest camp' },
        { id: 'c2', name: 'Shira Camp', dayNumber: 2, elevation: 3750, coordinates: [37.36, -3.07], elevationGainFromPrevious: 915, notes: 'Shira plateau' },
        { id: 'c3', name: 'Barranco Camp', dayNumber: 3, elevation: 3976, coordinates: [37.37, -3.08], elevationGainFromPrevious: 200, notes: 'Barranco wall views' }
    ],
    route: {
        type: 'LineString',
        coordinates: [
            [37.35, -3.06, 1800],
            [37.36, -3.07, 2600],
            [37.37, -3.08, 3800],
            [37.38, -3.09, 4200]
        ]
    }
};

const mockJourneysValue = {
    treks: [{
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        elevation: '5,895m',
        lat: -3.0674,
        lng: 37.3556,
        preferredBearing: 180,
        preferredPitch: 60,
        slug: 'kilimanjaro'
    }],
    trekDataMap: { kilimanjaro: mockTrekData },
    loading: false,
    error: null,
    refetch: vi.fn()
};

vi.mock('../contexts/JourneysContext', () => ({
    useJourneys: () => mockJourneysValue
}));

import { useTrekData } from './useTrekData';

describe('useTrekData hook', () => {
    describe('initial state', () => {
        it('starts with globe view', () => {
            const { result } = renderHook(() => useTrekData());
            expect(result.current.view).toBe('globe');
        });

        it('starts with no selected trek', () => {
            const { result } = renderHook(() => useTrekData());
            expect(result.current.selectedTrek).toBeNull();
        });

        it('starts with no selected camp', () => {
            const { result } = renderHook(() => useTrekData());
            expect(result.current.selectedCamp).toBeNull();
        });

        it('starts with overview tab active', () => {
            const { result } = renderHook(() => useTrekData());
            expect(result.current.activeTab).toBe('overview');
        });

        it('has null trekData when no trek selected', () => {
            const { result } = renderHook(() => useTrekData());
            expect(result.current.trekData).toBeNull();
        });
    });

    describe('selectTrek', () => {
        it('selects a trek', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.selectedTrek).toEqual(mockTrek);
        });

        it('loads trek data when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.trekData).not.toBeNull();
            expect(result.current.trekData!.id).toBe('kilimanjaro');
        });

        it('clears selected camp when selecting new trek', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };
            const mockCamp: Camp = {
                id: 'camp1',
                name: 'Camp 1',
                dayNumber: 1,
                elevation: 2700,
                coordinates: [37.35, -3.06],
                elevationGainFromPrevious: 500,
                notes: 'Test camp'
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toEqual(mockCamp);

            act(() => {
                result.current.selectTrek({
                    id: 'mount-kenya',
                    name: 'Mount Kenya',
                    country: 'Kenya',
                    elevation: '4,985m',
                    lat: -0.1521,
                    lng: 37.3084,
                    preferredBearing: 0,
                    preferredPitch: 60
                });
            });

            expect(result.current.selectedCamp).toBeNull();
        });
    });

    describe('handleExplore', () => {
        it('switches to trek view when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            act(() => {
                result.current.handleExplore();
            });

            expect(result.current.view).toBe('trek');
        });

        it('does nothing when no trek is selected', () => {
            const { result } = renderHook(() => useTrekData());

            act(() => {
                result.current.handleExplore();
            });

            expect(result.current.view).toBe('globe');
        });
    });

    describe('handleBackToGlobe', () => {
        it('switches to globe view', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            act(() => {
                result.current.handleExplore();
            });

            expect(result.current.view).toBe('trek');

            act(() => {
                result.current.handleBackToGlobe();
            });

            expect(result.current.view).toBe('globe');
        });

        it('clears selected trek and camp', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            act(() => {
                result.current.handleBackToGlobe();
            });

            expect(result.current.selectedTrek).toBeNull();
            expect(result.current.selectedCamp).toBeNull();
        });
    });

    describe('handleBackToSelection', () => {
        it('clears trek selection but stays on globe view', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.selectedTrek).not.toBeNull();

            act(() => {
                result.current.handleBackToSelection();
            });

            expect(result.current.selectedTrek).toBeNull();
            expect(result.current.view).toBe('globe');
        });
    });

    describe('handleCampSelect', () => {
        it('selects a camp', () => {
            const { result } = renderHook(() => useTrekData());
            const mockCamp: Camp = {
                id: 'camp1',
                name: 'Base Camp',
                dayNumber: 1,
                elevation: 2700,
                coordinates: [37.35, -3.06],
                elevationGainFromPrevious: 500,
                notes: 'Test camp'
            };

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toEqual(mockCamp);
        });

        it('deselects camp when clicking same camp', () => {
            const { result } = renderHook(() => useTrekData());
            const mockCamp: Camp = {
                id: 'camp1',
                name: 'Base Camp',
                dayNumber: 1,
                elevation: 2700,
                coordinates: [37.35, -3.06],
                elevationGainFromPrevious: 500,
                notes: 'Test camp'
            };

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toEqual(mockCamp);

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toBeNull();
        });

        it('switches to different camp', () => {
            const { result } = renderHook(() => useTrekData());
            const camp1: Camp = {
                id: 'camp1',
                name: 'Base Camp',
                dayNumber: 1,
                elevation: 2700,
                coordinates: [37.35, -3.06],
                elevationGainFromPrevious: 500,
                notes: 'Test camp 1'
            };
            const camp2: Camp = {
                id: 'camp2',
                name: 'High Camp',
                dayNumber: 2,
                elevation: 3500,
                coordinates: [37.36, -3.07],
                elevationGainFromPrevious: 800,
                notes: 'Test camp 2'
            };

            act(() => {
                result.current.handleCampSelect(camp1);
            });

            act(() => {
                result.current.handleCampSelect(camp2);
            });

            expect(result.current.selectedCamp).toEqual(camp2);
        });
    });

    describe('setActiveTab', () => {
        it('changes active tab', () => {
            const { result } = renderHook(() => useTrekData());

            act(() => {
                result.current.setActiveTab('journey');
            });

            expect(result.current.activeTab).toBe('journey');

            act(() => {
                result.current.setActiveTab('stats');
            });

            expect(result.current.activeTab).toBe('stats');
        });
    });

    describe('computed values', () => {
        it('computes extendedStats when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.extendedStats).not.toBeNull();
            expect(result.current.extendedStats!.avgDailyDistance).toBeDefined();
            expect(result.current.extendedStats!.maxDailyGain).toBeDefined();
        });

        it('computes elevationProfile when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek: TrekConfig = {
                id: 'kilimanjaro',
                name: 'Kilimanjaro',
                country: 'Tanzania',
                elevation: '5,895m',
                lat: -3.0674,
                lng: 37.3556,
                preferredBearing: 180,
                preferredPitch: 60
            };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.elevationProfile).not.toBeNull();
            expect(result.current.elevationProfile!.linePath).toBeDefined();
            expect(result.current.elevationProfile!.areaPath).toBeDefined();
        });

        it('returns null computed values when no trek selected', () => {
            const { result } = renderHook(() => useTrekData());

            expect(result.current.extendedStats).toBeNull();
            expect(result.current.elevationProfile).toBeNull();
        });
    });
});
