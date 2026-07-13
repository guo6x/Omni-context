import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { configHash, sha256, sha256File } from './integrity.mjs';

export const EVALUATION_FREEZE_AUTHORIZATION = 'Omni-Context Evaluation Freeze v1';

export const EvaluationAuthorizationSchema = z.object({
  authorization: z.literal(EVALUATION_FREEZE_AUTHORIZATION),
  freeze_commit: z.string().regex(/^[a-f0-9]{40}$/),
  config_hash: z.string().regex(/^[a-f0-9]{64}$/),
  answer_prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  judge_prompt_hash: z.string().regex(/^[a-f0-9]{64}$/),
  dataset_hash: z.string().regex(/^[a-f0-9]{64}$/),
  issued_at: z.string().datetime(),
}).strict();

export async function loadAndVerifyEvaluationAuthorization({
  manifestPath, currentCommit, config, answerPrompt, judgePrompt, datasetPath,
}) {
  if (!manifestPath) throw new Error('Held-out mode requires --authorization-manifest <path>.');
  const raw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const parsed = EvaluationAuthorizationSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Evaluation authorization manifest validation failed: ${details}`);
  }
  const expected = {
    freeze_commit: currentCommit,
    config_hash: configHash(config),
    answer_prompt_hash: sha256(answerPrompt),
    judge_prompt_hash: sha256(judgePrompt),
    dataset_hash: await sha256File(datasetPath),
  };
  for (const [field, value] of Object.entries(expected)) {
    if (parsed.data[field] !== value) {
      throw new Error(`Evaluation authorization ${field} mismatch: authorized ${parsed.data[field]}, current ${value}`);
    }
  }
  return { ...parsed.data, manifest_path: manifestPath };
}
