/**
 * Filesystem / env / CLI helpers shared by the export I/O scripts.
 * Kept separate from lib.ts so lib.ts stays pure and smoke-testable.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { rawStringify, stableStringify } from './lib.ts';

/** Resolve the export output directory: `--out <dir>` > $EXPORT_DIR > ./export (cwd-relative). */
export function resolveOutDir(argv: string[] = process.argv.slice(2)): string {
  const flagIdx = argv.findIndex((a) => a === '--out' || a === '-o');
  if (flagIdx >= 0 && argv[flagIdx + 1]) return path.resolve(argv[flagIdx + 1]);
  if (process.env.EXPORT_DIR) return path.resolve(process.env.EXPORT_DIR);
  return path.resolve('export');
}

/** Is `--dry-run` present? */
export function isDryRun(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes('--dry-run');
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Write raw-order pretty JSON (preserves key order — "raw truth"). */
export function writeRawJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, rawStringify(value));
}

/** Write deterministic key-sorted pretty JSON (for salvage/normalized/manifests). */
export function writeStableJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, stableStringify(value));
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
}

export function readJsonIfExists<T = unknown>(file: string): T | null {
  return fs.existsSync(file) ? readJson<T>(file) : null;
}

export function fileExists(file: string): boolean {
  return fs.existsSync(file);
}

/** Require an env var, exiting with a clear message if absent. */
export function requireEnv(name: string, ...aliases: string[]): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v) return v;
  }
  const names = [name, ...aliases].join(' or ');
  console.error(`\n❌ Missing required environment variable: ${names}\n`);
  process.exit(1);
}

/** First env var among the candidates, or undefined. */
export function optionalEnv(...names: string[]): string | undefined {
  for (const key of names) {
    if (process.env[key]) return process.env[key];
  }
  return undefined;
}
