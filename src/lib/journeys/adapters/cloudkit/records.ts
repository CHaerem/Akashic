/**
 * Pure mappers: CloudKit records -> the DB-shaped rows the app already speaks.
 *
 * These have NO CloudKit dependency — they take plain record-field bags — so
 * they can be unit-tested in isolation and feed the existing transforms.ts
 * (toTrekConfig / toTrekData) unchanged.
 *
 * Field-name conventions (camelCase CloudKit fields -> snake_case DB rows)
 * follow apple/CloudKit/MAPPING.md. `route`/`stats`/`weather`/etc. are stored
 * as JSON — either an inline STRING field (`*JSON`) or, above the field size
 * limit, a CKAsset (handled as a TODO below).
 */

import type {
    Route,
    TrekStats,
    Photo,
    Profile,
    JourneyMember,
    JourneyRole,
    MediaType,
    LocationSource,
} from '../../../../types/trek';
import type {
    DbJourney,
    DbWaypoint,
    DayComment,
    CommentAuthor,
    WeatherData,
    DbFunFact,
    DbPointOfInterest,
    DbHistoricalSite,
} from '../../types';

/** A CloudKit-JS-shaped record, kept minimal so mappers stay dependency-free. */
export interface CKRecordLike {
    recordName?: string;
    recordType?: string;
    fields?: Record<string, { value?: unknown } | undefined>;
    created?: { timestamp?: number; userRecordName?: string };
    modified?: { timestamp?: number; userRecordName?: string };
}

/** Read a raw field value out of a record. */
export function fieldValue(record: CKRecordLike, name: string): unknown {
    return record.fields?.[name]?.value;
}

function stringOrNull(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
}

function numberOrNull(v: unknown): number | null {
    return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

function stringArrayOrNull(v: unknown): string[] | null {
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return null;
}

/** CloudKit encodes booleans as INT64 0/1 (occasionally as real booleans). */
function boolFromCK(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return false;
}

/**
 * Unwrap a coordinate value to `[lng, lat]`, supporting both encodings:
 *  - CloudKit LOCATION field: `{ latitude, longitude }`
 *  - a plain `[lng, lat]` (or `[lng, lat, ele]`) list
 *  - a GeoJSON-ish `{ coordinates: [lng, lat] }`
 */
export function toLngLat(value: unknown): [number, number] | null {
    if (value == null) return null;

    if (Array.isArray(value)) {
        const [lng, lat] = value as unknown[];
        if (typeof lng === 'number' && typeof lat === 'number') return [lng, lat];
        return null;
    }

    if (typeof value === 'object') {
        const loc = value as { latitude?: unknown; longitude?: unknown; coordinates?: unknown };
        if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
            return [loc.longitude, loc.latitude];
        }
        if (Array.isArray(loc.coordinates)) return toLngLat(loc.coordinates);
    }

    return null;
}

/** Resolve a CKReference (or bare record name string) to its record name. */
export function referenceName(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
        const ref = value as { recordName?: unknown };
        if (typeof ref.recordName === 'string') return ref.recordName;
    }
    return null;
}

/** Extract a full https download URL from a CKAsset field (or a URL string). */
export function assetUrl(value: unknown): string | null {
    if (value && typeof value === 'object') {
        const asset = value as { downloadURL?: unknown };
        if (typeof asset.downloadURL === 'string') return asset.downloadURL;
    }
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
    return null;
}

/**
 * Parse a JSON-backed field. Handles the inline STRING encoding; an
 * already-structured value passes through.
 */
export function parseJsonField<T>(value: unknown): T | null {
    if (value == null) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }
    if (typeof value === 'object') {
        // CKAsset-backed JSON cannot be read synchronously here.
        if ('downloadURL' in (value as object) || 'fileChecksum' in (value as object)) {
            // TODO(cloudkit): fetch asset-backed JSON (routeJSON/statsJSON) when a
            // payload exceeds CloudKit's string-field size limit.
            return null;
        }
        return value as T;
    }
    return null;
}

function timestampToIso(ts?: number): string | null {
    return typeof ts === 'number' ? new Date(ts).toISOString() : null;
}

/** Map a `Journey` record to a `DbJourney` row. */
export function recordToDbJourney(record: CKRecordLike): DbJourney {
    const f = (n: string) => fieldValue(record, n);
    return {
        id: record.recordName ?? '',
        slug: stringOrNull(f('slug')) ?? '',
        name: stringOrNull(f('name')) ?? '',
        description: stringOrNull(f('description')),
        country: stringOrNull(f('country')),
        summit_elevation: numberOrNull(f('summitElevation')),
        total_distance: numberOrNull(f('totalDistance')),
        total_days: numberOrNull(f('totalDays')),
        date_started: stringOrNull(f('dateStarted')),
        date_ended: stringOrNull(f('dateEnded')),
        hero_image_url: assetUrl(f('heroImage')) ?? stringOrNull(f('heroImageURL')),
        // Schema field is `centerLocation` (LOCATION); `centerCoordinates` kept as a defensive fallback.
        center_coordinates: toLngLat(f('centerLocation')) ?? toLngLat(f('centerCoordinates')),
        route: parseJsonField<Route>(f('routeJSON')),
        stats: parseJsonField<TrekStats>(f('statsJSON')),
        preferred_bearing: numberOrNull(f('preferredBearing')),
        preferred_pitch: numberOrNull(f('preferredPitch')),
        is_public: boolFromCK(f('isPublic')),
    };
}

/** Map a `Waypoint` record to a `DbWaypoint` row. */
export function recordToDbWaypoint(record: CKRecordLike): DbWaypoint {
    const f = (n: string) => fieldValue(record, n);
    return {
        id: record.recordName ?? '',
        journey_id: referenceName(f('journeyRef')) ?? stringOrNull(f('journeyId')) ?? '',
        name: stringOrNull(f('name')) ?? '',
        waypoint_type: stringOrNull(f('waypointType')) ?? 'camp',
        day_number: numberOrNull(f('dayNumber')),
        coordinates: toLngLat(f('coordinates')) ?? [0, 0],
        elevation: numberOrNull(f('elevation')),
        description: stringOrNull(f('description')),
        highlights: stringArrayOrNull(f('highlights')),
        sort_order: numberOrNull(f('sortOrder')),
        route_distance_km: numberOrNull(f('routeDistanceKm')),
        route_point_index: numberOrNull(f('routePointIndex')),
        weather: parseJsonField<WeatherData>(f('weatherJSON')),
        fun_facts: parseJsonField<DbFunFact[]>(f('funFactsJSON')),
        points_of_interest: parseJsonField<DbPointOfInterest[]>(f('pointsOfInterestJSON')),
        historical_sites: parseJsonField<DbHistoricalSite[]>(f('historicalSitesJSON')),
    };
}

/**
 * Map a `Photo` record to a `Photo`. CKAsset download URLs are full,
 * pre-authenticated https URLs, so `url`/`thumbnail_url` are ready to use and
 * `coordinates` are already `[lng, lat]` (no PostGIS-style unwrap needed).
 */
export function recordToPhoto(record: CKRecordLike): Photo {
    const f = (n: string) => fieldValue(record, n);
    return {
        id: record.recordName ?? '',
        journey_id: referenceName(f('journeyRef')) ?? stringOrNull(f('journeyId')) ?? '',
        waypoint_id: referenceName(f('waypointRef')),
        // Schema asset fields are `original`/`thumb` (see apple/CloudKit/schema.ckdb);
        // the other names are defensive fallbacks only.
        url:
            assetUrl(f('original')) ??
            assetUrl(f('image')) ??
            assetUrl(f('imageAsset')) ??
            stringOrNull(f('url')) ??
            '',
        thumbnail_url:
            assetUrl(f('thumb')) ??
            assetUrl(f('thumbnail')) ??
            assetUrl(f('thumbnailAsset')) ??
            stringOrNull(f('thumbnailUrl')),
        caption: stringOrNull(f('caption')),
        coordinates: toLngLat(f('coordinates')),
        taken_at: stringOrNull(f('takenAt')),
        is_hero: boolFromCK(f('isHero')),
        sort_order: numberOrNull(f('sortOrder')) ?? undefined,
        created_at:
            stringOrNull(f('createdAt')) ?? timestampToIso(record.created?.timestamp) ?? undefined,
        uploaded_by: referenceName(f('uploadedBy')) ?? record.created?.userRecordName ?? null,
        rotation: numberOrNull(f('rotation')),
        media_type: (stringOrNull(f('mediaType')) as MediaType | null) ?? undefined,
        duration: numberOrNull(f('duration')),
        location_source: (stringOrNull(f('locationSource')) as LocationSource | null) ?? undefined,
    };
}

/** Default author used when no profile/identity is available for a comment. */
export const DEFAULT_COMMENT_AUTHOR: CommentAuthor = {
    id: '',
    display_name: null,
    avatar_url: null,
};

/**
 * Map a `DayComment` record to a `DayComment`, stitching in the author from a
 * pre-fetched identity map (CloudKit has no server-side joins). Falls back to
 * a placeholder author keyed by the comment's user id.
 */
export function recordToDayComment(
    record: CKRecordLike,
    authorsById?: Map<string, CommentAuthor>
): DayComment {
    const f = (n: string) => fieldValue(record, n);
    // Schema has no user field: the author is the record creator. `userRef`/`userId`
    // are defensive fallbacks for hand-crafted records only.
    const userId =
        record.created?.userRecordName ??
        referenceName(f('userRef')) ??
        stringOrNull(f('userId')) ??
        '';
    // `authorDisplayName` is only populated on migrated records (whose CloudKit
    // creator is always the owner) to preserve original attribution — see
    // apple/CloudKit/MAPPING.md §7. It wins over participant identity when set.
    const displayName = stringOrNull(f('authorDisplayName'));
    const mapped = authorsById?.get(userId);
    const author = displayName
        ? { id: userId, display_name: displayName, avatar_url: mapped?.avatar_url ?? null }
        : (mapped ?? { ...DEFAULT_COMMENT_AUTHOR, id: userId });
    return {
        id: record.recordName ?? '',
        waypoint_id: referenceName(f('waypointRef')) ?? stringOrNull(f('waypointId')) ?? '',
        journey_id: referenceName(f('journeyRef')) ?? stringOrNull(f('journeyId')) ?? '',
        user_id: userId,
        content: stringOrNull(f('content')) ?? '',
        created_at: stringOrNull(f('createdAt')) ?? timestampToIso(record.created?.timestamp) ?? '',
        // Schema field is `modifiedAt` (explicit, survives migration); system
        // modification timestamp is the fallback.
        updated_at:
            stringOrNull(f('modifiedAt')) ??
            stringOrNull(f('updatedAt')) ??
            timestampToIso(record.modified?.timestamp) ??
            '',
        author,
    };
}

/** Map a CloudKit user identity to the app's `Profile` shape. */
export function identityToProfile(identity: CloudKitJS.UserIdentity): Profile {
    const name =
        [identity.nameComponents?.givenName, identity.nameComponents?.familyName]
            .filter(Boolean)
            .join(' ') || null;
    return {
        id: identity.userRecordName,
        email: identity.lookupInfo?.emailAddress ?? '',
        display_name: name,
        avatar_url: null,
    };
}

/**
 * Map a CloudKit share participant to a `JourneyMember` (with a `profile`
 * synthesized from the participant's identity).
 */
export function participantToMember(participant: CloudKitJS.ShareParticipant, journeyId: string): JourneyMember {
    const identity = participant.userIdentity;
    const userId = identity?.userRecordName ?? '';
    return {
        id: userId,
        journey_id: journeyId,
        user_id: userId,
        role: permissionToRole(participant.permission, participant.role),
        profile: identity
            ? identityToProfile(identity)
            : { id: userId, email: '', display_name: null, avatar_url: null },
    };
}

/**
 * Map CloudKit share role/permission to the app's role hierarchy.
 * CKShare participant role: owner has the highest privilege; permission 2 is
 * read/write. TODO(cloudkit): pin these against CloudKit JS's numeric enums
 * once the container schema is finalized.
 */
export function permissionToRole(permission?: number, role?: number): JourneyRole {
    // CloudKit JS: ShareParticipantRole.OWNER === 1
    if (role === 1) return 'owner';
    // CloudKit JS: ShareParticipantPermission.READ_WRITE === 3
    if (permission === 3) return 'editor';
    return 'viewer';
}
