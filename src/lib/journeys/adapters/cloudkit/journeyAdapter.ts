/**
 * CloudKit adapter — journey reads + cache population.
 *
 * Mirrors the journeyAPI surface. Reads materialize DbJourney/DbWaypoint rows
 * and reuse the existing transforms so the app types stay identical. Journey
 * metadata/route editing is native-only on web.
 */

import type { TrekConfig, TrekData, Route } from '../../../../types/trek';
import type { DbJourney, DbWaypoint } from '../../types';
import type { JourneyUpdate } from '../../journeyAPI';
import { toTrekConfig, toTrekData } from '../../transforms';
import { setJourneyCacheState } from '../../journeyCache';
import { getSharedDatabase, getPrivateDatabase } from '../../../cloudkit';
import { recordToDbJourney, recordToDbWaypoint, referenceName, fieldValue } from './records';

export const CK_UNSUPPORTED = '[cloudkit] not supported on web — use the iOS app';

/** Run the same query against the shared + private databases and concat results. */
async function queryAllZones(query: CloudKitJS.Query): Promise<CloudKitJS.Record[]> {
    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    const responses = await Promise.all([
        shared.performQuery(query).catch(() => ({ records: [] as CloudKitJS.Record[] })),
        priv.performQuery(query).catch(() => ({ records: [] as CloudKitJS.Record[] })),
    ]);
    return responses.flatMap((r) => r.records ?? []);
}

/**
 * Fetch all journeys visible to the signed-in user (shared + private zones),
 * transform to app types, and populate the shared journey cache.
 */
export async function fetchJourneys(): Promise<{
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
}> {
    let journeyRecords: CloudKitJS.Record[];
    let waypointRecords: CloudKitJS.Record[];
    try {
        // TODO(cloudkit): apply sortBy: name and any filterBy once schema indexes exist.
        journeyRecords = await queryAllZones({ recordType: 'Journey' });
        waypointRecords = await queryAllZones({ recordType: 'Waypoint' });
    } catch (err) {
        console.error('[cloudkit] Error fetching journeys:', err);
        return { treks: [], trekDataMap: {} };
    }

    if (journeyRecords.length === 0) {
        return { treks: [], trekDataMap: {} };
    }

    const journeys: DbJourney[] = journeyRecords.map(recordToDbJourney);
    const waypoints: DbWaypoint[] = waypointRecords.map(recordToDbWaypoint);

    // Group waypoints by journey id (reference -> journey record name).
    const waypointsByJourney: Record<string, DbWaypoint[]> = {};
    waypoints.forEach((w) => {
        (waypointsByJourney[w.journey_id] ??= []).push(w);
    });

    const treks: TrekConfig[] = [];
    const trekDataMap: Record<string, TrekData> = {};

    journeys.forEach((journey) => {
        try {
            treks.push(toTrekConfig(journey));
            trekDataMap[journey.slug] = toTrekData(journey, waypointsByJourney[journey.id] || []);
        } catch (err) {
            console.error(`[cloudkit] Failed to transform journey ${journey.id}:`, err);
        }
    });

    setJourneyCacheState({ treks, trekDataMap, loaded: true });
    return { treks, trekDataMap };
}

/** Resolve a journey's CloudKit record name from its slug. */
export async function getJourneyIdBySlug(slug: string): Promise<string | null> {
    try {
        const records = await queryAllZones({
            recordType: 'Journey',
            filterBy: [{ fieldName: 'slug', comparator: 'EQUALS', fieldValue: { value: slug } }],
        });
        return records[0]?.recordName ?? null;
    } catch (err) {
        console.error('[cloudkit] Error fetching journey id:', err);
        return null;
    }
}

/** Fetch a single journey (as a DbJourney row) by slug. */
export async function getJourneyForEdit(slug: string): Promise<DbJourney | null> {
    try {
        const records = await queryAllZones({
            recordType: 'Journey',
            filterBy: [{ fieldName: 'slug', comparator: 'EQUALS', fieldValue: { value: slug } }],
        });
        const record = records.find((r) => referenceName(fieldValue(r, 'slug')) === slug) ?? records[0];
        return record ? recordToDbJourney(record) : null;
    } catch (err) {
        console.error('[cloudkit] Error fetching journey:', err);
        return null;
    }
}

// --- Native-only writes -----------------------------------------------------

export async function updateJourney(_slug: string, _updates: JourneyUpdate): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function updateJourneyRoute(_slug: string, _route: Route): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}
