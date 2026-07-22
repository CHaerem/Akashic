/**
 * verifyExport.ts — cross-check an export directory before importing to CloudKit.
 *
 * Checks, in both directions:
 *   - DB photo rows -> R2 objects (missing files)
 *   - R2 photo objects -> DB rows (orphan files)
 *   - thumbnail coverage (row has thumbnail_url AND the object exists)
 *   - byte totals (from inventory)
 *   - checksum spot checks (md5 of downloaded file vs R2 ETag for single-part objects)
 *   - coordinate-encoding stats (GeoJSON Point vs bare array vs null)
 * Writes export/verification-report.md. Exit code 2 if any hard check fails.
 *
 * Works against either data source: prefers export/supabase/photos.json,
 * falls back to export/salvage/photos.json.
 *
 *   node scripts/export/verifyExport.ts [--out export] [--spot N]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseR2Key,
  isThumbKey,
  coordinateEncoding,
  md5,
  normalizeEtag,
  humanBytes,
  type CoordinateValue,
  type PhotoRow,
} from './lib.ts';
import { resolveOutDir, readJson, readJsonIfExists, fileExists } from './io.ts';

interface InventoryItem {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  customMetadata: Record<string, string>;
}

interface CountsBlock {
  [k: string]: number | string | undefined;
}

function loadPhotos(outDir: string): { photos: PhotoRow[]; source: string; file: string } | null {
  const supa = path.join(outDir, 'supabase', 'photos.json');
  const salv = path.join(outDir, 'salvage', 'photos.json');
  if (fileExists(supa)) return { photos: readJson<PhotoRow[]>(supa), source: 'supabase', file: supa };
  if (fileExists(salv)) return { photos: readJson<PhotoRow[]>(salv), source: 'salvage', file: salv };
  return null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const outDir = resolveOutDir(argv);
  const spotIdx = argv.findIndex((a) => a === '--spot');
  const spotN = spotIdx >= 0 && argv[spotIdx + 1] ? parseInt(argv[spotIdx + 1], 10) : 12;

  const loaded = loadPhotos(outDir);
  const inventoryFile = path.join(outDir, 'r2', 'inventory.json');
  const problems: string[] = [];

  if (!loaded) problems.push(`No photos.json found under ${outDir}/supabase or ${outDir}/salvage.`);
  if (!fileExists(inventoryFile)) problems.push(`No R2 inventory at ${inventoryFile} (run pullR2Archive.ts).`);
  if (!loaded || !fileExists(inventoryFile)) {
    console.error(`\n❌ Cannot verify:\n  - ${problems.join('\n  - ')}\n`);
    process.exit(1);
  }

  const { photos, source, file: photosFile } = loaded;
  const inventory = readJson<InventoryItem[]>(inventoryFile);
  const objectsDir = path.join(outDir, 'r2', 'objects');
  const objectsDownloaded = fileExists(objectsDir);

  const r2Keys = new Set(inventory.map((i) => i.key));
  const invByKey = new Map(inventory.map((i) => [i.key, i]));
  const totalBytes = inventory.reduce((n, i) => n + i.size, 0);

  // R2 photo originals (exclude thumbnails + non-photo objects).
  const r2Originals = new Set(
    inventory.map((i) => i.key).filter((k) => parseR2Key(k)?.kind === 'photo' && !isThumbKey(k)),
  );
  const r2Thumbs = new Set(inventory.map((i) => i.key).filter((k) => parseR2Key(k)?.kind === 'photo' && isThumbKey(k)));

  // --- DB -> R2 (missing files) ----------------------------------------------
  const missingOriginals: string[] = [];
  const missingThumbs: string[] = [];
  const referencedOriginals = new Set<string>();
  const referencedThumbs = new Set<string>();
  let withThumbUrl = 0;
  for (const p of photos) {
    if (p.url) {
      referencedOriginals.add(p.url);
      if (!r2Keys.has(p.url)) missingOriginals.push(`${p.id} -> ${p.url}`);
    }
    if (p.thumbnail_url) {
      withThumbUrl++;
      referencedThumbs.add(p.thumbnail_url);
      if (!r2Keys.has(p.thumbnail_url)) missingThumbs.push(`${p.id} -> ${p.thumbnail_url}`);
    }
  }

  // --- R2 -> DB (orphan files) -----------------------------------------------
  const orphanOriginals = [...r2Originals].filter((k) => !referencedOriginals.has(k)).sort();
  const orphanThumbs = [...r2Thumbs].filter((k) => !referencedThumbs.has(k)).sort();

  // --- thumbnail coverage ----------------------------------------------------
  const thumbCoveragePct = photos.length ? Math.round((withThumbUrl / photos.length) * 100) : 0;

  // --- coordinate encoding stats ---------------------------------------------
  const encTally: Record<string, number> = { geojson: 0, array: 0, null: 0, unknown: 0 };
  for (const p of photos) encTally[coordinateEncoding(p.coordinates as CoordinateValue)]++;

  // --- byte totals per journey ------------------------------------------------
  const perJourney: Record<string, { objects: number; bytes: number }> = {};
  for (const i of inventory) {
    const jid = parseR2Key(i.key)?.journeyId ?? '(unrecognized)';
    const s = (perJourney[jid] ??= { objects: 0, bytes: 0 });
    s.objects++;
    s.bytes += i.size;
  }

  // --- checksum spot checks --------------------------------------------------
  const spot: { key: string; ok: boolean; note: string }[] = [];
  if (objectsDownloaded) {
    const candidates = inventory.filter((i) => normalizeEtag(i.etag) && i.size > 0);
    const step = Math.max(1, Math.floor(candidates.length / spotN));
    for (let i = 0; i < candidates.length && spot.length < spotN; i += step) {
      const item = candidates[i];
      const local = path.join(objectsDir, item.key);
      if (!fs.existsSync(local)) {
        spot.push({ key: item.key, ok: false, note: 'file not downloaded' });
        continue;
      }
      const localMd5 = md5(fs.readFileSync(local));
      const ok = localMd5 === normalizeEtag(item.etag);
      spot.push({ key: item.key, ok, note: ok ? 'md5 == etag' : `md5 ${localMd5} != etag ${normalizeEtag(item.etag)}` });
    }
  }
  const spotFailures = spot.filter((s) => !s.ok);

  // --- optional companion counts ---------------------------------------------
  const supaManifest = readJsonIfExists<{ counts?: CountsBlock; total_rows?: number; tables?: Record<string, { rows: number }> }>(
    path.join(outDir, 'manifest.json'),
  );

  // --- hard-fail accounting ---------------------------------------------------
  if (missingOriginals.length) problems.push(`${missingOriginals.length} DB photo(s) reference an R2 original that is missing.`);
  if (missingThumbs.length) problems.push(`${missingThumbs.length} DB photo(s) reference an R2 thumbnail that is missing.`);
  if (spotFailures.length) problems.push(`${spotFailures.length} checksum spot-check failure(s).`);

  // --- report ----------------------------------------------------------------
  const lines: string[] = [];
  const p = (s = '') => lines.push(s);
  p(`# Akashic export verification`);
  p();
  p(`- Generated: ${new Date().toISOString()}`);
  p(`- Data source: **${source}** (\`${path.relative(outDir, photosFile)}\`)`);
  p(`- R2 inventory: ${inventory.length} objects, ${humanBytes(totalBytes)} total`);
  p(`- R2 objects downloaded locally: ${objectsDownloaded ? 'yes' : 'no'}`);
  p(`- Overall: ${problems.length === 0 ? '✅ **PASS**' : `❌ **${problems.length} problem(s)** — do NOT import yet`}`);
  p();
  if (problems.length) {
    p(`## Problems`);
    for (const pr of problems) p(`- ❌ ${pr}`);
    p();
  }
  p(`## DB → R2 (are all referenced files present?)`);
  p(`- Photo rows: **${photos.length}**`);
  p(`- Originals present: **${photos.length - missingOriginals.length}/${photos.length}**`);
  p(`- Missing originals: **${missingOriginals.length}**`);
  for (const m of missingOriginals.slice(0, 25)) p(`  - ${m}`);
  if (missingOriginals.length > 25) p(`  - …and ${missingOriginals.length - 25} more`);
  p(`- Rows with thumbnail_url: **${withThumbUrl}** (${thumbCoveragePct}% coverage)`);
  p(`- Missing thumbnails: **${missingThumbs.length}**`);
  for (const m of missingThumbs.slice(0, 25)) p(`  - ${m}`);
  if (missingThumbs.length > 25) p(`  - …and ${missingThumbs.length - 25} more`);
  p();
  p(`## R2 → DB (are there orphan files with no row?)`);
  p(`- R2 photo originals: **${r2Originals.size}**, thumbnails: **${r2Thumbs.size}**`);
  p(`- Orphan originals (file, no row): **${orphanOriginals.length}**`);
  for (const o of orphanOriginals.slice(0, 25)) p(`  - ${o}`);
  if (orphanOriginals.length > 25) p(`  - …and ${orphanOriginals.length - 25} more`);
  p(`- Orphan thumbnails: **${orphanThumbs.length}**`);
  p();
  p(`## Coordinate encoding (photos)`);
  p(`| encoding | count |`);
  p(`|---|---|`);
  for (const [k, v] of Object.entries(encTally)) p(`| ${k} | ${v} |`);
  p();
  p(`## Byte totals per journey`);
  p(`| journey | objects | bytes |`);
  p(`|---|---|---|`);
  for (const [jid, s] of Object.entries(perJourney).sort()) p(`| ${jid} | ${s.objects} | ${humanBytes(s.bytes)} |`);
  p(`| **total** | **${inventory.length}** | **${humanBytes(totalBytes)}** |`);
  p();
  p(`## Checksum spot checks (md5 vs R2 ETag)`);
  if (!objectsDownloaded) {
    p(`- skipped (objects not downloaded)`);
  } else if (spot.length === 0) {
    p(`- no single-part objects available to check`);
  } else {
    p(`- Checked **${spot.length}**, failures: **${spotFailures.length}**`);
    for (const s of spot) p(`  - ${s.ok ? '✅' : '❌'} ${s.key} — ${s.note}`);
  }
  p();
  if (supaManifest?.tables) {
    p(`## Supabase manifest row counts`);
    p(`| table | rows |`);
    p(`|---|---|`);
    for (const [t, v] of Object.entries(supaManifest.tables)) p(`| ${t} | ${v.rows} |`);
    p(`| **total** | **${supaManifest.total_rows ?? '?'}** |`);
    p();
  }
  p(`---`);
  p(`_Keep R2 and Supabase READ-ONLY until this report shows PASS (plan Section 6)._`);
  p();

  const reportFile = path.join(outDir, 'verification-report.md');
  fs.writeFileSync(reportFile, lines.join('\n'));

  console.log(`\n${problems.length === 0 ? '✅ PASS' : `❌ ${problems.length} problem(s)`} — report: ${reportFile}`);
  console.log(`   photos=${photos.length} missing-originals=${missingOriginals.length} missing-thumbs=${missingThumbs.length} orphans=${orphanOriginals.length} spot-fail=${spotFailures.length}`);
  console.log(`   coordinate-encoding=${JSON.stringify(encTally)}  total=${humanBytes(totalBytes)}\n`);
  if (problems.length > 0) process.exitCode = 2;
}

main();
