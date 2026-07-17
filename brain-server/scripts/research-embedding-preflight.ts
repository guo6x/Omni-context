import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EmbeddingService } from '../src/embedding/service.js';
import { E5_LARGE_USAGE_PROFILE } from '../src/embedding/profiles.js';

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function argument(name: string): string | undefined {
  const assigned = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  process.env.OMNI_EVALUATION_MODE = '1';
  process.env.TRANSFORMERS_OFFLINE = '1';
  const root = path.resolve(argument('--model-root') || process.env.EMBEDDING_LOCAL_MODEL_PATH || '');
  if (!root) throw new Error('--model-root or EMBEDDING_LOCAL_MODEL_PATH is required');
  const outputPath = argument('--output');
  const modelPath = path.join(root, E5_LARGE_USAGE_PROFILE.modelId, E5_LARGE_USAGE_PROFILE.onnxFile);
  const modelStat = await stat(modelPath);
  const actualSha256 = await sha256File(modelPath);
  if (actualSha256 !== E5_LARGE_USAGE_PROFILE.modelSha256) throw new Error('Pinned model SHA-256 mismatch');
  const service = new EmbeddingService({
    mode: 'local',
    localModel: E5_LARGE_USAGE_PROFILE.modelId,
    localModelPath: root,
    dimensions: E5_LARGE_USAGE_PROFILE.dimension,
    failOnUnavailable: true,
  });
  const startedAt = Date.now();
  const embedding = await service.embedQuery('research preflight dimension verification');
  const info = service.getInfo();
  const healthy = info.status === 'local'
    && embedding.dimensions === 1024
    && info.actualDimension === 1024
    && info.modelSha256Verified
    && embedding.embedding.every(Number.isFinite)
    && embedding.embedding.some((value) => value !== 0);
  if (!healthy) throw new Error(`Embedding preflight unhealthy: ${JSON.stringify(info)}`);
  const report = {
    schema_version: 1,
    created_at: new Date().toISOString(),
    model_root: root,
    model_path: modelPath,
    model_file_exists: true,
    model_file_bytes: modelStat.size,
    expected_sha256: E5_LARGE_USAGE_PROFILE.modelSha256,
    actual_sha256: actualSha256,
    sha256_verified: true,
    expected_dimension: 1024,
    actual_dimension: embedding.dimensions,
    status: info.status,
    healthy,
    hash_fallback: false,
    load_and_embed_ms: Date.now() - startedAt,
    usage_profile: info.usageProfile,
  };
  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    event: 'research_embedding_preflight_failed',
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 1;
});
