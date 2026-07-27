import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';
import { toTrekData, journeyDayCount } from '../../lib/journeys/transforms';
import type { DbJourney, DbWaypoint } from '../../lib/journeys/types';
import type { TrekConfig } from '../../types/trek';
import { calculateStats, generateElevationProfile } from '../../utils/stats';
import { Sidebar } from '../layout/Sidebar';
import { BottomSheet } from '../layout/BottomSheet';
import { OverviewTab } from '../trek/OverviewTab';
import { StatsTab } from '../trek/StatsTab';
import { JourneyTimeline } from './JourneyTimeline';

/**
 * QUA-46 — one journey, one duration, on every surface that renders it.
 *
 * The defect: on https://akashic.no/?journey=kilimanjaro the header pill read "8 days"
 * while the Duration stat right below it read "7 days". The pill counted
 * `trekData.camps.length`; the stat read `trekData.stats.duration`.
 *
 * The journey below is the real Kilimanjaro shape, from `src/data/kilimanjaro.json` as it
 * stood before the CloudKit migration (recovered from git history): `duration: 7`, and
 * EIGHT waypoints, because day 6 carries two — "Uhuru Peak (Summit)" and "Mweka Camp".
 * That is the whole bug; there is no off-by-one in `totalDays`, and the iOS app showing 7
 * on both its list card and its detail view is the tie-break.
 *
 * `EXPECTED_DAYS` is asserted against every surface and `WAYPOINT_COUNT` is asserted to
 * differ from it — a fixture where camps and days happen to agree cannot fail this. The
 * e2e fixtures are exactly that (5 waypoints / 5 days and 3 / 3), which is why the browser
 * gate never caught it.
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

function kilimanjaroJourney(overrides: Partial<DbJourney> = {}): DbJourney {
    return {
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
        ...overrides,
    };
}

function kilimanjaroWaypoints(): DbWaypoint[] {
    return KILIMANJARO_CAMPS.map((camp, i) => ({
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
}

const trekData = toTrekData(kilimanjaroJourney(), kilimanjaroWaypoints());

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

/** Every "<n> days" string the rendered tree contains, in DOM order. */
function renderedDayCounts(container: HTMLElement): string[] {
    return (container.textContent ?? '').match(/\d+ days/g) ?? [];
}

function noop() {}

beforeAll(() => {
    // jsdom has no IntersectionObserver and JourneyTimeline builds one on mount.
    if (!('IntersectionObserver' in globalThis)) {
        class StubObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
            readonly root = null;
            readonly rootMargin = '';
            readonly thresholds: number[] = [];
        }
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: StubObserver,
        });
    }
});

describe('QUA-46 — the fixture has more waypoints than days', () => {
    it('has 8 camps against a stated duration of 7, so camps.length is not a day count', () => {
        expect(trekData.camps).toHaveLength(WAYPOINT_COUNT);
        expect(trekData.stats.duration).toBe(EXPECTED_DAYS);
        expect(WAYPOINT_COUNT).not.toBe(EXPECTED_DAYS);
    });

    it('has two camps on day 6, which is why the counts diverged', () => {
        const daySix = trekData.camps.filter(c => c.dayNumber === 6);
        expect(daySix.map(c => c.name)).toEqual(['Uhuru Peak (Summit)', 'Mweka Camp']);
    });
});

describe('QUA-46 — journeyDayCount is the single source of truth', () => {
    it('returns the stated duration, not the waypoint count', () => {
        expect(journeyDayCount(trekData)).toBe(EXPECTED_DAYS);
    });

    it('falls back to the highest camp day number when the record states no duration', () => {
        // A journey published with neither statsJSON nor totalDays gets duration 0 from
        // toTrekData. Before this helper existed that case still navigated, because the
        // pill counted camps — so the fallback has to keep working.
        const bare = toTrekData(
            kilimanjaroJourney({ stats: null, total_days: null }),
            kilimanjaroWaypoints()
        );
        expect(bare.stats.duration).toBe(0);
        // The highest dayNumber, NOT camps.length: two waypoints on day 6 must not add a day.
        expect(journeyDayCount(bare)).toBe(EXPECTED_DAYS);
    });

    it('returns 0 for a journey with no stated duration and no camps', () => {
        const empty = toTrekData(kilimanjaroJourney({ stats: null, total_days: null }), []);
        expect(journeyDayCount(empty)).toBe(0);
    });
});

describe('QUA-46 — every surface renders the same duration', () => {
    const totalDays = journeyDayCount(trekData);

    it('the desktop header pill (Sidebar) shows the stated duration', () => {
        const { container } = render(
            <Sidebar
                isOpen
                view="trek"
                selectedTrek={trekConfig}
                selectedCamp={null}
                totalDays={totalDays}
                activeMode="day"
                onModeChange={noop}
                onDaySelect={noop}
                onStart={noop}
                onExplore={noop}
                onBackToOverview={noop}
            >
                <div />
            </Sidebar>
        );

        expect(renderedDayCounts(container)).toEqual([`${EXPECTED_DAYS} days`]);
    });

    it('the mobile header pill (BottomSheet) shows the stated duration', () => {
        const { container } = render(
            <BottomSheet
                snapPoint="minimized"
                onSnapChange={noop}
                isOpen
                isMobile
                view="trek"
                selectedTrek={trekConfig}
                selectedCamp={null}
                totalDays={totalDays}
                activeMode="day"
                onModeChange={noop}
                onDaySelect={noop}
                onStart={noop}
                onExplore={noop}
                onBackToOverview={noop}
            >
                <div />
            </BottomSheet>
        );

        expect(renderedDayCounts(container)).toEqual([`${EXPECTED_DAYS} days`]);
    });

    it('the Duration stat on the overview shows the same number', () => {
        const { container } = render(<OverviewTab trekData={trekData} />);
        expect(screen.getByText(`${EXPECTED_DAYS} days`)).toBeTruthy();
        expect(renderedDayCounts(container)).toEqual([`${EXPECTED_DAYS} days`]);
    });

    it('the Duration stat in stats mode shows the same number', () => {
        const { container } = render(
            <StatsTab
                trekData={trekData}
                selectedCamp={null}
                extendedStats={calculateStats(trekData)}
                elevationProfile={generateElevationProfile(trekData.route.coordinates, trekData.camps)}
                onCampSelect={noop}
            />
        );
        expect(renderedDayCounts(container)).toContain(`${EXPECTED_DAYS} days`);
        expect(renderedDayCounts(container)).not.toContain(`${WAYPOINT_COUNT} days`);
    });

    it('the JourneyTimeline header shows the same number', () => {
        const { container } = render(
            <JourneyTimeline
                trekData={trekData}
                photos={[]}
                getMediaUrl={(p: string) => p}
                selectedCamp={null}
                onCampSelect={noop}
                onDayChange={noop}
                onPhotoClick={noop}
                onJourneyUpdate={noop}
                isMobile={false}
            />
        );
        expect(renderedDayCounts(container)).toContain(`${EXPECTED_DAYS} days`);
        expect(renderedDayCounts(container)).not.toContain(`${WAYPOINT_COUNT} days`);
    });
});
