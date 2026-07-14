import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { EmbeddingService } from '../src/embedding/service.js';
import { E5_LARGE_USAGE_PROFILE } from '../src/embedding/profiles.js';
import { ASSERTION_SERIALIZATION_VERSION, ENTITY_SERIALIZATION_VERSION } from '../src/embedding/serialization.js';

function argsFrom(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith('--')) { positional.push(current); continue; }
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = next; i++; }
  }
  // PowerShell's npm shim can strip option names after `--`; retain a stable
  // positional fallback for the documented Windows command.
  const keys = ['db', 'model', 'dimension', 'entity-serialization', 'assertion-serialization'];
  positional.forEach((value, index) => { if (keys[index] && result[keys[index]] === undefined) result[keys[index]] = value; });
  return result;
}

async function main(): Promise<void> {
  const args = argsFrom(process.argv.slice(2));
  const dbPath = String(args.db || process.env.DB_PATH || '').trim();
  const modelPath = String(args['model-path'] || process.env.EMBEDDING_LOCAL_MODEL_PATH || '').trim();
  if (!dbPath) throw new Error('--db or DB_PATH is required');
  if (!modelPath) throw new Error('--model-path or EMBEDDING_LOCAL_MODEL_PATH is required; downloads are disabled');
  const modelArg = String(args.model || 'multilingual-e5-large');
  if (!['multilingual-e5-large', E5_LARGE_USAGE_PROFILE.modelId].includes(modelArg)) throw new Error(`Unsupported pinned model: ${modelArg}`);
  if (Number(args.dimension || 1024) !== E5_LARGE_USAGE_PROFILE.dimension) throw new Error('Expected dimension 1024');
  if (String(args['entity-serialization'] || ENTITY_SERIALIZATION_VERSION) !== ENTITY_SERIALIZATION_VERSION) throw new Error(`Entity serialization must be ${ENTITY_SERIALIZATION_VERSION}`);
  if (String(args['assertion-serialization'] || ASSERTION_SERIALIZATION_VERSION) !== ASSERTION_SERIALIZATION_VERSION) throw new Error(`Assertion serialization must be ${ASSERTION_SERIALIZATION_VERSION}`);

  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = initDatabase({ dbPath });
  await db.runMigrations();
  const service = new EmbeddingService({
    mode: 'local', localModel: E5_LARGE_USAGE_PROFILE.modelId,
    localModelPath: modelPath, dimensions: 1024, failOnUnavailable: true,
  });
  const started = Date.now();
  const preflightText = 'Omni-Context embedding preflight';
  const preflight = await service.embedQuery(preflightText);
  const passagePreflight = await service.embedPassage(preflightText);
  const info = service.getInfo();
  const queryPassageDiffer = preflight.embedding.some((value, index) => value !== passagePreflight.embedding[index]);
  if (preflight.dimensions !== 1024 || passagePreflight.dimensions !== 1024
    || info.actualDimension !== 1024 || !info.modelSha256Verified || !queryPassageDiffer) {
    throw new Error(`Embedding preflight unhealthy: expected=1024 actual=${info.actualDimension}`);
  }

  const backupPath = `${dbPath}.embedding-manifests.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(backupPath, `${JSON.stringify({
    backed_up_at: new Date().toISOString(), manifests: await db.getEmbeddingIndexManifests(),
    profile: service.getUsageProfile(),
  }, null, 2)}\n`);
  const counts = await db.rebuildAllEmbeddings(service, (progress) => {
    process.stdout.write(`${JSON.stringify({ event: 'embedding_rebuild_progress', ...progress })}\n`);
  });
  const integrity = await db.scanEmbeddingIntegrity();
  const healthy = integrity.assertion.coverage === 1 && integrity.entity.coverage === 1
    && integrity.zeroVectors === 0 && integrity.nanVectors === 0
    && integrity.wrongDimensions === 0 && integrity.orphanVectors === 0 && integrity.staleVectors === 0;
  process.stdout.write(`${JSON.stringify({
    event: 'embedding_rebuild_complete', status: healthy ? 'healthy' : 'unhealthy',
    expected_dimension: 1024, actual_dimension: info.actualDimension,
    usage_profile: service.getUsageProfile().usageProfileVersion,
    query_prefix: service.getUsageProfile().queryPrefix,
    passage_prefix: service.getUsageProfile().passagePrefix,
    query_passage_vectors_differ: queryPassageDiffer,
    rss_bytes: process.memoryUsage().rss,
    duration_ms: Date.now() - started, backup_path: backupPath, counts, integrity,
  })}\n`);
  await db.close();
  if (!healthy) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'embedding_rebuild_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
