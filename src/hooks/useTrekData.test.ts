import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTrekData } from './useTrekData';
import type { TrekConfig, Camp, TrekData } from '../types/trek';

// Mock data
const mockTrekDataMap: Record<string, TrekData> = {
    'kilimanjaro': {
        id: 'kilimanjaro',
        name: 'Kilimanjaro',
        country: 'Tanzania',
        description: 'Test description',
        dateStarted: '2024-10-01',
        camps: [
            {
                id: 'camp1',
                name: 'Base Camp',
                dayNumber: 1,
                elevation: 2700,
                coordinates: [37.35, -3.06],
                elevationGainFromPrevious: 500,
                notes: 'Test camp'
            },
            {
                id: 'camp2',
                name: 'High Camp',
                dayNumber: 2,
                elevation: 3500,
                coordinates: [37.36, -3.07],
                elevationGainFromPrevious: 800,
                notes: 'Test camp 2'
            }
        ],
        stats: {
            duration: 8,
            totalDistance: 70,
            totalElevationGain: 3800,
            highestPoint: { name: 'Uhuru Peak', elevation: 5895 }
        },
        route: {
            type: 'LineString',
            coordinates: [
                [37.0, -3.0, 1800],
                [37.1, -3.1, 2500],
                [37.2, -3.2, 3500],
                [37.3, -3.3, 4500],
                [37.35, -3.35, 5895]
            ]
        }
    },
    'mount-kenya': {
        id: 'mount-kenya',
        name: 'Mount Kenya',
        country: 'Kenya',
        description: 'Test description',
        dateStarted: '2024-11-01',
        camps: [],
        stats: {
            duration: 5,
            totalDistance: 40,
            totalElevationGain: 2500,
            highestPoint: { name: 'Batian Peak', elevation: 5199 }
        },
        route: { type: 'LineString', coordinates: [] }
    }
};

// Mock the JourneysContext
vi.mock('../contexts/JourneysContext', () => ({
    useJourneys: () => ({
        treks: [],
        trekDataMap: mockTrekDataMap,
        loading: false,
        error: null,
        refetch: vi.fn()
    })
}));

describe('useTrekData hook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

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
