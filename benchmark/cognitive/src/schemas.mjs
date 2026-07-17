const STATES = ['current', 'historical', 'supported', 'uncertain'];
const REJECTION_REASONS = ['stale', 'invalidated', 'low_confidence', 'contradicted', 'noise', 'unsupported'];
const RUBRIC_KEYS = ['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'];

const stringArray = { type: 'array', items: { type: 'string' } };
const compactJudgeList = { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 120 } };
export const ANSWER_SCHEMA_V2 = Object.freeze({
  name: 'omni_cognitive_answer_v2',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['answer', 'facts', 'transitions', 'constraints_used', 'rejected_facts', 'insights', 'actions', 'uncertainty'],
    properties: {
      answer: { type: 'string' },
      facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value', 'state', 'source_ids', 'source_agents'], properties: { key: { type: 'string' }, value: { type: 'string' }, state: { type: 'string', enum: STATES }, source_ids: stringArray, source_agents: stringArray } } },
      transitions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'from_value', 'to_value', 'source_ids'], properties: { key: { type: 'string' }, from_value: { type: 'string' }, to_value: { type: 'string' }, source_ids: stringArray } } },
      constraints_used: stringArray,
      rejected_facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['value', 'reason', 'source_ids'], properties: { value: { type: 'string' }, reason: { type: 'string', enum: REJECTION_REASONS }, source_ids: stringArray } } },
      insights: stringArray,
      actions: stringArray,
      uncertainty: { type: ['string', 'null'] },
    },
  },
});

export const KIMI_JUDGE_SCHEMA_V2 = Object.freeze({
  name: 'omni_cognitive_kimi_judge_v2',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['rubric_scores', 'unsupported_claim_rate', 'overreach_rate', 'redundant_insight_rate', 'missing_required_elements', 'unsupported_elements', 'rationale'],
    properties: {
      rubric_scores: { type: 'object', additionalProperties: false, required: RUBRIC_KEYS, properties: Object.fromEntries(RUBRIC_KEYS.map((key) => [key, { type: 'number', minimum: 0, maximum: 1 }])) },
      unsupported_claim_rate: { type: 'number', minimum: 0, maximum: 1 },
      overreach_rate: { type: 'number', minimum: 0, maximum: 1 },
      redundant_insight_rate: { type: 'number', minimum: 0, maximum: 1 },
      missing_required_elements: compactJudgeList,
      unsupported_elements: compactJudgeList,
      rationale: { type: 'string', maxLength: 240 },
    },
  },
});

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(required)) throw new Error(`${label} keys do not match schema; expected=${required.join(',')} actual=${actual.join(',')}`);
}
function strings(value, label) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`); }
function norm(value) { return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

export function validateAnswerV2(value, { visibleSourceIds = [], visibleAgents = [], allowEmptySources = false } = {}) {
  exactKeys(value, ANSWER_SCHEMA_V2.schema.required, 'answer');
  if (typeof value.answer !== 'string' || !value.answer.trim()) throw new Error('answer.answer must be non-empty');
  const sourceIds = new Set(visibleSourceIds);
  const agents = new Set(visibleAgents);
  const validateSources = (ids, label) => {
    strings(ids, label);
    if (!allowEmptySources && ids.length === 0) throw new Error(`${label} cannot be empty with memory context`);
    if (ids.some((id) => !sourceIds.has(id))) throw new Error(`${label} contains invisible source ID`);
  };
  if (!Array.isArray(value.facts)) throw new Error('facts must be an array');
  for (const fact of value.facts) {
    exactKeys(fact, ['key', 'value', 'state', 'source_ids', 'source_agents'], 'fact');
    if (typeof fact.key !== 'string' || typeof fact.value !== 'string' || !STATES.includes(fact.state)) throw new Error('fact fields invalid');
    validateSources(fact.source_ids, 'fact.source_ids');
    strings(fact.source_agents, 'fact.source_agents');
    if (allowEmptySources && fact.source_ids.length === 0 && fact.source_agents.length) throw new Error('No Memory fact cannot invent source Agent');
    if (fact.source_agents.some((agent) => !agents.has(agent))) throw new Error('fact.source_agents contains invisible Agent');
  }
  if (!Array.isArray(value.transitions)) throw new Error('transitions must be an array');
  for (const transition of value.transitions) {
    exactKeys(transition, ['key', 'from_value', 'to_value', 'source_ids'], 'transition');
    if (['key', 'from_value', 'to_value'].some((key) => typeof transition[key] !== 'string')) throw new Error('transition fields invalid');
    validateSources(transition.source_ids, 'transition.source_ids');
  }
  strings(value.constraints_used, 'constraints_used');
  if (!Array.isArray(value.rejected_facts)) throw new Error('rejected_facts must be an array');
  for (const rejected of value.rejected_facts) {
    exactKeys(rejected, ['value', 'reason', 'source_ids'], 'rejected_fact');
    if (typeof rejected.value !== 'string' || !REJECTION_REASONS.includes(rejected.reason)) throw new Error('rejected_fact fields invalid');
    validateSources(rejected.source_ids, 'rejected_fact.source_ids');
    const collision = value.facts.some((fact) => ['current', 'supported'].includes(fact.state) && norm(fact.value) === norm(rejected.value));
    if (collision) throw new Error('rejected fact cannot also be current or supported');
  }
  for (const key of ['insights', 'actions']) strings(value[key], key);
  if (value.uncertainty !== null && typeof value.uncertainty !== 'string') throw new Error('uncertainty must be string or null');
  return value;
}

export function validateKimiJudgeV2(value) {
  exactKeys(value, KIMI_JUDGE_SCHEMA_V2.schema.required, 'kimi judge');
  exactKeys(value.rubric_scores, RUBRIC_KEYS, 'rubric_scores');
  for (const key of RUBRIC_KEYS) if (typeof value.rubric_scores[key] !== 'number' || value.rubric_scores[key] < 0 || value.rubric_scores[key] > 1) throw new Error(`invalid rubric score ${key}`);
  for (const key of ['unsupported_claim_rate', 'overreach_rate', 'redundant_insight_rate']) if (typeof value[key] !== 'number' || value[key] < 0 || value[key] > 1) throw new Error(`invalid negative metric ${key}`);
  strings(value.missing_required_elements, 'missing_required_elements');
  strings(value.unsupported_elements, 'unsupported_elements');
  for (const key of ['missing_required_elements', 'unsupported_elements']) {
    if (value[key].length > 5) throw new Error(`${key} must contain at most 5 items`);
    if (value[key].some((item) => [...item].length > 120)) throw new Error(`${key} items must contain at most 120 Unicode characters`);
  }
  if (typeof value.rationale !== 'string') throw new Error('rationale must be string');
  if ([...value.rationale].length > 240) throw new Error('rationale must contain at most 240 Unicode characters');
  return value;
}

export const ANSWER_STATES = Object.freeze(STATES);
export const REJECTION_REASON_VALUES = Object.freeze(REJECTION_REASONS);
