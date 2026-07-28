/**
 * CloudKit adapter — the signed-out public showcase (T3.3).
 *
 * A visitor with no Apple ID session still gets the globe, the journeys, their days
 * and photo thumbnails. That works because the publish step mirrors each public
 * journey into two **world-readable** record types in the PUBLIC database
 * (`GRANT READ TO "_world"`, MAPPING §8): `PublicJourney` (metadata + route/stats/
 * waypoints assets) and `PublicPhoto` (thumbnails only, joined by `journeySlug`).
 * CloudKit JS can query both with just the API token — no `setUpAuth`, no user.
 *
 * The public mirror has no UUIDs: a `PublicJourney`'s `recordName` **is** the slug,
 * and the whole app keys journeys by `TrekConfig.id === slug`, so we use the slug as
 * both `DbJourney.id` and `DbJourney.slug`. Everything downstream (transforms,
 * journeyCache, usePhotoDay) is then identical to the signed-in path.
 *
 * Traps already paid for in the signed-in adapter and avoided here (see
 * docs/cloudkit-js-verification.md): dates are TIMESTAMPs (isoDateOrNull), route +
 * waypoints are ASSETs that must be fetched (resolveJsonField), day content is
 * camelCase from Swift (snakeCaseKeys). `journeySlug` is a plain STRING field, so it
 * takes a plain string predicate — not the REFERENCE shape a `*Ref` field needs.
 */

import type { TrekConfig, TrekData, Route, TrekStats, Photo } from '../../../../types/trek';
import type {
    DbJourney,
    DbWaypoint,
    WeatherData,
    DbFunFact,
    DbPointOfInterest,
    DbHistoricalSite,
} from '../../types';
import { toTrekConfig, toTrekData } from '../../transforms';
import { getJourneyCacheState, setJourneyCacheState } from '../../journeyCache';
import { getPublicDatabase, getCloudKitSession } from '../../../cloudkit';
import { performQueryAll } from './paginate';
import {
    fieldValue,
    toLngLat,
    assetUrl,
    snakeCaseKeys,
    parseJsonField,
    resolveJsonField,
    isoDateOrNull,
    stringOrNull,
    numberOrNull,
} from './records';

const PUBLIC_JOURNEY_TYPE = 'PublicJourney';
const PUBLIC_PHOTO_TYPE = 'PublicPhoto';

// ---------------------------------------------------------------------------
// Session probe
// ---------------------------------------------------------------------------

/**
 * Whether an Apple ID session exists, cached for the page load.
 *
 * `getCloudKitSession` calls `setUpAuth`, which resolves the persisted identity (or
 * null) **without** popping any UI — it only renders the sign-in button into the
 * configured element if one is present, which the showcase does not mount until the
 * visitor opens the sign-in overlay. So this is a non-prompting probe: signed-out
 * resolves cleanly to `false` and the read adapters take the public path.
 *
 * Cached because every read path checks it and the answer cannot change without a
 * sign-in/out event (which reloads the app; see AuthGuard).
 */
let signedInCache: boolean | null = null;

export async function isSignedIn(): Promise<boolean> {
    if (signedInCache !== null) return signedInCache;
    try {
        const session = await getCloudKitSession();
        signedInCache = session?.user != null;
    } catch {
        signedInCache = false;
    }
    return signedInCache;
}

/** Clear the cached session answer — on a sign-in/out transition, and in tests. */
export function resetAuthCache(): void {
    signedInCache = null;
}

// ---------------------------------------------------------------------------
// PublicJourney -> DbJourney + waypoints
// ---------------------------------------------------------------------------

function recordToPublicDbJourney(record: CloudKitJS.Record, slug: string): DbJourney {
    const f = (n: string) => fieldValue(record, n);
    return {
        id: slug,
        slug,
        name: stringOrNull(f('name')) ?? '',
        description: stringOrNull(f('description')),
        country: stringOrNull(f('country')),
        summit_elevation: numberOrNull(f('summitElevation')),
        total_distance: numberOrNull(f('totalDistance')),
        total_days: numberOrNull(f('totalDays')),
        date_started: isoDateOrNull(f('dateStarted')),
        date_ended: isoDateOrNull(f('dateEnded')),
        hero_image_url: assetUrl(f('heroThumb')),
        center_coordinates: toLngLat(f('centerLocation')),
        // ASSET: resolved asynchronously in fetchPublicJourneys. An inline string
        // (should the writer ever change) is tolerated by parseJsonField.
        route: parseJsonField<Route>(f('routeJSON')),
        // statsJSON stays an inline STRING (camelCase, matching TrekStats already).
        stats: parseJsonField<TrekStats>(f('statsJSON')),
        preferred_bearing: numberOrNull(f('preferredBearing')),
        preferred_pitch: numberOrNull(f('preferredPitch')),
        is_public: true,
    };
}

/**
 * Coerce a day-content subfield that may arrive either as an already-nested object
 * (snake-cased with the rest of the payload) or as a nested JSON string. Either way
 * the result is snake_cased so `transforms.ts` can read it.
 */
function coerceNested<T>(value: unknown): T | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        const parsed = parseJsonField<T>(value);
        return parsed == null ? null : snakeCaseKeys<T>(parsed);
    }
    if (typeof value === 'object') return snakeCaseKeys<T>(value);
    return null;
}

function mapWaypoint(raw: unknown, slug: string, index: number): DbWaypoint {
    // Swift's Codable emits camelCase; the Db* shapes are snake_case (Postgres-era).
    const w = snakeCaseKeys<Record<string, unknown>>(raw ?? {});
    const dayNumber = numberOrNull(w.day_number);
    // The payload carries stable camp ids; fall back to a slug/day-derived id so day
    // grouping (usePhotoDay tier 1, keyed on camp id) still lines up if one is absent.
    const id = stringOrNull(w.id) ?? `${slug}-day-${dayNumber ?? index + 1}`;
    return {
        id,
        journey_id: slug,
        name: stringOrNull(w.name) ?? '',
        waypoint_type: stringOrNull(w.waypoint_type) ?? 'camp',
        day_number: dayNumber,
        coordinates: toLngLat(w.coordinates) ?? [0, 0],
        elevation: numberOrNull(w.elevation),
        // The public mirror encodes a Swift `Camp` (Domain.swift), whose day text is
        // `notes` — there is no `description` key. (The signed-in path differs: its
        // RecordCoder renames camp.notes into the Waypoint record's `description`
        // field.) snakeCaseKeys leaves the single word `notes` untouched, so read it
        // directly, preferring `description` if a future writer ever emits it.
        description: stringOrNull(w.description) ?? stringOrNull(w.notes),
        highlights: Array.isArray(w.highlights)
            ? w.highlights.filter((x): x is string => typeof x === 'string')
            : null,
        sort_order: numberOrNull(w.sort_order) ?? index,
        route_distance_km: numberOrNull(w.route_distance_km),
        route_point_index: numberOrNull(w.route_point_index),
        weather: coerceNested<WeatherData>(w.weather ?? w.weather_json),
        fun_facts: coerceNested<DbFunFact[]>(w.fun_facts ?? w.fun_facts_json),
        points_of_interest: coerceNested<DbPointOfInterest[]>(
            w.points_of_interest ?? w.points_of_interest_json
        ),
        historical_sites: coerceNested<DbHistoricalSite[]>(
            w.historical_sites ?? w.historical_sites_json
        ),
    };
}

function mapWaypointsPayload(payload: unknown, slug: string): DbWaypoint[] {
    if (!Array.isArray(payload)) return [];
    return payload.map((raw, index) => mapWaypoint(raw, slug, index));
}

/**
 * All public journeys, mapped to the same `{ treks, trekDataMap }` shape the signed-in
 * `fetchJourneys` returns, and pushed into the shared journeyCache the whole app reads.
 */
export async function fetchPublicJourneys(): Promise<{
    treks: TrekConfig[];
    trekDataMap: Record<string, TrekData>;
}> {
    let records: CloudKitJS.Record[];
    try {
        const db = await getPublicDatabase();
        // SHIP-20 — THIS QUERY HAS NO CREATOR FILTER, AND THE RECORD TYPE IS `_icloud`-CREATABLE.
        // `apple/CloudKit/schema.ckdb` grants every public type `GRANT WRITE TO "_creator"` *and*
        // `GRANT CREATE TO "_icloud"`, so any Apple ID can create a `PublicJourney` that this line
        // then fetches and the globe renders at akashic.no. A stranger cannot modify our records;
        // they can add their own. The public database is billed to us, not to the customer, so the
        // traffic is our cost line too.
        //
        // The cheap half of the fix belongs here: filter on `created.userRecordName`, which is
        // already typed on the record. It is deliberately NOT applied yet, because client-side
        // filtering still lets a stranger's records exist and be billed, and choosing between that
        // and a schema change is the owner's call. Do not "tidy" this comment away — it is the only
        // marker on the defect at the line that carries it.
        records = await performQueryAll(db, { recordType: PUBLIC_JOURNEY_TYPE });
    } catch (err) {
        console.error('[cloudkit] Error fetching public journeys:', err);
        return { treks: [], trekDataMap: {} };
    }

    if (records.length === 0) {
        return { treks: [], trekDataMap: {} };
    }

    // Each journey awaits its route + waypoints asset fetches, so completion order
    // follows network latency, not the query. Building treks inside the Promise.all
    // callbacks therefore reshuffled the globe's journey order between page loads.
    // Gather first, then sort deterministically below.
    const mapped = await Promise.all(
        records.map(async (record) => {
            try {
                const slug = stringOrNull(fieldValue(record, 'slug')) ?? record.recordName ?? '';
                if (!slug) return null;
                const journey = recordToPublicDbJourney(record, slug);
                // route + waypoints are ASSETs — a metadata query returns only their
                // { downloadURL } descriptors, so fetch both bodies (in parallel).
                const [route, waypointsPayload] = await Promise.all([
                    resolveJsonField<Route>(fieldValue(record, 'routeJSON')),
                    resolveJsonField<unknown[]>(fieldValue(record, 'waypointsJSON')),
                ]);
                if (route) journey.route = route;
                const waypoints = mapWaypointsPayload(waypointsPayload, slug);
                return { slug, journey, waypoints };
            } catch (err) {
                console.error('[cloudkit] Failed to map public journey:', err);
                return null;
            }
        })
    );

    // Deterministic order: most recent journey first (dateStarted descending), name as
    // a stable tiebreak, nulls last. Independent of asset-fetch completion order, so a
    // signed-out visitor gets the same globe/list order on every reload.
    const ordered = mapped
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => {
            const da = a.journey.date_started ?? '';
            const db = b.journey.date_started ?? '';
            if (da !== db) return da < db ? 1 : -1;
            return a.journey.name.localeCompare(b.journey.name);
        });

    const treks: TrekConfig[] = [];
    const trekDataMap: Record<string, TrekData> = {};
    for (const { slug, journey, waypoints } of ordered) {
        treks.push(toTrekConfig(journey));
        trekDataMap[slug] = toTrekData(journey, waypoints);
    }

    setJourneyCacheState({ treks, trekDataMap, loaded: true });
    return { treks, trekDataMap };
}

// ---------------------------------------------------------------------------
// PublicPhoto -> Photo
// ---------------------------------------------------------------------------

/**
 * A day-number -> camp-id map from the already-cached journey, so a public photo's
 * `dayNumber` can be turned into the exact `waypoint_id` usePhotoDay matches on
 * (tier 1). fetchPublicJourneys must have run first, which the app guarantees:
 * journeys load before any journey's photos.
 */
function buildDayToWaypointId(slug: string): Map<number, string> {
    const map = new Map<number, string>();
    const trekData = getJourneyCacheState().trekDataMap[slug];
    trekData?.camps.forEach((camp) => {
        if (camp.dayNumber != null) map.set(camp.dayNumber, camp.id);
    });
    return map;
}

function recordToPublicPhoto(
    record: CloudKitJS.Record,
    slug: string,
    dayToWaypointId: Map<number, string>
): Photo {
    const f = (n: string) => fieldValue(record, n);
    const thumb = assetUrl(f('thumb'));
    const dayNumber = numberOrNull(f('dayNumber'));
    // Synthesize the waypoint id from dayNumber so day grouping is exact. Null when
    // the photo has no dayNumber (falls through to usePhotoDay's coarser tiers).
    const waypointId = dayNumber != null ? dayToWaypointId.get(dayNumber) ?? null : null;
    return {
        id: record.recordName ?? '',
        journey_id: slug,
        waypoint_id: waypointId,
        // Thumb is the only asset a public photo carries (no originals, ever — D9).
        url: thumb ?? '',
        thumbnail_url: thumb,
        caption: stringOrNull(f('caption')),
        coordinates: toLngLat(f('coordinates')),
        taken_at: isoDateOrNull(f('takenAt')),
        is_hero: false,
        sort_order: numberOrNull(f('sortOrder')) ?? undefined,
    };
}

/** Photos ordered by sort_order asc, then taken_at asc (nulls last) — mirrors photoAdapter. */
function sortPublicPhotos(photos: Photo[]): Photo[] {
    return photos.sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (so !== 0) return so;
        if (!a.taken_at) return 1;
        if (!b.taken_at) return -1;
        return a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : 0;
    });
}

/**
 * All public thumbnails for a journey, joined on the QUERYABLE `journeySlug` STRING
 * field. Paginated: Kilimanjaro alone has 939 photos, far past one page.
 */
export async function fetchPublicPhotos(slug: string): Promise<Photo[]> {
    let records: CloudKitJS.Record[];
    try {
        const db = await getPublicDatabase();
        records = await performQueryAll(db, {
            recordType: PUBLIC_PHOTO_TYPE,
            // journeySlug is a plain STRING (not a *Ref REFERENCE), so a plain string
            // predicate is correct here — this is not the reference-decode trap.
            filterBy: [{ fieldName: 'journeySlug', comparator: 'EQUALS', fieldValue: { value: slug } }],
        });
    } catch (err) {
        console.error('[cloudkit] Error fetching public photos:', err);
        return [];
    }

    const dayToWaypointId = buildDayToWaypointId(slug);
    return sortPublicPhotos(records.map((r) => recordToPublicPhoto(r, slug, dayToWaypointId)));
}
