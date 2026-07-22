/**
 * CloudKit adapter — photo reads + caption ("light edit") writes.
 *
 * Photo asset URLs come back as full, pre-authenticated https download URLs,
 * so no `?token=` proxying is needed. Uploading / deleting / re-assigning
 * photos is native-only on web.
 */

import type { Photo } from '../../../../types/trek';
import { getSharedDatabase, getPrivateDatabase } from '../../../cloudkit';
import { recordToPhoto } from './records';
import { CK_UNSUPPORTED } from './journeyAdapter';
import { performQueryAll } from './paginate';
import { resolveJourneyZone, rememberRecordZone, resolveRecordZone } from './journeyZones';

const PHOTO_TYPE = 'Photo';

/**
 * Query both databases. Errors are logged rather than swallowed: a query that
 * fails and one that finds nothing are the same empty array to the caller, and
 * that ambiguity is exactly what hid the broken photo filter (see journeyZones).
 */
async function queryPhotos(
    query: CloudKitJS.Query,
    options: CloudKitJS.QueryOptions = {}
): Promise<CloudKitJS.Record[]> {
    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    // Paginated: a journey can hold hundreds of photos (939 on Kilimanjaro) and
    // a single performQuery returns only the first page.
    const responses = await Promise.all([
        performQueryAll(shared, query, options).catch((err) => {
            console.warn('[cloudkit] shared photo query failed:', err);
            return [] as CloudKitJS.Record[];
        }),
        performQueryAll(priv, query, options).catch((err) => {
            console.warn('[cloudkit] private photo query failed:', err);
            return [] as CloudKitJS.Record[];
        }),
    ]);
    return responses.flat();
}

/** Photos ordered by sort_order asc, then taken_at asc (nulls last). */
function sortPhotos(photos: Photo[]): Photo[] {
    return photos.sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (so !== 0) return so;
        if (!a.taken_at) return 1;
        if (!b.taken_at) return -1;
        return a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0;
    });
}

/**
 * All photos for a journey.
 *
 * Scoped to the journey's own zone rather than filtered by `journeyRef`: callers
 * pass the slug, `journeyRef` holds a reference to a UUID, and comparing the two
 * made CloudKit reject the query outright. One journey per zone (D3) means the
 * zone already *is* the filter.
 */
export async function fetchPhotos(journeyId: string): Promise<Photo[]> {
    try {
        const zone = await resolveJourneyZone(journeyId);
        if (!zone) {
            console.warn(`[cloudkit] no zone found for journey ${journeyId}`);
            return [];
        }
        const records = await queryPhotos({ recordType: PHOTO_TYPE }, { zoneID: zone.zoneID });
        // Reading is also how the write path learns where each photo lives.
        rememberRecordZone(records, zone);
        return sortPhotos(records.map(recordToPhoto));
    } catch (err) {
        console.error('[cloudkit] Error fetching photos:', err);
        return [];
    }
}

/**
 * Photos explicitly assigned to one day.
 *
 * A reference field needs a reference predicate — `{ value: { recordName }, type:
 * 'REFERENCE' }`, not a bare string. Note that in the migrated archive `waypointRef`
 * is unset on every photo (day assignment is derived from `taken_at` by
 * `usePhotoDay`, exactly as it was under Postgres), so this legitimately returns
 * nothing for imported data. It is correct for photos added since.
 */
export async function getPhotosForWaypoint(waypointId: string): Promise<Photo[]> {
    try {
        const records = await queryPhotos({
            recordType: PHOTO_TYPE,
            filterBy: [
                {
                    fieldName: 'waypointRef',
                    comparator: 'EQUALS',
                    fieldValue: { value: { recordName: waypointId }, type: 'REFERENCE' },
                },
            ],
        });
        return sortPhotos(records.map(recordToPhoto));
    } catch (err) {
        console.error('[cloudkit] Error fetching photos for waypoint:', err);
        return [];
    }
}

/**
 * Update a photo's caption (the one "light edit" allowed on web). Other photo
 * fields are native-only; callers that pass them get a no-op for those.
 */
export async function updatePhoto(
    photoId: string,
    updates: Partial<Pick<Photo, 'caption' | 'waypoint_id' | 'coordinates' | 'is_hero' | 'sort_order' | 'rotation' | 'location_source'>>
): Promise<Photo | null> {
    if (updates.caption === undefined) {
        // Only caption edits are supported on web.
        console.warn(CK_UNSUPPORTED);
        return null;
    }

    // A save needs three things the record name alone does not carry: which database
    // owns the record, its zone (with `ownerRecordName` when shared — the shared
    // database rejects a zone ID without it), and the current `recordChangeTag`.
    // Saving without the tag is an insert, which collides with the existing record.
    const zone = resolveRecordZone(photoId);
    if (!zone) {
        throw new Error(`[cloudkit] unknown zone for photo ${photoId} — load the journey first`);
    }

    try {
        const db = zone.scope === 'shared' ? await getSharedDatabase() : await getPrivateDatabase();
        // `recordName` is not a queryable field — a record is fetched by name, not
        // filtered by it.
        const existing = await db.fetchRecords(photoId, { zoneID: zone.zoneID });
        const current = existing.records?.[0];

        // The zone belongs in the *options* argument. Putting `zoneID` on the record
        // is accepted without complaint and then ignored: the save is aimed at the
        // default zone, where the record does not exist, and comes back
        // "recordChangeTag specified, but record not found".
        const response = await db.saveRecords(
            [
                {
                    recordType: PHOTO_TYPE,
                    recordName: photoId,
                    recordChangeTag: current?.recordChangeTag,
                    fields: { caption: { value: updates.caption } },
                },
            ],
            { zoneID: zone.zoneID }
        );
        if (response.hasErrors) {
            const reason = response.errors?.[0]?.reason ?? 'unknown CloudKit error';
            throw new Error(`[cloudkit] caption save rejected: ${reason}`);
        }
        const saved = response.records?.[0];
        return saved ? recordToPhoto(saved) : null;
    } catch (err) {
        console.error('[cloudkit] Error updating photo:', err);
        throw err instanceof Error ? err : new Error(String(err));
    }
}

// --- Native-only writes -----------------------------------------------------

export async function createPhoto(_photo: {
    journey_id: string;
    url: string;
    thumbnail_url?: string;
    caption?: string;
    coordinates?: [number, number];
    taken_at?: string;
    waypoint_id?: string;
}): Promise<Photo | null> {
    console.warn(CK_UNSUPPORTED);
    return null;
}

export async function deletePhoto(_photoId: string): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}

export async function assignPhotoToWaypoint(
    _photoId: string,
    _waypointId: string | null
): Promise<boolean> {
    console.warn(CK_UNSUPPORTED);
    return false;
}
