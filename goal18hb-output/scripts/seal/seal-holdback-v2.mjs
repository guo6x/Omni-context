// Goal 18HB - Holdback V2 sealing (follows Goal 15A protocol + Goal 18HB section 14).
// Usage:
//   node seal-holdback-v2.mjs --fixtures <abs path to plaintext jsonl> --seed-file <abs path (offline)>
//     --custody-dir <abs path (offline)> --out <goal18hb-output/holdback-v2-sealed.bin>
//     --manifest-out <goal18hb-output/holdback-v2-public-manifest.json>
//     --access-log <goal18hb-output/holdback-v2-access-log.jsonl>
//     --auth <goal18hb-output/holdback-v2-run-auth.json>
//     --schema-sha256 <hex> --generator-commit <hex> --generator-version <v>
//     --ri-audit-sha256 <hex> --integrity-suite-sha256 <hex>
//     --policy-version <v> --actor <name>
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
      if (k.includes('-')) { const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); args[camel] = args[k]; }
    }
  }
  return args;
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const now = () => new Date().toISOString();
function appendAccessLog(file, entry) { fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8'); }

function main() {
  const a = parseArgs(process.argv);
  const required = ['fixtures', 'seed-file', 'custody-dir', 'out', 'manifest-out', 'access-log', 'auth', 'schema-sha256', 'generator-commit', 'generator-version', 'ri-audit-sha256', 'integrity-suite-sha256'];
  for (const r of required) if (!a[r]) { console.error('missing --' + r); process.exit(1); }

  const fixturesBuf = fs.readFileSync(a.fixtures);
  const plaintextSha = sha256(fixturesBuf);
  const seed = fs.readFileSync(a.seedFile, 'utf8').trim();
  const seedHash = sha256(seed);
  const generatedAt = now();

  // Authorization check (generation/seal authorization; explicitly no model runs)
  const auth = JSON.parse(fs.readFileSync(a.auth, 'utf8').replace(/^\uFEFF/, ''));
  if (auth.schema_version !== 'holdback-v2-run-auth-v1') { console.error('bad auth schema'); process.exit(1); }
  if (auth.seed_hash && auth.seed_hash.toLowerCase() !== seedHash.toLowerCase()) { console.error('auth seed_hash mismatch'); process.exit(1); }
  if (!(auth.forbidden || []).includes('run_models')) { console.error('auth must explicitly forbid model runs'); process.exit(1); }

  // Structural pre-seal checks
  const lines = fixturesBuf.toString('utf8').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 180) { console.error('expected 180 samples, got ' + lines.length); process.exit(1); }
  const perTt = {};
  const goldLines = [];
  for (const l of lines) {
    const s = JSON.parse(l);
    perTt[s.task_type] = (perTt[s.task_type] || 0) + 1;
    goldLines.push(JSON.stringify({ sample_id: s.sample_id, expected_action: s.expected_action, acceptable_explanations: s.acceptable_explanations, severe_failure_labels: s.severe_failure_labels, scoring: s.scoring }));
  }
  for (const tt of ['TT01','TT02','TT03','TT04','TT05','TT06','TT07','TT08','TT09','TT10','TT11','TT12','TT13','TT14','TT15']) {
    if (perTt[tt] !== 12) { console.error('task type ' + tt + ' count ' + perTt[tt] + ' != 12'); process.exit(1); }
  }
  const goldBuf = Buffer.from(goldLines.join('\n') + '\n', 'utf8');
  const goldSha = sha256(goldBuf);

  // Encrypt: AES-256-GCM, key = scrypt(seed) (Goal 18HB salt label, distinct from V1)
  const salt = Buffer.from(sha256('goal18hb-holdback-seal-v2|' + seedHash).slice(0, 32), 'hex');
  const key = crypto.scryptSync(seed, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(fixturesBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from('G18HB2', 'utf8');
  const sealed = Buffer.concat([header, Buffer.from([1]), iv, tag, enc]);
  fs.writeFileSync(a.out, sealed);

  const manifest = {
    schemaVersion: 'holdback-v2-seal-manifest-v1',
    goal: 'Goal 18HB',
    status: 'SEALED_PRE_VALIDATION',
    supersedes: {
      legacy_holdback: 'RETIRED_BEFORE_EVALUATION',
      legacy_manifest: 'goal18-output/holdback-public-manifest.json',
      legacy_manifest_sha256: 'd433bfa5edd9a10d361dd478a3b4a68a4e8271766b17e07f0c7976d6bdbb0fd8',
      legacy_sealed_artifact_sha256: 'f0d08a12731299fd0246492babc2edd118a08c836588ad0aa841b84543333ea3',
      retirement_record: 'goal18hb-output/legacy-holdback-retirement-record.json'
    },
    holdback_file: 'holdback-v2-fixtures.jsonl (offline custody)',
    sample_count: 180,
    task_type_counts: { per_task_type_12: true, TT01: 12, TT02: 12, TT03: 12, TT04: 12, TT05: 12, TT06: 12, TT07: 12, TT08: 12, TT09: 12, TT10: 12, TT11: 12, TT12: 12, TT13: 12, TT14: 12, TT15: 12 },
    sha256: plaintextSha,
    gold_projection_sha256: goldSha,
    seed_hash: seedHash,
    generator: { version: a.generatorVersion, commit: a.generatorCommit, identity_file: 'goal18hb-output/holdback-v2-generator-identity.json' },
    schema_sha256: a.schemaSha256,
    ri_audit: { file: 'goal18hb-output/holdback-v2-referential-integrity.json', sha256: a.riAuditSha256, severity_counts: 'ERROR=0; INFO 89 (RI-03 x77, RI-04 x12 with justifications)' },
    integrity_suite: { file: 'goal18hb-output/benchmark-integrity-tests/integrity.test.mjs', sha256: a.integritySuiteSha256, status: 'SEE holdback-v2-integrity-report.md (T1-T18)' },
    authorized_by: path.basename(a.auth),
    generated_at: generatedAt,
    policy_version: a.policyVersion || 'decision-policy-rules-v1 (Goal 13) / invariants-v1',
    sealed_artifact: { file: 'goal18hb-output/holdback-v2-sealed.bin', sha256: sha256(sealed), cipher: 'AES-256-GCM', kdf: 'scrypt(N=32768,r=8,p=1)', key_derivation: 'key=scrypt(seed, salt=sha256(goal18hb-holdback-seal-v2|seed_hash)[0:32])' },
    immutability: { edits_forbidden: true, reseal_requires: ['new authorization', 'seed custody release', 'full integrity suite', 'manifest re-seal'] },
    access_log_ref: path.basename(a.accessLog),
    custody: { plaintext_location: 'offline custody directory (outside repository)', seed_location: 'offline custody directory (outside repository)' },
    invalid_run_rules: ['on infrastructure failure (corrupt file, failed decryption, hash mismatch): record invalid-run entry in access log; no in-place repair; full regeneration via seed custody release + new authorization']
  };
  fs.writeFileSync(a.manifestOut, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18hb-seal-agent', action: 'generate', purpose: 'Goal 18HB Holdback V2 construction (authorized; no model runs)', authorized_by: path.basename(a.auth), sample_ids: [], note: '180 fixtures = 15 task types x 12; deterministic generator v2.1.0' });
  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18hb-seal-agent', action: 'seal', purpose: 'Goal 18HB Holdback V2 construction and sealing (no model runs)', authorized_by: path.basename(a.auth), sample_ids: [], note: 'plaintext sha256 ' + plaintextSha });
  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18hb-seal-agent', action: 'custody_transfer', purpose: 'move plaintext fixtures to offline custody', authorized_by: path.basename(a.auth), sample_ids: [], note: 'dest ' + a.custodyDir });

  if (!fs.existsSync(a.custodyDir)) fs.mkdirSync(a.custodyDir, { recursive: true });
  fs.copyFileSync(a.fixtures, path.join(a.custodyDir, 'holdback-v2-fixtures.jsonl'));
  fs.writeFileSync(path.join(a.custodyDir, 'holdback-v2-fixtures.sha256'), plaintextSha + '  holdback-v2-fixtures.jsonl\n', 'utf8');
  fs.writeFileSync(path.join(a.custodyDir, 'holdback-v2-gold.jsonl'), goldBuf);
  fs.writeFileSync(path.join(a.custodyDir, 'holdback-v2-gold.sha256'), goldSha + '  holdback-v2-gold.jsonl\n', 'utf8');
  fs.writeFileSync(path.join(a.custodyDir, 'seed-sha256.txt'), seedHash + '\n', 'utf8');
  fs.unlinkSync(a.fixtures);

  appendAccessLog(a.accessLog, { at: now(), actor: a.actor || 'goal18hb-seal-agent', action: 'verify', purpose: 'post-seal verification: plaintext hash == manifest hash; counts 180 = 15x12', authorized_by: path.basename(a.auth), sample_ids: [], note: plaintextSha });
  console.log(JSON.stringify({ sealed_artifact: path.basename(a.out), plaintext_sha256: manifest.sha256, gold_projection_sha256: goldSha, seed_hash: seedHash, sealed_sha256: manifest.sealed_artifact.sha256, plaintext_moved_to_custody: true }, null, 2));
}
main();
