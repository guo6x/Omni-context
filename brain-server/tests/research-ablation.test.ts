import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { reciprocalRankFuse, type FusedRetrievalCandidate, type FusionList } from '../src/retrieval/fusion.js';
import { groupFusedEvidence, isolateRawEventChannels, selectEvidenceSet } from '../src/retrieval/evidence-selector.js';
import {
  applySourceAwareFusionAblation,
  buildEvidenceGroupsForAblation,
  loadResearchAblationConfig,
  researchAblationTraceStage,
  selectEvidenceForAblation,
} from '../src/retrieval/research-ablation.js';

type Value = Record<string, any>;

function value(id: string, options: { raw?: boolean; event?: string; stateKey?: string } = {}): Value {
  return {
    id,
    assertion: {
      id,
      subject_id: 'subject',
      predicate: 'relates_to',
      original_predicate: 'prefers',
      literal_value: id,
      source_span: `Quote ${id}`,
      provenance: {
        evidence_kind: options.raw ? 'raw_event' : 'normalized_assertion',
        source_event_ids: [options.event || `event-${id}`],
        source_agent: 'Agent-A',
        state: 'current',
        state_key: options.stateKey || 'preference',
      },
    },
    passage: `passage: Fact ${id}`,
  };
}

function candidate(id: string, item: Value, rank: number): FusedRetrievalCandidate<Value> {
  return {
    id,
    kind: 'assertion',
    value: item,
    sources: [{ source: 'assertion_vector', rawRank: rank, rawDistance: null, normalizedScore: 1, weight: 1 }],
    fusedScore: 1 / (60 + rank),
    fusedRank: rank,
  };
}

function rawLists(raw: Value): FusionList<Value>[] {
  return [
    { source: 'assertion_vector', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    { source: 'assertion_fts', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    { source: 'raw_event_fallback', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
  ];
}

describe('research-only strict component ablations', () => {
  it('keeps production default disabled and explicit', () => {
    expect(loadResearchAblationConfig({})).toEqual({ researchMode: false, ablation: 'none' });
  });

  it('rejects any ablation outside explicit research mode', () => {
    expect(() => loadResearchAblationConfig({ OMNI_ABLATION: 'selector_off' }))
      .toThrow('OMNI_ABLATION requires OMNI_RESEARCH_ABLATION_MODE=1');
  });

  it('rejects unknown research conditions', () => {
    expect(() => loadResearchAblationConfig({
      OMNI_RESEARCH_ABLATION_MODE: '1',
      OMNI_ABLATION: 'unknown',
    })).toThrow('Unsupported OMNI_ABLATION');
  });

  it('default source-aware path is byte-for-byte equivalent to the frozen helper', () => {
    const lists = rawLists(value('raw', { raw: true }));
    expect(applySourceAwareFusionAblation(lists, { researchMode: false, ablation: 'none' }))
      .toEqual(isolateRawEventChannels(lists));
  });

  it('source-aware fusion off changes only channel isolation and retains standard RRF', () => {
    const lists = rawLists(value('raw', { raw: true }));
    const routed = applySourceAwareFusionAblation(lists, {
      researchMode: true,
      ablation: 'source_aware_fusion_off',
    });
    const fused = reciprocalRankFuse(routed.lists, { rrfK: 60 });
    expect(routed.lists.flatMap((list) => list.items)).toHaveLength(3);
    expect(routed.audit).toEqual([]);
    expect(fused).toHaveLength(1);
    expect(fused[0].sources).toHaveLength(3);
  });

  it('default grouping is byte-for-byte equivalent to the frozen helper', () => {
    const fused = [candidate('a', value('a', { event: 'same' }), 1), candidate('b', value('b', { event: 'same' }), 2)];
    expect(buildEvidenceGroupsForAblation(fused, { rrfK: 60 }, { researchMode: false, ablation: 'none' }))
      .toEqual(groupFusedEvidence(fused, { rrfK: 60 }));
  });

  it('grouping off makes every fused candidate a standalone group while preserving ranks', () => {
    const fused = [candidate('a', value('a', { event: 'same' }), 1), candidate('b', value('b', { event: 'same' }), 2)];
    const grouped = buildEvidenceGroupsForAblation(fused, { rrfK: 60 }, {
      researchMode: true,
      ablation: 'grouping_off',
    });
    expect(grouped).toHaveLength(2);
    expect(grouped.map((group) => group.members.length)).toEqual([1, 1]);
    expect(grouped.map((group) => group.rrfRank)).toEqual([1, 2]);
  });

  it('default selector is byte-for-byte equivalent to the frozen helper', () => {
    const rankedGroups = groupFusedEvidence([
      candidate('a', value('a', { stateKey: 'goal' }), 1),
      candidate('b', value('b', { stateKey: 'risk' }), 2),
    ], { rrfK: 60 });
    const input = { query: 'Compare goal and risk', rankedGroups, limit: 1 };
    expect(selectEvidenceForAblation(input, { researchMode: false, ablation: 'none' }))
      .toEqual(selectEvidenceSet(input));
  });

  it('selector off uses pre-selector rank only and keeps the fixed Top-10 schema', () => {
    const rankedGroups = groupFusedEvidence(
      Array.from({ length: 14 }, (_, index) => candidate(`a-${index}`, value(`a-${index}`), index + 1)),
      { rrfK: 60 },
    );
    const result = selectEvidenceForAblation(
      { query: 'general query', rankedGroups, limit: 10 },
      { researchMode: true, ablation: 'selector_off' },
    );
    expect(result.selected).toHaveLength(10);
    expect(result.selected.map((group) => group.groupId)).toEqual(rankedGroups.slice(0, 10).map((group) => group.groupId));
    expect(Object.keys(result)).toEqual(['selected', 'intent', 'trace']);
    expect(result.trace[0].reason).toBe('ablation_selector_off_rank_only');
  });

  it('records the active condition in trace metadata', () => {
    expect(researchAblationTraceStage({ researchMode: true, ablation: 'grouping_off' }))
      .toEqual([{ id: 'ablation:grouping_off', rank: 1, evidence_kind: 'research' }]);
  });

  it('contains no benchmark scenario identifier or answer-key dependency in product ablation logic', async () => {
    const source = await readFile(new URL('../src/retrieval/research-ablation.ts', import.meta.url), 'utf8');
    expect(source.toLowerCase()).not.toContain('scenario_id');
    expect(source.toLowerCase()).not.toMatch(/\bgold\b/);
  });
});
