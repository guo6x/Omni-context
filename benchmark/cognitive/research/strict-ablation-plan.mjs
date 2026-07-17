export const STRICT_ABLATION_CONDITIONS = Object.freeze([
  'full_omni_fresh_control',
  'selector_off',
  'grouping_off',
  'source_aware_fusion_off',
]);

export const CONDITION_TO_ENV = Object.freeze({
  full_omni_fresh_control: 'none',
  selector_off: 'selector_off',
  grouping_off: 'grouping_off',
  source_aware_fusion_off: 'source_aware_fusion_off',
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shuffledConditions(seed, scenarioId) {
  const random = mulberry32((Number(seed) ^ hashText(scenarioId)) >>> 0);
  const conditions = [...STRICT_ABLATION_CONDITIONS];
  for (let index = conditions.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [conditions[index], conditions[swap]] = [conditions[swap], conditions[index]];
  }
  return conditions;
}

export function buildInterleavedPlan(scenarios, seed) {
  return scenarios.flatMap((scenario, scenarioIndex) =>
    shuffledConditions(seed, scenario.scenario_id).map((condition, conditionIndex) => ({
      ordinal: scenarioIndex * STRICT_ABLATION_CONDITIONS.length + conditionIndex + 1,
      scenario_index: scenarioIndex + 1,
      scenario_id: scenario.scenario_id,
      category: scenario.category,
      condition,
      ablation: CONDITION_TO_ENV[condition],
    })));
}
