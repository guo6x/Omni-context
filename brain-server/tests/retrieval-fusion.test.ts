import { describe, expect, it } from 'vitest';
import { reciprocalRankFuse } from '../src/retrieval/fusion.js';

describe('auditable reciprocal-rank fusion', () => {
  it('deduplicates the same assertion while preserving every source path', () => {
    const fact = { text: 'Caroline plans to study counseling' };
    const fused = reciprocalRankFuse([
      { source: 'assertion_vector', weight: 1.4, items: [
        { id: 'a1', kind: 'assertion', value: fact, distance: 0.1 },
      ] },
      { source: 'FTS', weight: 1.1, items: [
        { id: 'a1', kind: 'assertion', value: fact, score: 0.8 },
      ] },
      { source: 'raw_event_fallback', weight: 0.9, items: [
        { id: 'a1', kind: 'assertion', value: fact, score: 0.7 },
      ] },
    ], { rrfK: 60 });

    expect(fused).toHaveLength(1);
    expect(fused[0].sources.map((item) => item.source)).toEqual([
      'assertion_vector', 'FTS', 'raw_event_fallback',
    ]);
    expect(fused[0]).toMatchObject({ fusedRank: 1, kind: 'assertion' });
    expect(fused[0].sources[0]).toMatchObject({ rawRank: 1, rawDistance: 0.1 });
  });

  it('uses explicit source weights without allowing unlimited top-k behavior', () => {
    const fused = reciprocalRankFuse([
      { source: 'entity_vector', weight: 0.8, items: [
        { id: 'e1', kind: 'entity', value: 'entity' },
      ] },
      { source: 'assertion_vector', weight: 1.4, items: [
        { id: 'a1', kind: 'assertion', value: 'assertion' },
      ] },
    ], { rrfK: 60 });
    expect(fused.map((item) => item.id)).toEqual(['a1', 'e1']);
  });

  it('rejects invalid fusion configuration', () => {
    expect(() => reciprocalRankFuse([], { rrfK: 0 })).toThrow('rrfK');
  });
});
