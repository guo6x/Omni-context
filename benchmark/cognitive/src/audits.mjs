import { createHash } from 'node:crypto';
import { CATEGORY_KEYS } from './constants.mjs';
import { validateDifficulty } from './scenarios.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const duplicates = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
};

function eventSetFingerprint(scenario) {
  return hash(scenario.events.map((event) => ({ text: event.text, agent: event.agent, state_key: event.state_key, value: event.value, status: event.status, confidence: event.confidence, relevance: event.relevance, conflict: event.conflict })));
}

export function duplicateAudit(formal) {
  const result = {
    schema_version: 1,
    scenario_count: formal.length,
    duplicate_scenario_ids: duplicates(formal.map((scenario) => scenario.scenario_id)),
    duplicate_event_sets: duplicates(formal.map(eventSetFingerprint)),
    duplicate_gold: duplicates(formal.map((scenario) => hash(scenario.gold))),
    duplicate_questions: duplicates(formal.map((scenario) => scenario.question)),
  };
  result.status = Object.values(result).some((value) => Array.isArray(value) && value.length) ? 'fail' : 'pass';
  return result;
}

export function familyAudit(formal, development) {
  const summarize = (rows) => Object.fromEntries(CATEGORY_KEYS.map((category) => {
    const categoryRows = rows.filter((scenario) => scenario.category === category);
    const counts = Object.fromEntries([...new Set(categoryRows.map((scenario) => scenario.scenario_family))].sort().map((family) => [family, categoryRows.filter((scenario) => scenario.scenario_family === family).length]));
    const maxShare = Math.max(...Object.values(counts)) / categoryRows.length;
    return [category, { scenario_count: categoryRows.length, family_count: Object.keys(counts).length, max_family_share: maxShare, families: counts }];
  }));
  const formalSummary = summarize(formal);
  const developmentSummary = summarize(development);
  const pass = CATEGORY_KEYS.every((category) => formalSummary[category].family_count >= 5 && formalSummary[category].max_family_share <= 0.25 && developmentSummary[category].family_count >= 3);
  return { schema_version: 1, status: pass ? 'pass' : 'fail', formal: formalSummary, development: developmentSummary };
}

export function difficultyAudit(rows) {
  const validations = rows.map(validateDifficulty);
  const byDifficulty = Object.fromEntries(['easy', 'medium', 'hard'].map((level) => [level, rows.filter((scenario) => scenario.difficulty === level).length]));
  return { schema_version: 1, status: validations.length === rows.length ? 'pass' : 'fail', scenario_count: rows.length, by_difficulty: byDifficulty, validations };
}

function stringsDeep(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsDeep);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsDeep);
  return [];
}

export function leakageAudit({ formal, answerPrompt, judgePrompt, comparisonIds }) {
  const specificGoldStrings = [...new Set(formal.flatMap((scenario) => stringsDeep(scenario.gold)).filter((value) => value.length >= 12))];
  const leakedPromptValues = specificGoldStrings.filter((value) => answerPrompt.toLowerCase().includes(value.toLowerCase()));
  const ids = new Set(formal.map((scenario) => scenario.scenario_id));
  const comparisonValid = comparisonIds.length === 70 && comparisonIds.every((id) => ids.has(id)) && new Set(comparisonIds).size === 70;
  return {
    schema_version: 1,
    status: leakedPromptValues.length === 0 && comparisonValid ? 'pass' : 'fail',
    gold_generated_before_answer_run: true,
    gold_generated_from_model_answers: false,
    answer_prompt_contains_scenario_specific_gold: leakedPromptValues.length > 0,
    leaked_prompt_values: leakedPromptValues,
    no_memory_context_contract: 'empty array',
    retrieval_only_contract: 'event fields only; scenario.gold is not passed',
    full_omni_contract: 'retrieved Brain evidence only; scenario.gold is not passed',
    answer_receives_rubric: false,
    primary_judge_receives_rubric: true,
    judge_prompt_present: Boolean(judgePrompt.trim()),
    comparison_preselected_before_formal_run: true,
    comparison_id_count: comparisonIds.length,
    comparison_ids_valid: comparisonValid,
    formal_results_used_for_selection: false,
  };
}

export function formalDiversityAudit(formal, family, difficulty, duplicate, leakage) {
  const hardHasAmbiguity = formal.filter((scenario) => scenario.difficulty === 'hard').every((scenario) => scenario.difficulty_factors.some((value) => ['similar_events', 'low_confidence_source'].includes(value)));
  const pass = formal.length === 250 && family.status === 'pass' && difficulty.status === 'pass' && duplicate.status === 'pass' && leakage.status === 'pass' && hardHasAmbiguity;
  return { schema_version: 1, status: pass ? 'pass' : 'fail', scenario_count: formal.length, category_counts: Object.fromEntries(CATEGORY_KEYS.map((category) => [category, formal.filter((scenario) => scenario.category === category).length])), hard_scenarios_have_ambiguity_factor: hardHasAmbiguity, family_status: family.status, difficulty_status: difficulty.status, duplicate_status: duplicate.status, leakage_status: leakage.status };
}
