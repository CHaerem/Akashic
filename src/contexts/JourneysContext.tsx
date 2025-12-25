/**
 * React context for journey data from Supabase
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { fetchJourneys } from '../lib/journeys';
import type { TrekConfig, TrekData } from '../types/trek';

interface JourneysContextValue {
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
    loading: boolean;
    error: string | null;
    refetch: () => Promise<void>;
}

const JourneysContext = createContext<JourneysContextValue | null>(null);

interface JourneysProviderProps {
    children: ReactNode;
}

export function JourneysProvider({ children }: JourneysProviderProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<{
        treks: TrekConfig[];
        trekDataMap: Record<string, TrekData>;
    }>({ treks: [], trekDataMap: {} });

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await fetchJourneys();
            // Debug: Log Mount Kenya data
            const kenya = result.treks.find(t => t.id === 'mount-kenya');
            if (kenya) {
                const kenyaData = result.trekDataMap['mount-kenya'];
                console.log('[JourneysContext] Mount Kenya loaded:', {
                    total_days: kenyaData?.stats.duration,
                    camps_count: kenyaData?.camps.length,
                    camp_days: kenyaData?.camps.map(c => `Day ${c.dayNumber}: ${c.name}`)
                });
            }
            setData(result);
        } catch (err) {
            console.error('Failed to load journeys:', err);
            setError('Failed to load journey data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Memoize context value to prevent unnecessary re-renders
    const value = useMemo<JourneysContextValue>(() => ({
        treks: data.treks,
        trekDataMap: data.trekDataMap,
        loading,
        error,
        refetch: loadData
    }), [data.treks, data.trekDataMap, loading, error, loadData]);

    return (
        <JourneysContext.Provider value={value}>
            {children}
        </JourneysContext.Provider>
    );
}

/**
 * Hook to access journey data
 */
export function useJourneys(): JourneysContextValue {
    const context = useContext(JourneysContext);
    if (!context) {
        throw new Error('useJourneys must be used within a JourneysProvider');
    }
    return context;
}

/**
 * Get trek data by ID (convenience hook)
 */
export function useTrekDataById(id: string | null): TrekData | null {
    const { trekDataMap } = useJourneys();
    return id ? trekDataMap[id] || null : null;
}

/**
 * Get trek config by ID (convenience hook)
 */
export function useTrekConfigById(id: string | null): TrekConfig | null {
    const { treks } = useJourneys();
    return id ? treks.find(t => t.id === id) || null : null;
}
