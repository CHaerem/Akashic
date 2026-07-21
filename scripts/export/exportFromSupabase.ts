/**
 * exportFromSupabase.ts — full-fidelity Supabase -> JSON dump (PATH A).
 *
 * Dumps every public table to export/supabase/<table>.json (raw truth, pretty,
 * stable row ordering by id), writes a manifest with row counts + per-file
 * sha256, and a companion normalized/photos.json where photo coordinates are
 * unwrapped to [lng,lat] regardless of the two encodings.
 *
 * READ-ONLY. Nothing is written back to Supabase. Requires the project to be
 * live (see README — the project host was NXDOMAIN as of the migration audit).
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_KEY=<service-role-key> \
 *   node scripts/export/exportFromSupabase.ts [--out export]
 *
 * Env:
 *   SUPABASE_URL         project URL (no hardcoded ref)
 *   SUPABASE_SERVICE_KEY service-role key (bypasses RLS for a complete dump)
 */

import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  sha256,
  sortById,
  rawStringify,
  unwrapCoordinates,
  coordinateEncoding,
  type CoordinateValue,
  type PhotoRow,
} from './lib.ts';
import { resolveOutDir, ensureDir, writeRawJson, writeStableJson, requireEnv } from './io.ts';

// Dependency/export order (respect FKs). profiles is the exportable user record;
// auth.users is external and not dumped here.
const TABLES = ['profiles', 'journeys', 'journey_members', 'waypoints', 'photos', 'day_comments'] as const;
type TableName = (typeof TABLES)[number];

const PAGE_SIZE = 1000; // PostgREST default cap; paginate via range headers.

interface Row {
  id?: string | null;
  [k: string]: unknown;
}

interface ManifestEntry {
  file: string;
  rows: number;
  sha256: string;
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
  const outDir = resolveOutDir();
  const supaDir = path.join(outDir, 'supabase');
  const normDir = path.join(outDir, 'normalized');
  ensureDir(supaDir);
  ensureDir(normDir);

  console.log(`\n=== Supabase export (PATH A) ===`);
  console.log(`Project : ${url}`);
  console.log(`Out     : ${supaDir}\n`);

  const client = createClient(url, key, { auth: { persistSession: false } });

  // Fetch an entire table in PAGE_SIZE pages, ordered by id for determinism.
  const fetchAll = async (table: TableName): Promise<Row[]> => {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await client
        .from(table)
        .select('*')
        .order('id', { ascending: true })
        .range(from, to);
      if (error) {
        throw new Error(`Failed to read "${table}" (range ${from}-${to}): ${error.message}`);
      }
      const page = (data ?? []) as Row[];
      rows.push(...page);
      process.stdout.write(`\r  ${table}: ${rows.length} rows…`);
      if (page.length < PAGE_SIZE) break;
    }
    process.stdout.write(`\r  ${table}: ${rows.length} rows    \n`);
    return rows;
  };

  const manifestTables: Record<string, ManifestEntry> = {};
  let totalRows = 0;
  let photos: Row[] = [];

  for (const table of TABLES) {
    const rows = sortById(await fetchAll(table));
    const file = path.join(supaDir, `${table}.json`);
    writeRawJson(file, rows); // raw truth: values + key order preserved
    const body = rawStringify(rows);
    manifestTables[table] = {
      file: path.relative(outDir, file),
      rows: rows.length,
      sha256: sha256(body),
    };
    totalRows += rows.length;
    if (table === 'photos') photos = rows;
  }

  // Companion normalized/photos.json: coordinates unwrapped to [lng,lat].
  const normalizedPhotos = photos.map((p) => {
    const coords = p.coordinates as CoordinateValue;
    return {
      ...(p as unknown as PhotoRow),
      coordinates: unwrapCoordinates(coords),
      coordinate_encoding: coordinateEncoding(coords),
    };
  });
  const normFile = path.join(normDir, 'photos.json');
  writeStableJson(normFile, normalizedPhotos);

  // Coordinate-encoding tally (handy sanity signal).
  const encTally = normalizedPhotos.reduce<Record<string, number>>((acc, p) => {
    acc[p.coordinate_encoding] = (acc[p.coordinate_encoding] ?? 0) + 1;
    return acc;
  }, {});

  const manifest = {
    source: 'supabase' as const,
    project_url: url,
    exported_at: new Date().toISOString(),
    export_order: TABLES,
    total_rows: totalRows,
    tables: manifestTables,
    normalized: {
      'photos.json': {
        file: path.relative(outDir, normFile),
        rows: normalizedPhotos.length,
        coordinate_encoding: encTally,
      },
    },
  };
  writeStableJson(path.join(outDir, 'manifest.json'), manifest);

  console.log(`\n✅ Export complete — ${totalRows} rows across ${TABLES.length} tables.`);
  console.log(`   Coordinate encodings (photos): ${JSON.stringify(encTally)}`);
  console.log(`   Manifest: ${path.join(outDir, 'manifest.json')}`);
  console.log(`\n   Next: pullR2Archive.ts, then verifyExport.ts. Keep sources READ-ONLY until verify passes.\n`);
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
