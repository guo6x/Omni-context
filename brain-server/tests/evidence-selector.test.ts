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
  it('1. allows raw events in a dedicated fallback channel', () => {
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

  it('3. moves semantically retrieved raw events into a dedicated vector channel', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const result = isolateRawEventChannels([
      { source: 'assertion_vector', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ]);
    expect(result.lists.find((list) => list.source === 'assertion_vector')?.items).toHaveLength(0);
    expect(result.lists.find((list) => list.source === 'raw_event_vector')?.items).toHaveLength(1);
  });

  it('4. prevents one raw event from receiving three channel contributions', () => {
    const raw = assertionValue('raw-1', { raw: true });
    const isolated = isolateRawEventChannels([
      { source: 'assertion_vector', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
      { source: 'assertion_fts', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
      { source: 'raw_event_fallback', weight: 1, items: [{ id: raw.id, kind: 'assertion', value: raw }] },
    ]);
    expect(isolated.lists.flatMap((list) => list.items)).toHaveLength(1);
    expect(isolated.audit[0].eligibleChannels).toEqual(['raw_event_vector']);
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

  it('31. temporal anchor ignores irrelevant first current and selects complementary state key', () => {
    const transition = { kind: 'updated', from_value: 'red', to_value: 'blue' };
    const ranked = groups([
      assertionValue('irrelevant-current', { state: 'current', stateKey: 'support_note', predicate: 'mentions', literalValue: 'irrelevant' }),
      assertionValue('color-current', { state: 'current', stateKey: 'color', predicate: 'has_color', literalValue: 'blue' }),
      assertionValue('color-history', { state: 'historical', stateKey: 'color', predicate: 'has_color', literalValue: 'red' }),
      assertionValue('color-transition', { state: 'current', stateKey: 'color', predicate: 'has_color', literalValue: 'blue', transition }),
    ]);
    const result = selectEvidenceSet({ query: 'How has the color changed?', rankedGroups: ranked, limit: 10 });
    const selectedKeys = result.selected.flatMap((group) => group.stateKeys);
    expect(selectedKeys).toContain('color');
    expect(result.selected.flatMap((group) => group.states)).toContain('current');
    expect(result.selected.flatMap((group) => group.states)).toContain('historical');
    expect(result.selected.flatMap((group) => group.transitions)).toHaveLength(1);
    const irrelevantTrace = result.trace.find((entry) => entry.groupId === ranked[0].groupId);
    const temporalReasons = ['temporal_current_fact', 'complementary_historical_state', 'complementary_invalidated_state', 'state_transition', 'correction_transition'];
    expect(temporalReasons).not.toContain(irrelevantTrace?.reason);
  });

  it('32. temporal result contains current, historical, and transition', () => {
    const transition = { kind: 'updated', from_value: 'v1', to_value: 'v2' };
    const ranked = groups([
      assertionValue('cur', { state: 'current', stateKey: 'setting', predicate: 'has_setting', literalValue: 'v2' }),
      assertionValue('hist', { state: 'historical', stateKey: 'setting', predicate: 'has_setting', literalValue: 'v1' }),
      assertionValue('trans', { state: 'current', stateKey: 'setting', predicate: 'has_setting', literalValue: 'v2', transition }),
    ]);
    const selected = selectEvidenceSet({ query: 'How did the setting change over time?', rankedGroups: ranked, limit: 10 });
    const states = selected.selected.flatMap((group) => group.states);
    expect(states).toContain('current');
    expect(states).toContain('historical');
    expect(selected.selected.flatMap((group) => group.transitions)).toHaveLength(1);
  });

  it('33. cross-agent provenance prefers high-relevance core fact over low-relevance new agent', () => {
    const ranked = groups([
      assertionValue('core', { agent: 'Agent-A', stateKey: 'budget', predicate: 'has_budget', literalValue: 'budget' }),
      assertionValue('irrelevant-b', { agent: 'Agent-B', stateKey: 'misc_note', predicate: 'mentions', literalValue: 'weather' }),
      assertionValue('irrelevant-c', { agent: 'Agent-C', stateKey: 'misc_note', predicate: 'mentions', literalValue: 'weather' }),
    ]);
    const result = selectEvidenceSet({ query: 'What is the budget provenance and source?', rankedGroups: ranked, limit: 3 });
    const coreTrace = result.trace.find((entry) => entry.groupId === ranked[0].groupId);
    expect(coreTrace?.selected).toBe(true);
    const agentDiversityReasons = result.trace.filter((entry) => entry.reason === 'distinct_relevant_source_agent');
    expect(agentDiversityReasons.every((entry) => entry.groupId !== ranked[1].groupId && entry.groupId !== ranked[2].groupId)).toBe(true);
  });

  it('34. agent diversity only among relevant candidates', () => {
    const ranked = groups([
      assertionValue('rel-a', { agent: 'Agent-A', stateKey: 'project', predicate: 'has_project', literalValue: 'project' }),
      assertionValue('rel-b', { agent: 'Agent-B', stateKey: 'project', predicate: 'has_project', literalValue: 'project' }),
      assertionValue('irrel-c', { agent: 'Agent-C', stateKey: 'note', predicate: 'mentions', literalValue: 'weather' }),
      assertionValue('irrel-d', { agent: 'Agent-D', stateKey: 'note', predicate: 'mentions', literalValue: 'weather' }),
      assertionValue('irrel-e', { agent: 'Agent-E', stateKey: 'note', predicate: 'mentions', literalValue: 'weather' }),
    ]);
    const result = selectEvidenceSet({ query: 'What is the project source and provenance?', rankedGroups: ranked, limit: 5 });
    const agentDiversityGroupIds = result.trace
      .filter((entry) => entry.reason === 'distinct_relevant_source_agent')
      .map((entry) => entry.groupId);
    expect(agentDiversityGroupIds).toContain(ranked[1].groupId);
    expect(agentDiversityGroupIds).not.toContain(ranked[2].groupId);
    expect(agentDiversityGroupIds).not.toContain(ranked[3].groupId);
    expect(agentDiversityGroupIds).not.toContain(ranked[4].groupId);
  });

  it('35. same state_key and predicate with different sourceEventId does not occupy multiple diversity slots', () => {
    const ranked = groups([
      assertionValue('note-1', { stateKey: 'preference', predicate: 'relates_to', sourceEventIds: ['event-1'] }),
      assertionValue('note-2', { stateKey: 'preference', predicate: 'relates_to', sourceEventIds: ['event-2'] }),
      assertionValue('note-3', { stateKey: 'preference', predicate: 'relates_to', sourceEventIds: ['event-3'] }),
      assertionValue('note-4', { stateKey: 'preference', predicate: 'relates_to', sourceEventIds: ['event-4'] }),
    ]);
    const result = selectEvidenceSet({ query: 'general query', rankedGroups: ranked, limit: 4 });
    const diversityCount = result.trace.filter((entry) => entry.reason === 'diverse_evidence_dimension').length;
    expect(diversityCount).toBe(0);
  });

  it('36. conflict test still passes with anchor-based selection', () => {
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

  it('37. forgetting evidence is preserved with invalidated state', () => {
    const ranked = groups([
      assertionValue('valid', { state: 'current', stateKey: 'memory' }),
      assertionValue('forgotten', { state: 'invalidated', stateKey: 'memory' }),
    ]);
    const selected = selectEvidenceSet({
      query: 'What memory was invalidated or forgotten?',
      rankedGroups: ranked,
      limit: 10,
      includeInvalidated: true,
    });
    expect(selected.selected.flatMap((group) => group.states)).toContain('invalidated');
    expect(selected.selected.flatMap((group) => group.states)).toContain('current');
  });

  it('38. top-10 budget is strictly maintained with mixed evidence', () => {
    const transition = { kind: 'updated', from_value: 'a', to_value: 'b' };
    const ranked = groups([
      assertionValue('c1', { stateKey: 'k1', agent: 'Agent-A' }),
      assertionValue('c2', { stateKey: 'k2', agent: 'Agent-B' }),
      assertionValue('c3', { state: 'historical', stateKey: 'k1' }),
      assertionValue('c4', { state: 'current', stateKey: 'k1', transition }),
      assertionValue('c5', { stateKey: 'k3' }),
      assertionValue('c6', { stateKey: 'k4' }),
      assertionValue('c7', { stateKey: 'k5' }),
      assertionValue('c8', { stateKey: 'k6' }),
      assertionValue('c9', { stateKey: 'k7' }),
      assertionValue('c10', { stateKey: 'k8' }),
      assertionValue('c11', { stateKey: 'k9' }),
      assertionValue('c12', { stateKey: 'k10' }),
    ]);
    const result = selectEvidenceSet({ query: 'How has k1 changed? Provenance source.', rankedGroups: ranked, limit: 10 });
    expect(result.selected).toHaveLength(10);
  });

  it('39. no duplicate groupId in selected set', () => {
    const ranked = groups([
      assertionValue('a-1', { stateKey: 'k1', agent: 'Agent-A' }),
      assertionValue('a-2', { stateKey: 'k1', agent: 'Agent-B' }),
      assertionValue('a-3', { stateKey: 'k2', agent: 'Agent-C' }),
    ]);
    const result = selectEvidenceSet({ query: 'provenance source', rankedGroups: ranked, limit: 10 });
    const ids = result.selected.map((group) => group.groupId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('40. does not cross user or scope boundaries in selection', () => {
    const ranked = groups([
      assertionValue('u1-a', { stateKey: 'k1', userId: 'user-1', agent: 'Agent-A' }),
      assertionValue('u2-a', { stateKey: 'k1', userId: 'user-2', agent: 'Agent-B' }),
    ]);
    const result = selectEvidenceSet({ query: 'provenance source', rankedGroups: ranked, limit: 10 });
    expect(result.selected).toHaveLength(2);
    expect(new Set(result.selected.map((group) => group.groupId)).size).toBe(2);
  });

  it('41. query-relevant core dimensions fill before repetitive support notes', () => {
    const ranked = groups([
      assertionValue('support', { stateKey: 'support_note_8', literalValue: 'project planning support note', quote: 'A repetitive project planning support note.' }),
      assertionValue('goal', { stateKey: 'goal', predicate: 'has_goal', literalValue: 'project goal' }),
      assertionValue('budget', { stateKey: 'budget', predicate: 'has_budget', literalValue: 'project budget' }),
      assertionValue('time', { stateKey: 'weekly_time', predicate: 'has_time', literalValue: 'project time' }),
      assertionValue('preference', { stateKey: 'preference', predicate: 'prefers', literalValue: 'project preference' }),
      assertionValue('boundary', { stateKey: 'boundary', predicate: 'has_boundary', literalValue: 'project boundary' }),
    ]);
    const result = selectEvidenceSet({
      query: 'Recommend project planning using the goal, budget, time, preference, and boundary.',
      rankedGroups: ranked,
      limit: 5,
    });
    expect(result.selected.flatMap((group) => group.stateKeys)).toEqual(expect.arrayContaining([
      'goal', 'budget', 'weekly_time', 'preference', 'boundary',
    ]));
    expect(result.selected.flatMap((group) => group.stateKeys)).not.toContain('support_note_8');
  });

  it('42. temporal selection preserves every complementary state and transition within budget', () => {
    const ranked = groups([
      ...Array.from({ length: 7 }, (_, index) => assertionValue(`support-${index}`, {
        stateKey: `support_note_${index}`,
        literalValue: `phase support note ${index}`,
      })),
      assertionValue('current', { state: 'current', stateKey: 'phase', literalValue: 'v4', transition: { from_value: 'v3', to_value: 'v4' } }),
      assertionValue('history-3', { state: 'historical', stateKey: 'phase', literalValue: 'v3', transition: { from_value: 'v2', to_value: 'v3' } }),
      assertionValue('history-2', { state: 'historical', stateKey: 'phase', literalValue: 'v2', transition: { from_value: 'v1', to_value: 'v2' } }),
      assertionValue('history-1', { state: 'historical', stateKey: 'phase', literalValue: 'v1' }),
    ]);
    const result = selectEvidenceSet({
      query: 'What is the current phase, which earlier states were historical, and what transitions occurred?',
      rankedGroups: ranked,
      limit: 10,
    });
    const phaseGroups = result.selected.filter((group) => group.stateKeys.includes('phase'));
    expect(phaseGroups).toHaveLength(4);
    expect(phaseGroups.flatMap((group) => group.transitions)).toHaveLength(3);
    expect(result.selected.slice(0, 4).every((group) => group.stateKeys.includes('phase'))).toBe(true);
  });

  it('43. joins an assertion with missing event metadata to its unique raw quote anchor', () => {
    const quote = 'The exact original observation.';
    const normalized = assertionValue('normalized', { sourceEventIds: [], agent: '', quote });
    const raw = assertionValue('raw', { raw: true, sourceEventIds: ['event-anchor'], agent: 'Agent-A', quote });
    const grouped = groups([normalized, raw]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].normalizedAssertions).toHaveLength(1);
    expect(grouped[0].rawEvents).toHaveLength(1);
  });
});
