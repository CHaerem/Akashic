/**
 * Custom hook for managing trek state and data
 */

import { useState, useCallback, useMemo, useTransition } from 'react';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateStats, generateElevationProfile } from '../utils/stats';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, ViewMode, TabType } from '../types/trek';

// Bottom sheet snap points
export type SheetSnapPoint = 'minimized' | 'half' | 'expanded';

// Content modes for the bottom sheet
export type ContentMode = 'day' | 'photos' | 'stats' | 'info';

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

    // Sheet state (Find My redesign)
    sheetSnapPoint: SheetSnapPoint;
    activeMode: ContentMode;

    // Edit mode
    editMode: boolean;
    setEditMode: (mode: boolean) => void;
    toggleEditMode: () => void;

    // Setters
    setView: (view: ViewMode) => void;
    setActiveTab: (tab: TabType) => void;
    setSheetSnapPoint: (snap: SheetSnapPoint) => void;
    setActiveMode: (mode: ContentMode) => void;

    // Handlers
    selectTrek: (trek: TrekConfig) => void;
    handleExplore: () => void;
    handleBackToGlobe: () => void;
    handleBackToSelection: () => void;
    handleBackToOverview: () => void;
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

    // Sheet state for Find My redesign
    const [sheetSnapPoint, setSheetSnapPoint] = useState<SheetSnapPoint>('half');
    const [activeMode, setActiveMode] = useState<ContentMode>('day');

    // Edit mode state
    const [editMode, setEditMode] = useState(false);
    const toggleEditMode = useCallback(() => setEditMode(prev => !prev), []);

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

    // Handle explore button click - show full journey overview first
    const handleExplore = useCallback(() => {
        if (!selectedTrek) return;
        // Don't select a camp - show full journey overview
        // User can then select a specific day from the nav pill
        setSelectedCamp(null);
        setView('trek');
    }, [selectedTrek, setView]);

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

    // Handle back to overview (deselect camp but stay in trek view)
    const handleBackToOverview = useCallback(() => {
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

        // Sheet state (Find My redesign)
        sheetSnapPoint,
        activeMode,

        // Edit mode
        editMode,
        setEditMode,
        toggleEditMode,

        // Setters
        setView,
        setActiveTab,
        setSheetSnapPoint,
        setActiveMode,

        // Handlers
        selectTrek,
        handleExplore,
        handleBackToGlobe,
        handleBackToSelection,
        handleBackToOverview,
        handleCampSelect
    };
}
