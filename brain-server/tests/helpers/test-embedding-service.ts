import { E5_LARGE_USAGE_PROFILE, embeddingProfileFingerprint } from '../../src/embedding/profiles.js';

function deterministicVector(text: string): number[] {
  const vector = new Array(E5_LARGE_USAGE_PROFILE.dimension).fill(0);
  let slot = 0;
  for (let index = 0; index < text.length; index++) {
    slot = (slot + text.charCodeAt(index) * (index + 1)) % vector.length;
  }
  vector[slot] = 1;
  return vector;
}

export const testEmbeddingService = {
  getUsageProfile: () => ({
    ...E5_LARGE_USAGE_PROFILE,
    fingerprint: embeddingProfileFingerprint(E5_LARGE_USAGE_PROFILE),
  }),
  getStatus: () => 'local' as const,
  getInfo: () => ({
    status: 'local',
    dimensions: E5_LARGE_USAGE_PROFILE.dimension,
    model: E5_LARGE_USAGE_PROFILE.modelId,
  }),
  embedPassage: async (text: string) => ({
    embedding: deterministicVector(text),
    dimensions: E5_LARGE_USAGE_PROFILE.dimension,
    model: E5_LARGE_USAGE_PROFILE.modelId,
  }),
  embedQuery: async (text: string) => ({
    embedding: deterministicVector(text),
    dimensions: E5_LARGE_USAGE_PROFILE.dimension,
    model: E5_LARGE_USAGE_PROFILE.modelId,
  }),
  embed: async (text: string) => ({
    embedding: deterministicVector(text),
    dimensions: E5_LARGE_USAGE_PROFILE.dimension,
    model: E5_LARGE_USAGE_PROFILE.modelId,
  }),
};
