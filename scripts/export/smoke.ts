/**
 * Tiny unit-style smoke test for the pure helpers in lib.ts.
 *
 *   node scripts/export/smoke.ts        (Node >= 23.6, native TS type-stripping)
 *   npx tsx scripts/export/smoke.ts     (if you prefer tsx)
 *
 * Exercises coordinate unwrap, thumb pairing, R2-key parsing and the
 * fixture->snake_case mapping with inline fixtures. Throws (non-zero exit) on
 * the first failed assertion.
 */

import assert from 'node:assert/strict';
import {
  unwrapCoordinates,
  coordinateEncoding,
  extOf,
  mediaTypeFromExt,
  parseR2Key,
  isThumbKey,
  photoIdFromKey,
  pairPhotosFromKeys,
  elevationToNumber,
  parseCampDate,
  addDaysISO,
  campDateVisited,
  nearestRoutePointIndex,
  waypointType,
  deterministicUuid,
  fixtureToJourneyRow,
  fixtureToWaypointRow,
  stableStringify,
  sortById,
  normalizeEtag,
  mapWithConcurrency,
  humanBytes,
  type RecoveredFixture,
  type TrekConfig,
  type FixtureCamp,
} from './lib.ts';

let passed = 0;
function ok(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- coordinate unwrap --------------------------------------------------------
ok('unwrap GeoJSON Point -> [lng,lat]', () => {
  assert.deepEqual(unwrapCoordinates({ type: 'Point', coordinates: [37.35, -3.07] }), [37.35, -3.07]);
});
ok('unwrap bare array -> [lng,lat]', () => {
  assert.deepEqual(unwrapCoordinates([37.35, -3.07]), [37.35, -3.07]);
});
ok('unwrap drops elevation (3-tuple)', () => {
  assert.deepEqual(unwrapCoordinates([37.35, -3.07, 5895]), [37.35, -3.07]);
});
ok('unwrap null / undefined / garbage -> null', () => {
  assert.equal(unwrapCoordinates(null), null);
  assert.equal(unwrapCoordinates(undefined), null);
  assert.equal(unwrapCoordinates([37.35] as number[]), null);
  assert.equal(unwrapCoordinates({ type: 'Point', coordinates: ['x', 'y'] as unknown as number[] }), null);
});
ok('coordinateEncoding classifies both encodings', () => {
  assert.equal(coordinateEncoding({ type: 'Point', coordinates: [1, 2] }), 'geojson');
  assert.equal(coordinateEncoding([1, 2]), 'array');
  assert.equal(coordinateEncoding(null), 'null');
  assert.equal(coordinateEncoding({ foo: 1 } as unknown as null), 'unknown');
});

// --- extension / media type ---------------------------------------------------
ok('extOf + mediaTypeFromExt', () => {
  assert.equal(extOf('journeys/x/photos/abc.JPG'), 'jpg');
  assert.equal(extOf('noext'), '');
  assert.equal(mediaTypeFromExt('clip.MOV'), 'video');
  assert.equal(mediaTypeFromExt('pic.heic'), 'image');
  assert.equal(mediaTypeFromExt('movie.mp4'), 'video');
});

// --- R2 key parsing + thumb pairing ------------------------------------------
const JID = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const ORIG = `journeys/${JID}/photos/${PID}.jpg`;
const THUMB = `journeys/${JID}/photos/${PID}_thumb.jpg`;
const VID = `journeys/${JID}/photos/33333333-3333-4333-8333-333333333333.mp4`;
const HERO = `journeys/${JID}/hero.png`;

ok('parseR2Key original', () => {
  const p = parseR2Key(ORIG);
  assert.equal(p?.kind, 'photo');
  assert.equal(p?.journeyId, JID);
  assert.equal(p?.photoId, PID);
  assert.equal(p?.ext, 'jpg');
  assert.equal(p?.isThumb, false);
});
ok('parseR2Key thumbnail (photoId strips _thumb)', () => {
  const p = parseR2Key(THUMB);
  assert.equal(p?.isThumb, true);
  assert.equal(p?.photoId, PID); // same id as the original
});
ok('parseR2Key hero -> kind other', () => {
  const p = parseR2Key(HERO);
  assert.equal(p?.kind, 'other');
  assert.equal(p?.journeyId, JID);
});
ok('parseR2Key non-journey key -> null', () => {
  assert.equal(parseR2Key('random/thing.txt'), null);
});
ok('isThumbKey / photoIdFromKey', () => {
  assert.equal(isThumbKey(THUMB), true);
  assert.equal(isThumbKey(ORIG), false);
  assert.equal(photoIdFromKey(ORIG), PID);
  assert.equal(photoIdFromKey(HERO), null);
});
ok('pairPhotosFromKeys pairs original+thumb, keeps lone video', () => {
  const pairs = pairPhotosFromKeys([THUMB, ORIG, VID, HERO]);
  assert.equal(pairs.length, 2);
  const photo = pairs.find((p) => p.photoId === PID);
  assert.equal(photo?.originalKey, ORIG);
  assert.equal(photo?.thumbKey, THUMB);
  assert.equal(photo?.ext, 'jpg');
  const video = pairs.find((p) => p.ext === 'mp4');
  assert.equal(video?.thumbKey, undefined);
});

// --- fixture helpers ----------------------------------------------------------
ok('elevationToNumber parses "5,895m"', () => {
  assert.equal(elevationToNumber('5,895m'), 5895);
  assert.equal(elevationToNumber('4215'), 4215);
  assert.equal(elevationToNumber(5199), 5199);
  assert.equal(elevationToNumber(null), null);
  assert.equal(elevationToNumber('n/a'), null);
});
ok('parseCampDate "Oct 1" with year', () => {
  assert.equal(parseCampDate('Oct 1', 2023), '2023-10-01');
  assert.equal(parseCampDate('Day 3', 2023), null); // non-month format
  assert.equal(parseCampDate(undefined, 2023), null);
});
ok('addDaysISO', () => {
  assert.equal(addDaysISO('2023-09-29', 2), '2023-10-01');
});
ok('campDateVisited falls back to start + (dayNumber-1)', () => {
  const camp: FixtureCamp = { id: 'c', name: 'C', dayNumber: 3, date: 'Day 3', coordinates: [0, 0] };
  assert.equal(campDateVisited(camp, '2023-10-10', 2023), '2023-10-12');
});
ok('nearestRoutePointIndex', () => {
  const route = [[0, 0], [1, 1], [2, 2], [3, 3]];
  assert.equal(nearestRoutePointIndex([2.1, 2.1], route), 2);
  assert.equal(nearestRoutePointIndex([0, 0], undefined), null);
});
ok('waypointType detects summit', () => {
  assert.equal(waypointType({ id: 'uhuru-peak', name: 'Uhuru Peak (Summit)', coordinates: [0, 0] }), 'summit');
  assert.equal(waypointType({ id: 'mti-mkubwa', name: 'Big Tree Camp', coordinates: [0, 0] }), 'camp');
});
ok('deterministicUuid is stable + RFC-4122 shaped', () => {
  const a = deterministicUuid('seed-x');
  const b = deterministicUuid('seed-x');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// --- fixture -> row mapping ---------------------------------------------------
const fixture: RecoveredFixture = {
  id: 'kilimanjaro',
  name: 'Kilimanjaro - Lemosho Route',
  country: 'Tanzania',
  slug: 'kilimanjaro',
  description: 'The Whiskey Route.',
  dates: { start: '2023-09-29', end: '2023-10-09' },
  stats: { totalDistance: 70, duration: 7, highestPoint: { name: 'Uhuru Peak', elevation: 5895 } },
  route: { type: 'LineString', coordinates: [[37.1, -3.0, 2400], [37.2, -3.05, 3800]] },
  camps: [
    { id: 'mti-mkubwa', name: 'Mti Mkubwa', dayNumber: 1, date: 'Oct 1', elevation: 2812, coordinates: [37.18, -2.99], distanceFromStart: 7, notes: 'Rainforest.', highlights: ['Rainforest'] },
    { id: 'uhuru-peak', name: 'Uhuru Peak (Summit)', dayNumber: 6, date: 'Oct 6', elevation: 5874, coordinates: [37.35, -3.07], distanceFromStart: 48, notes: 'Summit!', highlights: ['Sunrise'] },
  ],
};
const config: TrekConfig = {
  id: 'kilimanjaro', name: 'Kilimanjaro', country: 'Tanzania', elevation: '5,895m',
  lat: -3.0674, lng: 37.3556, preferredBearing: -20, preferredPitch: 60,
};

ok('fixtureToJourneyRow -> snake_case columns', () => {
  const row = fixtureToJourneyRow(JID, fixture, config, 'journeys/x/hero.png');
  assert.equal(row.id, JID);
  assert.equal(row.slug, 'kilimanjaro');
  assert.equal(row.summit_elevation, 5895);
  assert.equal(row.total_distance, 70);
  assert.equal(row.total_days, 7);
  assert.equal(row.date_started, '2023-09-29');
  assert.equal(row.date_ended, '2023-10-09');
  assert.equal(row.journey_type, 'trek');
  assert.equal(row.is_public, true);
  assert.equal(row.gpx_url, null);
  assert.equal(row.created_by, null);
  assert.equal(row.preferred_bearing, -20);
  assert.deepEqual(row.center_coordinates, [37.3556, -3.0674]);
  assert.equal(row.hero_image_url, 'journeys/x/hero.png');
});
ok('fixtureToWaypointRow -> snake_case columns + summit typing', () => {
  const w0 = fixtureToWaypointRow(JID, fixture.camps![0], 0, fixture.route!.coordinates, '2023-09-29');
  assert.equal(w0.journey_id, JID);
  assert.equal(w0.name, 'Mti Mkubwa');
  assert.equal(w0.waypoint_type, 'camp');
  assert.equal(w0.day_number, 1);
  assert.deepEqual(w0.coordinates, [37.18, -2.99]);
  assert.equal(w0.elevation, 2812);
  assert.equal(w0.description, 'Rainforest.');
  assert.deepEqual(w0.highlights, ['Rainforest']);
  assert.equal(w0.route_distance_km, 7);
  assert.equal(w0.date_visited, '2023-10-01');
  assert.deepEqual(w0.fun_facts, []);
  assert.equal(w0.weather, null);

  const w1 = fixtureToWaypointRow(JID, fixture.camps![1], 1, fixture.route!.coordinates, '2023-09-29');
  assert.equal(w1.waypoint_type, 'summit');
  assert.equal(w1.route_point_index, 1); // nearest route vertex to [37.35,-3.07]
  // synthetic ids are deterministic + differ per camp
  assert.notEqual(w0.id, w1.id);
  assert.equal(w0.id, deterministicUuid(`${JID}:waypoint:mti-mkubwa`));
});

// --- serialization / misc -----------------------------------------------------
ok('stableStringify sorts keys deterministically', () => {
  const a = stableStringify({ b: 1, a: { d: 4, c: 3 } });
  const b = stableStringify({ a: { c: 3, d: 4 }, b: 1 });
  assert.equal(a, b);
  assert.ok(a.indexOf('"a"') < a.indexOf('"b"'));
});
ok('sortById orders rows', () => {
  const rows = sortById([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c']);
});
ok('normalizeEtag strips quotes, rejects multipart', () => {
  assert.equal(normalizeEtag('"d41d8cd98f00b204e9800998ecf8427e"'), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(normalizeEtag('abc-2'), null);
  assert.equal(normalizeEtag(undefined), null);
});
ok('humanBytes', () => {
  assert.equal(humanBytes(0), '0 B');
  assert.equal(humanBytes(1024), '1.00 KB');
  assert.equal(humanBytes(1048576), '1.00 MB');
});

// --- async concurrency limiter ------------------------------------------------
await ok2('mapWithConcurrency preserves order, caps in-flight', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(maxInFlight <= 3, `maxInFlight=${maxInFlight}`);
});

async function ok2(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log(`\n✅ smoke: ${passed} checks passed\n`);
