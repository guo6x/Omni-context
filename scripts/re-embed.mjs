#!/usr/bin/env node
/**
 * Omni-Context re-embed tool (embedding v3 migration).
 *
 * Rebuilds entity + assertion vector indexes with a pinned embedding usage
 * profile using the RESUNABLE shadow-build pipeline in sqlite.ts:
 *   - interruptible: SIGINT/SIGTERM stops cleanly; the shadow tables + state
 *     key remain on disk;
 *   - resumable: re-running continues from the checkpoint without re-embedding
 *     unchanged rows (content_sha256 comparison);
 *   - repeatable: idempotent — re-running a completed migration is a no-op
 *     (state key removed, active index verified);
 *   - safe: the OLD index stays live until the NEW shadow build is complete
 *     AND verified (verifyBeforeActivate), then swaps atomically.
 *
 * THIS ROUND: no remote model download, no full real re-embed. Default mode is
 * `--fixture` (deterministic mock embeddings). Use `--real` only when the local
 * model is already installed (see docs/embedding-migration-plan.md).
 *
 * Usage:
 *   node scripts/re-embed.mjs --db ./data/omni-context.db
 *   node scripts/re-embed.mjs --db ./data/omni-context.db --profile e5-small
 *   node scripts/re-embed.mjs --db ./data/omni-context.db --check
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import initDatabase from '../brain-server/dist/db/sqlite.js';
import {
  E5_LARGE_USAGE_PROFILE,
  E5_SMALL_USAGE_PROFILE,
  embeddingProfileFingerprint,
} from '../brain-server/dist/embedding/profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES = {
  'e5-large': E5_LARGE_USAGE_PROFILE,
  'e5-small': E5_SMALL_USAGE_PROFILE,
};

function parseArgs(argv) {
  const args = {
    db: path.join(__dirname, '..', 'brain-server', 'data', 'omni-context.db'),
    profile: 'e5-large',
    fixture: true,
    verify: true,
    check: false,
    out: null,
    resume: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--db') args.db = next();
    else if (arg === '--profile') args.profile = next();
    else if (arg === '--out') args.out = next();
    else if (arg === '--real') args.fixture = false;
    else if (arg === '--fixture') args.fixture = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--no-verify') args.verify = false;
    else if (arg === '--no-resume') args.resume = false;
    else if (arg === '--help' || arg === '-h') { args.help = true; }
  }
  return args;
}

function makeFixtureService(profile) {
  const fingerprint = embeddingProfileFingerprint(profile);
  const vector = (text) => {
    const v = new Array(profile.dimension).fill(0);
    let slot = 0;
    for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i) * (i + 1)) % profile.dimension;
    v[slot] = 1;
    return v;
  };
  return {
    getUsageProfile: () => ({ ...profile, fingerprint }),
    getStatus: () => 'local',
    getInfo: () => ({ mode: 'local', status: 'local', dimensions: profile.dimension, model: profile.modelId }),
    embedPassage: async (text) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
    embedQuery: async (text) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
    embed: async (text) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
  };
}

async function buildRealService(profile) {
  // NOT used in this round (no model downloads). Present as the documented
  // path for when a local model is installed and verified.
  const { default: EmbeddingService } = await import('../brain-server/dist/embedding/service.js');
  const service = new EmbeddingService({
    mode: 'local',
    localModel: profile.modelId,
    localModelPath: process.env.EMBEDDING_LOCAL_MODEL_PATH,
  });
  return service;
}

function log(msg) {
  console.log(`[re-embed] ${msg}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(path.join(__dirname, 're-embed.mjs'), 'utf-8').split('\n').slice(0, 30).join('\n'));
    return;
  }
  const profile = PROFILES[args.profile];
  if (!profile) throw new Error(`Unknown profile: ${args.profile} (use e5-large|e5-small)`);

  if (!fs.existsSync(args.db)) {
    log(`database does not exist yet: ${args.db}`);
  } else {
    log(`database: ${args.db}`);
  }
  log(`profile: ${profile.modelId} (${profile.dimension}d, serialization ${profile.serializationVersion})`);
  log(`embedding source: ${args.fixture ? 'FIXTURE (mock, no model download)' : 'real local model (requires installed model)'}`);

  const db = initDatabase({ dbPath: args.db, enableWAL: true, busyTimeout: 5000 });
  await db.runMigrations();

  const service = args.fixture
    ? makeFixtureService(profile)
    : await buildRealService(profile);

  const report = {
    db: args.db,
    profile: profile.modelId,
    dimension: profile.dimension,
    serializationVersion: profile.serializationVersion,
    source: args.fixture ? 'fixture' : 'real',
    startedAt: new Date().toISOString(),
    entityIndex: null,
    assertionIndex: null,
  };

  if (args.check) {
    const entityCheck = await db.verifyEmbeddingIndexConsistency('vec_entities');
    const assertionCheck = await db.verifyEmbeddingIndexConsistency('vec_assertions');
    log(`check vec_entities: ${entityCheck.ok ? 'OK' : 'MIXED'} rows=${entityCheck.rows} serial=${entityCheck.serializationVersion}`);
    if (!entityCheck.ok) log(`  mismatches: ${entityCheck.mismatches.join('; ')}`);
    log(`check vec_assertions: ${assertionCheck.ok ? 'OK' : 'MIXED'} rows=${assertionCheck.rows} serial=${assertionCheck.serializationVersion}`);
    if (!assertionCheck.ok) log(`  mismatches: ${assertionCheck.mismatches.join('; ')}`);
    report.entityIndex = entityCheck;
    report.assertionIndex = assertionCheck;
  } else {
    // Resume/rebuild with shadow tables. Old index stays live until swap.
    log('rebuilding embeddings (shadow build; old index stays live until verify+swap)...');
    let interrupted = false;
    const onInterrupt = () => { interrupted = true; };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);
    const counts = await db.rebuildAllEmbeddings(service, (progress) => {
      log(`  ${progress.phase}: ${progress.done}/${progress.total}`);
      if (interrupted) {
        log('  interrupt requested after this row — safe to stop; re-run to resume.');
        process.exit(130);
      }
    }, { verifyBeforeActivate: true });
    report.entities = counts.entities;
    report.assertions = counts.assertions;
    log(`rebuild complete: ${counts.entities} entities, ${counts.assertions} assertions (old index swapped only after verify)`);

    if (args.verify) {
      const entityCheck = await db.verifyEmbeddingIndexConsistency('vec_entities');
      const assertionCheck = await db.verifyEmbeddingIndexConsistency('vec_assertions');
      log(`verify vec_entities: ${entityCheck.ok ? 'OK' : 'MIXED'} rows=${entityCheck.rows} serial=${entityCheck.serializationVersion}`);
      log(`verify vec_assertions: ${assertionCheck.ok ? 'OK' : 'MIXED'} rows=${assertionCheck.rows} serial=${assertionCheck.serializationVersion}`);
      report.entityIndex = entityCheck;
      report.assertionIndex = assertionCheck;
      if (!entityCheck.ok || !assertionCheck.ok) {
        throw new Error(`EMBEDDING_SERIALIZATION_MIX after activation — investigate before use`);
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(report, null, 2));
    log(`report written: ${args.out}`);
  } else {
    log(`summary: ${JSON.stringify(report, null, 2)}`);
  }
  await db.close();
}

main().catch((error) => {
  console.error('[re-embed] failed:', error);
  process.exit(1);
});
