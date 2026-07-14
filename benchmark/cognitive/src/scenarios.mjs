import { CATEGORY_KEYS, CATEGORY_SPECS, FORGETTING_CAPABILITIES, difficultyFor } from './constants.mjs';

const NAMES = ['Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan', 'Kai', 'Lane'];
const GOALS = ['ship an accessibility tool', 'transition into data engineering', 'launch a community workshop', 'finish a research prototype', 'build a sustainable consultancy'];
const STACKS = ['Python', 'Rust', 'TypeScript', 'Go', 'Kotlin'];
const LOCATIONS = ['Nanjing', 'Chengdu', 'Hangzhou', 'Shenzhen', 'Suzhou'];

function event(id, day, agent, text, key, value, options = {}) {
  return {
    id,
    timestamp: `2025-${String(1 + Math.floor(day / 28)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}T09:00:00Z`,
    agent,
    text,
    state_key: key,
    value,
    status: options.status || 'current',
    confidence: options.confidence ?? 1,
    importance: options.importance || 'normal',
    source_type: options.source_type || 'user_statement',
  };
}

function base(split, category, index, count) {
  const name = NAMES[index % NAMES.length];
  return {
    schema_version: 1,
    scenario_id: `${split}-${category}-${String(index + 1).padStart(3, '0')}`,
    split,
    category,
    difficulty: difficultyFor(index, count),
    seed: 20260714 + index,
    persona: name,
    official_locomo: false,
    synthetic_curated: true,
  };
}

function continuity(split, i, count) {
  const s = base(split, 'cognitive_continuity', i, count);
  const goal = GOALS[i % GOALS.length];
  const budget = 80 + (i % 5) * 20;
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona} says: My long-term goal is to ${goal}.`, 'goal', goal, { importance: 'high' }),
    event(`${s.scenario_id}-e2`, 8, 'Agent-A', `${s.persona} can spend at most ${budget} dollars per month.`, 'monthly_budget', `${budget} dollars`, { importance: 'high' }),
    event(`${s.scenario_id}-e3`, 15, 'Agent-B', `${s.persona} has only five focused hours each week.`, 'weekly_time', 'five hours', { importance: 'high' }),
    event(`${s.scenario_id}-e4`, 22, 'Agent-B', `${s.persona} learns best through small practical projects.`, 'learning_preference', 'small practical projects'),
    event(`${s.scenario_id}-e5`, 29, 'Agent-C', `${s.persona} struggles with public speaking.`, 'skill_gap', 'public speaking'),
  ];
  s.question = `Recommend the next four-week step for ${s.persona}, using their stable goal, constraints, preference, and known skill gap.`;
  s.gold = {
    required_facts: [goal, `${budget} dollars`, 'five hours', 'small practical projects', 'public speaking'],
    required_constraints: [`${budget} dollars`, 'five hours'],
    forbidden_facts: ['unlimited budget', 'full-time availability'],
    acceptable_actions: ['small project', 'weekly practice', 'four-week plan'],
    forbidden_inferences: ['medical diagnosis', 'personality disorder'],
  };
  return s;
}

function evolution(split, i, count) {
  const s = base(split, 'memory_evolution', i, count);
  const oldStack = STACKS[i % STACKS.length];
  const newStack = STACKS[(i + 2) % STACKS.length];
  const oldLocation = LOCATIONS[i % LOCATIONS.length];
  const newLocation = LOCATIONS[(i + 1) % LOCATIONS.length];
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona} used ${oldStack} as the primary project stack.`, 'stack', oldStack, { status: 'historical' }),
    event(`${s.scenario_id}-e2`, 4, 'Agent-A', `${s.persona} lived in ${oldLocation}.`, 'location', oldLocation, { status: 'historical' }),
    event(`${s.scenario_id}-e3`, 35, 'Agent-B', `${s.persona} has now switched the primary project stack to ${newStack}; ${oldStack} is historical.`, 'stack', newStack),
    event(`${s.scenario_id}-e4`, 40, 'Agent-B', `${s.persona} moved from ${oldLocation} to ${newLocation}.`, 'location', newLocation),
    event(`${s.scenario_id}-e5`, 45, 'Agent-C', `${s.persona}'s current project is active in ${newLocation}.`, 'project_status', 'active'),
  ];
  s.question = `What are ${s.persona}'s current stack and location, and what were the previous values?`;
  s.gold = {
    required_facts: [newStack, newLocation, oldStack, oldLocation],
    current_facts: [newStack, newLocation],
    historical_facts: [oldStack, oldLocation],
    stale_as_current: [oldStack, oldLocation],
    required_order: [`${oldStack}->${newStack}`, `${oldLocation}->${newLocation}`],
  };
  return s;
}

function conflict(split, i, count) {
  const s = base(split, 'conflict_resolution', i, count);
  const oldValue = i % 2 ? 'fully remote' : 'onsite';
  const currentValue = i % 2 ? 'hybrid two days onsite' : 'fully remote';
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona}'s work arrangement was ${oldValue}.`, 'work_arrangement', oldValue, { status: 'historical' }),
    event(`${s.scenario_id}-e2`, 10, 'Agent-X', `A low-confidence calendar import suggests ${s.persona} is onsite every day.`, 'work_arrangement', 'onsite every day', { confidence: 0.3, source_type: 'calendar_import' }),
    event(`${s.scenario_id}-e3`, 30, 'Agent-B', `${s.persona} explicitly corrects the record: the current arrangement is ${currentValue}.`, 'work_arrangement', currentValue, { importance: 'high' }),
    event(`${s.scenario_id}-e4`, 31, 'Agent-C', `${s.persona} says the earlier ${oldValue} arrangement should remain only as history.`, 'work_arrangement_history', oldValue),
  ];
  s.question = `State ${s.persona}'s current work arrangement, mention the historical arrangement, and handle the low-confidence conflict.`;
  s.gold = {
    required_facts: [currentValue, oldValue],
    current_facts: [currentValue],
    historical_facts: [oldValue],
    invalidated_facts: ['onsite every day'],
    conflict_disclosure: ['low-confidence', 'conflict', 'correction'],
    forbidden_facts: ['onsite every day is current'],
  };
  return s;
}

function crossAgent(split, i, count) {
  const s = base(split, 'cross_agent_transfer', i, count);
  const goal = GOALS[(i + 1) % GOALS.length];
  const project = `Project-${String.fromCharCode(65 + (i % 20))}`;
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `Agent A records ${s.persona}'s long-term goal: ${goal}.`, 'goal', goal),
    event(`${s.scenario_id}-e2`, 5, 'Agent-B', `Agent B records that ${s.persona} prefers written weekly summaries.`, 'communication_preference', 'written weekly summaries'),
    event(`${s.scenario_id}-e3`, 15, 'Agent-C', `Agent C updates ${project} from planning to implementation.`, 'project_status', 'implementation'),
    event(`${s.scenario_id}-e4`, 18, 'Agent-D', `Agent D notes that decisions for ${project} should support ${goal}.`, 'decision_rule', goal),
    event(`${s.scenario_id}-e5`, 21, 'Agent-X', `Agent X incorrectly reports ${project} is cancelled.`, 'project_status', 'cancelled', { confidence: 0.2 }),
  ];
  s.question = `As Agent A, summarize ${s.persona}'s goal, preference, and latest ${project} status with source agents.`;
  s.gold = {
    required_facts: [goal, 'written weekly summaries', 'implementation'],
    required_sources: ['Agent-A', 'Agent-B', 'Agent-C'],
    forbidden_facts: ['cancelled'],
    current_facts: ['implementation'],
  };
  return s;
}

function forgetting(split, i, count) {
  const s = base(split, 'human_like_forgetting', i, count);
  const salient = GOALS[(i + 2) % GOALS.length];
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona}'s high-priority long-term goal is to ${salient}.`, 'salient_goal', salient, { importance: 'high' }),
    event(`${s.scenario_id}-e2`, 8, 'Agent-A', `${s.persona} repeats that ${salient} remains important.`, 'salient_goal', salient, { importance: 'high' }),
    event(`${s.scenario_id}-e3`, 10, 'Agent-B', `${s.persona} had a temporary headache for one afternoon; it is resolved.`, 'temporary_state', 'headache', { status: 'invalidated' }),
    event(`${s.scenario_id}-e4`, 12, 'Agent-X', `Noise: ${s.persona} clicked a blue button once.`, 'noise', 'blue button', { importance: 'low' }),
    event(`${s.scenario_id}-e5`, 20, 'Agent-C', `${s.persona} explicitly invalidates an old plan to buy a drone.`, 'purchase_plan', 'buy a drone', { status: 'invalidated' }),
  ];
  s.question = `Which memories should influence ${s.persona}'s current planning, and which stale or noisy items should be suppressed?`;
  s.gold = {
    required_facts: [salient],
    forbidden_facts: ['headache is current', 'buy a drone is current', 'blue button is important'],
    suppress: ['headache', 'blue button', 'buy a drone'],
    capabilities: FORGETTING_CAPABILITIES,
  };
  return s;
}

function insight(split, i, count) {
  const s = base(split, 'proactive_insight', i, count);
  const goal = GOALS[(i + 3) % GOALS.length];
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona}'s stated goal is to ${goal} within six months.`, 'goal', goal),
    event(`${s.scenario_id}-e2`, 8, 'Agent-B', `${s.persona} started Initiative Alpha, then paused it after one week.`, 'initiative', 'Alpha paused'),
    event(`${s.scenario_id}-e3`, 16, 'Agent-B', `${s.persona} started Initiative Beta before validating Alpha.`, 'initiative', 'Beta started'),
    event(`${s.scenario_id}-e4`, 24, 'Agent-C', `${s.persona} has five hours per week and no user interviews completed.`, 'constraint', 'five hours and no interviews'),
    event(`${s.scenario_id}-e5`, 32, 'Agent-C', `${s.persona} is considering a third unrelated initiative.`, 'initiative', 'third initiative considered'),
  ];
  s.question = `Identify the most defensible blind spot in ${s.persona}'s trajectory and suggest one bounded action.`;
  s.gold = {
    required_facts: [goal, 'five hours', 'no user interviews'],
    required_constraints: ['five hours', 'no user interviews'],
    acceptable_insights: ['direction switching', 'too many initiatives', 'lack of validation', 'goal-action mismatch'],
    acceptable_actions: ['pause new initiative', 'conduct user interviews', 'choose one initiative'],
    forbidden_inferences: ['ADHD', 'mental illness', 'lazy', 'incapable'],
    unacceptable_actions: ['quit immediately', 'spend unlimited money'],
  };
  return s;
}

function decision(split, i, count) {
  const s = base(split, 'decision_quality', i, count);
  const goal = GOALS[(i + 4) % GOALS.length];
  const budget = 1200 + (i % 5) * 300;
  s.events = [
    event(`${s.scenario_id}-e1`, 1, 'Agent-A', `${s.persona}'s long-term goal is to ${goal}.`, 'goal', goal),
    event(`${s.scenario_id}-e2`, 5, 'Agent-A', `${s.persona} has ${budget} dollars of risk budget and needs stable income.`, 'budget', `${budget} dollars`),
    event(`${s.scenario_id}-e3`, 10, 'Agent-B', `Option A is a stable job with limited project autonomy.`, 'option_a', 'stable job'),
    event(`${s.scenario_id}-e4`, 12, 'Agent-B', `Option B is a three-month startup trial with uncertain income and high autonomy.`, 'option_b', 'startup trial'),
    event(`${s.scenario_id}-e5`, 15, 'Agent-C', `${s.persona} can test Option B part-time for four weeks before committing.`, 'reversible_step', 'four-week part-time test'),
  ];
  s.question = `Compare Option A and Option B for ${s.persona}, recommend a risk-aware next step, and state uncertainty.`;
  s.gold = {
    required_facts: [goal, `${budget} dollars`, 'stable income', 'stable job', 'startup trial', 'four-week part-time test'],
    required_constraints: [`${budget} dollars`, 'stable income'],
    acceptable_actions: ['four-week part-time test', 'preserve stable income', 'decision checkpoint'],
    forbidden_inferences: ['guaranteed success', 'no financial risk'],
    required_option_comparison: ['Option A', 'Option B'],
  };
  return s;
}

const BUILDERS = { cognitive_continuity: continuity, memory_evolution: evolution, conflict_resolution: conflict, cross_agent_transfer: crossAgent, human_like_forgetting: forgetting, proactive_insight: insight, decision_quality: decision };

export function generateSplit(split) {
  const counts = split === 'smoke'
    ? Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 3]))
    : split === 'development'
      ? Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 5]))
      : Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORY_SPECS[key].formal_count]));
  return CATEGORY_KEYS.flatMap((category) => Array.from({ length: counts[category] }, (_, i) => BUILDERS[category](split, i, counts[category])));
}

export function selectComparisonSubset(formalScenarios) {
  return CATEGORY_KEYS.flatMap((category) => {
    const candidates = formalScenarios.filter((scenario) => scenario.category === category);
    const byDifficulty = {
      easy: candidates.filter((s) => s.difficulty === 'easy'),
      medium: candidates.filter((s) => s.difficulty === 'medium'),
      hard: candidates.filter((s) => s.difficulty === 'hard'),
    };
    return [...byDifficulty.easy.slice(0, 3), ...byDifficulty.medium.slice(0, 5), ...byDifficulty.hard.slice(0, 2)].map((s) => s.scenario_id);
  });
}
