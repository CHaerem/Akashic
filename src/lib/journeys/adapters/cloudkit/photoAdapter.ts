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
import { isSignedIn, fetchPublicPhotos } from './publicAdapter';

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
    // Signed-out: the public mirror holds thumbnails only, queried by slug (T3.3).
    if (!(await isSignedIn())) {
        return fetchPublicPhotos(journeyId);
    }
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
 * Two things the live container taught us (see journeyZones / docs fault #2, #4):
 *  - the query must be scoped to the journey's zone via the *options* argument, or it
 *    runs against the default zone of both DBs where no Photo lives and returns [];
 *  - the reference predicate needs the zone too — `{ value: { recordName, zoneID },
 *    type: 'REFERENCE' }`, not a bare string.
 * The zone is resolved from the waypoint, remembered when the journey loaded. When it
 * is unknown (the journey was never loaded this session) we return [] rather than
 * running an unscoped query that would silently find nothing. Note the migrated
 * archive leaves `waypointRef` unset on every photo, so this legitimately returns
 * nothing for imported data; it is correct for photos assigned since.
 */
export async function getPhotosForWaypoint(waypointId: string): Promise<Photo[]> {
    // The public mirror has no per-waypoint photo query (thumbs carry a dayNumber, not
    // a waypointRef); day grouping is handled by the synthesized waypoint_id on
    // fetchPublicPhotos + usePhotoDay. Signed-out this resolves to empty, quietly.
    if (!(await isSignedIn())) {
        return [];
    }
    const zone = resolveRecordZone(waypointId);
    if (!zone) {
        // Unknown zone: the waypoint's journey was never loaded this session. An
        // unscoped query would query the wrong (default) zone and find nothing.
        return [];
    }
    try {
        const records = await queryPhotos(
            {
                recordType: PHOTO_TYPE,
                filterBy: [
                    {
                        fieldName: 'waypointRef',
                        comparator: 'EQUALS',
                        fieldValue: {
                            value: { recordName: waypointId, zoneID: zone.zoneID },
                            type: 'REFERENCE',
                        },
                    },
                ],
            },
            { zoneID: zone.zoneID }
        );
        rememberRecordZone(records, zone);
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

        // A lookup for a record deleted elsewhere resolves with `hasErrors` and no
        // usable record rather than rejecting (verification doc fault #6). Without the
        // change tag the save below is an INSERT, which resurrects the photo as a ghost
        // record carrying only a caption (no assets) — a broken empty tile for the whole
        // family. Refuse the edit instead.
        if (existing.hasErrors || !current?.recordChangeTag) {
            throw new Error(
                `[cloudkit] photo ${photoId} not found (it may have been deleted) — caption edit aborted`
            );
        }

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
