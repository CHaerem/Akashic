/**
 * Custom hook for managing trek state and data
 */

import { useState, useCallback, useMemo } from 'react';
import { trekDataMap } from '../data/trekConfig';
import { calculateStats, generateElevationProfile } from '../utils/stats';

/**
 * Manage trek selection state and computed data
 * @returns {Object} Trek state and handlers
 */
export function useTrekData() {
    const [view, setView] = useState('globe');
    const [selectedTrek, setSelectedTrek] = useState(null);
    const [selectedCamp, setSelectedCamp] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    // Get trek data for selected trek
    const trekData = selectedTrek ? trekDataMap[selectedTrek.id] : null;

    // Memoized stats and elevation profile
    const { extendedStats, elevationProfile } = useMemo(() => {
        if (!trekData) return { extendedStats: null, elevationProfile: null };
        return {
            extendedStats: calculateStats(trekData),
            elevationProfile: generateElevationProfile(trekData.route?.coordinates)
        };
    }, [trekData]);

    // Handle explore button click
    const handleExplore = useCallback(() => {
        if (!selectedTrek) return;
        setView('trek');
    }, [selectedTrek]);

    // Handle back to globe view
    const handleBackToGlobe = useCallback(() => {
        setView('globe');
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, []);

    // Handle back to trek selection (deselect trek)
    const handleBackToSelection = useCallback(() => {
        setSelectedTrek(null);
        setSelectedCamp(null);
    }, []);

    // Handle camp selection (toggle)
    const handleCampSelect = useCallback((camp) => {
        setSelectedCamp(prev => prev?.id === camp.id ? null : camp);
    }, []);

    // Select a trek
    const selectTrek = useCallback((trek) => {
        setSelectedTrek(trek);
        setSelectedCamp(null);
    }, []);

    return {
        // State
        view,
        selectedTrek,
        selectedCamp,
        activeTab,
        trekData,
        extendedStats,
        elevationProfile,

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
