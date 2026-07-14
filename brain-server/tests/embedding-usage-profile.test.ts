import { describe, expect, it } from 'vitest';
import {
  E5_LARGE_USAGE_PROFILE,
  embeddingProfileFingerprint,
  prepareEmbeddingText,
  resolveEmbeddingUsageProfile,
} from '../src/embedding/profiles.js';

describe('EmbeddingUsageProfile', () => {
  it('pins the Candidate v2 E5-Large artifact and dimensions', () => {
    const profile = resolveEmbeddingUsageProfile('Xenova/multilingual-e5-large');
    expect(profile).toMatchObject({
      modelRevision: 'a19b072cb4f0cc8bf98b4e46f90a787a61380979',
      dimension: 1024,
      maxTokens: 512,
      pooling: 'mean',
      normalize: true,
      usageProfileVersion: 'e5-large-v1',
    });
    expect(profile.modelSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('adds the query prefix exactly once', () => {
    expect(prepareEmbeddingText('holiday plans', 'query', E5_LARGE_USAGE_PROFILE)).toBe('query: holiday plans');
    expect(prepareEmbeddingText('query: holiday plans', 'query', E5_LARGE_USAGE_PROFILE)).toBe('query: holiday plans');
    expect(prepareEmbeddingText('passage: holiday plans', 'query', E5_LARGE_USAGE_PROFILE)).toBe('query: holiday plans');
  });

  it('adds the passage prefix exactly once', () => {
    expect(prepareEmbeddingText('holiday plans', 'passage', E5_LARGE_USAGE_PROFILE)).toBe('passage: holiday plans');
    expect(prepareEmbeddingText('passage: holiday plans', 'passage', E5_LARGE_USAGE_PROFILE)).toBe('passage: holiday plans');
    expect(prepareEmbeddingText('query: holiday plans', 'passage', E5_LARGE_USAGE_PROFILE)).toBe('passage: holiday plans');
  });

  it('rejects empty input', () => {
    expect(() => prepareEmbeddingText('   ', 'query', E5_LARGE_USAGE_PROFILE)).toThrow('non-empty');
  });

  it('keeps query and passage inputs distinct for the same content', () => {
    expect(prepareEmbeddingText('same text', 'query', E5_LARGE_USAGE_PROFILE))
      .not.toBe(prepareEmbeddingText('same text', 'passage', E5_LARGE_USAGE_PROFILE));
  });

  it('changes the index fingerprint when profile usage changes', () => {
    const changed = { ...E5_LARGE_USAGE_PROFILE, queryPrefix: 'query-v2: ' };
    expect(embeddingProfileFingerprint(changed)).not.toBe(embeddingProfileFingerprint(E5_LARGE_USAGE_PROFILE));
  });

  it('refuses an unpinned model instead of selecting latest', () => {
    expect(() => resolveEmbeddingUsageProfile('Xenova/unknown-model')).toThrow('No pinned');
  });
});
