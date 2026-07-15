import { createHash } from 'crypto';
import type {
  FusedRetrievalCandidate,
  FusionList,
  RetrievalSource,
  RetrievalSourceTrace,
} from './fusion.js';

type UnknownRecord = Record<string, any>;

export const EVIDENCE_GROUP_VERSION = 'evidence-group-v1';
export const EVIDENCE_SELECTOR_VERSION = 'evidence-selector-v1';
export const RERANKER_SUMMARY_VERSION = 'reranker-evidence-summary-v1';

export interface RawEventChannelAudit {
  candidateId: string;
  evidenceKind: 'raw_event';
  eligibleChannels: RetrievalSource[];
  excludedChannels: RetrievalSource[];
}

export interface EvidenceGroup<T = unknown> {
  groupId: string;
  primaryId: string;
  primaryKind: 'entity' | 'assertion';
  primaryValue: T;
  members: Array<FusedRetrievalCandidate<T>>;
  normalizedAssertions: Array<FusedRetrievalCandidate<T>>;
  rawEvents: Array<FusedRetrievalCandidate<T>>;
  entities: Array<FusedRetrievalCandidate<T>>;
  sourceEventIds: string[];
  sourceAgents: string[];
  states: string[];
  stateKeys: string[];
  transitions: UnknownRecord[];
  rejectedConflicts: UnknownRecord[];
  predicates: string[];
  exactValues: string[];
  eventTimes: string[];
  rawQuotes: string[];
  confidence: number;
  retrievalSources: RetrievalSourceTrace[];
  bestFusedScore: number;
  combinedFusedScore: number;
  rrfRank: number;
  rerankerRank?: number;
}

export interface EvidenceIntent {
  temporal: boolean;
  conflict: boolean;
  provenance: boolean;
  decision: boolean;
  currentOnly: boolean;
}

export interface EvidenceSelectionTrace {
  groupId: string;
  selected: boolean;
  finalRank: number | null;
  reason: string;
  rrfRank: number;
  rerankerRank: number | null;
}

export interface EvidenceSelectionResult<T = unknown> {
  selected: Array<EvidenceGroup<T>>;
  trace: EvidenceSelectionTrace[];
  intent: EvidenceIntent;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function text(value: unknown, limit = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function unique(values: unknown[], limit = 100): string[] {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].slice(0, limit);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertionOf(value: unknown): UnknownRecord {
  const candidate = record(value);
  return record(candidate.assertion);
}

function provenanceOf(value: unknown): UnknownRecord {
  const candidate = record(value);
  const assertion = assertionOf(candidate);
  return record(assertion.provenance || candidate.provenance || record(candidate.metadata).provenance || candidate.metadata);
}

function sourceEventIdsOf(value: unknown): string[] {
  const provenance = provenanceOf(value);
  const references = Array.isArray(provenance.raw_event_references) ? provenance.raw_event_references : [];
  return unique([
    provenance.source_event_id,
    ...(Array.isArray(provenance.source_event_ids) ? provenance.source_event_ids : []),
    ...references.map((reference) => record(reference).event_id),
  ]).sort();
}

function sourceAgentsOf(value: unknown): string[] {
  const provenance = provenanceOf(value);
  const references = Array.isArray(provenance.raw_event_references) ? provenance.raw_event_references : [];
  return unique([
    provenance.source_agent,
    ...(Array.isArray(provenance.source_agents) ? provenance.source_agents : []),
    ...references.map((reference) => record(reference).agent),
  ]).sort();
}

function scopeOf(value: unknown): string {
  const candidate = record(value);
  const assertion = assertionOf(candidate);
  const provenance = provenanceOf(candidate);
  const metadata = record(candidate.metadata);
  const parts = unique([
    provenance.user_id || provenance.userId || metadata.user_id || metadata.userId,
    provenance.tenant_id || provenance.tenantId || metadata.tenant_id || metadata.tenantId,
    provenance.conversation_id || provenance.conversationId,
    provenance.session_id || provenance.sessionId,
    provenance.document_id || provenance.documentId,
    assertion.document_id || candidate.document_id,
  ]);
  return parts.length ? digest(parts.join('|')) : 'global';
}

function stateOf(value: unknown): string {
  const assertion = assertionOf(value);
  const provenance = provenanceOf(value);
  const explicit = text(provenance.state, 40).toLowerCase();
  if (explicit) return explicit;
  if (assertion.invalidated_at) return 'invalidated';
  if (assertion.valid_until && Date.parse(assertion.valid_until) <= Date.now()) return 'historical';
  return 'current';
}

function quoteOf(value: unknown): string {
  const candidate = record(value);
  const assertion = assertionOf(candidate);
  const provenance = provenanceOf(candidate);
  const refs = Array.isArray(provenance.raw_event_references) ? provenance.raw_event_references : [];
  return text(assertion.source_span || record(refs[0]).text || candidate.source_span, 1_000);
}

function factOf(value: unknown): string {
  const candidate = record(value);
  const assertion = assertionOf(candidate);
  const passage = text(candidate.passage, 2_000);
  return text(candidate.fact || assertion.literal_value || passage.split(/\r?\n/, 1)[0].replace(/^passage:\s*/i, ''), 500);
}

function exactValuesOf(value: unknown): string[] {
  const assertion = assertionOf(value);
  const provenance = provenanceOf(value);
  return unique([provenance.exact_value, assertion.literal_value]);
}

function transitionOf(value: unknown): UnknownRecord | null {
  const transition = record(provenanceOf(value).transition);
  return Object.keys(transition).length ? transition : null;
}

function rejectedConflictsOf(value: unknown): UnknownRecord[] {
  const conflicts = provenanceOf(value).rejected_conflicts;
  return Array.isArray(conflicts) ? conflicts.map(record).filter((item) => Object.keys(item).length > 0) : [];
}

export function isRawEventEvidence(value: unknown): boolean {
  return text(provenanceOf(value).evidence_kind, 60).toLowerCase() === 'raw_event';
}

/** Keep raw observations in one dedicated retrieval lane and audit every exclusion. */
export function isolateRawEventChannels<T>(lists: FusionList<T>[]): {
  lists: FusionList<T>[];
  audit: RawEventChannelAudit[];
} {
  const audits = new Map<string, RawEventChannelAudit>();
  const isolated = lists.map((list) => ({
    ...list,
    items: list.items.filter((item) => {
      if (item.kind !== 'assertion') return true;
      const raw = isRawEventEvidence(item.value);
      if (raw) {
        if (!audits.has(item.id)) {
          audits.set(item.id, {
            candidateId: item.id,
            evidenceKind: 'raw_event',
            eligibleChannels: ['raw_event_fallback'],
            excludedChannels: ['assertion_vector', 'assertion_fts', 'subject_attachment'],
          });
        }
        return list.source === 'raw_event_fallback';
      }
      return list.source !== 'raw_event_fallback';
    }),
  }));
  return { lists: isolated, audit: [...audits.values()].sort((a, b) => a.candidateId.localeCompare(b.candidateId)) };
}

/** Stable, scope-aware group key without Benchmark-specific fields. */
export function buildEvidenceGroupKey(candidate: FusedRetrievalCandidate<unknown>): string {
  const value = candidate.value;
  const scope = scopeOf(value);
  const eventIds = sourceEventIdsOf(value);
  if (eventIds.length === 1) return `event:${digest(`${scope}|${eventIds[0]}`)}`;
  if (eventIds.length > 1) return `events:${digest(`${scope}|${eventIds.join('|')}`)}`;

  const assertion = assertionOf(value);
  const provenance = provenanceOf(value);
  const documentId = text(provenance.document_id || provenance.documentId || assertion.document_id || record(value).document_id);
  const sourceSpan = quoteOf(value);
  const agents = sourceAgentsOf(value);
  if (documentId && sourceSpan) {
    return `span:${digest(`${scope}|${documentId}|${agents.join('|')}|${sourceSpan}`)}`;
  }
  return `self:${candidate.kind}:${candidate.id}`;
}

function memberPriority(candidate: FusedRetrievalCandidate<unknown>): number {
  if (candidate.kind === 'assertion' && !isRawEventEvidence(candidate.value)) return 3;
  if (candidate.kind === 'assertion') return 2;
  return 1;
}

/** Aggregate candidates by source evidence and allow at most one contribution per channel. */
export function groupFusedEvidence<T>(
  candidates: Array<FusedRetrievalCandidate<T>>,
  config: { rrfK: number },
): Array<EvidenceGroup<T>> {
  if (!Number.isFinite(config.rrfK) || config.rrfK <= 0) throw new Error('rrfK must be positive');
  const buckets = new Map<string, Array<FusedRetrievalCandidate<T>>>();
  for (const candidate of candidates) {
    const key = buildEvidenceGroupKey(candidate as FusedRetrievalCandidate<unknown>);
    const bucket = buckets.get(key) || [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.entries()].map(([groupId, members]) => {
    const ordered = [...members].sort((a, b) =>
      memberPriority(b as FusedRetrievalCandidate<unknown>) - memberPriority(a as FusedRetrievalCandidate<unknown>)
      || b.fusedScore - a.fusedScore
      || a.id.localeCompare(b.id));
    const normalizedAssertions = members.filter((candidate) => candidate.kind === 'assertion' && !isRawEventEvidence(candidate.value));
    const rawEvents = members.filter((candidate) => candidate.kind === 'assertion' && isRawEventEvidence(candidate.value));
    const entities = members.filter((candidate) => candidate.kind === 'entity');
    const sourceMap = new Map<RetrievalSource, RetrievalSourceTrace>();
    for (const source of members.flatMap((candidate) => candidate.sources)) {
      const existing = sourceMap.get(source.source);
      if (!existing || source.rawRank < existing.rawRank) sourceMap.set(source.source, source);
    }
    const retrievalSources = [...sourceMap.values()].sort((a, b) => a.rawRank - b.rawRank || a.source.localeCompare(b.source));
    const values = members.map((candidate) => candidate.value);
    const confidences = values.map((value) => Number(assertionOf(value).confidence ?? record(value).confidence)).filter(Number.isFinite);
    const transitions = values.map(transitionOf).filter((item): item is UnknownRecord => item !== null);
    const rejectedConflicts = values.flatMap(rejectedConflictsOf);
    const primary = ordered[0];
    return {
      groupId,
      primaryId: primary.id,
      primaryKind: primary.kind,
      primaryValue: primary.value,
      members,
      normalizedAssertions,
      rawEvents,
      entities,
      sourceEventIds: unique(values.flatMap(sourceEventIdsOf)).sort(),
      sourceAgents: unique(values.flatMap(sourceAgentsOf)).sort(),
      states: unique(values.map(stateOf)).sort(),
      stateKeys: unique(values.map((value) => provenanceOf(value).state_key)).sort(),
      transitions,
      rejectedConflicts,
      predicates: unique(values.flatMap((value) => {
        const assertion = assertionOf(value);
        return [assertion.original_predicate, assertion.predicate];
      })).sort(),
      exactValues: unique(values.flatMap(exactValuesOf)),
      eventTimes: unique(values.map((value) => assertionOf(value).event_time || provenanceOf(value).event_time)).sort(),
      rawQuotes: unique(values.map(quoteOf)),
      confidence: confidences.length ? Math.max(...confidences) : 0,
      retrievalSources,
      bestFusedScore: Math.max(...members.map((candidate) => candidate.fusedScore)),
      combinedFusedScore: retrievalSources.reduce(
        (sum, source) => sum + source.weight / (config.rrfK + source.rawRank),
        0,
      ),
      rrfRank: 0,
    } satisfies EvidenceGroup<T>;
  });

  return groups
    .sort((a, b) => b.combinedFusedScore - a.combinedFusedScore || a.groupId.localeCompare(b.groupId))
    .map((group, index) => ({ ...group, rrfRank: index + 1 }));
}

function boundedField(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function transitionText(transition: UnknownRecord): string {
  const from = text(transition.from_value || transition.from, 100);
  const to = text(transition.to_value || transition.to, 100);
  const kind = text(transition.kind, 40);
  if (from || to) return `${from || '?'} -> ${to || '?'}${kind ? ` (${kind})` : ''}`;
  return kind;
}

function groupFacts(group: EvidenceGroup<unknown>): string[] {
  const normalized = group.normalizedAssertions.map((candidate) => factOf(candidate.value));
  return unique(normalized.length ? normalized : [factOf(group.primaryValue)]);
}

function groupFact(group: EvidenceGroup<unknown>): string {
  return groupFacts(group).join(' | ');
}

export function buildRerankerEvidenceSummary(group: EvidenceGroup<unknown>): string {
  const evidenceType = group.normalizedAssertions.length && group.rawEvents.length
    ? 'hybrid'
    : (group.normalizedAssertions.length ? 'normalized_assertion' : (group.rawEvents.length ? 'raw_event' : 'entity'));
  const conflictValues = unique(group.rejectedConflicts.map((conflict) => conflict.value || conflict.literal_value));
  const lines = [
    `ID: ${boundedField(group.groupId, 90)}`,
    `TYPE: ${evidenceType}`,
    `FACT: ${boundedField(groupFact(group), 120)}`,
    `EXACT_VALUE: ${boundedField(group.exactValues.join(' | '), 100)}`,
    `STATE: ${boundedField(group.states.join(' | '), 60)}`,
    `STATE_KEY: ${boundedField(group.stateKeys.join(' | '), 80)}`,
    `TRANSITION: ${boundedField(group.transitions.map(transitionText).filter(Boolean).join(' | '), 100)}`,
    `REJECTED_CONFLICTS: ${boundedField(conflictValues.join(' | '), 80)}`,
    `SOURCE_AGENTS: ${boundedField(group.sourceAgents.join(' | '), 80)}`,
    `CONFIDENCE: ${Number(group.confidence.toFixed(4))}`,
    `EVENT_TIME: ${boundedField(group.eventTimes.join(' | '), 60)}`,
    `RAW_QUOTE: ${boundedField(group.rawQuotes.join(' | '), 120)}`,
  ];
  return lines.join('\n').slice(0, 600);
}

export function buildEvidenceGroupPassage(group: EvidenceGroup<unknown>): string {
  const conflicts = unique(group.rejectedConflicts.map((conflict) => conflict.value || conflict.literal_value));
  const lines = [
    `passage: ${groupFact(group)}`,
    `Exact value: ${group.exactValues.join(' | ')}`,
    `State: ${group.states.join(' | ') || 'current'}`,
    `State key: ${group.stateKeys.join(' | ')}`,
    `Transition: ${group.transitions.map(transitionText).filter(Boolean).join(' | ')}`,
    `Rejected conflicts: ${conflicts.join(' | ')}`,
    `Source Agent: ${group.sourceAgents.join(' | ')}`,
    `Source Event ID: ${group.sourceEventIds.join(' | ')}`,
    `Raw Source Quote: ${group.rawQuotes.join(' | ')}`,
  ];
  return lines.join('\n').slice(0, 2_500);
}

const TEMPORAL_RE = /\b(current|now|latest|previous|historical|history|changed?|updated?|transition|before|after|formerly|prior|evolution)\b|当前|现在|最新|以前|之前|历史|变化|更新|转换|先前|之后/i;
const CONFLICT_RE = /\b(conflict|correct(?:ed|ion)?|reject(?:ed|ion)?|invalid(?:ated)?|low[- ]confidence|latest valid|contradict)\b|冲突|纠正|更正|失效|拒绝|低置信|矛盾/i;
const PROVENANCE_RE = /\b(source|agent|shared|provenance|who said|where did)\b|来源|代理|共享|谁说|出处/i;
const DECISION_RE = /\b(decide|decision|recommend|compare|option|choice|trade[- ]?off|risk|reversible|constraint|goal)\b|决策|建议|比较|选项|选择|风险|可逆|约束|目标/i;
const CURRENT_RE = /\b(current|now|latest|present)\b|当前|现在|目前|最新/i;

export function detectEvidenceIntent(query: string): EvidenceIntent {
  return {
    temporal: TEMPORAL_RE.test(query),
    conflict: CONFLICT_RE.test(query),
    provenance: PROVENANCE_RE.test(query),
    decision: DECISION_RE.test(query),
    currentOnly: CURRENT_RE.test(query) && !CONFLICT_RE.test(query) && !/\b(previous|historical|history|before|changed?|transition)\b|历史|之前|变化|转换/i.test(query),
  };
}

export function queryAwareTemporalOptions<T extends { asOf?: string; includeHistorical?: boolean }>(
  query: string,
  base: T,
): T {
  if (base.asOf || base.includeHistorical) return base;
  const intent = detectEvidenceIntent(query);
  return intent.conflict || (intent.temporal && !intent.currentOnly)
    ? { ...base, includeHistorical: true }
    : base;
}

function hasState(group: EvidenceGroup<unknown>, state: string): boolean {
  return group.states.includes(state);
}

function groupSearchText(group: EvidenceGroup<unknown>): string {
  return [groupFact(group), ...group.predicates, ...group.stateKeys, ...group.exactValues].join(' ').toLowerCase();
}

/** Coverage-aware selection under a fixed budget; it never adds candidates or changes Top-K. */
export function selectEvidenceSet<T>(input: {
  query: string;
  rankedGroups: Array<EvidenceGroup<T>>;
  limit: number;
  temporalMode?: string;
  includeInvalidated?: boolean;
}): EvidenceSelectionResult<T> {
  const limit = Math.max(0, Math.floor(input.limit));
  const intent = detectEvidenceIntent(input.query);
  const allowHistorical = Boolean(
    input.includeInvalidated || intent.conflict || (intent.temporal && !intent.currentOnly) || input.temporalMode === 'historical',
  );
  const eligible = input.rankedGroups.filter((group) => {
    if (allowHistorical) return true;
    return !group.states.includes('invalidated') && !(intent.currentOnly && group.states.every((state) => state === 'historical'));
  });
  const selected: Array<EvidenceGroup<T>> = [];
  const reasons = new Map<string, string>();
  const add = (group: EvidenceGroup<T> | undefined, reason: string) => {
    if (!group || selected.length >= limit || reasons.has(group.groupId)) return;
    selected.push(group);
    reasons.set(group.groupId, reason);
  };

  add(eligible[0], 'highest_ranked_core_evidence');

  if (intent.temporal || intent.conflict) {
    const current = eligible.find((group) => hasState(group, 'current'));
    const key = current?.stateKeys[0];
    const related = key ? eligible.filter((group) => group.stateKeys.includes(key)) : eligible;
    add(current, intent.conflict ? 'conflict_current_fact' : 'temporal_current_fact');
    add(related.find((group) => hasState(group, 'historical')), 'complementary_historical_state');
    add(related.find((group) => hasState(group, 'invalidated')), 'complementary_invalidated_state');
    add(related.find((group) => group.transitions.length > 0), intent.conflict ? 'correction_transition' : 'state_transition');
    if (intent.conflict) add(related.find((group) => group.rejectedConflicts.length > 0), 'rejected_conflict');
  }

  if (intent.provenance) {
    const agents = new Set<string>();
    for (const group of eligible) {
      if (group.sourceAgents.some((agent) => !agents.has(agent))) {
        add(group, 'distinct_relevant_source_agent');
        group.sourceAgents.forEach((agent) => agents.add(agent));
      }
      if (selected.length >= limit) break;
    }
  }

  if (intent.decision) {
    const categories: Array<[RegExp, string]> = [
      [/\bgoal\b|目标/i, 'decision_goal'],
      [/\bconstraint|requirement|limit\b|约束|要求|限制/i, 'decision_constraint'],
      [/\boption\s*a\b|选项\s*a/i, 'decision_option_a'],
      [/\boption\s*b\b|选项\s*b/i, 'decision_option_b'],
      [/\breversible|next step|experiment\b|可逆|下一步|试验/i, 'decision_reversible_step'],
      [/\brisk|downside|failure\b|风险|缺点|失败/i, 'decision_risk'],
    ];
    for (const [pattern, reason] of categories) add(eligible.find((group) => pattern.test(groupSearchText(group))), reason);
  }

  const diversityKeys = new Set<string>();
  for (const group of selected) {
    diversityKeys.add(`${group.stateKeys[0] || ''}|${group.predicates[0] || ''}|${group.sourceEventIds[0] || group.groupId}`);
  }
  for (const group of eligible) {
    const key = `${group.stateKeys[0] || ''}|${group.predicates[0] || ''}|${group.sourceEventIds[0] || group.groupId}`;
    if (!diversityKeys.has(key)) {
      add(group, 'diverse_evidence_dimension');
      diversityKeys.add(key);
    }
    if (selected.length >= limit) break;
  }
  for (const group of eligible) {
    add(group, 'reranker_rank_fill');
    if (selected.length >= limit) break;
  }

  const finalRanks = new Map(selected.map((group, index) => [group.groupId, index + 1]));
  return {
    selected,
    intent,
    trace: input.rankedGroups.map((group, index) => ({
      groupId: group.groupId,
      selected: finalRanks.has(group.groupId),
      finalRank: finalRanks.get(group.groupId) || null,
      reason: reasons.get(group.groupId) || (eligible.includes(group) ? 'outside_fixed_budget' : 'query_ineligible_historical_or_invalidated'),
      rrfRank: group.rrfRank,
      rerankerRank: group.rerankerRank ?? index + 1,
    })),
  };
}
