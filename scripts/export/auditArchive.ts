/**
 * Point the coherence audit at a real export archive (QUA-93).
 *
 *   node scripts/export/auditArchive.ts /path/to/AkashicExport-YYYYMMDD
 *
 * READ-ONLY. It opens two JSON files and prints. Unlike `verifyExport.ts` — which mutates the dated
 * verification report inside the bundle and needs the owner's credentials — this is safe to run
 * against the owner's archive at any time, and safe for an agent to run.
 *
 * Why a separate command rather than a check inside `smoke.ts`: the archive lives outside the repo
 * (16 GiB, one unbacked copy — LEG-02), so CI cannot depend on its path. `smoke.ts` exercises every
 * branch of `auditJourneyCoherence` with inline fixtures shaped from the defects this found, and this
 * command runs the same function over the real thing. Neither can pass while the other fails for a
 * reason the code cares about.
 *
 * Exit code is 1 when findings exist, so it can gate a shell pipeline. Measured on the 2026-07-22
 * archive it reports Kilimanjaro's 374-day span, its 939 unassigned photos, Mount Kenya's year
 * offset, its 144-photo collapsed coordinate and its total absence of EXIF locations — and Inca
 * Trail clean.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  auditJourneyCoherence,
  type CoherenceJourney,
  type CoherencePhoto,
  type CoherenceWaypoint,
} from './lib.ts';

const root = process.argv[2];
if (!root) {
  console.error('usage: node scripts/export/auditArchive.ts <archive-root>');
  process.exit(2);
}

/** Tolerate both `[...]` and `{ rows: [...] }`, which the archive uses in different places. */
function rows<T>(raw: string): T[] {
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: T[] }).rows;
  }
  return [];
}

function load<T>(...candidates: string[]): T[] {
  for (const rel of candidates) {
    try {
      return rows<T>(readFileSync(join(root, rel), 'utf8'));
    } catch {
      // Try the next location: `photos.json` exists both normalized and raw, and only one of the
      // two is present in some bundles.
    }
  }
  throw new Error(`none of these could be read under ${root}: ${candidates.join(', ')}`);
}

const journeys = load<CoherenceJourney>('supabase/journeys.json', 'normalized/journeys.json');
const photos = load<CoherencePhoto>('normalized/photos.json', 'supabase/photos.json');
// Waypoints are optional: a bundle without them simply skips the day-structure check rather than
// failing, which is why `load` is not used here.
let waypoints: CoherenceWaypoint[] = [];
try {
  waypoints = rows<CoherenceWaypoint>(readFileSync(join(root, 'supabase/waypoints.json'), 'utf8'));
} catch {
  console.log('  (no waypoints.json — skipping the duplicate-day check)');
}

console.log(`\naudit: ${journeys.length} journeys, ${photos.length} photos, ${waypoints.length} waypoints under ${root}\n`);

const findings = auditJourneyCoherence(journeys, photos, {}, waypoints);

if (findings.length === 0) {
  console.log('✅ no coherence findings — every journey agrees with its own photographs\n');
  process.exit(0);
}

const byJourney = new Map<string, typeof findings>();
for (const f of findings) {
  const list = byJourney.get(f.journey) ?? [];
  list.push(f);
  byJourney.set(f.journey, list);
}

for (const [journey, list] of byJourney) {
  console.log(`  ${journey}`);
  for (const f of list) console.log(`    ✗ ${f.kind}: ${f.detail}`);
}

const clean = journeys
  .map((j) => j.slug ?? j.name ?? j.id)
  .filter((label) => !byJourney.has(label));
if (clean.length) console.log(`\n  clean: ${clean.join(', ')}`);

console.log(`\n❌ ${findings.length} coherence finding(s)\n`);
process.exit(1);
