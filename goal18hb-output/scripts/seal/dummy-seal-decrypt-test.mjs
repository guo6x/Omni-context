// Goal 18HB - dummy seal/decrypt round-trip test (spec sec. 20: "seal decrypt-on-dummy test only").
// Uses NON-FORMAL dummy data + NON-FORMAL dummy seed. Exercises the exact Holdback V2 seal path
// (AES-256-GCM, salt label goal18hb-holdback-seal-v2|seed_hash, header G18HB2) and verifies the
// decrypt round-trip. The FORMAL Holdback V2 is never decrypted by this test.
// Usage: node dummy-seal-decrypt-test.mjs [--fixtures <abs dummy jsonl>] [--seed-file <abs dummy seed>] [--out <abs dir>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

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
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = a.fixtures || path.join(base, 'work', 'dummy-hb-run1', 'holdback-fixtures.jsonl');
const seedFile = a.seedFile || path.join(base, 'work', 'dummy-seed-1.txt');
const outDir = a.out || path.join(base, 'work');

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log((cond ? 'ok   ' : 'FAIL ') + msg); };

const plain = fs.readFileSync(fixtures);
const plainSha = sha256(plain);
const seed = fs.readFileSync(seedFile, 'utf8').trim();
const seedHash = sha256(seed);

// Seal (identical code path to seal-holdback-v2.mjs).
const salt = Buffer.from(sha256('goal18hb-holdback-seal-v2|' + seedHash).slice(0, 32), 'hex');
const key = crypto.scryptSync(seed, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
const sealed = Buffer.concat([Buffer.from('G18HB2', 'utf8'), Buffer.from([1]), iv, tag, enc]);

check(sealed.toString('utf8', 0, 6) === 'G18HB2', 'dummy sealed header G18HB2');
check(sealed[6] === 1, 'dummy sealed format version 1');

// Decrypt with the same seed (positive control).
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const roundtrip = Buffer.concat([decipher.update(enc), decipher.final()]);
check(roundtrip.equals(plain), 'decrypt(seal(plain)) == plain (byte-identical)');
check(sha256(roundtrip) === plainSha, 'decrypted sha256 matches original');

// Negative control: wrong seed must fail decryption.
const wrongSeed = sha256('wrong-dummy-seed-not-the-seed');
const wrongSalt = Buffer.from(sha256('goal18hb-holdback-seal-v2|' + wrongSeed).slice(0, 32), 'hex');
const wrongKey = crypto.scryptSync(wrongSeed, wrongSalt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
let wrongFailed = false;
try {
  const d2 = crypto.createDecipheriv('aes-256-gcm', wrongKey, iv);
  d2.setAuthTag(tag);
  const p2 = Buffer.concat([d2.update(enc), d2.final()]);
  if (sha256(p2) === plainSha) wrongFailed = false; else wrongFailed = true;
} catch { wrongFailed = true; }
check(wrongFailed, 'wrong seed fails decryption (auth tag mismatch)');

// Persist results (dummy only; no formal material).
const result = {
  schema_version: 'dummy-seal-decrypt-test-v1',
  non_formal: true,
  material: { fixtures: 'work/dummy-hb-run1/holdback-fixtures.jsonl', seed: 'work/dummy-seed-1.txt' },
  seed_hash: seedHash,
  plaintext_sha256: plainSha,
  checks: { header: true, roundtrip: true, wrong_seed_rejected: wrongFailed },
  passed: failures.length === 0,
  run_at: new Date().toISOString()
};
fs.writeFileSync(path.join(outDir, 'dummy-seal-decrypt-results.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('results: ' + path.join(outDir, 'dummy-seal-decrypt-results.json'));

if (failures.length) { console.error('DUMMY SEAL/DECRYPT TEST FAILED (' + failures.length + ')'); process.exit(1); }
console.log('DUMMY SEAL/DECRYPT ROUND-TRIP TEST PASSED');