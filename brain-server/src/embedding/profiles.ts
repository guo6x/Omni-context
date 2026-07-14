import { createHash } from 'crypto';

export type EmbeddingUsage = 'query' | 'passage';

export interface EmbeddingUsageProfile {
  family: 'e5' | 'bge' | 'generic';
  modelId: string;
  modelRevision: string;
  onnxFile: string;
  quantization: string;
  tokenizerVersion: string;
  modelSha256?: string;
  dimension: number;
  maxTokens: number;
  queryPrefix: string;
  passagePrefix: string;
  pooling: 'mean' | 'cls';
  normalize: boolean;
  serializationVersion: string;
  usageProfileVersion: string;
}

export const E5_LARGE_USAGE_PROFILE: Readonly<EmbeddingUsageProfile> = Object.freeze({
  family: 'e5',
  modelId: 'Xenova/multilingual-e5-large',
  modelRevision: 'a19b072cb4f0cc8bf98b4e46f90a787a61380979',
  onnxFile: 'onnx/model_quantized.onnx',
  quantization: 'QInt8',
  tokenizerVersion: '@xenova/transformers@2.17.2:XLMRobertaTokenizer',
  modelSha256: '0a8d65db9a36f810ba5da15249f13145fcdc7890e6656f1fd38cd8b7c4db1fca',
  dimension: 1024,
  maxTokens: 512,
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  serializationVersion: 'entity-passage-v2+assertion-passage-v1',
  usageProfileVersion: 'e5-large-v1',
});

export const E5_SMALL_USAGE_PROFILE: Readonly<EmbeddingUsageProfile> = Object.freeze({
  family: 'e5',
  modelId: 'Xenova/multilingual-e5-small',
  modelRevision: 'local-bundle-candidate-v1',
  onnxFile: 'onnx/model_quantized.onnx',
  quantization: 'QInt8',
  tokenizerVersion: '@xenova/transformers@2.17.2:XLMRobertaTokenizer',
  modelSha256: 'f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193',
  dimension: 384,
  maxTokens: 512,
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  serializationVersion: 'entity-passage-v2+assertion-passage-v1',
  usageProfileVersion: 'e5-small-prefixed-v2',
});

export function resolveEmbeddingUsageProfile(
  modelId: string,
  override?: EmbeddingUsageProfile,
): EmbeddingUsageProfile {
  if (override) {
    if (override.modelId !== modelId) {
      throw new Error(`Embedding profile model mismatch: ${override.modelId} != ${modelId}`);
    }
    return { ...override };
  }
  if (modelId === E5_LARGE_USAGE_PROFILE.modelId) return { ...E5_LARGE_USAGE_PROFILE };
  if (modelId === E5_SMALL_USAGE_PROFILE.modelId) return { ...E5_SMALL_USAGE_PROFILE };
  throw new Error(`No pinned EmbeddingUsageProfile for model: ${modelId}`);
}

function stripKnownPrefix(text: string): string {
  return text.trim().replace(/^(?:query|passage)\s*:\s*/i, '').trim();
}

export function prepareEmbeddingText(
  text: string,
  usage: EmbeddingUsage,
  profile: EmbeddingUsageProfile,
): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Embedding text must be non-empty');
  }
  const content = profile.family === 'e5' ? stripKnownPrefix(text) : text.trim();
  const prefix = usage === 'query' ? profile.queryPrefix : profile.passagePrefix;
  return `${prefix}${content}`;
}

export function embeddingProfileFingerprint(profile: EmbeddingUsageProfile): string {
  const stable = Object.fromEntries(Object.entries(profile).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}
