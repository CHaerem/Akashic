/**
 * Journey -> CloudKit zone resolution.
 *
 * Two facts collide here, and the collision silently produced empty photo lists:
 *
 *  1. The app addresses a journey by its **slug** (`kilimanjaro`) — that is what
 *     `TrekConfig.id` carries and what every `fetchPhotos(journeyId)` caller passes.
 *  2. CloudKit addresses it by **record name** (a UUID) inside a per-journey custom
 *     zone (`journey-<uuid>`, D3).
 *
 * So filtering photos by `journeyRef == journeyId` was comparing a reference against a
 * slug. CloudKit rejected it ("could not decode reference object"), the adapter's
 * `catch(() => [])` swallowed the rejection, and the UI showed a journey with zero
 * photos — indistinguishable from a journey that genuinely has none.
 *
 * Because a zone holds exactly one journey and its children, scoping the query to the
 * zone *is* the filter: no reference predicate needed, and one fewer thing to get wrong.
 */

import { getSharedDatabase, getPrivateDatabase } from '../../../cloudkit';

export interface JourneyZone {
    /** CloudKit record name (UUID) of the Journey record. */
    recordName: string;
    zoneID: CloudKitJS.ZoneID;
    /** Which database the zone lives in — private (owner) or shared (invited). */
    scope: 'private' | 'shared';
}

/** Keyed by BOTH slug and record name, so either identifier resolves. */
const zonesByKey = new Map<string, JourneyZone>();

/** Zone lookup for individual child records (photos, comments) — see rememberRecordZone. */
const zoneByRecordName = new Map<string, JourneyZone>();

/**
 * Record what `fetchJourneys` already learned. Every read path afterwards resolves
 * from memory instead of re-querying.
 */
export function rememberJourneyZones(
    records: CloudKitJS.Record[],
    scope: 'private' | 'shared'
): void {
    for (const record of records) {
        const recordName = record.recordName;
        const zoneID = record.zoneID;
        if (!recordName || !zoneID) continue;
        const entry: JourneyZone = { recordName, zoneID, scope };
        zonesByKey.set(recordName, entry);
        const slug = record.fields?.slug?.value;
        if (typeof slug === 'string' && slug) zonesByKey.set(slug, entry);
    }
}

/** Testing / sign-out hook — a different account must not inherit these zones. */
export function clearJourneyZones(): void {
    zonesByKey.clear();
    zoneByRecordName.clear();
}

/**
 * Resolve a slug or record name to its zone, querying CloudKit only if the journey
 * was never seen by `fetchJourneys` in this session (a deep link straight into a day,
 * for instance).
 */
export async function resolveJourneyZone(journeyId: string): Promise<JourneyZone | null> {
    const known = zonesByKey.get(journeyId);
    if (known) return known;

    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    for (const [db, scope] of [[priv, 'private'], [shared, 'shared']] as const) {
        for (const query of [
            { recordType: 'Journey', filterBy: [{ fieldName: 'slug', comparator: 'EQUALS' as const, fieldValue: { value: journeyId } }] },
            { recordType: 'Journey' },
        ]) {
            try {
                const response = await db.performQuery(query);
                const match = (response.records ?? []).find(
                    (r) => r.recordName === journeyId || r.fields?.slug?.value === journeyId
                );
                if (match) {
                    rememberJourneyZones([match], scope);
                    return zonesByKey.get(journeyId) ?? null;
                }
            } catch {
                // Try the next database / query shape.
            }
        }
    }
    return null;
}

/**
 * Which zone a given non-journey record (a photo, say) lives in.
 *
 * Writes need this. A record is addressed by `recordName` alone, but saving it
 * requires the zone — and for a shared zone, the zone's `ownerRecordName` as well
 * ("zoneID needs to have ownerRecordName field for calls to sharedb"). Reads populate
 * this map as a side effect, which is enough: nothing is editable before it is shown.
 */
export function rememberRecordZone(records: CloudKitJS.Record[], zone: JourneyZone): void {
    for (const record of records) {
        if (record.recordName) zoneByRecordName.set(record.recordName, zone);
    }
}

/**
 * Same idea, but deriving the zone from each record's own `zoneID` — for records
 * fetched across every zone at once (waypoints, notably: `fetchJourneys` reads them
 * all in one query, and a day's comments cannot be found without knowing which zone
 * that day lives in).
 */
export function rememberChildZones(
    records: CloudKitJS.Record[],
    scope: 'private' | 'shared'
): void {
    for (const record of records) {
        const zoneID = record.zoneID;
        if (!record.recordName || !zoneID) continue;
        const known = zonesByKey.get(zoneID.zoneName.replace(/^journey-/, ''));
        zoneByRecordName.set(record.recordName, known ?? { recordName: '', zoneID, scope });
    }
}

export function resolveRecordZone(recordName: string): JourneyZone | null {
    return zoneByRecordName.get(recordName) ?? null;
}
