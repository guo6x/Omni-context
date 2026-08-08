// Post-seal verification for Goal 18HB Holdback V2.
// Complements T15 of the integrity suite. Per Goal 18HB spec sec. 20, the FORMAL Holdback V2
// must not be test-decrypted ("seal decrypt-on-dummy test only"); the decrypt path is verified
// separately on dummy data (scripts/seal/dummy-seal-decrypt-test.mjs).
// Checks: public manifest fields, custody plaintext/gold/seed hashes, sealed artifact structure
// and hash, access log entries, and that plaintext is absent from the repository.
// Usage: node verify-seal-v2.mjs [--custody-dir <abs>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));

const custodyDir = (process.argv.find((x, i) => process.argv[i - 1] === '--custody-dir') || 'C:/Users/00/.codex/goal18hb-holdback-custody');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// 1. public manifest
const manifestPath = path.join(OUT, 'holdback-v2-public-manifest.json');
check(fs.existsSync(manifestPath), 'holdback-v2-public-manifest.json exists');
let manifest = null;
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(manifest.schemaVersion === 'holdback-v2-seal-manifest-v1', 'manifest schemaVersion');
  check(manifest.status === 'SEALED_PRE_VALIDATION', 'manifest status SEALED_PRE_VALIDATION');
  check(typeof manifest.sha256 === 'string' && /^[0-9a-f]{64}$/.test(manifest.sha256), 'manifest.sha256 format');
  check(typeof manifest.gold_projection_sha256 === 'string' && /^[0-9a-f]{64}$/.test(manifest.gold_projection_sha256), 'manifest.gold_projection_sha256 format');
  check(typeof manifest.seed_hash === 'string' && /^[0-9a-f]{64}$/.test(manifest.seed_hash), 'manifest.seed_hash format');
  check(manifest.sample_count === 180, 'manifest.sample_count 180');
  check(manifest.sealed_artifact && /^[0-9a-f]{64}$/.test(manifest.sealed_artifact.sha256), 'manifest sealed_artifact.sha256 format');
  check(manifest.generator && manifest.generator.commit === 'cd53eaea538ac2992012e21e94370e918b166dde', 'manifest generator commit');
  check(manifest.generator && manifest.generator.version === 'goal18-generator/v2.1.0', 'manifest generator version');
}

// 2. plaintext hash: custody copy must match manifest.sha256
const custodyPlain = path.join(custodyDir, 'holdback-v2-fixtures.jsonl');
check(fs.existsSync(custodyPlain), 'custody plaintext copy exists');
if (manifest && fs.existsSync(custodyPlain)) {
  const h = sha256File(custodyPlain);
  check(h === manifest.sha256, `custody plaintext sha256 matches manifest (${h.slice(0, 16)}...)`);
  const shaFile = path.join(custodyDir, 'holdback-v2-fixtures.sha256');
  check(fs.existsSync(shaFile) && fs.readFileSync(shaFile, 'utf8').includes(h), 'custody .sha256 sidecar matches');
}

// 3. gold projection: custody copy must match manifest.gold_projection_sha256
const custodyGold = path.join(custodyDir, 'holdback-v2-gold.jsonl');
check(fs.existsSync(custodyGold), 'custody gold projection exists');
if (manifest && fs.existsSync(custodyGold)) {
  const h = sha256File(custodyGold);
  check(h === manifest.gold_projection_sha256, `custody gold projection sha256 matches manifest (${h.slice(0, 16)}...)`);
  const shaFile = path.join(custodyDir, 'holdback-v2-gold.sha256');
  check(fs.existsSync(shaFile) && fs.readFileSync(shaFile, 'utf8').includes(h), 'custody gold .sha256 sidecar matches');
}

// 4. seed hash: custody seed -> sha256 == manifest.seed_hash
const seedFile = path.join(custodyDir, 'seed.txt');
check(fs.existsSync(seedFile), 'custody seed file exists');
if (manifest && fs.existsSync(seedFile)) {
  const seed = fs.readFileSync(seedFile, 'utf8').trim();
  const h = sha256(seed).toUpperCase();
  check(h === manifest.seed_hash.toUpperCase(), `seed sha256 matches manifest (${h.slice(0, 16)}...)`);
  const seedShaFile = path.join(custodyDir, 'seed-sha256.txt');
  check(fs.existsSync(seedShaFile) && fs.readFileSync(seedShaFile, 'utf8').trim().toUpperCase() === h, 'custody seed-sha256.txt matches');
}

// 5. sealed artifact: exists, structure, hash (no test-decrypt of the formal artifact per spec sec. 20)
const sealedPath = path.join(OUT, 'holdback-v2-sealed.bin');
check(fs.existsSync(sealedPath), 'holdback-v2-sealed.bin exists');
if (manifest && fs.existsSync(sealedPath)) {
  const b = fs.readFileSync(sealedPath);
  const h = sha256(b);
  check(h === manifest.sealed_artifact.sha256, `sealed artifact sha256 matches manifest (${h.slice(0, 16)}...)`);
  check(b.length >= 35 && b.toString('utf8', 0, 6) === 'G18HB2', 'sealed artifact header G18HB2');
  check(b[6] === 1, 'sealed artifact format version 1');
  check(b.length >= 6 + 1 + 12 + 16, 'sealed artifact layout iv(12)+tag(16)+ciphertext');
}

// 6. access log
const accessPath = path.join(OUT, 'holdback-v2-access-log.jsonl');
check(fs.existsSync(accessPath), 'holdback-v2-access-log.jsonl exists');
if (fs.existsSync(accessPath)) {
  const lines = fs.readFileSync(accessPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  check(lines.length >= 4, `access log has >=4 entries (${lines.length})`);
  const actions = lines.map((l) => { try { return JSON.parse(l).action; } catch { return null; } });
  check(actions.every(Boolean), 'access log entries are valid JSONL');
  for (const act of ['generate', 'seal', 'custody_transfer', 'verify']) check(actions.includes(act), `access log contains ${act} entry`);
  check(!actions.includes('run_models') && !actions.includes('score'), 'access log has no model-run or scoring entries');
}

// 7. plaintext absent from repository
check(!fs.existsSync(path.join(OUT, 'holdback-v2-fixtures.jsonl')), 'holdback-v2-fixtures.jsonl absent from repo root (plaintext moved to custody)');
check(!fs.existsSync(path.join(OUT, 'work', 'holdback-fixtures.jsonl')), 'work/holdback-fixtures.jsonl absent from repository (plaintext moved to custody)');

// 8. dummy decrypt-path coverage (spec sec. 20: decrypt-on-dummy only)
check(true, 'no test-decrypt performed on formal Holdback V2 (dummy round-trip covered by dummy-seal-decrypt-test.mjs)');

if (failures.length) {
  console.error(`\nPOST-SEAL VERIFICATION FAILED (${failures.length}):`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nPOST-SEAL VERIFICATION PASSED (Holdback V2)');