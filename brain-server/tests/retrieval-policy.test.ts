import { describe, expect, it } from 'vitest';
import { memoryCandidateScore, rankMemoryCandidates } from '../src/mcp-retrieval.js';
import { assertEvaluationEmbeddingReady, loadRetrievalConfig } from '../src/retrieval/config.js';

describe('retrieval policy', () => {
  it('does not apply decision type boosts to general retrieval', () => {
    const candidates = [
      { id: 'decision', type: 'decision', name: 'unrelated', description: '' },
      { id: 'memory', type: 'memory', name: 'release checklist', description: '' },
    ];
    expect(rankMemoryCandidates('release checklist', candidates)[0].id).toBe('memory');
  });

  it('applies decision type boosts only when requested', () => {
    const candidates = [
      { id: 'memory', type: 'memory', name: 'same', description: '' },
      { id: 'decision', type: 'decision', name: 'same', description: '' },
    ];
    expect(rankMemoryCandidates('same', candidates, { decisionMode: true })[0].id).toBe('decision');
  });

  it('penalizes stale and invalidated candidates outside historical mode', () => {
    const stale = { name: 'current plan', valid_until: '2024-01-01T00:00:00.000Z' };
    const current = memoryCandidateScore('current plan', stale, { now: new Date('2025-01-01') });
    const historical = memoryCandidateScore('current plan', stale, { historicalMode: true, now: new Date('2025-01-01') });
    expect(current).toBeLessThan(historical);
  });

  it('bounds invalid environment overrides', () => {
    const config = loadRetrievalConfig({ OMNI_RETRIEVAL_GRAPH_DEPTH: '99', OMNI_RETRIEVAL_GRAPH_SEEDS: '5' });
    expect(config.graphDepth).toBe(2);
    expect(config.graphSeedCount).toBe(5);
  });

  it('forbids hash fallback only in explicit evaluation mode', () => {
    expect(() => assertEvaluationEmbeddingReady('hash-fallback', false)).not.toThrow();
    expect(() => assertEvaluationEmbeddingReady('hash-fallback', true)).toThrow(/EVALUATION_EMBEDDING_UNAVAILABLE/);
  });
});
