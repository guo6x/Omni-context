import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { reciprocalRankFuse, type FusionItem, type FusionList } from '../src/retrieval/fusion.js';
import {
  applySourceAwareFusionAblation,
  buildEvidenceGroupsForAblation,
  selectEvidenceForAblation,
  type ResearchAblation,
  type ResearchAblationConfig,
} from '../src/retrieval/research-ablation.js';

type FixtureValue = Record<string, any>;

const RRF_K = 60;
const CANDIDATE_LIMIT = 40;
const FINAL_CONTEXT_LIMIT = 20;
const ANSWER_LIMIT = 10;
const REQUIRED_SLOTS = ['goal', 'budget', 'time', 'preference', 'boundary', 'temporal', 'conflict', 'provenance'];

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertion(id: string, options: Record<string, any> = {}): FixtureValue {
  const state = options.state || 'current';
  const sourceEventIds = options.sourceEventIds || [`event-${id}`];
  return {
    id,
    assertion: {
      id,
      subject_id: options.subjectId || 'person-alex',
      predicate: options.predicate || 'relates_to',
      original_predicate: options.originalPredicate || options.predicate || 'relates_to',
      literal_value: options.literalValue || id,
      confidence: options.confidence ?? 0.9,
      source_span: options.quote || `Synthetic observation for ${id}.`,
      valid_from: options.validFrom || '2026-01-01T00:00:00.000Z',
      ...(state === 'historical' ? { valid_until: '2026-02-01T00:00:00.000Z' } : {}),
      ...(state === 'invalidated' ? {
        valid_until: '2026-02-01T00:00:00.000Z',
        invalidated_at: '2026-02-01T00:00:00.000Z',
      } : {}),
      provenance: {
        evidence_kind: options.raw ? 'raw_event' : 'normalized_assertion',
        source_event_ids: sourceEventIds,
        source_agent: options.agent || 'Agent-A',
        document_id: 'synthetic-ablation-fixture',
        state,
        state_key: options.stateKey || 'general',
        exact_value: options.literalValue || id,
        ...(options.transition ? { transition: options.transition } : {}),
        ...(options.rejectedConflicts ? { rejected_conflicts: options.rejectedConflicts } : {}),
      },
    },
    passage: `passage: ${options.fact || options.literalValue || id}\nSource: ${options.quote || `Synthetic observation for ${id}.`}`,
  };
}

function entity(id: string, description: string): FixtureValue {
  return { id, name: id, type: 'concept', description, metadata: { fixture: true } };
}

function item(value: FixtureValue, score?: number): FusionItem<FixtureValue> {
  return {
    id: value.id,
    kind: value.assertion ? 'assertion' : 'entity',
    value,
    ...(score === undefined ? {} : { score }),
  };
}

function fixtureLists(): FusionList<FixtureValue>[] {
  const sharedRaw = assertion('raw-preference', {
    raw: true,
    stateKey: 'preference',
    sourceEventIds: ['event-preference'],
    agent: 'Agent-B',
    literalValue: 'quiet workspace',
    quote: 'Alex said a quiet workspace helps concentration.',
  });
  const preference = assertion('preference-core', {
    stateKey: 'preference',
    sourceEventIds: ['event-preference'],
    agent: 'Agent-B',
    predicate: 'prefers',
    literalValue: 'quiet workspace',
  });
  const core = [
    assertion('goal-core', { stateKey: 'goal', predicate: 'has_goal', literalValue: 'finish the research draft', agent: 'Agent-A' }),
    assertion('budget-core', { stateKey: 'budget', predicate: 'has_budget', literalValue: '200 dollars', agent: 'Agent-C' }),
    assertion('time-core', { stateKey: 'time', predicate: 'has_time', literalValue: 'six hours weekly', agent: 'Agent-A' }),
    preference,
    assertion('boundary-core', { stateKey: 'boundary', predicate: 'has_boundary', literalValue: 'no weekend meetings', agent: 'Agent-D' }),
    assertion('phase-current', {
      stateKey: 'temporal', state: 'current', predicate: 'has_phase', literalValue: 'revision', agent: 'Agent-A',
      transition: { kind: 'updated', from_value: 'outline', to_value: 'revision' },
    }),
    assertion('phase-history', { stateKey: 'temporal', state: 'historical', predicate: 'has_phase', literalValue: 'outline', agent: 'Agent-A' }),
    assertion('conflict-current', {
      stateKey: 'conflict', state: 'current', predicate: 'uses_tool', literalValue: 'Tool Blue', agent: 'Agent-C',
      rejectedConflicts: [{ value: 'Tool Red', state: 'invalidated', confidence: 0.2 }],
    }),
    assertion('conflict-invalidated', { stateKey: 'conflict', state: 'invalidated', predicate: 'uses_tool', literalValue: 'Tool Red', confidence: 0.2, agent: 'Agent-D' }),
    assertion('provenance-a', { stateKey: 'provenance', predicate: 'confirmed_by', literalValue: 'Agent A confirmation', agent: 'Agent-A' }),
    assertion('provenance-b', { stateKey: 'provenance', predicate: 'confirmed_by', literalValue: 'Agent B confirmation', agent: 'Agent-B' }),
  ];
  const support = Array.from({ length: 12 }, (_, index) => assertion(`support-${index + 1}`, {
    stateKey: `support_note_${index + 1}`,
    predicate: 'mentions',
    literalValue: `generic support note ${index + 1}`,
    confidence: 0.45,
    agent: index % 2 ? 'Agent-C' : 'Agent-A',
    fact: `Generic support note ${index + 1}`,
  }));
  const navigation = [
    entity('graph-project', 'Duplicate graph navigation relation for the project.'),
    entity('graph-project-alias', 'Support-only graph relation with the same project neighborhood.'),
    entity('graph-agent', 'Agent navigation node.'),
  ];

  return [
    {
      source: 'entity_vector', weight: 0.8,
      items: navigation.map((value, index) => item(value, 0.95 - index * 0.02)),
    },
    {
      source: 'assertion_vector', weight: 1.2,
      items: [sharedRaw, ...support.slice(0, 8), ...core].map((value, index) => item(value, 1 - index * 0.015)),
    },
    {
      source: 'assertion_fts', weight: 0.9,
      items: [sharedRaw, ...support.slice(4), core[0], core[1], core[5], core[7], preference]
        .map((value, index) => item(value, 1 - index * 0.02)),
    },
    {
      source: 'graph', weight: 0.5,
      items: [navigation[0], navigation[1], navigation[0], navigation[2]].map((value, index) => item(value, 1 - index * 0.1)),
    },
    {
      source: 'subject_attachment', weight: 0.35,
      items: [sharedRaw, ...support.slice(0, 5), core[2], core[4], core[8]].map((value, index) => item(value)),
    },
    {
      source: 'raw_event_fallback', weight: 0.25,
      items: [sharedRaw].map((value) => item(value, 1)),
    },
  ];
}

function groupSlots(group: Record<string, any>): string[] {
  const slots = new Set<string>();
  for (const key of group.stateKeys || []) {
    const normalized = String(key).toLowerCase();
    if (REQUIRED_SLOTS.includes(normalized)) slots.add(normalized);
  }
  if ((group.sourceAgents || []).length > 1 || (group.stateKeys || []).includes('provenance')) slots.add('provenance');
  return [...slots].sort();
}

function snapshotGroup(group: Record<string, any>, rank: number): Record<string, any> {
  return {
    id: group.groupId,
    rank,
    rrf_rank: group.rrfRank,
    score: Number(group.combinedFusedScore.toFixed(8)),
    member_ids: group.members.map((member: Record<string, any>) => member.id),
    state_keys: group.stateKeys,
    states: group.states,
    source_agents: group.sourceAgents,
    sources: group.retrievalSources.map((source: Record<string, any>) => source.source),
    slots: groupSlots(group),
    support_noise: group.stateKeys.some((key: string) => key.startsWith('support_note_')),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function runCondition(ablation: ResearchAblation): Record<string, any> {
  const config: ResearchAblationConfig = {
    researchMode: ablation !== 'none',
    ablation,
  };
  const sourceLists = fixtureLists();
  const routed = applySourceAwareFusionAblation(sourceLists, config);
  const fused = reciprocalRankFuse(routed.lists, { rrfK: RRF_K }).slice(0, CANDIDATE_LIMIT);
  const groups = buildEvidenceGroupsForAblation(fused, { rrfK: RRF_K }, config)
    .map((group, index) => ({ ...group, rerankerRank: index + 1 }));
  const assertionGroups = groups.filter((group) => group.normalizedAssertions.length > 0 || group.rawEvents.length > 0);
  const selection = selectEvidenceForAblation({
    query: 'Compare the goal, budget, time, preference, boundary, temporal changes, conflicts, and source provenance.',
    rankedGroups: assertionGroups,
    limit: ANSWER_LIMIT,
    temporalMode: 'historical',
    includeInvalidated: true,
  }, config);
  const selectedIds = new Set(selection.selected.map((group) => group.groupId));
  const finalGroups = [
    ...selection.selected,
    ...assertionGroups.filter((group) => !selectedIds.has(group.groupId)),
  ].slice(0, FINAL_CONTEXT_LIMIT);
  const answerSlots = new Set(selection.selected.flatMap((group) => groupSlots(group)));
  const totalMembers = groups.reduce((sum, group) => sum + group.members.length, 0);
  const supportCount = (items: Array<Record<string, any>>) => items.filter((entry) => entry.support_noise).length;
  const candidatePool = fused.map((candidate, index) => ({
    id: candidate.id,
    kind: candidate.kind,
    rank: index + 1,
    score: Number(candidate.fusedScore.toFixed(8)),
    sources: candidate.sources.map((source) => source.source),
    evidence_kind: candidate.value.assertion?.provenance?.evidence_kind || 'entity',
    state_key: candidate.value.assertion?.provenance?.state_key || null,
    source_agent: candidate.value.assertion?.provenance?.source_agent || null,
    graph_noise: candidate.kind === 'entity',
    support_noise: String(candidate.value.assertion?.provenance?.state_key || '').startsWith('support_note_'),
  }));
  const groupSnapshots = groups.map((group, index) => snapshotGroup(group, index + 1));
  const final20 = finalGroups.map((group, index) => snapshotGroup(group, index + 1));
  const answerTop10 = selection.selected.map((group, index) => ({
    ...snapshotGroup(group, index + 1),
    selection_reason: selection.trace.find((entry) => entry.groupId === group.groupId)?.reason,
  }));
  return {
    condition: ablation === 'none' ? 'full_omni' : ablation,
    ablation,
    config,
    channel_audit: routed.audit,
    candidate_pool: candidatePool,
    evidence_groups: groupSnapshots,
    final_20: final20,
    answer_top_10: answerTop10,
    metrics: {
      candidate_count: candidatePool.length,
      group_count: groups.length,
      final_20_count: final20.length,
      answer_top_10_count: answerTop10.length,
      required_slots: REQUIRED_SLOTS,
      covered_slots: [...answerSlots].sort(),
      slot_coverage: ratio(answerSlots.size, REQUIRED_SLOTS.length),
      source_agents: [...new Set(answerTop10.flatMap((entry) => entry.source_agents))].sort(),
      duplicate_evidence_rate: ratio(totalMembers - groups.length, totalMembers),
      candidate_graph_noise_ratio: ratio(candidatePool.filter((entry) => entry.graph_noise).length, candidatePool.length),
      candidate_support_noise_ratio: ratio(candidatePool.filter((entry) => entry.support_noise).length, candidatePool.length),
      final_support_noise_ratio: ratio(supportCount(final20), final20.length),
      answer_support_noise_ratio: ratio(supportCount(answerTop10), answerTop10.length),
    },
  };
}

function parseOutput(argv: string[]): string {
  const index = argv.indexOf('--output');
  if (index !== -1 && argv[index + 1]) return path.resolve(argv[index + 1]);
  const assigned = argv.find((argument) => argument.startsWith('--output='));
  if (assigned) return path.resolve(assigned.slice('--output='.length));
  const positional = argv.find((argument) => !argument.startsWith('-'));
  if (positional) return path.resolve(positional);
  throw new Error('--output is required');
}

async function main(): Promise<void> {
  const outputDir = parseOutput(process.argv.slice(2));
  await mkdir(outputDir, { recursive: true });
  const conditions: ResearchAblation[] = ['none', 'selector_off', 'grouping_off', 'source_aware_fusion_off'];
  const results = conditions.map(runCondition);
  const signatures = Object.fromEntries(results.map((result) => [result.condition, sha256(JSON.stringify({
    candidate_pool: result.candidate_pool.map((entry: Record<string, any>) => entry.id),
    groups: result.evidence_groups.map((entry: Record<string, any>) => entry.member_ids),
    answer: result.answer_top_10.map((entry: Record<string, any>) => entry.id),
  }))]));
  const fullSignature = signatures.full_omni;
  const mechanismChanged = Object.fromEntries(Object.entries(signatures).map(([condition, signature]) => [
    condition,
    condition === 'full_omni' ? false : signature !== fullSignature,
  ]));
  if (Object.entries(mechanismChanged).some(([condition, changed]) => condition !== 'full_omni' && !changed)) {
    throw new Error(`One or more strict ablations did not change the synthetic mechanism: ${JSON.stringify(mechanismChanged)}`);
  }
  const report = {
    schema_version: 1,
    fixture_kind: 'synthetic_only',
    provider_calls: 0,
    answer_model_calls: 0,
    judge_model_calls: 0,
    fixed_limits: { candidate_pool: CANDIDATE_LIMIT, final_context: FINAL_CONTEXT_LIMIT, answer: ANSWER_LIMIT, rrf_k: RRF_K },
    fixture_coverage: [
      'duplicate_graph_relations', 'support_note_noise', 'current_historical_states',
      'conflict_invalidated_facts', 'multiple_source_agents', 'multiple_semantic_slots',
    ],
    signatures,
    mechanism_changed_from_full: mechanismChanged,
    results,
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const summary = {
    schema_version: 1,
    report_sha256: sha256(reportText),
    mechanism_changed_from_full: mechanismChanged,
    conditions: Object.fromEntries(results.map((result) => [result.condition, result.metrics])),
  };
  await writeFile(path.join(outputDir, 'strict-ablation-offline.json'), reportText);
  await writeFile(path.join(outputDir, 'strict-ablation-offline-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(
    path.join(outputDir, 'strict-ablation-snapshots.jsonl'),
    `${results.map((result) => JSON.stringify(result)).join('\n')}\n`,
  );
  process.stdout.write(`${JSON.stringify({ event: 'strict_ablation_fixture_complete', outputDir, summary })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'strict_ablation_fixture_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
