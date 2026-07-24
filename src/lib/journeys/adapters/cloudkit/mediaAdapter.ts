/**
 * CloudKit adapter — on-demand photo originals (photo architecture v2).
 *
 * iOS is moving photo ORIGINALS off the `Photo` record and into dedicated
 * `PhotoMedia` records (recordName `media-<photoId>`, fields photoId/journeyId/
 * `original` ASSET) that live in a per-journey MEDIA zone — `journey-<uuid>-media`
 * — alongside the journey's own `journey-<uuid>` zone. A `Photo` record keeps only
 * its `thumb`; after the one-time repack its `original` asset is nil.
 *
 * So the web can no longer read a full-size URL straight off the Photo record for
 * repacked journeys. `fetchOriginalUrl` resolves it lazily from the PhotoMedia
 * record instead, and the caller falls back to the thumb whenever it returns null —
 * the thumb is always the floor, so a repacked photo is never a broken image.
 *
 * Traps this pays for (docs/cloudkit-js-verification.md):
 *  - #4 the zone belongs in the *options* argument, never on the record. The media
 *    zone is derived from the journey's resolved zone, and the lookup carries it in
 *    `fetchRecords`' options.
 *  - #5 the database follows the zone: private when the journey is owned, shared when
 *    it was shared in (the shared DB needs the zone's `ownerRecordName`, which the
 *    resolved zone already carries).
 *  - #6 `hasErrors` is not optional — a lookup for a missing record resolves with
 *    `hasErrors` rather than rejecting, so it is checked explicitly and degrades to
 *    null.
 */

import { getSharedDatabase, getPrivateDatabase } from '../../../cloudkit';
import { assetUrl } from './records';
import { resolveJourneyZone } from './journeyZones';

/** PhotoMedia record name: `media-<photoId>`. */
const MEDIA_RECORD_PREFIX = 'media-';
/** Media zone name: `<journeyZoneName>-media`. */
const MEDIA_ZONE_SUFFIX = '-media';

/**
 * Resolved originals, cached for the page lifetime. Only successful (non-null)
 * lookups are cached: a transient failure must not pin a photo to its thumb forever,
 * so a null result stays retryable on the next open.
 */
const originalUrlCache = new Map<string, string>();

/** Derive the MEDIA zone id from a journey zone, preserving `ownerRecordName`. */
function toMediaZoneID(zoneID: CloudKitJS.ZoneID): CloudKitJS.ZoneID {
    return { ...zoneID, zoneName: `${zoneID.zoneName}${MEDIA_ZONE_SUFFIX}` };
}

async function lookupOriginalUrl(photoId: string, journeySlug: string): Promise<string | null> {
    const zone = await resolveJourneyZone(journeySlug);
    if (!zone) return null;

    // The database follows the zone (trap #5): a shared-in journey's media zone lives
    // in the shared DB and its zone id carries the owner's record name; an owned
    // journey's lives in the private DB.
    const db = zone.scope === 'shared' ? await getSharedDatabase() : await getPrivateDatabase();
    const zoneID = toMediaZoneID(zone.zoneID);
    const recordName = `${MEDIA_RECORD_PREFIX}${photoId}`;

    // A plain lookup by record name — `recordName` is not a queryable field, and this is
    // exactly one record. The zone goes in the OPTIONS argument (trap #4), never on a
    // record. `desiredKeys` trims the response to the one asset we need; CloudKit JS's
    // fetchRecords accepts it in the same options bag as `zoneID`.
    const response = await db.fetchRecords(recordName, {
        zoneID,
        desiredKeys: ['original'],
    });

    // A missing record resolves with `hasErrors` rather than rejecting (trap #6).
    if (response.hasErrors) return null;
    const record = response.records?.[0];
    if (!record) return null;
    return assetUrl(record.fields?.original?.value) ?? null;
}

/**
 * Full-size download URL for a photo whose original now lives in a `PhotoMedia`
 * record, or null when it cannot be resolved (unknown zone, missing record, or any
 * CloudKit failure). Callers keep the thumb as the floor on null.
 *
 * Cached per photoId for the page lifetime; failures are not cached so a later open
 * can retry.
 */
export async function fetchOriginalUrl(
    photoId: string,
    journeySlug: string
): Promise<string | null> {
    const cached = originalUrlCache.get(photoId);
    if (cached) return cached;

    try {
        const url = await lookupOriginalUrl(photoId, journeySlug);
        if (url) originalUrlCache.set(photoId, url);
        return url;
    } catch {
        // On ANY failure return null quietly — the thumb still shows.
        return null;
    }
}

/** Testing / sign-out hook — a different account must not inherit resolved URLs. */
export function clearOriginalUrlCache(): void {
    originalUrlCache.clear();
}
