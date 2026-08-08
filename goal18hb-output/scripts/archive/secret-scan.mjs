// Goal 18HB-A post-seal archival secret scanner (ASCII-only, no dependencies).
// Usage:
//   node secret-scan.mjs --repo-root <git root> --seed-file <custody seed path>
//                        --expected-seed-hash <public seed sha256 hex>
//                        [--out <result json path>] [--label <scan label>]
//                        [--staged-list <file with one path per line>]
// Behavior:
//   - Reads the staged file list via `git diff --cached --name-only -z`
//     (or --staged-list) and reads each staged blob via `git show :<path>`.
//   - Pathname scan: flags secret-bearing path patterns.
//   - Content scan: compares each blob against the custody seed in memory
//     (never printed) and searches for private-key / API-key / token patterns.
//   - Writes a JSON result (hashes only) and exits 0 on PASS, 2 on FAIL.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename, normalize, sep } from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = value;
        i++;
      }
    }
  }
  return out;
}

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');

// Secret-bearing path patterns (matched against the lowercased relative path).
const PATH_RULES = [
  { id: 'SEED_FILE', re: /(^|[\\/])seed(\.txt)?$/ },
  { id: 'DUMMY_SEED', re: /dummy[-_ ]seed/i },
  { id: 'PRIVATE_KEY_FILE', re: /\.(pem|key|pfx|p12|jks|keystore|ppk)$/ },
  { id: 'SSH_KEY_FILE', re: /(^|[\\/])id_(rsa|ed25519|ecdsa)(\.pub)?$|\.ssh[\\/]/ },
  { id: 'ENV_FILE', re: /(^|[\\/])\.env($|\.)|\.env\.local$/ },
  { id: 'TOKEN_FILE', re: /(^|[\\/])[^\\/]*-token\.txt$|(^|[\\/])(pair-code|local-token)\.txt$/ },
  { id: 'RAW_HOLDBACK_FIXTURES', re: /holdback[-_]fixtures\.jsonl$/ },
  { id: 'RAW_HOLDBACK_GOLD', re: /holdback[-_]gold\.jsonl$/ },
  { id: 'KEYRING', re: /\.gnupg|keyring|wallet\.json|credentials\.json$/ }
];

// Content patterns for private keys / API keys / tokens.
const CONTENT_RULES = [
  { id: 'PRIVATE_KEY_BLOCK', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { id: 'AWS_ACCESS_KEY', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'OPENAI_STYLE_KEY', re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { id: 'GITHUB_PAT', re: /\bghp_[A-Za-z0-9]{30,}\b/ },
  { id: 'SLACK_TOKEN', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'GOOGLE_API_KEY', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'STRIPE_LIVE_KEY', re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  {
    id: 'GENERIC_SECRET_ASSIGNMENT',
    re: /\b(api[_-]?key|apikey|client[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{24,}["']?/i
  }
];

function scanPath(relPath) {
  const low = relPath.toLowerCase();
  const flags = [];
  for (const rule of PATH_RULES) {
    if (rule.re.test(low)) flags.push({ check: 'pathname', rule: rule.id, path: relPath });
  }
  return flags;
}

function scanContent(relPath, buf, seed, seedHash) {
  const flags = [];
  const utf8 = buf.toString('utf8');
  const latin1 = buf.toString('latin1');
  if (seed && (utf8.includes(seed) || latin1.includes(seed))) {
    flags.push({ check: 'content', rule: 'CUSTODY_SEED_PRESENT', path: relPath, detail: 'staged blob contains the custody seed value' });
  }
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(utf8) || rule.re.test(latin1)) {
      flags.push({ check: 'content', rule: rule.id, path: relPath, detail: 'secret-like pattern matched' });
    }
  }
  return flags;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = normalize(args['repo-root'] || process.cwd());
  const seedFile = args['seed-file'];
  const outFile = args['out'];
  const label = args['label'] || 'staged';
  const expectedSeedHash = args['expected-seed-hash'] || null;

  let seed = null;
  let seedHash = null;
  if (seedFile) {
    seed = readFileSync(seedFile, 'utf8').trim();
    seedHash = sha256hex(seed);
    if (expectedSeedHash && seedHash.toLowerCase() !== expectedSeedHash.toLowerCase()) {
      console.error('FATAL: custody seed hash does not match expected public seed hash');
      process.exit(2);
    }
  } else {
    console.error('WARN: --seed-file not provided; seed-presence check skipped');
  }

  let paths = [];
  if (args['staged-list']) {
    paths = readFileSync(args['staged-list'], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } else {
    const res = spawnSync('git', ['diff', '--cached', '--name-only', '-z'], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
    });
    if (res.status !== 0) {
      console.error('FATAL: git diff --cached failed:', res.stderr.toString());
      process.exit(2);
    }
    paths = res.stdout.split('\0').filter(Boolean);
  }

  const files = [];
  let findings = [];
  for (const p of paths) {
    const res = spawnSync('git', ['show', ':' + p], {
      cwd: repoRoot, maxBuffer: 256 * 1024 * 1024
    });
    if (res.status !== 0) {
      findings.push({ check: 'read', rule: 'STAGED_BLOB_READ_FAILED', path: p, detail: res.stderr ? res.stderr.toString().slice(0, 200) : 'git show failed' });
      files.push({ path: p, bytes: -1, sha256: null, flags: [] });
      continue;
    }
    const buf = res.stdout;
    const flags = scanPath(p).concat(scanContent(p, buf, seed, seedHash));
    files.push({ path: p, bytes: buf.length, sha256: sha256hex(buf), flags });
    findings = findings.concat(flags);
  }

  const result = {
    schema_version: 'secret-scan-result-v1',
    goal: 'Goal 18HB-A',
    label,
    scanned_at: new Date().toISOString(),
    seed_sha256_compared: seedHash,
    expected_seed_sha256: expectedSeedHash ? expectedSeedHash.toLowerCase() : null,
    staged_file_count: paths.length,
    findings_count: findings.length,
    findings,
    files,
    verdict: findings.length === 0 ? 'PASS' : 'FAIL'
  };

  if (outFile) writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    label,
    seed_sha256_compared: seedHash,
    staged_file_count: paths.length,
    findings_count: findings.length,
    verdict: result.verdict
  }, null, 2));
  process.exit(result.verdict === 'PASS' ? 0 : 2);
}

main();