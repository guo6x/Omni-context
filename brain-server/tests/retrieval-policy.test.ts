import { describe, expect, it, vi } from 'vitest';
import { collectGraphCandidates, memoryCandidateScore, rankMemoryCandidates } from '../src/mcp-retrieval.js';
import { assertEvaluationEmbeddingReady, DEFAULT_RETRIEVAL_CONFIG, loadRetrievalConfig, retrievalConfigHash } from '../src/retrieval/config.js';

describe('retrieval policy', () => {
  it('expands the configured graph seeds and fuses duplicate nodes', async () => {
    const getGraphNeighborhood = vi.fn(async (id: string) => ({
      nodes: [
        { id, name: id, type: 'concept' as const, description: '', created_at: '', updated_at: '', last_accessed: '', access_count: 0 },
        { id: 'shared', name: 'shared', type: 'concept' as const, description: '', created_at: '', updated_at: '', last_accessed: '', access_count: 0 },
      ],
      edges: [],
    }));
    const graph = await collectGraphCandidates(
      { getGraphNeighborhood },
      [{ id: 'seed-1' }, { id: 'seed-2' }, { id: 'seed-3' }, { id: 'seed-4' }],
      { ...DEFAULT_RETRIEVAL_CONFIG, graphSeedCount: 3, graphDepth: 2 },
    );
    expect(getGraphNeighborhood).toHaveBeenCalledTimes(3);
    expect(getGraphNeighborhood).toHaveBeenCalledWith('seed-1', 2, false);
    expect(graph.nodes.map((node) => node.id)).toEqual(['seed-1', 'shared', 'seed-2', 'seed-3']);
  });
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

  it('includes the bounded raw-event weight in a deterministic config hash', () => {
    const baseline = retrievalConfigHash({ ...DEFAULT_RETRIEVAL_CONFIG });
    const changed = retrievalConfigHash({ ...DEFAULT_RETRIEVAL_CONFIG, rawEventFallbackWeight: 0.8 });
    expect(baseline).toMatch(/^[a-f0-9]{64}$/);
    expect(changed).not.toBe(baseline);
  });
});
