/**
 * Custom hook for managing trek state and data
 */

import { useState, useCallback, useMemo, useTransition, useEffect, useRef } from 'react';
import { useJourneys } from '../contexts/JourneysContext';
import { calculateStats, generateElevationProfile } from '../utils/stats';
import type { TrekConfig, TrekData, Camp, ExtendedStats, ElevationProfile, ViewMode } from '../types/trek';

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
    trekData: TrekData | null;
    extendedStats: ExtendedStats | null;
    elevationProfile: ElevationProfile | null;
    loading: boolean;
    /** QUA-72: the ?journey= slug that matched nothing (typo/unpublished), for a visible notice. */
    sharedLinkMiss: string | null;
    clearSharedLinkMiss: () => void;

    // Sheet state (Find My redesign)
    sheetSnapPoint: SheetSnapPoint;
    activeMode: ContentMode;

    // Edit mode
    editMode: boolean;
    setEditMode: (mode: boolean) => void;
    toggleEditMode: () => void;

    // Setters
    setView: (view: ViewMode) => void;
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

    // Sheet state for Find My redesign
    const [sheetSnapPoint, setSheetSnapPoint] = useState<SheetSnapPoint>('half');
    const [activeMode, setActiveMode] = useState<ContentMode>('day');

    // Edit mode state
    const [editMode, setEditMode] = useState(false);
    const toggleEditMode = useCallback(() => setEditMode(prev => !prev), []);

    // Use transition for view changes to prevent blocking the map surface's animations
    const [, startTransition] = useTransition();

    // Track if URL params have been processed
    const urlParamsProcessed = useRef(false);

    // QUA-72: the ?journey= slug that matched nothing, for a visible "isn't available" notice.
    const [sharedLinkMiss, setSharedLinkMiss] = useState<string | null>(null);

    // Auto-select journey from URL parameters (e.g., ?journey=kilimanjaro&day=3)
    // When ?journey= is provided, automatically skip to trek view (no Start button)
    useEffect(() => {
        if (urlParamsProcessed.current || loading || treks.length === 0) return;

        const { journeySlug, day } = parseUrlParams();
        // QUA-73: the ARRIVAL url is processed exactly once, match or not. Without marking the
        // no-param case processed too, a later dependency change could re-run this effect after
        // the user has navigated (the URL now carries QUA-73's synced params) and silently
        // re-open a journey the user just left.
        if (!journeySlug) {
            urlParamsProcessed.current = true;
            return;
        }

        // QUA-72: EXACT id match (case-insensitive). This used to be `includes()` against both
        // id and name, which meant (a) `?journey=kilimanjaro` with kilimanjaro-2023 AND
        // kilimanjaro-2024 published opened whichever sorted first — a link could open the WRONG
        // journey — and (b) the fuzziness bought nothing on the real path, because
        // AppInfo.showcaseURL always emits the exact slug. A miss is now reported instead of
        // silently rendering the globe (`sharedLinkMiss` below).
        const trek = treks.find(t => t.id.toLowerCase() === journeySlug.toLowerCase());

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
        } else {
            // QUA-72: a typo'd, unpublished or taken-down slug used to land the visitor on the
            // bare globe with zero explanation — which reads as "the share is broken". Report it
            // once; the notice renders in AkashicApp and clears when a journey is opened.
            urlParamsProcessed.current = true;
            setSharedLinkMiss(journeySlug);
        }
    }, [loading, treks, trekDataMap, startTransition]);

    // Wrap setView in startTransition for smooth camera animations
    const setView = useCallback((newView: ViewMode) => {
        startTransition(() => {
            setViewState(newView);
        });
    }, []);

    // QUA-73: the URL and document.title FOLLOW the selection. parseUrlParams was read-once at
    // load and nothing ever wrote back, so a visitor who found a journey and copied the address
    // bar shared the bare globe; one who arrived on ?journey=X and browsed to Y shared X; and
    // every tab/bookmark read the site slogan. Opening/leaving a journey pushes (so Back — the
    // most common mobile gesture — navigates within the app instead of exiting the site); a day
    // change only replaces, so scrubbing days does not bury history.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const beforeJourney = params.get('journey');
        if (selectedTrek && view === 'trek') {
            params.set('journey', selectedTrek.id);
            if (selectedCamp) params.set('day', String(selectedCamp.dayNumber));
            else params.delete('day');
        } else {
            params.delete('journey');
            params.delete('day');
        }
        const after = params.toString();
        const current = window.location.search.replace(/^\?/, '');
        if (after !== current) {
            const url = after ? `${window.location.pathname}?${after}` : window.location.pathname;
            const journeyChanged = (selectedTrek && view === 'trek' ? selectedTrek.id : null) !== beforeJourney;
            if (journeyChanged) {
                window.history.pushState({ akashic: true }, '', url);
            } else {
                window.history.replaceState(window.history.state, '', url);
            }
        }
        document.title = selectedTrek && view === 'trek'
            ? `${selectedTrek.name} — Akashic`
            : 'Akashic — Your treks on a living globe';
    }, [selectedTrek, selectedCamp, view]);

    // QUA-73: Back/forward drive the same state the URL now records.
    useEffect(() => {
        const onPopState = () => {
            const params = new URLSearchParams(window.location.search);
            const slug = params.get('journey');
            if (!slug) {
                setSelectedTrek(null);
                setSelectedCamp(null);
                setViewState('globe');
                return;
            }
            const trek = treks.find(t => t.id.toLowerCase() === slug.toLowerCase());
            if (!trek) return;
            setSelectedTrek(trek);
            setViewState('trek');
            const dayRaw = params.get('day');
            const day = dayRaw ? Number(dayRaw) : NaN;
            const camps = trekDataMap[trek.id]?.camps ?? [];
            setSelectedCamp(Number.isNaN(day) ? null : camps.find(c => c.dayNumber === day) ?? null);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [treks, trekDataMap]);

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
        trekData,
        extendedStats,
        elevationProfile,
        loading,
        // QUA-72: non-null when a ?journey= deep link matched nothing; cleared on selection.
        sharedLinkMiss,
        clearSharedLinkMiss: () => setSharedLinkMiss(null),

        // Sheet state (Find My redesign)
        sheetSnapPoint,
        activeMode,

        // Edit mode
        editMode,
        setEditMode,
        toggleEditMode,

        // Setters
        setView,
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
