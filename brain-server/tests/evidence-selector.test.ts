import { describe, expect, it } from 'vitest';
import type { FusedRetrievalCandidate, FusionList } from '../src/retrieval/fusion.js';
import {
  buildEvidenceGroupKey,
  buildRerankerEvidenceSummary,
  detectEvidenceIntent,
  groupFusedEvidence,
  isolateRawEventChannels,
  queryAwareTemporalOptions,
  selectEvidenceSet,
} from '../src/retrieval/evidence-selector.js';

type Value = Record<string, any>;

function assertionValue(id: string, options: Record<string, any> = {}): Value {
  const state = options.state || 'current';
  const sourceEventIds = options.sourceEventIds || [`event-${id}`];
  const provenance = {
    evidence_kind: options.raw ? 'raw_event' : 'normalized_assertion',
    exact_value: options.exactValue || options.literalValue || id,
    state,
    state_key: options.stateKey || 'preference',
    source_event_ids: sourceEventIds,
    source_agent: options.agent === undefined ? 'Agent-A' : options.agent,
    document_id: options.documentId || 'document-1',
    ...(options.userId ? { user_id: options.userId } : {}),
    ...(options.transition ? { transition: options.transition } : {}),
    ...(options.rejectedConflicts ? { rejected_conflicts: options.rejectedConflicts } : {}),
    ...(options.provenance || {}),
  };
  return {
    id,
    assertion: {
      id,
      subject_id: options.subjectId || 'subject-1',
      predicate: options.predicate || 'relates_to',
      original_predicate: options.originalPredicate || options.predicate || 'preference',
      literal_value: options.literalValue || options.exactValue || id,
      confidence: options.confidence ?? 0.9,
      source_span: options.quote || `Raw quote for ${id}`,
      provenance,
      valid_from: options.validFrom || '2026-01-01T00:00:00.000Z',
      ...(state === 'historical' ? { valid_until: '2026-02-01T00:00:00.000Z' } : {}),
      ...(state === 'invalidated' ? {
        valid_until: '2026-02-01T00:00:00.000Z',
        invalidated_at: '2026-02-01T00:00:00.000Z',
      } : {}),
    },
    subjectName: options.subjectName || 'Person',
    passage: options.passage || `passage: Fact ${id}\nSource: ${options.quote || `Raw quote for ${id}`}`,
  };
}

function fused(id: string, value: Value, rank = 1, source: any = 'assertion_vector'): FusedRetrievalCandidate<Value> {
  return {
    id,
    kind: 'assertion',
    value,
    sources: [{ source, rawRank: rank, rawDistance: null, normalizedScore: 1, weight: 1 }],
    fusedScore: 1 / (60 + rank),
    fusedRank: rank,
  };
}

function groups(values: Value[]) {
  return groupFusedEvidence(values.map((value, index) => fused(value.id, value, index + 1)), { rrfK: 60 });
}

describe('Candidate v3.1 evidence fusion and selection', () => {
  it('1. allows raw events only in the dedicated fallback channel', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const lists: FusionList<Value>[] = [
      { source: 'raw_event_fallback', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ];
    expect(isolateRawEventChannels(lists).lists[0].items).toHaveLength(1);
  });

  it('2. excludes raw events from assertion FTS', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const result = isolateRawEventChannels([
      { source: 'assertion_fts', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ]);
    expect(result.lists[0].items).toHaveLength(0);
  });

  it('3. excludes raw events from assertion vectors', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const result = isolateRawEventChannels([
      { source: 'assertion_vector', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ]);
    expect(result.lists[0].items).toHaveLength(0);
  });

  it('4. prevents one raw event from receiving three channel contributions', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const isolated = isolateRawEventChannels([
      { source: 'assertion_vector', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
      { source: 'assertion_fts', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
      { source: 'raw_event_fallback', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ]);
    expect(isolated.lists.flatMap((list) => list.items)).toHaveLength(1);
    expect(isolated.audit[0].eligibleChannels).toEqual(['raw_event_fallback']);
  });

  it('5. groups a normalized assertion and raw event by source event ID', () => {
    const normalized = assertionValue('a-1', { sourceEventIds: ['event-shared'] });
    const raw = assertionValue('raw-1', { raw: true, sourceEventIds: ['event-shared'] });
    const grouped = groups([normalized, raw]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].retrievalSources.filter((source) => source.source === 'assertion_vector')).toHaveLength(1);
  });

  it('6. preserves both normalized fact and raw quote in one group', () => {
    const normalized = assertionValue('a-1', { sourceEventIds: ['event-shared'], exactValue: 'blue' });
    const raw = assertionValue('raw-1', { raw: true, sourceEventIds: ['event-shared'], quote: 'The setting is blue.' });
    const [group] = groups([normalized, raw]);
    expect(group.normalizedAssertions).toHaveLength(1);
    expect(group.rawEvents).toHaveLength(1);
    expect(buildRerankerEvidenceSummary(group)).toContain('The setting is blue.');
  });

  it('7. preserves different states instead of flattening them', () => {
    const current = assertionValue('a-current', { sourceEventIds: ['event-shared'], state: 'current' });
    const historical = assertionValue('a-history', { sourceEventIds: ['event-shared'], state: 'historical' });
    expect(groups([current, historical])[0].states.sort()).toEqual(['current', 'historical']);
  });

  it('8. keeps independent agents separate when event IDs are unavailable', () => {
    const first = assertionValue('a-1', { sourceEventIds: [], agent: 'Agent-A', quote: 'same text' });
    const second = assertionValue('a-2', { sourceEventIds: [], agent: 'Agent-B', quote: 'same text' });
    expect(groups([first, second])).toHaveLength(2);
  });

  it('9. never groups different users that reuse an event ID', () => {
    const first = assertionValue('a-1', { sourceEventIds: ['event-1'], userId: 'user-1' });
    const second = assertionValue('a-2', { sourceEventIds: ['event-1'], userId: 'user-2' });
    expect(groups([first, second])).toHaveLength(2);
  });

  it('10. creates a stable fallback key without source event IDs', () => {
    const value = assertionValue('a-1', { sourceEventIds: [], quote: 'stable span' });
    expect(buildEvidenceGroupKey(fused('a-1', value))).toBe(buildEvidenceGroupKey(fused('a-1', value)));
  });

  it('11. includes exact values in reranker summaries', () => {
    expect(buildRerankerEvidenceSummary(groups([assertionValue('a-1', { exactValue: 'exact-blue' })])[0]))
      .toContain('EXACT_VALUE: exact-blue');
  });

  it('12. includes memory state in reranker summaries', () => {
    expect(buildRerankerEvidenceSummary(groups([assertionValue('a-1', { state: 'historical' })])[0]))
      .toContain('STATE: historical');
  });

  it('13. includes transitions in reranker summaries', () => {
    const transition = { kind: 'updated', from_value: 'red', to_value: 'blue' };
    expect(buildRerankerEvidenceSummary(groups([assertionValue('a-1', { transition })])[0]))
      .toContain('TRANSITION: red -> blue');
  });

  it('14. includes rejected conflicts in reranker summaries', () => {
    const rejectedConflicts = [{ value: 'red', confidence: 0.2, state: 'invalidated' }];
    expect(buildRerankerEvidenceSummary(groups([assertionValue('a-1', { rejectedConflicts })])[0]))
      .toContain('REJECTED_CONFLICTS: red');
  });

  it('15. includes source agents in reranker summaries', () => {
    expect(buildRerankerEvidenceSummary(groups([assertionValue('a-1', { agent: 'Agent-Z' })])[0]))
      .toContain('SOURCE_AGENTS: Agent-Z');
  });

  it('16. bounds each reranker summary to 600 characters', () => {
    const summary = buildRerankerEvidenceSummary(groups([
      assertionValue('a-1', { quote: 'q'.repeat(2_000), passage: `passage: ${'x'.repeat(2_000)}` }),
    ])[0]);
    expect(summary.length).toBeLessThanOrEqual(600);
  });

  it('17. selects current, historical, and transition evidence for evolution queries', () => {
    const transition = { kind: 'updated', from_value: 'red', to_value: 'blue' };
    const ranked = groups([
      assertionValue('current', { state: 'current', stateKey: 'color' }),
      assertionValue('history', { state: 'historical', stateKey: 'color' }),
      assertionValue('transition', { state: 'current', stateKey: 'color', transition }),
    ]);
    const selected = selectEvidenceSet({ query: 'How has the color changed?', rankedGroups: ranked, limit: 10 });
    expect(selected.selected.flatMap((group) => group.states)).toContain('current');
    expect(selected.selected.flatMap((group) => group.states)).toContain('historical');
    expect(selected.selected.flatMap((group) => group.transitions)).toHaveLength(1);
  });

  it('18. selects current, invalidated, and correction evidence for conflict queries', () => {
    const correction = { kind: 'corrected', from_value: 'wrong', to_value: 'right' };
    const ranked = groups([
      assertionValue('current', { state: 'current', stateKey: 'answer', confidence: 0.95 }),
      assertionValue('invalid', { state: 'invalidated', stateKey: 'answer', confidence: 0.2 }),
      assertionValue('correction', { state: 'current', stateKey: 'answer', transition: correction }),
    ]);
    const selected = selectEvidenceSet({ query: 'Resolve the conflict and identify the corrected value', rankedGroups: ranked, limit: 10 });
    expect(selected.selected.flatMap((group) => group.states)).toContain('invalidated');
    expect(selected.selected.flatMap((group) => group.transitions)[0]).toMatchObject({ kind: 'corrected' });
  });

  it('19. preserves multiple relevant source agents for provenance queries', () => {
    const ranked = groups([
      assertionValue('a-1', { agent: 'Agent-A' }),
      assertionValue('a-2', { agent: 'Agent-B' }),
      assertionValue('a-3', { agent: 'Agent-C' }),
    ]);
    const selected = selectEvidenceSet({ query: 'Which agents shared these memories?', rankedGroups: ranked, limit: 3 });
    expect(new Set(selected.selected.flatMap((group) => group.sourceAgents)).size).toBe(3);
  });

  it('20. covers goal, constraint, options, reversible step, and risk for decisions', () => {
    const ranked = groups([
      assertionValue('goal', { stateKey: 'goal', predicate: 'has_goal' }),
      assertionValue('constraint', { stateKey: 'constraint', predicate: 'constraint' }),
      assertionValue('option-a', { stateKey: 'option a', predicate: 'option' }),
      assertionValue('option-b', { stateKey: 'option b', predicate: 'option' }),
      assertionValue('reversible', { stateKey: 'reversible step', predicate: 'reversible_step' }),
      assertionValue('risk', { stateKey: 'risk', predicate: 'risk' }),
    ]);
    const selected = selectEvidenceSet({ query: 'Compare the options and recommend a decision', rankedGroups: ranked, limit: 10 });
    expect(selected.selected).toHaveLength(6);
  });

  it('21. never exceeds the fixed Top-10 budget', () => {
    const ranked = groups(Array.from({ length: 20 }, (_, index) => assertionValue(`a-${index}`)));
    expect(selectEvidenceSet({ query: 'general query', rankedGroups: ranked, limit: 10 }).selected).toHaveLength(10);
  });

  it('22. emits no duplicate evidence groups', () => {
    const ranked = groups([
      assertionValue('a-1', { sourceEventIds: ['same'] }),
      assertionValue('raw-1', { raw: true, sourceEventIds: ['same'] }),
    ]);
    const selected = selectEvidenceSet({ query: 'general query', rankedGroups: ranked, limit: 10 });
    expect(new Set(selected.selected.map((group) => group.groupId)).size).toBe(selected.selected.length);
  });

  it('23. keeps invalidated evidence out of ordinary current queries', () => {
    const ranked = groups([
      assertionValue('current', { state: 'current' }),
      assertionValue('invalid', { state: 'invalidated' }),
    ]);
    const selected = selectEvidenceSet({ query: 'What is the current value?', rankedGroups: ranked, limit: 10 });
    expect(selected.selected.flatMap((group) => group.states)).not.toContain('invalidated');
  });

  it('24. preserves provenance fields through grouping', () => {
    const [group] = groups([assertionValue('a-1', { sourceEventIds: ['event-x'], agent: 'Agent-X' })]);
    expect(group.sourceEventIds).toEqual(['event-x']);
    expect(group.sourceAgents).toEqual(['Agent-X']);
  });

  it('25. retains zero agent-isolation errors by not inventing agents', () => {
    const [group] = groups([assertionValue('a-1', { agent: '' })]);
    expect(group.sourceAgents).toEqual([]);
  });

  it('26. groups raw representations so they cannot crowd forgetting evidence', () => {
    const ranked = groups([
      assertionValue('normalized', { sourceEventIds: ['event-1'] }),
      assertionValue('raw', { raw: true, sourceEventIds: ['event-1'] }),
      assertionValue('salient', { sourceEventIds: ['event-2'], stateKey: 'salient memory' }),
    ]);
    expect(ranked).toHaveLength(2);
  });

  it('27. does not merge identical event IDs from different documents', () => {
    const first = assertionValue('a-1', { sourceEventIds: ['event-1'], documentId: 'scenario-a' });
    const second = assertionValue('a-2', { sourceEventIds: ['event-1'], documentId: 'scenario-b' });
    expect(groups([first, second])).toHaveLength(2);
  });

  it('28. keeps user scope in fallback group keys', () => {
    const first = assertionValue('a-1', { sourceEventIds: [], userId: 'user-a', quote: 'same' });
    const second = assertionValue('a-2', { sourceEventIds: [], userId: 'user-b', quote: 'same' });
    expect(buildEvidenceGroupKey(fused('a-1', first))).not.toBe(buildEvidenceGroupKey(fused('a-2', second)));
  });

  it('29. records a reason for every selected and unselected group', () => {
    const ranked = groups(Array.from({ length: 4 }, (_, index) => assertionValue(`a-${index}`)));
    const result = selectEvidenceSet({ query: 'general query', rankedGroups: ranked, limit: 2 });
    expect(result.trace).toHaveLength(4);
    expect(result.trace.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('30. detects query-aware historical eligibility without exposing benchmark fields', () => {
    expect(detectEvidenceIntent('What changed before the latest update?').temporal).toBe(true);
    expect(queryAwareTemporalOptions('Resolve the corrected conflict', {})).toEqual({ includeHistorical: true });
    expect(queryAwareTemporalOptions('What is the current value?', {})).toEqual({});
  });
});
