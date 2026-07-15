import { CATEGORY_KEYS, CATEGORY_SPECS } from './constants.mjs';

const NAMES = ['Avery', 'Blair', 'Casey', 'Devon', 'Emery', 'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan', 'Kai', 'Lane', 'Morgan', 'Nova', 'Quinn', 'Riley'];
const AGENTS = ['Agent-A', 'Agent-B', 'Agent-C', 'Agent-D', 'Agent-E', 'Agent-F'];

export function displayAgent(agent) {
  if (!AGENTS.includes(agent)) throw new Error(`Unknown Agent identifier: ${agent}`);
  return agent;
}

export const SCENARIO_FAMILIES = Object.freeze({
  cognitive_continuity: [
    ['career_planning', 'career transition', 'move into accessibility engineering'],
    ['learning_plan', 'learning roadmap', 'become productive in distributed systems'],
    ['project_priority', 'project portfolio', 'ship the community scheduling tool'],
    ['communication_preference', 'collaboration plan', 'lead an asynchronous research group'],
    ['wellbeing_boundary_schedule', 'non-medical schedule', 'finish a sustainable four-week sprint'],
    ['budget_constraint', 'budgeted launch', 'release a low-cost education service'],
    ['goal_action_alignment', 'goal alignment', 'build a public-interest data product'],
  ],
  memory_evolution: [
    ['technology_stack', 'technology stack', ['Python', 'Rust']],
    ['location_change', 'work location', ['Nanjing', 'Chengdu']],
    ['project_phase', 'project phase', ['prototype', 'implementation']],
    ['work_arrangement', 'work arrangement', ['fully remote', 'hybrid two days onsite']],
    ['preference_change', 'communication preference', ['live meetings', 'written summaries']],
    ['resource_status', 'available budget', ['600 dollars', '1200 dollars']],
    ['temporary_recovery', 'temporary availability', ['unavailable this week', 'available next week']],
    ['multi_step_update', 'release target', ['alpha', 'beta']],
  ],
  conflict_resolution: [
    ['explicit_user_correction', 'work arrangement', ['onsite every day', 'hybrid two days onsite']],
    ['confidence_conflict', 'project deadline', ['April 2', 'April 18']],
    ['multi_agent_conflict', 'project status', ['cancelled', 'implementation']],
    ['same_time_sources', 'available budget', ['500 dollars', '900 dollars']],
    ['current_history_conflict', 'primary stack', ['Python', 'Go']],
    ['temporary_exception', 'meeting preference', ['no mornings', 'Tuesday morning exception']],
    ['successive_corrections', 'launch city', ['Suzhou', 'Hangzhou']],
  ],
  cross_agent_transfer: [
    ['goal_propagation', 'long-term goal', 'launch a community workshop'],
    ['preference_propagation', 'communication preference', 'written weekly summaries'],
    ['project_update', 'project status', 'implementation'],
    ['source_fidelity', 'budget limit', '800 dollars'],
    ['bad_agent_isolation', 'release status', 'ready for review'],
    ['ordered_updates', 'milestone', 'pilot complete'],
    ['agent_retraction', 'partner status', 'not selected'],
    ['similar_user_isolation', 'user-specific goal', 'build an accessibility tool'],
  ],
  human_like_forgetting: [
    ['salient_retention', 'salient goal', 'launch a community workshop'],
    ['repeated_reinforcement', 'reinforced preference', 'small practical projects'],
    ['temporary_expiry', 'temporary state', 'headache'],
    ['one_time_noise', 'one-time noise', 'clicked a blue button'],
    ['low_value_repetition', 'low-value repetition', 'opened the settings page'],
    ['explicit_withdrawal', 'withdrawn plan', 'buy a drone'],
    ['expired_plan', 'expired plan', 'attend the April conference'],
    ['irrelevant_truth', 'irrelevant true fact', 'owns a red notebook'],
    ['low_frequency_long_term', 'low-frequency long-term fact', 'cannot travel overnight'],
  ],
  proactive_insight: [
    ['direction_switching', 'direction switching', 'choose one initiative'],
    ['missing_validation', 'missing validation', 'conduct user interviews'],
    ['goal_action_mismatch', 'goal-action mismatch', 'align the next sprint'],
    ['repeated_failure', 'repeated failure pattern', 'run a bounded retrospective'],
    ['time_conflict', 'time conflict', 'reduce concurrent commitments'],
    ['budget_risk', 'budget risk', 'set a spending checkpoint'],
    ['project_overload', 'project overload', 'pause a new project'],
    ['resource_mismatch', 'resource mismatch', 'resize the milestone'],
    ['missed_opportunity', 'ignored opportunity', 'test the existing warm lead'],
    ['stalled_plan', 'stalled plan', 'define a measurable next action'],
  ],
  decision_quality: [
    ['job_vs_startup', 'job versus startup', 'four-week part-time trial'],
    ['learning_route', 'learning route', 'compare structured course and project path'],
    ['project_ranking', 'project prioritization', 'rank by goal fit and reversibility'],
    ['budget_allocation', 'budget allocation', 'fund the reversible experiment'],
    ['partner_selection', 'partner selection', 'run a reference-backed pilot'],
    ['time_allocation', 'time allocation', 'protect the highest-value block'],
    ['risk_reversibility', 'risk reversibility', 'choose a reversible checkpoint'],
    ['short_long_tradeoff', 'short-term versus long-term', 'preserve the long-term option'],
    ['insufficient_information', 'insufficient information', 'delay commitment and gather evidence'],
    ['multi_option_tradeoff', 'multi-option tradeoff', 'use a weighted decision table'],
  ],
});

const DIFFICULTY = Object.freeze({
  easy: { event_min: 6, event_max: 10, hops: [1, 2], conflicts: [0, 1], distractor: [0, 0.30], agents: [1, 2], transitions: [0, 1] },
  medium: { event_min: 12, event_max: 20, hops: [2, 3], conflicts: [1, 2], distractor: [0.25, 0.45], agents: [2, 4], transitions: [1, 3] },
  hard: { event_min: 25, event_max: 40, hops: [3, 5], conflicts: [2, 4], distractor: [0.35, 0.60], agents: [3, 6], transitions: [2, 5] },
});

function difficultySequence(split, count) {
  if (split === 'smoke') return ['easy', 'medium', 'hard'];
  if (split === 'development') return ['easy', 'medium', 'hard', 'medium', 'easy'];
  return [...Array(Math.round(count * 0.3)).fill('easy'), ...Array(Math.round(count * 0.5)).fill('medium'), ...Array(count - Math.round(count * 0.3) - Math.round(count * 0.5)).fill('hard')];
}

function structureFor(level, index) {
  if (level === 'easy') {
    const eventCount = 8 + (index % 3);
    const distractorCount = Math.min(2, Math.floor(eventCount * 0.25));
    return { eventCount, distractorCount, reasoningHops: 1 + (index % 2), conflictCount: 1, transitionCount: 1, agentCount: 2 };
  }
  if (level === 'medium') {
    const eventCount = 14 + (index % 6);
    const distractorCount = Math.ceil(eventCount * (0.28 + (index % 2) * 0.05));
    return { eventCount, distractorCount, reasoningHops: 2 + (index % 2), conflictCount: 1 + (index % 2), transitionCount: 1 + (index % 3), agentCount: 3 + (index % 2) };
  }
  const eventCount = 28 + (index % 10);
  const distractorCount = Math.ceil(eventCount * (0.38 + (index % 3) * 0.04));
  return { eventCount, distractorCount, reasoningHops: 3 + (index % 3), conflictCount: 2 + (index % 3), transitionCount: 2 + (index % 4), agentCount: 4 + (index % 3) };
}

function makeEvent(scenarioId, ordinal, agent, text, stateKey, value, options = {}) {
  const day = ordinal * 3 + 1;
  return {
    id: `${scenarioId}-e${String(ordinal + 1).padStart(2, '0')}`,
    timestamp: `2025-${String(1 + Math.floor(day / 28)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}T09:00:00Z`,
    agent,
    text,
    state_key: stateKey,
    value,
    status: options.status || 'current',
    confidence: options.confidence ?? 1,
    importance: options.importance || 'normal',
    source_type: options.source_type || 'user_statement',
    relevance: options.relevance || 'relevant',
    conflict: Boolean(options.conflict),
    transition_id: options.transition_id || null,
  };
}

function commonContext({ id, persona, family, cycle, structure }) {
  const budget = 500 + cycle * 37;
  const checkpoint = `checkpoint-${cycle + 1}`;
  return { id, persona, family, cycle, budget: `${budget} dollars`, checkpoint, structure };
}

function semanticCore(category, ctx) {
  const [familyId, label, detail] = ctx.family;
  const A = (n) => AGENTS[n % ctx.structure.agentCount];
  const e = [];
  let gold;
  let question;
  const add = (agent, text, key, value, options) => {
    const event = makeEvent(ctx.id, e.length, agent, text, key, value, options);
    e.push(event);
    return event;
  };

  if (category === 'cognitive_continuity') {
    const goal = detail;
    const time = `${4 + (ctx.cycle % 5)} focused hours per week`;
    const preference = familyId === 'communication_preference' ? 'written asynchronous updates' : 'small practical experiments';
    const boundary = familyId === 'wellbeing_boundary_schedule' ? 'no work after 20:00' : 'no overnight travel';
    add(A(0), `${ctx.persona}'s long-term ${label} goal is to ${goal}.`, 'goal', goal, { importance: 'high' });
    add(A(0), `${ctx.persona}'s budget is ${ctx.budget} for planning cycle ${ctx.cycle + 1}.`, 'budget', ctx.budget, { importance: 'high' });
    add(A(1), `${ctx.persona} has ${time}.`, 'weekly_time', time, { importance: 'high' });
    add(A(1), `${ctx.persona} prefers ${preference}.`, 'preference', preference);
    add(A(0), `${ctx.persona}'s explicit boundary is ${boundary}.`, 'boundary', boundary, { importance: 'high' });
    question = `For ${ctx.persona}'s ${label} planning cycle ${ctx.cycle + 1}, recommend the next bounded step using the stable goal, budget, time, preference, and boundary.`;
    gold = { required_facts: [goal, ctx.budget, time, preference, boundary], required_constraints: [ctx.budget, time, boundary], forbidden_facts: ['unlimited budget', 'full-time availability'], acceptable_actions: [detail, ctx.checkpoint], forbidden_inferences: ['medical diagnosis', 'personality disorder'] };
  } else if (category === 'memory_evolution') {
    const [oldValue, newValue] = detail;
    // Build a single-key timeline: oldValue -> newValue -> intermediate/revised pairs
    const timeline = [oldValue, newValue];
    for (let i = 1; i < ctx.structure.transitionCount; i++) {
      timeline.push(`${label} intermediate ${ctx.cycle}-${i}`);
      timeline.push(`${label} revised ${ctx.cycle}-${i}`);
    }
    // Add events in timeline order — ALL use the same semantic state_key (label)
    // transition_id assigned in pairs to satisfy difficulty validation
    for (let i = 0; i < timeline.length; i++) {
      const value = timeline[i];
      const isLast = i === timeline.length - 1;
      const isFirst = i === 0;
      const agent = A(i % ctx.structure.agentCount);
      let text;
      if (isFirst) {
        text = `${ctx.persona}'s ${label} was ${value}.`;
      } else if (isLast) {
        text = `${ctx.persona} now confirms the ${label} is ${value}.`;
      } else {
        text = `${ctx.persona}'s ${label} then changed to ${value}.`;
      }
      const pairIndex = Math.floor(i / 2);
      add(agent, text, label, value, {
        status: isLast ? 'current' : 'historical',
        importance: isLast ? 'high' : 'normal',
        transition_id: `evolution-${pairIndex}`,
      });
    }
    // Gold transitions: adjacent pairs in timeline order
    const transitions = [];
    for (let i = 0; i < timeline.length - 1; i++) {
      transitions.push({ key: label, from_value: timeline[i], to_value: timeline[i + 1] });
    }
    const current_facts = [timeline[timeline.length - 1]];
    const historical_facts = timeline.slice(0, -1);
    const stale_as_current = [oldValue];
    question = `At ${ctx.checkpoint}, what is ${ctx.persona}'s current ${label}, which earlier states were historical, and what transitions occurred during cycle ${ctx.cycle + 1}?`;
    gold = { required_facts: [...current_facts, ...historical_facts], current_facts, historical_facts, stale_as_current, transitions };
  } else if (category === 'conflict_resolution') {
    const [invalidValue, currentValue] = detail;
    add(A(0), `${ctx.persona}'s earlier ${label} was ${invalidValue}.`, label, invalidValue, { status: 'historical', transition_id: 'correction' });
    add(A(1), `A low-confidence import says ${ctx.persona}'s ${label} is ${invalidValue}.`, label, invalidValue, { confidence: 0.2, conflict: true, source_type: 'import' });
    add(A(0), `${ctx.persona} explicitly corrects the ${label} to ${currentValue}.`, label, currentValue, { importance: 'high', transition_id: 'correction' });
    for (let i = 1; i < ctx.structure.conflictCount; i++) add(A(i + 1), `Conflicting source ${i} repeats ${invalidValue} for ${label}, but has low confidence.`, label, invalidValue, { confidence: 0.25, conflict: true, source_type: 'agent_report' });
    question = `Resolve ${ctx.persona}'s ${label} conflict for ${ctx.checkpoint}: give the current value, preserve history, and explicitly reject invalid or low-confidence claims.`;
    gold = { required_facts: [currentValue, invalidValue], current_facts: [currentValue], historical_facts: [invalidValue], invalidated_facts: [invalidValue], conflict_disclosure: ['low confidence', 'correction'], forbidden_facts: [`${invalidValue} is current`], transitions: [{ key: label, from_value: invalidValue, to_value: currentValue }] };
  } else if (category === 'cross_agent_transfer') {
    const currentValue = detail;
    const factAgents = [A(0), A(1), A(2)];
    add(factAgents[0], `${displayAgent(factAgents[0])} records ${ctx.persona}'s ${label}: ${currentValue}.`, label, currentValue, { importance: 'high' });
    add(factAgents[1], `${displayAgent(factAgents[1])} confirms ${ctx.persona} prefers written weekly summaries.`, 'preference', 'written weekly summaries');
    add(factAgents[2], `${displayAgent(factAgents[2])} updates ${ctx.checkpoint} to implementation.`, 'project_status', 'implementation', { transition_id: ctx.structure.transitionCount ? 'agent-update' : null });
    const requiredSources = [...new Set(factAgents)];
    const provenanceAgent = A(0);
    add(provenanceAgent, `${displayAgent(provenanceAgent)} requests that the latest answer preserve ${requiredSources.join(', ')} provenance.`, 'provenance_rule', 'preserve source agents');
    if (ctx.structure.conflictCount) {
      const reportAgent = A(Math.min(3, ctx.structure.agentCount - 1));
      add(reportAgent, `${displayAgent(reportAgent)} submits a low-confidence incorrect report that ${ctx.checkpoint} is cancelled.`, 'project_status', 'cancelled', { confidence: 0.2, conflict: true, source_type: 'low_confidence_agent_report' });
    }
    question = `As a shared-memory agent in cycle ${ctx.cycle + 1}, summarize ${ctx.persona}'s ${label}, preference, and latest ${ctx.checkpoint} status with exact source Agents, isolating incorrect reports.`;
    gold = { required_facts: [currentValue, 'written weekly summaries', 'implementation'], current_facts: ['implementation'], required_sources: requiredSources, forbidden_facts: ['cancelled'], invalidated_facts: ctx.structure.conflictCount ? ['cancelled'] : [] };
  } else if (category === 'human_like_forgetting') {
    const salient = `${detail} for cycle ${ctx.cycle + 1}`;
    add(A(0), `${ctx.persona}'s high-value long-term ${label} is ${salient}.`, 'salient', salient, { importance: 'high' });
    add(A(0), `${ctx.persona} repeats that ${salient} remains important.`, 'salient', salient, { importance: 'high' });
    add(A(1), `${ctx.persona} had a temporary headache; it is now resolved.`, 'temporary_state', 'headache', { status: 'invalidated' });
    add(A(1), `Noise: ${ctx.persona} clicked a blue button once.`, 'noise', 'blue button', { importance: 'low' });
    add(A(0), `${ctx.persona} explicitly withdraws the plan to buy a drone.`, 'withdrawn_plan', 'buy a drone', { status: 'invalidated', transition_id: ctx.structure.transitionCount ? 'withdrawal' : null });
    question = `For ${ctx.persona}'s ${ctx.checkpoint} planning, identify the memory that should remain influential and structurally reject stale, invalidated, or noisy items.`;
    gold = { required_facts: [salient], forbidden_facts: ['headache is current', 'buy a drone is current', 'blue button is important'], invalidated_facts: ['buy a drone'], suppress: ['headache', 'blue button', 'buy a drone'] };
  } else if (category === 'proactive_insight') {
    const action = detail;
    const goal = `complete ${label} outcome ${ctx.cycle + 1}`;
    const time = `${5 + (ctx.cycle % 4)} hours per week`;
    add(A(0), `${ctx.persona}'s stated goal is to ${goal}.`, 'goal', goal, { importance: 'high' });
    add(A(1), `${ctx.persona} started initiative Alpha and paused it after one week.`, 'initiative', 'Alpha paused');
    add(A(1), `${ctx.persona} started initiative Beta before validating Alpha.`, 'initiative', 'Beta started');
    add(A(0), `${ctx.persona} has ${time} and zero completed user interviews.`, 'constraint', `${time}; no user interviews`, { importance: 'high' });
    add(A(2), `${ctx.persona} is considering another unrelated initiative before ${ctx.checkpoint}.`, 'initiative', 'new initiative considered');
    question = `Using cycle ${ctx.cycle + 1} evidence, identify the most defensible ${label} blind spot for ${ctx.persona} and recommend one bounded action.`;
    gold = { required_facts: [goal, time, 'no user interviews'], required_constraints: [time, 'no user interviews'], acceptable_insights: [label, 'lack of validation', 'goal action mismatch'], acceptable_actions: [action, ctx.checkpoint], forbidden_inferences: ['ADHD', 'mental illness', 'lazy', 'incapable'], unacceptable_actions: ['quit immediately', 'spend unlimited money'] };
  } else {
    const action = detail;
    const goal = `achieve ${label} objective ${ctx.cycle + 1}`;
    add(A(0), `${ctx.persona}'s long-term goal is to ${goal}.`, 'goal', goal, { importance: 'high' });
    add(A(0), `${ctx.persona} has ${ctx.budget} of risk budget and needs stable income.`, 'constraint', `${ctx.budget}; stable income`, { importance: 'high' });
    add(A(1), `Option A offers stability but limited autonomy for ${label}.`, 'option_a', 'stable option');
    add(A(1), `Option B offers high autonomy but uncertain income for ${label}.`, 'option_b', 'uncertain option');
    add(A(2), `${ctx.persona} can take a reversible four-week test before ${ctx.checkpoint}.`, 'reversible_step', 'four-week reversible test');
    question = `For ${ctx.persona}'s ${label} decision in cycle ${ctx.cycle + 1}, compare Option A and Option B, respect the budget and stable-income constraint, and recommend a risk-aware next step.`;
    gold = { required_facts: [goal, ctx.budget, 'stable income', 'Option A', 'Option B', 'four-week reversible test'], required_constraints: [ctx.budget, 'stable income'], acceptable_actions: [action, 'four-week reversible test', ctx.checkpoint], forbidden_inferences: ['guaranteed success', 'no financial risk'], required_option_comparison: ['Option A', 'Option B'] };
  }
  return { events: e, gold: { ...gold, evaluation_scope: ctx.checkpoint }, question };
}

function buildScenario(split, category, index, count, level) {
  const family = SCENARIO_FAMILIES[category][index % SCENARIO_FAMILIES[category].length];
  const structure = structureFor(level, index);
  const persona = NAMES[(index * 3 + CATEGORY_KEYS.indexOf(category)) % NAMES.length];
  const id = `${split}-v2-${category}-${String(index + 1).padStart(3, '0')}`;
  const ctx = commonContext({ id, persona, family, cycle: index, structure });
  const semantic = semanticCore(category, ctx);
  const relevantTarget = structure.eventCount - structure.distractorCount;
  let missingConflicts = structure.conflictCount - semantic.events.filter((event) => event.conflict).length;
  while (semantic.events.length < relevantTarget) {
    const ordinal = semantic.events.length;
    const conflict = missingConflicts > 0;
    semantic.events.push(makeEvent(id, ordinal, AGENTS[ordinal % structure.agentCount], conflict
      ? `Low-confidence conflicting ${family[1]} note ${index + 1}-${ordinal + 1} must not override confirmed evidence for ${ctx.checkpoint}.`
      : `${persona} confirms relevant ${family[1]} support note ${index + 1}-${ordinal + 1} for ${ctx.checkpoint}.`, conflict ? `conflict_support_${ordinal}` : `support_${ordinal}`, conflict ? `low-confidence-${index + 1}-${ordinal + 1}` : `support-${index + 1}-${ordinal + 1}`, { conflict, confidence: conflict ? 0.2 : 1, source_type: conflict ? 'low_confidence_agent_report' : 'user_statement', transition_id: ordinal < structure.transitionCount ? `support-transition-${ordinal + 1}` : null }));
    if (conflict) missingConflicts--;
  }
  if (missingConflicts > 0) throw new Error(`${id} semantic core leaves no event budget for required conflicts`);
  if (semantic.events.length > relevantTarget) throw new Error(`${id} semantic core exceeds ${level} relevant-event budget`);
  while (semantic.events.length < structure.eventCount) {
    const ordinal = semantic.events.length;
    semantic.events.push(makeEvent(id, ordinal, AGENTS[ordinal % structure.agentCount], `Unrelated distractor ${index + 1}-${ordinal + 1}: another user archived decorative sample ${ordinal + 1}.`, `noise_${ordinal}`, `distractor-${index + 1}-${ordinal + 1}`, { relevance: 'distractor', importance: 'low', source_type: 'noise' }));
  }
  const actualTransitions = new Set(semantic.events.map((event) => event.transition_id).filter(Boolean));
  while (actualTransitions.size < structure.transitionCount) {
    const candidate = semantic.events.find((event) => event.relevance === 'relevant' && !event.transition_id);
    candidate.transition_id = `structural-transition-${actualTransitions.size + 1}`;
    actualTransitions.add(candidate.transition_id);
  }
  const scenario = {
    schema_version: 2,
    scenario_id: id,
    split,
    category,
    scenario_family: family[0],
    difficulty: level,
    seed: 20260715 + index,
    persona,
    language: 'en',
    reasoning_hops: structure.reasoningHops,
    event_count: structure.eventCount,
    relevant_event_count: relevantTarget,
    distractor_count: structure.distractorCount,
    conflict_count: structure.conflictCount,
    state_transition_count: structure.transitionCount,
    agent_count: structure.agentCount,
    difficulty_factors: level === 'hard' ? ['long_history', 'multiple_conflicts', 'similar_events', 'low_confidence_source', 'high_distractor_ratio'] : level === 'medium' ? ['temporal_change', 'conflict', 'moderate_distractors'] : ['short_history', 'bounded_constraints'],
    official_locomo: false,
    synthetic_curated: true,
    events: semantic.events,
    question: semantic.question,
    gold: semantic.gold,
  };
  if (scenario.category === 'cross_agent_transfer') validateCrossAgentProvenance(scenario);
  validateDifficulty(scenario);
  return scenario;
}

export function validateCrossAgentProvenance(scenario) {
  if (scenario.category !== 'cross_agent_transfer') throw new Error(`${scenario.scenario_id}: not a Cross-Agent scenario`);
  const uniqueAgents = [...new Set(scenario.events.map((event) => event.agent))];
  const agentSet = new Set(uniqueAgents);
  const agentTextFieldMismatches = [];
  const unknownTextAgents = [];
  for (const event of scenario.events) {
    const leading = event.text.match(/^(Agent-[A-Z])\b/);
    if (leading && leading[1] !== event.agent) agentTextFieldMismatches.push({ event_id: event.id, field_agent: event.agent, text_agent: leading[1] });
    for (const textualAgent of event.text.match(/\bAgent-[A-Z]\b/g) || []) {
      if (!agentSet.has(textualAgent)) unknownTextAgents.push({ event_id: event.id, text_agent: textualAgent });
    }
  }
  const requiredFactAgents = [...new Set((scenario.gold.required_facts || []).flatMap((fact) => scenario.events.filter((event) => event.value === fact).map((event) => event.agent)))];
  const missingRequiredSources = (scenario.gold.required_sources || []).filter((agent) => !requiredFactAgents.includes(agent));
  const uncreditedFactSources = requiredFactAgents.filter((agent) => !(scenario.gold.required_sources || []).includes(agent));
  const failures = [];
  if (uniqueAgents.length < 2) failures.push('requires_at_least_two_agents');
  if (scenario.agent_count !== uniqueAgents.length) failures.push('agent_count_mismatch');
  if (agentTextFieldMismatches.length) failures.push('agent_text_field_mismatch');
  if (unknownTextAgents.length) failures.push('unknown_text_agent');
  if (missingRequiredSources.length) failures.push('gold_source_not_backed_by_required_fact');
  if (uncreditedFactSources.length) failures.push('required_fact_source_missing_from_gold');
  if (failures.length) throw new Error(`${scenario.scenario_id}: Cross-Agent provenance validation failed: ${failures.join(', ')}`);
  return {
    scenario_id: scenario.scenario_id,
    status: 'pass',
    unique_agents: uniqueAgents,
    required_fact_agents: requiredFactAgents,
    required_sources: scenario.gold.required_sources || [],
    agent_text_field_mismatches: agentTextFieldMismatches,
    unknown_text_agents: unknownTextAgents,
    missing_required_sources: missingRequiredSources,
    uncredited_fact_sources: uncreditedFactSources,
  };
}

export function validateDifficulty(scenario) {
  const limits = DIFFICULTY[scenario.difficulty];
  if (!limits) throw new Error(`${scenario.scenario_id}: unknown difficulty`);
  const actual = {
    events: scenario.events.length,
    distractors: scenario.events.filter((event) => event.relevance === 'distractor').length,
    conflicts: scenario.events.filter((event) => event.conflict).length,
    agents: new Set(scenario.events.map((event) => event.agent)).size,
    transitions: new Set(scenario.events.map((event) => event.transition_id).filter(Boolean)).size,
  };
  const ratio = actual.distractors / actual.events;
  const checks = [
    [actual.events >= limits.event_min && actual.events <= limits.event_max, 'event_count'],
    [scenario.reasoning_hops >= limits.hops[0] && scenario.reasoning_hops <= limits.hops[1], 'reasoning_hops'],
    [actual.conflicts >= limits.conflicts[0] && actual.conflicts <= limits.conflicts[1], 'conflict_count'],
    [ratio >= limits.distractor[0] && ratio <= limits.distractor[1], 'distractor_ratio'],
    [actual.agents >= limits.agents[0] && actual.agents <= limits.agents[1], 'agent_count'],
    [actual.transitions >= limits.transitions[0] && actual.transitions <= limits.transitions[1], 'state_transition_count'],
  ];
  const failed = checks.filter(([ok]) => !ok).map(([, name]) => name);
  if (failed.length) throw new Error(`${scenario.scenario_id}: difficulty validation failed: ${failed.join(', ')}`);
  for (const [key, value] of Object.entries({ event_count: actual.events, distractor_count: actual.distractors, relevant_event_count: actual.events - actual.distractors, conflict_count: actual.conflicts, agent_count: actual.agents, state_transition_count: actual.transitions })) {
    if (scenario[key] !== value) throw new Error(`${scenario.scenario_id}: declared ${key} mismatch`);
  }
  if (scenario.difficulty === 'hard' && !scenario.difficulty_factors.some((item) => ['similar_events', 'low_confidence_source'].includes(item))) throw new Error(`${scenario.scenario_id}: hard scenario lacks ambiguity factor`);
  return { scenario_id: scenario.scenario_id, status: 'pass', actual, distractor_ratio: ratio };
}

export function generateSplit(split) {
  const counts = split === 'smoke' ? Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 3])) : split === 'development' ? Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 5])) : Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORY_SPECS[key].formal_count]));
  return CATEGORY_KEYS.flatMap((category) => {
    const levels = difficultySequence(split, counts[category]);
    return levels.map((level, index) => buildScenario(split, category, index, counts[category], level));
  });
}

export function selectComparisonSubset(formalScenarios) {
  return CATEGORY_KEYS.flatMap((category) => {
    const candidates = formalScenarios.filter((scenario) => scenario.category === category);
    return ['easy', 'medium', 'hard'].flatMap((level, index) => candidates.filter((scenario) => scenario.difficulty === level).slice(0, [3, 5, 2][index])).map((scenario) => scenario.scenario_id);
  });
}

export const DIFFICULTY_RULES = DIFFICULTY;
