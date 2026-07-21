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

const PHOTO_TYPE = 'Photo';

async function queryPhotos(query: CloudKitJS.Query): Promise<CloudKitJS.Record[]> {
    const [shared, priv] = await Promise.all([getSharedDatabase(), getPrivateDatabase()]);
    const responses = await Promise.all([
        shared.performQuery(query).catch(() => ({ records: [] as CloudKitJS.Record[] })),
        priv.performQuery(query).catch(() => ({ records: [] as CloudKitJS.Record[] })),
    ]);
    return responses.flatMap((r) => r.records ?? []);
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

export async function fetchPhotos(journeyId: string): Promise<Photo[]> {
    try {
        const records = await queryPhotos({
            recordType: PHOTO_TYPE,
            filterBy: [
                { fieldName: 'journeyRef', comparator: 'EQUALS', fieldValue: { value: journeyId } },
            ],
        });
        return sortPhotos(records.map(recordToPhoto));
    } catch (err) {
        console.error('[cloudkit] Error fetching photos:', err);
        return [];
    }
}

export async function getPhotosForWaypoint(waypointId: string): Promise<Photo[]> {
    try {
        const records = await queryPhotos({
            recordType: PHOTO_TYPE,
            filterBy: [
                { fieldName: 'waypointRef', comparator: 'EQUALS', fieldValue: { value: waypointId } },
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

    try {
        const db = await getSharedDatabase();
        // TODO(cloudkit): resolve the record's home database + recordChangeTag,
        // and translate remaining light-edit fields once the schema is pinned.
        const response = await db.saveRecords({
            recordType: PHOTO_TYPE,
            recordName: photoId,
            fields: { caption: { value: updates.caption } },
        });
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
