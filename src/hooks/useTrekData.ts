/**
 * Custom hook for managing trek state and data
 */

import { useState, useCallback, useMemo, useTransition, useEffect, useRef } from 'react';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateStats, generateElevationProfile } from '../utils/stats';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, ViewMode, TabType } from '../types/trek';

/**
 * Parse URL parameters for deep linking
 * Supports: ?journey=kilimanjaro&day=3
 *
 * When ?journey= is provided, automatically skips to trek view (no Start button)
 * When ?day= is also provided, selects that specific day
 */
function parseUrlParams(): { journeySlug?: string; day?: number } {
    const params = new URLSearchParams(window.location.search);
    const journeySlug = params.get('journey') || undefined;
    const dayParam = params.get('day');
    const day = dayParam ? parseInt(dayParam, 10) : undefined;
    return { journeySlug, day: Number.isNaN(day) ? undefined : day };
}

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
    const { treks, trekDataMap, loading } = useJourneys();

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

    // Track if URL params have been processed
    const urlParamsProcessed = useRef(false);

    // Auto-select journey from URL parameters (e.g., ?journey=kilimanjaro&day=3)
    // When ?journey= is provided, automatically skip to trek view (no Start button)
    useEffect(() => {
        if (urlParamsProcessed.current || loading || treks.length === 0) return;

        const { journeySlug, day } = parseUrlParams();
        if (!journeySlug) return;

        // Find trek by slug (case-insensitive partial match)
        const trek = treks.find(t =>
            t.id.toLowerCase().includes(journeySlug.toLowerCase()) ||
            t.name.toLowerCase().includes(journeySlug.toLowerCase())
        );

        if (trek) {
            urlParamsProcessed.current = true;
            setSelectedTrek(trek);

            // Always go directly to trek view (skip "Start" button)
            startTransition(() => {
                setViewState('trek');
            });

            // Select specific day if provided
            if (day !== undefined) {
                const trekData = trekDataMap[trek.id];
                if (trekData) {
                    const camp = trekData.camps.find(c => c.dayNumber === day);
                    if (camp) {
                        setSelectedCamp(camp);
                    }
                }
            }
        }
    }, [loading, treks, trekDataMap, startTransition]);

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

    // Handle explore button click - go directly to Day 1
    const handleExplore = useCallback(() => {
        if (!selectedTrek) return;

        // Get trek data and find Day 1 camp
        const data = trekDataMap[selectedTrek.id];
        if (data && data.camps.length > 0) {
            // Find the camp with dayNumber === 1, or use the first camp if no Day 1 exists
            const day1Camp = data.camps.find(c => c.dayNumber === 1) || data.camps[0];
            setSelectedCamp(day1Camp);
        } else {
            // Fallback: no camp data, show overview
            setSelectedCamp(null);
        }

        setView('trek');
    }, [selectedTrek, trekDataMap, setView]);

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
