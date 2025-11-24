import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.selectedTrek).toEqual(mockTrek);
        });

        it('loads trek data when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.trekData).not.toBeNull();
            expect(result.current.trekData.id).toBe('kilimanjaro');
        });

        it('clears selected camp when selecting new trek', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };
            const mockCamp = { id: 'camp1', name: 'Camp 1' };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toEqual(mockCamp);

            act(() => {
                result.current.selectTrek({ id: 'mount-kenya', name: 'Mount Kenya' });
            });

            expect(result.current.selectedCamp).toBeNull();
        });
    });

    describe('handleExplore', () => {
        it('switches to trek view when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

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
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

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
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

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
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

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
            const mockCamp = { id: 'camp1', name: 'Base Camp' };

            act(() => {
                result.current.handleCampSelect(mockCamp);
            });

            expect(result.current.selectedCamp).toEqual(mockCamp);
        });

        it('deselects camp when clicking same camp', () => {
            const { result } = renderHook(() => useTrekData());
            const mockCamp = { id: 'camp1', name: 'Base Camp' };

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
            const camp1 = { id: 'camp1', name: 'Base Camp' };
            const camp2 = { id: 'camp2', name: 'High Camp' };

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
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.extendedStats).not.toBeNull();
            expect(result.current.extendedStats.avgDailyDistance).toBeDefined();
            expect(result.current.extendedStats.maxDailyGain).toBeDefined();
        });

        it('computes elevationProfile when trek is selected', () => {
            const { result } = renderHook(() => useTrekData());
            const mockTrek = { id: 'kilimanjaro', name: 'Kilimanjaro' };

            act(() => {
                result.current.selectTrek(mockTrek);
            });

            expect(result.current.elevationProfile).not.toBeNull();
            expect(result.current.elevationProfile.linePath).toBeDefined();
            expect(result.current.elevationProfile.areaPath).toBeDefined();
        });

        it('returns null computed values when no trek selected', () => {
            const { result } = renderHook(() => useTrekData());

            expect(result.current.extendedStats).toBeNull();
            expect(result.current.elevationProfile).toBeNull();
        });
    });
});
