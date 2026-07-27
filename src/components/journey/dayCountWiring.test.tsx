import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { toTrekData } from '../../lib/journeys/transforms';
import type { DbJourney, DbWaypoint } from '../../lib/journeys/types';
import type { TrekConfig } from '../../types/trek';

/**
 * QUA-46 — the wiring test, and the one that actually fails on a revert.
 *
 * `dayCount.test.tsx` renders each surface directly, which pins the components but NOT the
 * app: those tests hand `Sidebar` a `totalDays` they computed themselves, so putting
 * `trekData.camps.length` back into `AkashicApp` would leave them green. This one mounts
 * `AkashicApp` on the trek overview with the real Kilimanjaro shape (8 waypoints, stated
 * duration 7, two waypoints on day 6) and asserts the page contains exactly ONE distinct
 * "<n> days" figure. That is the assertion the live site failed: it rendered both 8 and 7.
 */

const EXPECTED_DAYS = 7;
const WAYPOINT_COUNT = 8;

const KILIMANJARO_CAMPS: Array<{ name: string; day: number }> = [
    { name: 'Mti Mkubwa (Big Tree Camp)', day: 1 },
    { name: 'Shira II Camp', day: 2 },
    { name: 'Barranco Camp', day: 3 },
    { name: 'Karanga Camp', day: 4 },
    { name: 'Barafu Camp (Base Camp)', day: 5 },
    { name: 'Uhuru Peak (Summit)', day: 6 },
    { name: 'Mweka Camp', day: 6 },
    { name: 'Mweka Gate (Finish)', day: 7 },
];

const journey: DbJourney = {
    id: 'kilimanjaro',
    slug: 'kilimanjaro',
    name: 'Kilimanjaro - Lemosho Route',
    description: 'Eight waypoints across seven days.',
    country: 'Tanzania',
    summit_elevation: 5895,
    total_distance: 70,
    total_days: EXPECTED_DAYS,
    date_started: '2024-10-01',
    date_ended: '2024-10-07',
    hero_image_url: null,
    center_coordinates: [37.3556, -3.0674],
    route: {
        type: 'LineString',
        coordinates: KILIMANJARO_CAMPS.map((_, i) => [
            37.3 + i * 0.01,
            -3.06 - i * 0.01,
            2000 + i * 400,
        ]) as [number, number, number][],
    },
    stats: {
        duration: EXPECTED_DAYS,
        totalDistance: 70,
        totalElevationGain: 4800,
        highestPoint: { name: 'Uhuru Peak', elevation: 5895 },
    },
    preferred_bearing: 45,
    preferred_pitch: 70,
    is_public: true,
};

const waypoints = KILIMANJARO_CAMPS.map((camp, i) => ({
    id: `wp-${i}`,
    journey_id: 'kilimanjaro',
    name: camp.name,
    waypoint_type: 'camp',
    day_number: camp.day,
    coordinates: [37.3 + i * 0.01, -3.06 - i * 0.01],
    elevation: 2000 + i * 400,
    description: null,
    highlights: null,
    sort_order: i,
    route_distance_km: i * 8,
    route_point_index: i,
    weather: null,
    fun_facts: null,
    points_of_interest: null,
    historical_sites: null,
})) as unknown as DbWaypoint[];

const trekData = toTrekData(journey, waypoints);

const trekConfig = {
    id: 'kilimanjaro',
    name: 'Kilimanjaro',
    country: 'Tanzania',
    elevation: '5,895m',
    lat: -3.0674,
    lng: 37.3556,
    preferredBearing: 45,
    preferredPitch: 70,
    slug: 'kilimanjaro',
} as unknown as TrekConfig;

// The map is the one dependency that cannot run in jsdom; everything else is real so the
// day count travels the real path from `toTrekData` to the rendered pill.
vi.mock('../MapSurface', () => ({
    MapSurface: () => <div data-testid="map-surface" />,
}));

vi.mock('../../contexts/JourneysContext', () => ({
    useJourneys: () => ({
        treks: [trekConfig],
        trekDataMap: { kilimanjaro: trekData },
        loading: false,
        error: null,
        refetch: vi.fn(),
    }),
}));

vi.mock('../../hooks/useTrekData', () => ({
    useTrekData: () => ({
        view: 'trek',
        selectedTrek: trekConfig,
        // null == the journey overview, which is where the "N days" pill renders.
        selectedCamp: null,
        trekData,
        extendedStats: null,
        elevationProfile: null,
        sheetSnapPoint: 'minimized',
        activeMode: 'day',
        editMode: false,
        toggleEditMode: vi.fn(),
        activeTab: 'overview',
        setActiveTab: vi.fn(),
        setSheetSnapPoint: vi.fn(),
        setActiveMode: vi.fn(),
        selectTrek: vi.fn(),
        handleExplore: vi.fn(),
        handleBackToGlobe: vi.fn(),
        handleBackToSelection: vi.fn(),
        handleBackToOverview: vi.fn(),
        handleCampSelect: vi.fn(),
    }),
}));

vi.mock('../../hooks/useMedia', () => ({
    useMedia: () => ({ getMediaUrl: (path: string) => `https://example.com/${path}` }),
}));

vi.mock('../../hooks/useMediaQuery', () => ({
    useIsMobile: () => false,
}));

vi.mock('../../lib/shareTarget', () => ({
    hasPendingShares: vi.fn().mockResolvedValue(false),
}));

// NOTE: `journeyDayCount` is deliberately re-exported for real here. Mocking it away is
// what would make this test vacuous.
vi.mock('../../lib/journeys', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../lib/journeys')>();
    return {
        ...actual,
        fetchPhotos: vi.fn().mockResolvedValue([]),
        getJourneyIdBySlug: vi.fn().mockResolvedValue(null),
        updatePhoto: vi.fn().mockResolvedValue(null),
    };
});

const AkashicApp = (await import('../AkashicApp')).default;

describe('QUA-46 — AkashicApp renders one day count, not two', () => {
    it('shows only the stated duration anywhere on the journey overview', () => {
        const { container } = render(<AkashicApp />);

        const counts = (container.textContent ?? '').match(/\d+ days/g) ?? [];
        const distinct = [...new Set(counts)];

        // The whole bug in one assertion: the live page held both "8 days" and "7 days".
        expect(distinct).toEqual([`${EXPECTED_DAYS} days`]);
        expect(counts.length).toBeGreaterThan(0);
        expect(distinct).not.toContain(`${WAYPOINT_COUNT} days`);
    });
});
