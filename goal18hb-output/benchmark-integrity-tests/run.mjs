// Decision Benchmark v2 — integrity runner (Goal 18).
// Orchestrates: pre-seal integrity suite -> holdback seal -> post-seal verification.
// Usage: node run.mjs [--custody-dir <abs>] [--seed-file <abs>] [--auth <abs>] [--actor <name>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));
const schemaSha = sha256File(path.join(OUT, 'schema', 'decision-benchmark-v2-schema.json'));

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (typeof args[k] !== 'boolean') i++;
    }
  }
  return args;
}

const a = parseArgs(process.argv);
const custodyDir = a.custodyDir || 'C:/Users/00/.codex/goal18-holdback-custody';
const seedFile = a.seedFile || path.join(custodyDir, 'seed-holdback.txt');
const authFile = a.authFile || path.join(OUT, 'holdback-run-auth.json');
const actor = a.actor || 'goal18-seal-agent';

const log = [];
const record = (m) => { log.push(m); console.log(m); };
const run = (label, cmd, args) => {
  record(`\n=== ${label} ===`);
  record(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: OUT, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = (r.stdout || '') + (r.stderr || '');
  record(out.trim().split('\n').slice(0, 40).join('\n'));
  return { code: r.status, out };
};

// Phase 1: pre-seal integrity suite (T15 pending seal is expected to fail).
record('# Phase 1: pre-seal integrity suite (18 checks; T15 pending seal)');
const t1 = run('integrity.test.mjs', process.execPath, ['--test', 'benchmark-integrity-tests/integrity.test.mjs']);
const t1Pass = /# pass (\d+)/.exec(t1.out);
const t1Fail = /# fail (\d+)/.exec(t1.out);
const passCount = t1Pass ? Number(t1Pass[1]) : 0;
const failCount = t1Fail ? Number(t1Fail[1]) : 0;
// Pre-seal, T15 (hash seals/manifests) is expected to fail because the seal artifacts do not
// exist yet; it is verified post-seal by verify-seal.mjs. All other 17 checks must pass,
// and the only allowed failure must be T15.
const failingTests = [...t1.out.matchAll(/not ok (\d+) - T(\d+)/g)].map((m) => Number(m[2]));
const onlyT15 = failingTests.length === 1 && failingTests[0] === 15;
if (passCount < 17 || failCount > 1 || !onlyT15) {
  console.error('ABORT: integrity suite must pass 17/18 pre-seal (T15 pending seal is the allowed failure).');
  process.exit(1);
}
record(`pre-seal integrity: ${passCount} pass / ${failCount} fail (expected: T15 pending seal)`);

// Phase 2: seal holdback.
record('\n# Phase 2: holdback sealing');
const t2 = run('seal-holdback.mjs', process.execPath, [
  'scripts/seal/seal-holdback.mjs',
  '--fixtures', path.join(OUT, 'holdback-fixtures.jsonl'),
  '--seed-file', seedFile,
  '--custody-dir', custodyDir,
  '--out', path.join(OUT, 'holdback-sealed.bin'),
  '--manifest-out', path.join(OUT, 'holdback-public-manifest.json'),
  '--access-log', path.join(OUT, 'holdback-access-log.jsonl'),
  '--auth', authFile,
  '--schema-sha256', schemaSha,
  '--generator-version', 'goal18-generator/v2.0.0',
  '--policy-version', 'decision-policy-rules-v1+invariants-v1',
  '--actor', actor
]);
if (t2.code !== 0) { console.error('ABORT: sealing failed'); process.exit(1); }

// Phase 3: post-seal verification.
record('\n# Phase 3: post-seal verification');
const t3 = run('verify-seal.mjs', process.execPath, ['benchmark-integrity-tests/verify-seal.mjs', '--custody-dir', custodyDir]);
if (t3.code !== 0) { console.error('ABORT: post-seal verification failed'); process.exit(1); }

record('\n# Pipeline complete: BENCHMARK_READY path verified (see commands-and-results.log)');
process.exit(0);
