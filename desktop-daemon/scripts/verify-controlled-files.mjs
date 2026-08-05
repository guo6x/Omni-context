#!/usr/bin/env node
/**
 * Guard against the Tauri CLI (and other tooling) silently rewriting
 * controlled files.
 *
 * Tauri `dev`/`build` regenerate some artifacts (icons, gen/ schemas, config
 * normalization). This guard takes a committed SHA-256 snapshot of the files
 * the product line owns and fails the build if any of them changed without an
 * explicit `--snapshot` update.
 *
 * Usage:
 *   node scripts/verify-controlled-files.mjs --snapshot scripts/controlled-files.sha256.json
 *   node scripts/verify-controlled-files.mjs          # verify against committed snapshot
 */
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, relative } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SNAPSHOT_PATH = resolve(root, 'scripts', 'controlled-files.sha256.json');

// Files the product line owns. The Tauri CLI must never rewrite these.
const CONTROLLED = [
  'package.json',
  'next.config.js',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.js',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/build.rs',
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.prod.conf.json',
  'src-tauri/tauri.ci.conf.json',
  ...readdirSync(resolve(root, 'src-tauri', 'src')).filter((f) => f.endsWith('.rs')).map((f) => `src-tauri/src/${f}`),
];

function sha256File(file) {
  return createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
}

function snapshot() {
  const entries = {};
  for (const file of CONTROLLED) {
    if (!existsSync(resolve(root, file))) {
      throw new Error(`controlled file missing: ${file}`);
    }
    entries[file] = sha256File(file);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    files: entries,
  };
}

const args = process.argv.slice(2);
if (args.includes('--snapshot')) {
  const target = args[args.indexOf('--snapshot') + 1];
  const outPath = target ? resolve(root, target) : SNAPSHOT_PATH;
  writeFileSync(outPath, `${JSON.stringify(snapshot(), null, 2)}\n`);
  console.log(`controlled-files snapshot written: ${relative(root, outPath)}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT_PATH)) {
  console.error('[verify-controlled-files] no snapshot found. Run with --snapshot first.');
  process.exit(1);
}

const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
const actual = snapshot();
const changed = [];
for (const file of Object.keys(expected.files || {})) {
  if (actual.files[file] !== expected.files[file]) changed.push(file);
}
for (const file of Object.keys(actual.files)) {
  if (!(file in (expected.files || {}))) changed.push(`+${file} (new)`);
}

if (changed.length > 0) {
  console.error('[verify-controlled-files] Tauri/tooling attempted to modify controlled files:');
  for (const file of changed) console.error(`  - ${file}`);
  console.error('Fix the cause, then re-run with --snapshot only if the change is intentional.');
  process.exit(1);
}
console.log('[verify-controlled-files] OK — controlled files unchanged.');
