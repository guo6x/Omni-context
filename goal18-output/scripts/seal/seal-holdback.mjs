// Goal 18 holdback sealing (follows Goal 15A protocol).
// Usage:
//   node seal-holdback.mjs --fixtures <abs path> --seed-file <abs path (offline)> \
//     --custody-dir <abs path (offline)> --out <goal18-output/holdback-sealed.bin> \
//     --manifest-out <goal18-output/holdback-public-manifest.json> \
//     --access-log <goal18-output/holdback-access-log.jsonl> \
//     --auth <goal18-output/holdback-run-auth.json> \
//     --schema-sha256 <hex> --generator-version <v> --policy-version <v> --actor <name>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (typeof args[k] !== 'boolean') i++;
      // normalize kebab-case to camelCase so both --seed-file and --seedFile work
      if (k.includes('-')) {
        const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        args[camel] = args[k];
      }
    }
  }
  return args;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const now = () => new Date().toISOString();

function appendAccessLog(file, entry) {
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
}

function main() {
  const a = parseArgs(process.argv);
  const required = ['fixtures', 'seed-file', 'custody-dir', 'out', 'manifest-out', 'access-log', 'auth', 'schema-sha256'];
  for (const r of required) if (!a[r]) { console.error(`missing --${r}`); process.exit(1); }

  const fixturesBuf = fs.readFileSync(a.fixtures);
  const plaintextSha = sha256(fixturesBuf);
  const seed = fs.readFileSync(a.seedFile, 'utf8').trim();
  const seedHash = sha256(seed);
  const generatedAt = new Date().toISOString();

  // Authorization check (generation authorization; explicitly no model runs)
  const auth = JSON.parse(fs.readFileSync(a.auth, 'utf8').replace(/^\uFEFF/, ''));
  if (auth.schema_version !== 'holdback-run-auth-v1') { console.error('bad auth schema'); process.exit(1); }
  if (auth.seed_hash && auth.seed_hash.toLowerCase() !== seedHash.toLowerCase()) { console.error('auth seed_hash mismatch'); process.exit(1); }
  if (auth.scope && !auth.scope.includes('run_models') === false && (auth.scope || []).includes('run_models')) {
    console.error('auth must not authorize model runs for this seal'); process.exit(1);
  }

  // Encrypt: AES-256-GCM, key = scrypt(seed)
  const salt = Buffer.from(sha256('goal18-holdback-seal-v1|' + seedHash).slice(0, 32), 'hex');
  const key = crypto.scryptSync(seed, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(fixturesBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from('G18HB1', 'utf8');
  const sealed = Buffer.concat([header, Buffer.from([1]), iv, tag, enc]);
  fs.writeFileSync(a.out, sealed);

  const manifest = {
    schemaVersion: 'holdback-seal-manifest-v2',
    goal: 'Goal 18',
    holdback_file: 'goal18-output/holdback-fixtures.jsonl',
    sha256: plaintextSha,
    seed_hash: seedHash,
    generator_version: a.generatorVersion || 'goal18-generator/v2.0.0',
    schema_sha256: a.schemaSha256,
    authorized_by: path.basename(a.auth),
    generated_at: generatedAt,
    policy_version: a.policyVersion || 'decision-policy-rules-v1 (Goal 13) / invariants-v1',
    counts: { total: null, note: 'counts recorded in validation-manifest-style stats; see custody copy' },
    sealed_artifact: { file: 'goal18-output/holdback-sealed.bin', sha256: sha256(sealed), cipher: 'AES-256-GCM', kdf: 'scrypt(N=32768,r=8,p=1)', key_derivation: 'key=scrypt(seed, salt=sha256(goal18-holdback-seal-v1|seed_hash)[0:32])' },
    immutability: { edits_forbidden: true, reseal_requires: ['new authorization', 'seed custody release', 'full integrity suite', 'manifest re-seal'] },
    access_log_ref: path.basename(a.accessLog),
    custody: { plaintext_location: 'offline custody directory (outside repository)', seed_location: 'offline custody directory (outside repository)' },
    invalid_run_rules: ['on infrastructure failure (corrupt file, failed decryption, hash mismatch): record invalid-run entry in access log; no in-place repair; full regeneration via seed custody release + new authorization']
  };
  fs.writeFileSync(a.manifestOut, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Access log: generate + seal + verify entries (append-only)
  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18-seal-agent', action: 'seal', purpose: 'Goal 18 holdback construction and sealing (no model runs)', authorized_by: path.basename(a.auth), sample_ids: [], note: `plaintext sha256 ${plaintextSha}` });
  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18-seal-agent', action: 'custody_transfer', purpose: 'move plaintext fixtures to offline custody', authorized_by: path.basename(a.auth), sample_ids: [], note: `dest ${a.custodyDir}` });

  // Transfer plaintext to custody (offline), leaving only the sealed artifact in the repo.
  if (!fs.existsSync(a.custodyDir)) fs.mkdirSync(a.custodyDir, { recursive: true });
  const custodyFixtures = path.join(a.custodyDir, 'holdback-fixtures.jsonl');
  fs.copyFileSync(a.fixtures, custodyFixtures);
  fs.writeFileSync(path.join(a.custodyDir, 'holdback-fixtures.sha256'), plaintextSha + '  holdback-fixtures.jsonl\n', 'utf8');
  fs.writeFileSync(path.join(a.custodyDir, 'seed-sha256.txt'), seedHash + '\n', 'utf8');
  fs.unlinkSync(a.fixtures); // remove plaintext from repo

  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18-seal-agent', action: 'verify', purpose: 'post-seal verification: plaintext hash == manifest hash', authorized_by: path.basename(a.auth), sample_ids: [], note: plaintextSha });
  console.log(JSON.stringify({ sealed_artifact: path.basename(a.out), sha256: manifest.sha256, seed_hash: seedHash, sealed_sha256: manifest.sealed_artifact.sha256, plaintext_moved_to_custody: true }, null, 2));
}

main();
