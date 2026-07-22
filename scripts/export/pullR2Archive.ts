/**
 * pullR2Archive.ts — Cloudflare R2 -> local archive via the S3 API (PATH A + B).
 *
 * Phase 1: ListObjectsV2 (paginated) -> full inventory; HeadObject per key
 *          (batched, concurrency ~8) to capture customMetadata -> export/r2/inventory.json
 * Phase 2: download every object to export/r2/objects/<key> preserving paths,
 *          resuming (skip files whose size already matches), with progress logs.
 * Final:   byte total + per-journey summary.
 *
 * READ-ONLY against R2 (List/Head/Get only — never Put/Delete). Safe to re-run.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   node scripts/export/pullR2Archive.ts [--out export] [--inventory-only]
 *
 * Env (aliases accepted for compatibility with the older scripts):
 *   CLOUDFLARE_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID      (alias CLOUDFLARE_R2_ACCESS_KEY_ID)
 *   R2_SECRET_ACCESS_KEY  (alias CLOUDFLARE_R2_SECRET_ACCESS_KEY)
 *   R2_BUCKET             (default: akashic-media)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  type _Object,
} from '@aws-sdk/client-s3';
import { mapWithConcurrency, humanBytes, parseR2Key } from './lib.ts';
import { resolveOutDir, ensureDir, writeStableJson, requireEnv, optionalEnv } from './io.ts';

const HEAD_CONCURRENCY = 8;
const DOWNLOAD_CONCURRENCY = 6;

interface InventoryItem {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  customMetadata: Record<string, string>;
}

function makeClient(): { client: S3Client; bucket: string } {
  const account = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const accessKeyId = requireEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  const bucket = optionalEnv('R2_BUCKET', 'CLOUDFLARE_R2_BUCKET_NAME') ?? 'akashic-media';
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/** Full paginated object listing. */
async function listAll(client: S3Client, bucket: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let token: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of res.Contents ?? []) objects.push(o);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
    process.stdout.write(`\r  listed ${objects.length} objects…`);
  } while (token);
  process.stdout.write(`\r  listed ${objects.length} objects    \n`);
  return objects;
}

/** HeadObject to capture content-type + user metadata for one key. */
async function headOne(client: S3Client, bucket: string, obj: _Object): Promise<InventoryItem> {
  const key = obj.Key ?? '';
  let contentType: string | null = null;
  let customMetadata: Record<string, string> = {};
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    contentType = head.ContentType ?? null;
    customMetadata = head.Metadata ?? {}; // S3 lowercases user-metadata keys
  } catch {
    // Non-fatal: keep the listing entry even if HEAD fails.
  }
  return {
    key,
    size: obj.Size ?? 0,
    etag: obj.ETag ?? null,
    lastModified: obj.LastModified ? obj.LastModified.toISOString() : null,
    contentType,
    customMetadata,
  };
}

/** Download one object to disk unless a same-size file already exists (resume). */
async function downloadOne(
  client: S3Client,
  bucket: string,
  item: InventoryItem,
  objectsDir: string,
): Promise<'downloaded' | 'skipped'> {
  const dest = path.join(objectsDir, item.key);
  if (fs.existsSync(dest) && fs.statSync(dest).size === item.size && item.size > 0) {
    return 'skipped';
  }
  ensureDir(path.dirname(dest));
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.key }));
  if (!res.Body) throw new Error(`Empty body for ${item.key}`);
  // In Node the SDK Body is a Readable stream; stream to disk to avoid buffering large videos.
  const tmp = `${dest}.part`;
  await pipeline(res.Body as Readable, createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return 'downloaded';
}

function perJourneySummary(items: InventoryItem[]): Record<string, { objects: number; bytes: number }> {
  const summary: Record<string, { objects: number; bytes: number }> = {};
  for (const it of items) {
    const parsed = parseR2Key(it.key);
    const jid = parsed?.journeyId ?? '(unrecognized)';
    const s = (summary[jid] ??= { objects: 0, bytes: 0 });
    s.objects++;
    s.bytes += it.size;
  }
  return summary;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inventoryOnly = argv.includes('--inventory-only');
  const { client, bucket } = makeClient();
  const outDir = resolveOutDir();
  const r2Dir = path.join(outDir, 'r2');
  const objectsDir = path.join(r2Dir, 'objects');
  ensureDir(r2Dir);

  console.log(`\n=== R2 archive pull (bucket: ${bucket}) ===`);
  console.log(`Out: ${r2Dir}\n`);

  // Phase 1: inventory.
  console.log('Phase 1: inventory (list + head)…');
  const objects = await listAll(client, bucket);
  const inventory = await mapWithConcurrency(objects, HEAD_CONCURRENCY, (o) => headOne(client, bucket, o));
  inventory.sort((a, b) => a.key.localeCompare(b.key));
  writeStableJson(path.join(r2Dir, 'inventory.json'), inventory);

  const totalBytes = inventory.reduce((n, i) => n + i.size, 0);
  const summary = perJourneySummary(inventory);
  console.log(`  ${inventory.length} objects, ${humanBytes(totalBytes)} total.`);
  for (const [jid, s] of Object.entries(summary).sort()) {
    console.log(`    ${jid}: ${s.objects} objects, ${humanBytes(s.bytes)}`);
  }
  writeStableJson(path.join(r2Dir, 'inventory-summary.json'), {
    generated_at: new Date().toISOString(),
    bucket,
    total_objects: inventory.length,
    total_bytes: totalBytes,
    per_journey: summary,
  });

  if (inventoryOnly) {
    console.log('\n--inventory-only: skipping downloads.\n');
    return;
  }

  // Phase 2: download with resume.
  console.log('\nPhase 2: download objects (resume-aware)…');
  ensureDir(objectsDir);
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let doneBytes = 0;
  let processed = 0;
  await mapWithConcurrency(inventory, DOWNLOAD_CONCURRENCY, async (item) => {
    try {
      const result = await downloadOne(client, bucket, item, objectsDir);
      if (result === 'downloaded') downloaded++;
      else skipped++;
      doneBytes += item.size;
    } catch (err) {
      failed++;
      console.error(`\n  ⚠️  ${item.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    processed++;
    process.stdout.write(
      `\r  ${processed}/${inventory.length}  (${humanBytes(doneBytes)} / ${humanBytes(totalBytes)})   `,
    );
  });

  console.log(`\n\n✅ R2 pull complete.`);
  console.log(`   Downloaded: ${downloaded}, Skipped (resume): ${skipped}, Failed: ${failed}`);
  console.log(`   Bytes accounted: ${humanBytes(doneBytes)} across ${inventory.length} objects.`);
  if (failed > 0) {
    console.log(`   ⚠️  ${failed} object(s) failed — re-run to retry (resume skips completed files).`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
