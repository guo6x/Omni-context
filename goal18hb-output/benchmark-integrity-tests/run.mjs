// Decision Benchmark v2 - Holdback V2 integrity runner (Goal 18HB).
// Orchestrates: pre-seal integrity suite -> V2 seal -> post-seal verification -> post-seal suite.
// Usage: node run.mjs [--custody-dir <abs>] [--seed-file <abs>] [--auth <abs>] [--actor <name>]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const G18 = 'D:/ai_code/Omni-context/goal18-output';
const schemaSha = sha256File(path.join(G18, 'schema', 'decision-benchmark-v2-schema.json'));
const riAuditSha = sha256File(path.join(OUT, 'holdback-v2-referential-integrity.json'));
const suiteSha = sha256File(path.join(here, 'integrity.test.mjs'));
const GENERATOR_COMMIT = 'cd53eaea538ac2992012e21e94370e918b166dde';
const GENERATOR_VERSION = 'goal18-generator/v2.1.0';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
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
const custodyDir = a.custodyDir || 'C:/Users/00/.codex/goal18hb-holdback-custody';
const seedFile = a.seedFile || path.join(custodyDir, 'seed.txt');
const authFile = a.authFile || path.join(OUT, 'holdback-v2-run-auth.json');
const actor = a.actor || 'goal18hb-seal-agent';

const log = [];
const record = (m) => { log.push(m); console.log(m); };
const run = (label, cmd, args, env) => {
  record(`\n=== ${label} ===`);
  record(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: OUT, encoding: 'utf8', shell: process.platform === 'win32', env: env ? { ...process.env, ...env } : undefined });
  const out = (r.stdout || '') + (r.stderr || '');
  record(out.trim().split('\n').slice(0, 60).join('\n'));
  return { code: r.status, out };
};

// Phase 1: pre-seal integrity suite (T15 pending seal is expected to fail).
record('# Phase 1: pre-seal integrity suite (18 checks; T15 pending seal)');
const t1 = run('integrity.test.mjs', process.execPath, ['--test', 'benchmark-integrity-tests/integrity.test.mjs']);
const passCount = Number((/^# pass (\d+)/m.exec(t1.out) || [])[1] || 0);
const failCount = Number((/^# fail (\d+)/m.exec(t1.out) || [])[1] || 0);
const failingTests = [...t1.out.matchAll(/not ok (\d+) - T(\d+)/g)].map((m) => Number(m[2]));
const onlyT15 = failingTests.length === 1 && failingTests[0] === 15;
if (passCount < 17 || failCount < 1 || !onlyT15) {
  console.error('ABORT: pre-seal integrity suite must have exactly T15 failing (17+ pass). Got pass=' + passCount + ' fail=' + failCount + ' failing=' + failingTests.join(','));
  process.exit(1);
}
record(`pre-seal integrity: ${passCount} pass / ${failCount} fail (expected: T15 pending seal)`);

// Phase 2: seal Holdback V2.
record('\n# Phase 2: holdback V2 sealing');
const t2 = run('seal-holdback-v2.mjs', process.execPath, [
  'scripts/seal/seal-holdback-v2.mjs',
  '--fixtures', path.join(OUT, 'work', 'holdback-fixtures.jsonl'),
  '--seed-file', seedFile,
  '--custody-dir', custodyDir,
  '--out', path.join(OUT, 'holdback-v2-sealed.bin'),
  '--manifest-out', path.join(OUT, 'holdback-v2-public-manifest.json'),
  '--access-log', path.join(OUT, 'holdback-v2-access-log.jsonl'),
  '--auth', authFile,
  '--schema-sha256', schemaSha,
  '--generator-commit', GENERATOR_COMMIT,
  '--generator-version', GENERATOR_VERSION,
  '--ri-audit-sha256', riAuditSha,
  '--integrity-suite-sha256', suiteSha,
  '--policy-version', 'decision-policy-rules-v1 (Goal 13) / invariants-v1',
  '--actor', actor
]);
if (t2.code !== 0) { console.error('ABORT: sealing failed'); process.exit(1); }

// Phase 3: post-seal verification (structure + hashes + custody; no test-decrypt of formal V2).
record('\n# Phase 3: post-seal verification');
const t3 = run('verify-seal-v2.mjs', process.execPath, ['benchmark-integrity-tests/verify-seal-v2.mjs', '--custody-dir', custodyDir]);
if (t3.code !== 0) { console.error('ABORT: post-seal verification failed'); process.exit(1); }

// Phase 4: post-seal integrity suite against the custody plaintext copy (18/18).
record('\n# Phase 4: post-seal integrity suite (18/18 expected)');
const t4 = run('integrity.test.mjs (post-seal)', process.execPath, ['--test', 'benchmark-integrity-tests/integrity.test.mjs'], { HOLDBACK_V2_FIXTURES: path.join(custodyDir, 'holdback-v2-fixtures.jsonl') });
const passCount2 = Number((/^# pass (\d+)/m.exec(t4.out) || [])[1] || 0);
const failCount2 = Number((/^# fail (\d+)/m.exec(t4.out) || [])[1] || 0);
if (passCount2 < 18 || failCount2 !== 0) {
  console.error('ABORT: post-seal integrity suite must be 18/18. Got pass=' + passCount2 + ' fail=' + failCount2);
  process.exit(1);
}
record(`post-seal integrity: ${passCount2} pass / ${failCount2} fail`);

record('\n# Pipeline complete: Holdback V2 sealed and verified');
process.exit(0);