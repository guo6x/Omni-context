// Post-seal verification for the Goal 18 holdback (complements T15 of the integrity suite).
// Checks: public manifest fields, plaintext hash vs custody copy, sealed artifact structure
// and hash, access log entries, and that plaintext is absent from the repository.
// Usage: node verify-seal.mjs [--custody-dir <abs>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));

const custodyDir = (process.argv.find((x, i) => process.argv[i - 1] === '--custody-dir') || 'C:/Users/00/.codex/goal18-holdback-custody');
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

// 1. public manifest
const manifestPath = path.join(OUT, 'holdback-public-manifest.json');
check(fs.existsSync(manifestPath), 'holdback-public-manifest.json exists');
let manifest = null;
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  check(typeof manifest.sha256 === 'string' && /^[0-9a-f]{64}$/.test(manifest.sha256), 'manifest.sha256 format');
  check(typeof manifest.seed_hash === 'string' && /^[0-9a-f]{64}$/.test(manifest.seed_hash), 'manifest.seed_hash format');
  check(manifest.schemaVersion === 'holdback-seal-manifest-v2', 'manifest schemaVersion');
  check(manifest.sealed_artifact && /^[0-9a-f]{64}$/.test(manifest.sealed_artifact.sha256), 'manifest sealed_artifact.sha256 format');
}

// 2. plaintext hash: custody copy must match manifest.sha256
const custodyPlain = path.join(custodyDir, 'holdback-fixtures.jsonl');
check(fs.existsSync(custodyPlain), 'custody plaintext copy exists');
if (manifest && fs.existsSync(custodyPlain)) {
  const h = sha256File(custodyPlain);
  check(h === manifest.sha256, `custody plaintext sha256 matches manifest (${h.slice(0, 16)}...)`);
  const shaFile = path.join(custodyDir, 'holdback-fixtures.sha256');
  check(fs.existsSync(shaFile) && fs.readFileSync(shaFile, 'utf8').includes(h), 'custody .sha256 sidecar matches');
}

// 3. seed hash: custody seed -> sha256 == manifest.seed_hash
const seedFile = path.join(custodyDir, 'seed-holdback.txt');
check(fs.existsSync(seedFile), 'custody seed file exists');
if (manifest && fs.existsSync(seedFile)) {
  const seed = fs.readFileSync(seedFile, 'utf8').trim();
  const h = sha256(seed).toUpperCase();
  check(h === manifest.seed_hash.toUpperCase(), `seed sha256 matches manifest (${h.slice(0, 16)}...)`);
  const seedShaFile = path.join(custodyDir, 'seed-sha256.txt');
  check(fs.existsSync(seedShaFile) && fs.readFileSync(seedShaFile, 'utf8').trim().toUpperCase() === h, 'custody seed-sha256.txt matches');
}

// 4. sealed artifact: exists, structure, hash
const sealedPath = path.join(OUT, 'holdback-sealed.bin');
check(fs.existsSync(sealedPath), 'holdback-sealed.bin exists');
if (manifest && fs.existsSync(sealedPath)) {
  const b = fs.readFileSync(sealedPath);
  const h = sha256(b);
  check(h === manifest.sealed_artifact.sha256, `sealed artifact sha256 matches manifest (${h.slice(0, 16)}...)`);
  check(b.length >= 35 && b.toString('utf8', 0, 6) === 'G18HB1', 'sealed artifact header G18HB1');
  check(b[6] === 1, 'sealed artifact format version 1');
  check(b.length >= 6 + 1 + 12 + 16, 'sealed artifact layout iv(12)+tag(16)+ciphertext');
  // 4b. decrypt sealed artifact with custody seed; plaintext must hash to manifest.sha256
  const seedForDecrypt = fs.readFileSync(seedFile, 'utf8').trim();
  const seedHashForDecrypt = sha256(seedForDecrypt);
  const salt = Buffer.from(sha256('goal18-holdback-seal-v1|' + seedHashForDecrypt).slice(0, 32), 'hex');
  const key = crypto.scryptSync(seedForDecrypt, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = b.slice(7, 19);
  const tag = b.slice(19, 35);
  const enc = b.slice(35);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
    check(sha256(plain) === manifest.sha256, 'decrypted plaintext sha256 matches manifest');
  } catch (e) {
    check(false, 'sealed artifact decrypts with custody seed: ' + e.message);
  }

}

// 5. access log
const accessPath = path.join(OUT, 'holdback-access-log.jsonl');
check(fs.existsSync(accessPath), 'holdback-access-log.jsonl exists');
if (fs.existsSync(accessPath)) {
  const lines = fs.readFileSync(accessPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  check(lines.length >= 4, `access log has >=4 entries (${lines.length})`);
  const actions = lines.map((l) => { try { return JSON.parse(l).action; } catch { return null; } });
  check(actions.every(Boolean), 'access log entries are valid JSONL');
  for (const act of ['generate', 'seal', 'custody_transfer', 'verify']) check(actions.includes(act), `access log contains ${act} entry`);
  check(!actions.includes('run_models') && !actions.includes('score'), 'access log has no model-run or scoring entries');
}

// 6. plaintext absent from repository
check(!fs.existsSync(path.join(OUT, 'holdback-fixtures.jsonl')), 'holdback-fixtures.jsonl absent from repository (plaintext moved to custody)');

if (failures.length) {
  console.error(`\nPOST-SEAL VERIFICATION FAILED (${failures.length}):`);
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('\nPOST-SEAL VERIFICATION PASSED');
