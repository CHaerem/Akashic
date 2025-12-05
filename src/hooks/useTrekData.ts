/**
 * Custom hook for managing trek state and data
 */

import { useState, useCallback, useMemo, useTransition } from 'react';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateStats, generateElevationProfile } from '../utils/stats';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, ViewMode, TabType } from '../types/trek';

interface UseTrekDataReturn {
    // State
    view: ViewMode;
    selectedTrek: TrekConfig | null;
    selectedCamp: Camp | null;
    activeTab: TabType;
    trekData: TrekData | null;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    loading: boolean;

    // Setters
    setView: (view: ViewMode) => void;
    setActiveTab: (tab: TabType) => void;

    // Handlers
    selectTrek: (trek: TrekConfig) => void;
    handleExplore: () => void;
    handleBackToGlobe: () => void;
    handleBackToSelection: () => void;
    handleCampSelect: (camp: Camp) => void;
}

/**
 * Manage trek selection state and computed data
 */
export function useTrekData(): UseTrekDataReturn {
    const { trekDataMap, loading } = useJourneys();

    const [view, setViewState] = useState<ViewMode>('globe');
    const [selectedTrek, setSelectedTrek] = useState<TrekConfig | null>(null);
    const [selectedCamp, setSelectedCamp] = useState<Camp | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('overview');

    // Use transition for view changes to prevent blocking Mapbox animations
    const [, startTransition] = useTransition();

    // Wrap setView in startTransition for smooth camera animations
    const setView = useCallback((newView: ViewMode) => {
        startTransition(() => {
            setViewState(newView);
        });
    }, []);

    // Get trek data for selected trek
    const trekData = selectedTrek ? trekDataMap[selectedTrek.id] || null : null;

    // Memoized stats and elevation profile
    const { extendedStats, elevationProfile } = useMemo(() => {
        if (!trekData) return { extendedStats: null, elevationProfile: null };
        return {
            extendedStats: calculateStats(trekData),
            elevationProfile: generateElevationProfile(trekData.route?.coordinates, trekData.camps)
        };
    }, [trekData]);

    // Handle explore button click - start the journey at day 1
    const handleExplore = useCallback(() => {
        if (!selectedTrek) return;
        // Select the first camp to start the journey
        if (trekData?.camps && trekData.camps.length > 0) {
            setSelectedCamp(trekData.camps[0]);
        }
        setView('trek');
    }, [selectedTrek, trekData, setView]);

    // Handle back to globe view
    const handleBackToGlobe = useCallback(() => {
        setView('globe');
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, [setView]);

    // Handle back to trek selection (deselect trek)
    const handleBackToSelection = useCallback(() => {
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, []);

    // Handle camp selection (toggle)
    const handleCampSelect = useCallback((camp: Camp) => {
        setSelectedCamp(prev => prev?.id === camp.id ? null : camp);
    }, []);

    // Select a trek - if already selected, explore it
    const selectTrek = useCallback((trek: TrekConfig) => {
        if (selectedTrek?.id === trek.id) {
            // Clicking on already-selected trek opens it
            setView('trek');
        } else {
            setSelectedTrek(trek);
            setSelectedCamp(null);
        }
    }, [selectedTrek, setView]);

    return {
        // State
        view,
        selectedTrek,
        selectedCamp,
        activeTab,
        trekData,
        extendedStats,
        elevationProfile,
        loading,

        // Setters
        setView,
        setActiveTab,

        // Handlers
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
        handleCampSelect
    };
}
