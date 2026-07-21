/**
 * CloudKit adapter — waypoint reads only.
 *
 * Waypoint creation, editing, repositioning, deletion and reordering are all
 * native-only on web.
 */

import type { DbWaypoint } from '../../types';
import type { WaypointUpdate, NewWaypoint } from '../../waypointAPI';
import { getSharedDatabase, getPrivateDatabase } from '../../../cloudkit';
import { recordToDbWaypoint } from './records';
import { CK_UNSUPPORTED } from './journeyAdapter';

const WAYPOINT_TYPE = 'Waypoint';

/** Fetch a single waypoint (as a DbWaypoint row) by its CloudKit record name. */
export async function getWaypoint(waypointId: string): Promise<DbWaypoint | null> {
    try {
        const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
        const responses = await Promise.all([
            shared.fetchRecords(waypointId).catch(() => ({ records: [] as CloudKitJS.Record[] })),
            priv.fetchRecords(waypointId).catch(() => ({ records: [] as CloudKitJS.Record[] })),
        ]);
        const record = responses.flatMap((r) => r.records ?? [])
            .find((r) => r.recordType === WAYPOINT_TYPE || r.recordName === waypointId);
        return record ? recordToDbWaypoint(record) : null;
    } catch (err) {
        console.error('[cloudkit] Error fetching waypoint:', err);
        return null;
    }
}

// --- Native-only writes -----------------------------------------------------

export async function updateWaypoint(_waypointId: string, _updates: WaypointUpdate): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function updateWaypointPosition(
    _waypointId: string,
    _coordinates: [number, number],
    _elevation: number | null,
    _routeDistanceKm: number | null,
    _routePointIndex: number | null
): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function createWaypoint(_waypoint: NewWaypoint): Promise<DbWaypoint | null> {
    console.warn(CK_UNSUPPORTED);
    return null;
}

export async function deleteWaypoint(_waypointId: string): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function updateWaypointOrder(
    _updates: Array<{ id: string; sort_order: number; day_number: number }>
): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}
