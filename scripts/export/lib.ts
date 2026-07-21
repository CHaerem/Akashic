/**
 * Shared pure helpers for the Akashic Apple-migration export/salvage tooling.
 *
 * Everything in this file is deterministic and dependency-light (only `node:crypto`)
 * so it can be unit-smoke-tested without touching Supabase, R2, exifr or sharp.
 *
 * The heavy I/O scripts (exportFromSupabase / pullR2Archive / salvageReconstruct /
 * verifyExport) import from here so the tricky logic — coordinate unwrapping,
 * R2-key parsing, thumbnail pairing, fixture->snake_case mapping — lives in one
 * tested place.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Row shapes (mirror the effective Postgres schema, snake_case).
// These are the "one input format" the CloudKit importer consumes, whether the
// rows come from the Supabase dump or the R2/fixture salvage path.
// ---------------------------------------------------------------------------

export type Lng = number;
export type Lat = number;
export type LngLat = [Lng, Lat];

/** GeoJSON Point as stored by the bulk-upload EXIF pipeline. */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: number[];
}

/** photos.coordinates / waypoints.coordinates are EITHER a GeoJSON Point OR a bare [lng,lat] array. */
export type CoordinateValue = GeoJsonPoint | number[] | null | undefined;

export type CoordinateEncoding = 'geojson' | 'array' | 'null' | 'unknown';

export interface JourneyRow {
  id: string;
  created_by: string | null;
  name: string;
  slug: string;
  description: string | null;
  country: string | null;
  journey_type: string | null;
  summit_elevation: number | null;
  total_distance: number | null;
  total_days: number | null;
  date_started: string | null;
  date_ended: string | null;
  hero_image_url: string | null;
  gpx_url: string | null;
  center_coordinates: unknown;
  default_zoom: number | null;
  is_public: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  route: unknown;
  stats: unknown;
  preferred_bearing: number | null;
  preferred_pitch: number | null;
}

export interface WaypointRow {
  id: string;
  journey_id: string;
  name: string;
  waypoint_type: string | null;
  day_number: number | null;
  coordinates: unknown;
  elevation: number | null;
  description: string | null;
  highlights: string[] | null;
  arrival_time: string | null;
  departure_time: string | null;
  date_visited: string | null;
  sort_order: number | null;
  created_at: string | null;
  route_distance_km: number | null;
  route_point_index: number | null;
  weather: unknown;
  fun_facts: unknown;
  points_of_interest: unknown;
  historical_sites: unknown;
}

export interface PhotoRow {
  id: string;
  journey_id: string | null;
  waypoint_id: string | null;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  coordinates: unknown;
  taken_at: string | null;
  is_hero: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  uploaded_by: string | null;
  rotation: number | null;
  media_type: string | null;
  duration: number | null;
  location_source: string | null;
}

// ---------------------------------------------------------------------------
// Coordinate handling — the two encodings (GeoJSON Point vs bare array).
// ---------------------------------------------------------------------------

/**
 * Unwrap a coordinate value to a bare `[lng, lat]` pair regardless of encoding.
 * Accepts a GeoJSON `{type:'Point',coordinates:[lng,lat(,ele)]}`, a bare
 * `[lng,lat(,ele)]` array, or null/garbage. Elevation (a 3rd element) is dropped.
 * Returns null when no valid finite lng/lat pair can be extracted.
 */
export function unwrapCoordinates(value: CoordinateValue): LngLat | null {
  if (value == null) return null;

  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === 'object' && (value as GeoJsonPoint).type === 'Point') {
    arr = (value as GeoJsonPoint).coordinates;
  } else {
    return null;
  }

  if (!Array.isArray(arr) || arr.length < 2) return null;
  const lng = Number(arr[0]);
  const lat = Number(arr[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** Classify how a coordinate value is encoded (for verification stats). */
export function coordinateEncoding(value: CoordinateValue): CoordinateEncoding {
  if (value == null) return 'null';
  if (Array.isArray(value)) return value.length >= 2 ? 'array' : 'unknown';
  if (typeof value === 'object' && (value as GeoJsonPoint).type === 'Point') return 'geojson';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Media type / extension helpers.
// ---------------------------------------------------------------------------

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif'] as const;
export const VIDEO_EXTENSIONS = ['mov', 'mp4', 'm4v', 'webm'] as const;

/** Lowercase extension without the leading dot, or '' if none. */
export function extOf(nameOrKey: string): string {
  const base = nameOrKey.split('/').pop() ?? nameOrKey;
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Map a filename/key/extension to 'image' | 'video' (defaults to 'image'). */
export function mediaTypeFromExt(nameOrKey: string): 'image' | 'video' {
  const ext = extOf(nameOrKey);
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? 'video' : 'image';
}

// ---------------------------------------------------------------------------
// R2 key parsing + thumbnail pairing.
// Key scheme: journeys/{journeyId}/photos/{photoId}.{ext}
//             journeys/{journeyId}/photos/{photoId}_thumb.jpg
//             journeys/{journeyId}/{heroFile}            (hero / other)
// ---------------------------------------------------------------------------

export interface ParsedR2Key {
  key: string;
  journeyId: string;
  /** 'photo' for objects under .../photos/, 'other' for hero/gpx/etc under the journey prefix. */
  kind: 'photo' | 'other';
  /** Present only for kind==='photo'. */
  photoId?: string;
  filename: string;
  ext: string;
  isThumb: boolean;
}

const THUMB_SUFFIX = '_thumb';

/** Does this key point at a thumbnail object (…_thumb.jpg)? */
export function isThumbKey(key: string): boolean {
  const base = key.split('/').pop() ?? key;
  const dot = base.lastIndexOf('.');
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  return stem.endsWith(THUMB_SUFFIX);
}

/**
 * Parse an R2 object key into its journey/photo components. Returns null for
 * keys that are not under a `journeys/{id}/…` prefix.
 */
export function parseR2Key(key: string): ParsedR2Key | null {
  const photoMatch = key.match(/^journeys\/([^/]+)\/photos\/(.+)$/);
  if (photoMatch) {
    const [, journeyId, filename] = photoMatch;
    const ext = extOf(filename);
    const dot = filename.lastIndexOf('.');
    const stem = dot >= 0 ? filename.slice(0, dot) : filename;
    const isThumb = stem.endsWith(THUMB_SUFFIX);
    const photoId = isThumb ? stem.slice(0, -THUMB_SUFFIX.length) : stem;
    return { key, journeyId, kind: 'photo', photoId, filename, ext, isThumb };
  }

  const otherMatch = key.match(/^journeys\/([^/]+)\/(.+)$/);
  if (otherMatch) {
    const [, journeyId, rest] = otherMatch;
    const filename = rest.split('/').pop() ?? rest;
    return { key, journeyId, kind: 'other', filename, ext: extOf(filename), isThumb: isThumbKey(key) };
  }

  return null;
}

/** Extract just the photoId from a key, or null if it is not a photo key. */
export function photoIdFromKey(key: string): string | null {
  const parsed = parseR2Key(key);
  return parsed?.kind === 'photo' ? parsed.photoId ?? null : null;
}

export interface PairedPhoto {
  journeyId: string;
  photoId: string;
  /** The original object key (undefined if only a thumb was found). */
  originalKey?: string;
  /** The `_thumb.jpg` object key (undefined if none). */
  thumbKey?: string;
  /** Extension of the original (or thumb, if original missing). */
  ext: string;
}

/**
 * Group a flat list of R2 keys into photo units, pairing each original with its
 * `_thumb.jpg` sibling by photoId. Non-photo keys (hero/gpx) are ignored.
 * Deterministic ordering: by journeyId then photoId.
 */
export function pairPhotosFromKeys(keys: string[]): PairedPhoto[] {
  const byId = new Map<string, PairedPhoto>();
  for (const key of keys) {
    const parsed = parseR2Key(key);
    if (!parsed || parsed.kind !== 'photo' || !parsed.photoId) continue;
    const mapKey = `${parsed.journeyId}/${parsed.photoId}`;
    let entry = byId.get(mapKey);
    if (!entry) {
      entry = { journeyId: parsed.journeyId, photoId: parsed.photoId, ext: parsed.ext };
      byId.set(mapKey, entry);
    }
    if (parsed.isThumb) {
      entry.thumbKey = key;
    } else {
      entry.originalKey = key;
      entry.ext = parsed.ext;
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.journeyId === b.journeyId
      ? a.photoId.localeCompare(b.photoId)
      : a.journeyId.localeCompare(b.journeyId),
  );
}

// ---------------------------------------------------------------------------
// Fixture (recovered trek JSON) -> snake_case DB row mapping.
// ---------------------------------------------------------------------------

export interface FixtureHighestPoint {
  name?: string;
  elevation?: number;
  coordinates?: number[];
}

export interface FixtureStats {
  totalDistance?: number;
  totalElevationGain?: number;
  totalElevationLoss?: number;
  duration?: number;
  highestPoint?: FixtureHighestPoint;
}

export interface FixtureCamp {
  id: string;
  name: string;
  dayNumber?: number;
  date?: string;
  elevation?: number;
  coordinates: number[];
  distanceFromStart?: number;
  distanceFromPrevious?: number;
  elevationGainFromPrevious?: number;
  timeFromPrevious?: string;
  terrain?: string;
  notes?: string;
  highlights?: string[];
  images?: unknown[];
  bearing?: number;
  pitch?: number;
}

export interface RecoveredFixture {
  id: string;
  name: string;
  country?: string;
  slug: string;
  description?: string;
  heroImage?: string;
  dates?: { start?: string; end?: string };
  stats?: FixtureStats;
  route?: { type: string; coordinates: number[][] };
  camps?: FixtureCamp[];
}

/** trekConfig.ts `treks[]` entry (globe marker config). */
export interface TrekConfig {
  id: string;
  name: string;
  country: string;
  elevation: string; // e.g. "5,895m"
  lat: number;
  lng: number;
  preferredBearing: number;
  preferredPitch: number;
}

/** "5,895m" / "5 895 m" / "4215" -> 5895 (null if unparseable). */
export function elevationToNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  const digits = value.replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a camp `date` like "Oct 1" into an ISO date (YYYY-MM-DD) using the given
 * year. Returns null for non-month formats such as "Day 3" / "Day 5 (PM)".
 * Mirrors the parseCampDate helper in scripts/migrateToSupabase.js.
 */
export function parseCampDate(dateStr: string | undefined, year: number): string | null {
  if (!dateStr) return null;
  const m = dateStr.trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = parseInt(m[2], 10);
  if (!Number.isFinite(day)) return null;
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

/** Add `n` days to an ISO date string (YYYY-MM-DD). */
export function addDaysISO(isoDate: string, n: number): string | null {
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) return null;
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/** Best-effort date_visited: explicit "Mon D" wins, else journeyStart + (dayNumber-1). */
export function campDateVisited(
  camp: FixtureCamp,
  journeyStart: string | undefined,
  startYear: number,
): string | null {
  const parsed = parseCampDate(camp.date, startYear);
  if (parsed) return parsed;
  if (journeyStart && typeof camp.dayNumber === 'number') {
    return addDaysISO(journeyStart, Math.max(0, camp.dayNumber - 1));
  }
  return null;
}

/** Index of the nearest route vertex to a point (squared planar distance). */
export function nearestRoutePointIndex(coord: number[], route: number[][] | undefined): number | null {
  if (!route || route.length === 0 || !Array.isArray(coord) || coord.length < 2) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    const dx = p[0] - coord[0];
    const dy = p[1] - coord[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Camps that are summits by convention (see report-docs-scripts / migrateToSupabase). */
const SUMMIT_CAMP_IDS = new Set(['uhuru-peak', 'point-lenana']);

/** Decide waypoint_type from a camp (summit vs camp). */
export function waypointType(camp: FixtureCamp): string {
  if (SUMMIT_CAMP_IDS.has(camp.id)) return 'summit';
  if (/\b(summit|peak)\b/i.test(camp.name)) return 'summit';
  return 'camp';
}

/**
 * Deterministic synthetic UUID from a seed string (sha1 -> RFC-4122-shaped,
 * version nibble 5). Used for salvage waypoint ids, which cannot be recovered
 * from R2/fixtures — stable across re-runs so the output diffs cleanly.
 */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex');
  const s = h.slice(0, 32);
  const v = '5' + s.slice(13, 16); // version 5
  const y = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16) + s.slice(17, 20); // variant
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${v}-${y}-${s.slice(20, 32)}`;
}

/** Map a recovered fixture + optional trek config to a `journeys` row. */
export function fixtureToJourneyRow(
  journeyId: string,
  fixture: RecoveredFixture,
  config: TrekConfig | null,
  heroImageUrl: string | null,
): JourneyRow {
  const stats = fixture.stats ?? {};
  const summitFromStats = stats.highestPoint?.elevation ?? null;
  return {
    id: journeyId,
    created_by: null, // SALVAGE-LOST (owner identity not in R2/fixtures)
    name: fixture.name,
    slug: fixture.slug,
    description: fixture.description ?? null,
    country: fixture.country ?? config?.country ?? null,
    journey_type: 'trek',
    summit_elevation: elevationToNumber(config?.elevation) ?? summitFromStats,
    total_distance: stats.totalDistance ?? null,
    total_days: stats.duration ?? null,
    date_started: fixture.dates?.start ?? null,
    date_ended: fixture.dates?.end ?? null,
    hero_image_url: heroImageUrl,
    gpx_url: null, // null for all journeys (route lives in `route` JSONB)
    center_coordinates: config ? [config.lng, config.lat] : null,
    default_zoom: null,
    is_public: true, // all three journeys are public
    created_at: null,
    updated_at: null,
    route: fixture.route ?? null,
    stats: fixture.stats ?? null,
    preferred_bearing: config?.preferredBearing ?? null,
    preferred_pitch: config?.preferredPitch ?? null,
  };
}

/** Map a fixture camp to a `waypoints` row. */
export function fixtureToWaypointRow(
  journeyId: string,
  camp: FixtureCamp,
  index: number,
  route: number[][] | undefined,
  journeyStart: string | undefined,
): WaypointRow {
  const startYear = journeyStart ? new Date(journeyStart).getUTCFullYear() : new Date().getUTCFullYear();
  return {
    id: deterministicUuid(`${journeyId}:waypoint:${camp.id}`),
    journey_id: journeyId,
    name: camp.name,
    waypoint_type: waypointType(camp),
    day_number: camp.dayNumber ?? null,
    coordinates: unwrapCoordinates(camp.coordinates), // bare [lng,lat]
    elevation: camp.elevation ?? null,
    description: camp.notes ?? null,
    highlights: camp.highlights ?? null,
    arrival_time: null, // SALVAGE-LOST
    departure_time: null, // SALVAGE-LOST
    date_visited: campDateVisited(camp, journeyStart, startYear),
    sort_order: index,
    created_at: null,
    route_distance_km: camp.distanceFromStart ?? null,
    route_point_index: nearestRoutePointIndex(camp.coordinates, route),
    weather: null, // SALVAGE-LOST (Open-Meteo, post-Nov-2025)
    fun_facts: [], // SALVAGE-LOST (post-Nov-2025 enrichment)
    points_of_interest: [], // SALVAGE-LOST
    historical_sites: [], // SALVAGE-LOST
  };
}

// ---------------------------------------------------------------------------
// Serialization + hashing (deterministic, for stable dumps + manifests).
// ---------------------------------------------------------------------------

/**
 * Deterministic pretty JSON: object keys sorted recursively, 2-space indent.
 * Used for salvage/normalized outputs and for hashing so re-runs are byte-stable.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2) + '\n';
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Pretty JSON preserving key order (for raw table dumps — "raw truth"). */
export function rawStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/** Sort an array of rows by their `id` field, ascending. Returns a new array. */
export function sortById<T extends { id?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')));
}

/** SHA-256 hex of a string or buffer. */
export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** MD5 hex — R2/S3 ETags for single-part uploads are the object MD5 (quoted). */
export function md5(data: string | Uint8Array): string {
  return createHash('md5').update(data).digest('hex');
}

/** Strip surrounding quotes from an S3 ETag; returns lowercase hex (or null if multipart "-N"). */
export function normalizeEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  const clean = etag.replace(/^"+|"+$/g, '').toLowerCase();
  return clean.includes('-') ? null : clean; // multipart etags aren't a plain MD5
}

// ---------------------------------------------------------------------------
// Small async concurrency limiter (used by the R2 pull / head-batching).
// ---------------------------------------------------------------------------

/** Run `fn` over `items` with at most `limit` in flight; preserves input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Human-readable byte size. */
export function humanBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(u === 0 ? 0 : 2)} ${units[u]}`;
}
