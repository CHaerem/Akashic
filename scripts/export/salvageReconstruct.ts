/**
 * salvageReconstruct.ts — reconstruct the export WITHOUT Postgres (PATH B).
 *
 * When the Supabase project is gone/paused (host was NXDOMAIN at audit time),
 * rebuild as much as possible from three surviving sources:
 *   1. export/r2/inventory.json  (from pullR2Archive.ts)      — object keys, sizes, customMetadata
 *   2. export/r2/objects/**      (downloaded originals)        — EXIF taken_at + GPS (images)
 *   3. apple/Fixtures/recovered/*.json + trekConfig            — routes, stats, waypoints, descriptions
 *
 * Emits export/salvage/{journeys,waypoints,photos}.json in the SAME row shape as
 * exportFromSupabase.ts, so the CloudKit importer has ONE input format. A
 * SALVAGE-GAPS section in the manifest records exactly what is recoverable and
 * from where, and what is unrecoverable if Supabase is truly gone.
 *
 *   node scripts/export/salvageReconstruct.ts [--out export] [--repo <repo-root>]
 *
 * Journey slug<->UUID mapping cannot be derived from R2 alone. On first run this
 * writes export/salvage/slugMap.json as a template (discovered UUIDs -> "") for
 * you to fill in, then reconstructs what it can. Re-run after filling it in.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import exifr from 'exifr';
import {
  pairPhotosFromKeys,
  parseR2Key,
  mediaTypeFromExt,
  unwrapCoordinates,
  fixtureToJourneyRow,
  fixtureToWaypointRow,
  humanBytes,
  type RecoveredFixture,
  type TrekConfig,
  type JourneyRow,
  type WaypointRow,
  type PhotoRow,
} from './lib.ts';
import {
  resolveOutDir,
  ensureDir,
  writeStableJson,
  readJson,
  readJsonIfExists,
  fileExists,
} from './io.ts';

interface InventoryItem {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  customMetadata: Record<string, string>;
}

// Mirrors apple/Fixtures/recovered/trekConfig.ts (treks[]). Hardcoded because that
// module imports JSON without an import-attribute and can't be loaded at runtime.
const TREK_CONFIGS: TrekConfig[] = [
  { id: 'kilimanjaro', name: 'Kilimanjaro', country: 'Tanzania', elevation: '5,895m', lat: -3.0674, lng: 37.3556, preferredBearing: -20, preferredPitch: 60 },
  { id: 'mount-kenya', name: 'Mount Kenya', country: 'Kenya', elevation: '5,199m', lat: -0.1521, lng: 37.3084, preferredBearing: -20, preferredPitch: 60 },
  { id: 'inca-trail', name: 'Inca Trail', country: 'Peru', elevation: '4,215m', lat: -13.1631, lng: -72.545, preferredBearing: 45, preferredPitch: 60 },
];

const FIXTURE_FILES = ['kilimanjaro.json', 'mountKenya.json', 'incaTrail.json'] as const;

function findRepoRoot(argv: string[]): string {
  const idx = argv.findIndex((a) => a === '--repo');
  if (idx >= 0 && argv[idx + 1]) return path.resolve(argv[idx + 1]);
  // scripts/export/ -> repo root is two levels up.
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

/** Read a customMetadata value case-insensitively (S3 lowercases keys). */
function meta(item: InventoryItem | undefined, name: string): string | undefined {
  if (!item) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(item.customMetadata)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** EXIF from a downloaded original image; {} if unreadable or file absent. */
async function readImageExif(filePath: string): Promise<{ coordinates?: [number, number]; takenAt?: string }> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const buf = fs.readFileSync(filePath);
    // NOTE: `pick` filters by raw EXIF tag names — the GPS tags must be listed here
    // (exifr's computed `latitude`/`longitude` outputs are still emitted), same
    // pattern as src/lib/exif.ts. Picking the computed names would silently skip
    // the GPS IFD and never yield coordinates.
    const data = await exifr.parse(buf, {
      gps: true,
      pick: ['DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'],
    });
    if (!data) return {};
    const out: { coordinates?: [number, number]; takenAt?: string } = {};
    if (typeof data.longitude === 'number' && typeof data.latitude === 'number') {
      out.coordinates = [data.longitude, data.latitude];
    }
    const when = data.DateTimeOriginal ?? data.CreateDate;
    if (when instanceof Date && !Number.isNaN(when.getTime())) {
      out.takenAt = when.toISOString();
    }
    return out;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const outDir = resolveOutDir(argv);
  const repoRoot = findRepoRoot(argv);
  const salvageDir = path.join(outDir, 'salvage');
  const objectsDir = path.join(outDir, 'r2', 'objects');
  ensureDir(salvageDir);

  console.log(`\n=== Salvage reconstruct (PATH B — no Postgres) ===`);
  console.log(`Repo   : ${repoRoot}`);
  console.log(`Out    : ${salvageDir}\n`);

  // --- Load R2 inventory ------------------------------------------------------
  const inventoryFile = path.join(outDir, 'r2', 'inventory.json');
  if (!fileExists(inventoryFile)) {
    console.error(`❌ Missing ${inventoryFile}. Run pullR2Archive.ts first (\`--inventory-only\` is enough to start).\n`);
    process.exit(1);
  }
  const inventory = readJson<InventoryItem[]>(inventoryFile);
  const invByKey = new Map(inventory.map((i) => [i.key, i]));
  const objectsDownloaded = fileExists(objectsDir);

  // --- Load recovered fixtures ------------------------------------------------
  const fixturesDir = path.join(repoRoot, 'apple', 'Fixtures', 'recovered');
  const fixturesBySlug = new Map<string, RecoveredFixture>();
  for (const f of FIXTURE_FILES) {
    const p = path.join(fixturesDir, f);
    if (!fileExists(p)) {
      console.error(`❌ Missing fixture ${p}`);
      process.exit(1);
    }
    const fx = readJson<RecoveredFixture>(p);
    fixturesBySlug.set(fx.slug, fx);
  }
  const configBySlug = new Map(TREK_CONFIGS.map((c) => [c.id, c]));

  // --- Discover journey UUIDs from R2 keys ------------------------------------
  const journeyIds = [...new Set(inventory.map((i) => parseR2Key(i.key)?.journeyId).filter((x): x is string => !!x))].sort();
  console.log(`Discovered ${journeyIds.length} journey UUID(s) in R2:`);
  for (const j of journeyIds) console.log(`  ${j}`);

  // --- Slug map (uuid -> slug), template on first run -------------------------
  const slugMapFile = path.join(salvageDir, 'slugMap.json');
  let slugMap = readJsonIfExists<Record<string, string>>(slugMapFile) ?? {};
  const knownSlugs = [...fixturesBySlug.keys()];
  const unmapped = journeyIds.filter((j) => !slugMap[j]);
  if (Object.keys(slugMap).length === 0 || unmapped.length === journeyIds.length) {
    const template: Record<string, string> = {
      _instructions: `Fill each journey UUID with its slug (one of: ${knownSlugs.join(', ')}), then re-run. UUID<->slug mapping cannot be derived from R2 alone.`,
      _knownSlugs: knownSlugs.join(', '),
    };
    for (const j of journeyIds) template[j] = slugMap[j] ?? '';
    writeStableJson(slugMapFile, template);
    console.log(`\n⚠️  Wrote slug-map template: ${slugMapFile}`);
    console.log(`    Fill in the ${journeyIds.length} slug(s) and re-run to attach fixture data.`);
    console.log(`    Continuing now with best-effort stubs for unmapped journeys.\n`);
    slugMap = template;
  }

  // --- Reconstruct journeys ---------------------------------------------------
  const journeys: JourneyRow[] = [];
  const waypoints: WaypointRow[] = [];
  let mappedCount = 0;

  for (const journeyId of journeyIds) {
    const slug = slugMap[journeyId];
    const fixture = slug ? fixturesBySlug.get(slug) : undefined;
    const config = slug ? configBySlug.get(slug) ?? null : null;

    // hero candidate: first non-photo object under the journey prefix.
    const heroKey = inventory.find((i) => {
      const p = parseR2Key(i.key);
      return p?.journeyId === journeyId && p.kind === 'other';
    })?.key ?? null;

    if (fixture) {
      mappedCount++;
      journeys.push(fixtureToJourneyRow(journeyId, fixture, config, heroKey));
      const routeCoords = fixture.route?.coordinates;
      (fixture.camps ?? []).forEach((camp, i) => {
        waypoints.push(fixtureToWaypointRow(journeyId, camp, i, routeCoords, fixture.dates?.start));
      });
    } else {
      // Stub: photos still attach by UUID, but no fixture-derived detail.
      journeys.push({
        id: journeyId,
        created_by: null,
        name: slug || `Unmapped journey ${journeyId.slice(0, 8)}`,
        slug: slug || `unmapped-${journeyId.slice(0, 8)}`,
        description: null,
        country: null,
        journey_type: 'trek',
        summit_elevation: null,
        total_distance: null,
        total_days: null,
        date_started: null,
        date_ended: null,
        hero_image_url: heroKey,
        gpx_url: null,
        center_coordinates: null,
        default_zoom: null,
        is_public: true,
        created_at: null,
        updated_at: null,
        route: null,
        stats: null,
        preferred_bearing: null,
        preferred_pitch: null,
      });
    }
  }

  // --- Reconstruct photos from R2 (EXIF for images, metadata for videos) ------
  const paired = pairPhotosFromKeys(inventory.map((i) => i.key));
  const photos: PhotoRow[] = [];
  let exifCoords = 0;
  let exifDates = 0;
  let videoCount = 0;
  const sortCounters = new Map<string, number>();

  for (const p of paired) {
    if (!p.originalKey) continue; // lone thumb with no original — skip
    const item = invByKey.get(p.originalKey);
    const isVideo = mediaTypeFromExt(p.originalKey) === 'video';
    const sort = sortCounters.get(p.journeyId) ?? 0;
    sortCounters.set(p.journeyId, sort + 1);

    let coordinates: [number, number] | null = null;
    let takenAt: string | null = null;
    let locationSource: string | null = null;

    if (isVideo) {
      videoCount++;
      // Videos: no EXIF GPS via exifr — fall back to R2 customMetadata.
      const uploadedAt = meta(item, 'uploadedAt');
      if (uploadedAt) {
        const d = new Date(uploadedAt);
        if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
      }
    } else if (objectsDownloaded) {
      const exif = await readImageExif(path.join(objectsDir, p.originalKey));
      if (exif.coordinates) {
        coordinates = exif.coordinates;
        locationSource = 'exif';
        exifCoords++;
      }
      if (exif.takenAt) {
        takenAt = exif.takenAt;
        exifDates++;
      }
    }

    // customMetadata uploadedAt as a last-resort taken_at for images too.
    if (!takenAt) {
      const uploadedAt = meta(item, 'uploadedAt');
      if (uploadedAt) {
        const d = new Date(uploadedAt);
        if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
      }
    }
    const uploadedBy = meta(item, 'uploadedBy') ?? null;

    photos.push({
      id: p.photoId, // real DB primary key (client UUID == filename)
      journey_id: p.journeyId,
      waypoint_id: null, // SALVAGE-LOST (photo<->waypoint assignment)
      url: p.originalKey,
      thumbnail_url: p.thumbKey ?? null,
      caption: null, // SALVAGE-LOST
      coordinates: coordinates ? unwrapCoordinates(coordinates) : null,
      taken_at: takenAt,
      is_hero: false, // SALVAGE-LOST (default)
      sort_order: sort,
      created_at: item?.lastModified ?? null, // proxy: R2 object last-modified
      uploaded_by: uploadedBy,
      rotation: 0, // SALVAGE-UNCERTAIN (bulk uploads used default 0)
      media_type: isVideo ? 'video' : 'image',
      duration: null, // SALVAGE-LOST (would need ffprobe on bytes)
      location_source: locationSource,
    });
  }
  photos.sort((a, b) => (a.journey_id === b.journey_id ? a.url.localeCompare(b.url) : String(a.journey_id).localeCompare(String(b.journey_id))));

  // --- Write outputs ----------------------------------------------------------
  writeStableJson(path.join(salvageDir, 'journeys.json'), journeys);
  writeStableJson(path.join(salvageDir, 'waypoints.json'), waypoints);
  writeStableJson(path.join(salvageDir, 'photos.json'), photos);

  const manifest = {
    source: 'salvage' as const,
    generated_at: new Date().toISOString(),
    inputs: {
      r2_inventory: path.relative(outDir, inventoryFile),
      r2_objects_downloaded: objectsDownloaded,
      fixtures: FIXTURE_FILES.map((f) => path.join('apple/Fixtures/recovered', f)),
      slug_map: path.relative(outDir, slugMapFile),
    },
    counts: {
      journeys: journeys.length,
      journeys_with_fixture: mappedCount,
      journeys_unmapped: journeys.length - mappedCount,
      waypoints: waypoints.length,
      photos: photos.length,
      videos: videoCount,
      photos_with_exif_gps: exifCoords,
      photos_with_exif_date: exifDates,
    },
    'SALVAGE-GAPS': {
      recovered: {
        'photo/video files, ids, journey grouping, thumbnail pairing': 'R2 key scheme (journeys/{uuid}/photos/{id}[_thumb].{ext})',
        'photo taken_at + GPS (images)': 'EXIF via exifr on downloaded originals',
        'video taken_at (fallback)': 'R2 customMetadata.uploadedAt',
        'photo uploaded_by (if present)': 'R2 customMetadata.uploadedBy',
        'routes, stats, summit, dates, descriptions, highlights, waypoint coords/day/elevation': 'apple/Fixtures/recovered/*.json + trekConfig',
      },
      lost_if_supabase_gone: [
        'photo captions (photos.caption)',
        'photo<->waypoint assignments (photos.waypoint_id)',
        'is_hero flags (photos.is_hero)',
        'video duration (photos.duration)',
        'photo rotation if non-zero (photos.rotation — defaulted to 0)',
        'day_comments (entire table — family-written notes)',
        'journey_members / profiles (sharing roles + author identities)',
        'weather (waypoints.weather — Open-Meteo)',
        'fun_facts / points_of_interest / historical_sites (post-Nov-2025 enrichment)',
        'arrival_time / departure_time (waypoints)',
        'any edits made after the recovered fixtures were captured',
        'exact waypoint UUIDs (regenerated as deterministic synthetic ids)',
        'exact sort_order and created_at (approximated)',
        'journey<->slug mapping (must be supplied via slugMap.json)',
      ],
      notes: [
        'Waypoint ids are synthetic (deterministicUuid of journeyId+camp.id) — stable across re-runs but NOT the original DB ids.',
        'photos.created_at uses R2 last-modified as a proxy for the real DB created_at.',
        'coordinates are emitted as bare [lng,lat] arrays (already normalized).',
      ],
    },
  };
  writeStableJson(path.join(salvageDir, 'manifest.json'), manifest);

  const totalBytes = inventory.reduce((n, i) => n + i.size, 0);
  console.log(`\n✅ Salvage complete.`);
  console.log(`   Journeys: ${journeys.length} (${mappedCount} with fixture, ${journeys.length - mappedCount} stub)`);
  console.log(`   Waypoints: ${waypoints.length}  Photos: ${photos.length} (${videoCount} video)`);
  console.log(`   EXIF: ${exifCoords} with GPS, ${exifDates} with date${objectsDownloaded ? '' : '  (objects not downloaded — EXIF skipped)'}`);
  console.log(`   R2 total: ${humanBytes(totalBytes)}`);
  console.log(`   See ${path.join(salvageDir, 'manifest.json')} → "SALVAGE-GAPS" for what is lost.\n`);
  if (mappedCount < journeyIds.length) {
    console.log(`   ⚠️  ${journeyIds.length - mappedCount} journey(s) unmapped — fill ${slugMapFile} and re-run.\n`);
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
