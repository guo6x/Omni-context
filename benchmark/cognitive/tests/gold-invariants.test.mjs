import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSplit } from '../src/scenarios.mjs';
import { scoreScenario } from '../src/scoring.mjs';

// Helper: extract evolution timeline events from a scenario by matching Gold values
function timelineEvents(scenario) {
  const goldValues = new Set([...scenario.gold.current_facts, ...scenario.gold.historical_facts]);
  return scenario.events
    .filter((e) => goldValues.has(e.value))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

// ─── Dataset invariant tests (1–8, 14) ───

test('1. memory_evolution: all evolution events for the same NL state use the same state_key', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const events = timelineEvents(scenario);
      const stateKeys = [...new Set(events.map((e) => e.state_key))];
      assert.equal(stateKeys.length, 1, `${scenario.scenario_id}: expected single state_key, got ${JSON.stringify(stateKeys)}`);
    }
  }
});

test('2. memory_evolution: each state_key has at most one final Current', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const events = timelineEvents(scenario);
      const currentEvents = events.filter((e) => e.status === 'current');
      assert.ok(currentEvents.length <= 1, `${scenario.scenario_id}: expected at most 1 current event, got ${currentEvents.length}`);
    }
  }
});

test('3. memory_evolution: Current equals the last valid state in the timeline', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const events = timelineEvents(scenario);
      const lastValue = events[events.length - 1].value;
      assert.deepEqual(scenario.gold.current_facts, [lastValue], `${scenario.scenario_id}: current_facts must be [last valid value]`);
    }
  }
});

test('4. memory_evolution: Historical includes all earlier valid states', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const events = timelineEvents(scenario);
      const earlierValues = events.slice(0, -1).map((e) => e.value);
      assert.deepEqual(scenario.gold.historical_facts, earlierValues, `${scenario.scenario_id}: historical_facts must match all earlier valid values`);
    }
  }
});

test('5. memory_evolution: Transitions connect adjacent valid states in the timeline', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const events = timelineEvents(scenario);
      const expectedCount = events.length - 1;
      assert.equal(scenario.gold.transitions.length, expectedCount, `${scenario.scenario_id}: transition count ${scenario.gold.transitions.length} !== expected ${expectedCount}`);
      for (let i = 0; i < expectedCount; i++) {
        assert.equal(scenario.gold.transitions[i].from_value, events[i].value, `${scenario.scenario_id}: transition ${i} from_value`);
        assert.equal(scenario.gold.transitions[i].to_value, events[i + 1].value, `${scenario.scenario_id}: transition ${i} to_value`);
      }
    }
  }
});

test('6. memory_evolution: From event timestamp is strictly earlier than To event timestamp', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      for (const transition of scenario.gold.transitions) {
        const fromEvent = scenario.events.find((e) => e.value === transition.from_value);
        const toEvent = scenario.events.find((e) => e.value === transition.to_value);
        if (fromEvent && toEvent) {
          assert.ok(String(fromEvent.timestamp) < String(toEvent.timestamp), `${scenario.scenario_id}: from must be strictly before to`);
        }
      }
    }
  }
});

test('7. memory_evolution: question uses plural "transitions" when transitionCount > 1', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      if (scenario.gold.transitions.length > 1) {
        assert.ok(scenario.question.includes('transitions'), `${scenario.scenario_id}: question must use plural "transitions" when >1 transition`);
      }
    }
  }
});

test('8. memory_evolution: no hidden numbered state keys in Gold transitions', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      for (const transition of scenario.gold.transitions) {
        assert.ok(!/_\d+$/.test(transition.key), `${scenario.scenario_id}: hidden numbered transition key "${transition.key}" must not exist`);
      }
      // Also verify all evolution timeline events use the same key as transitions
      const events = timelineEvents(scenario);
      const transitionKeys = new Set(scenario.gold.transitions.map((t) => t.key));
      for (const event of events) {
        assert.ok(transitionKeys.has(event.state_key), `${scenario.scenario_id}: event state_key "${event.state_key}" must match a transition key`);
      }
    }
  }
});

test('14. memory_evolution: low-confidence conflicts and noise do not enter Gold timeline', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((s) => s.category === 'memory_evolution');
    for (const scenario of scenarios) {
      const goldValues = new Set([...scenario.gold.current_facts, ...scenario.gold.historical_facts]);
      for (const event of scenario.events) {
        if (event.conflict || event.confidence < 0.5 || event.relevance === 'distractor') {
          assert.ok(!goldValues.has(event.value), `${scenario.scenario_id}: noise/conflict value "${event.value}" must not be in Gold`);
        }
      }
    }
  }
});

// ─── Scoring invariant tests (9–13) ───

test('9. phrasePresent: "2-2" does not match "2-3"', () => {
  const scenario = { category: 'memory_evolution', gold: { required_facts: ['x'], current_facts: ['phase 2-2'], historical_facts: [], stale_as_current: [], transitions: [] } };
  const answer = { answer: '', facts: [{ key: 'k', value: 'phase 2-3', state: 'current', source_ids: ['e1'], source_agents: [] }], transitions: [], constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1'] });
  assert.equal(score.metrics.current_state_accuracy, 0, '2-3 must not match gold 2-2');
});

test('10. phrasePresent: "3-10" does not match "3-11"', () => {
  const scenario = { category: 'memory_evolution', gold: { required_facts: ['x'], current_facts: ['phase 3-11'], historical_facts: [], stale_as_current: [], transitions: [] } };
  const answer = { answer: '', facts: [{ key: 'k', value: 'phase 3-10', state: 'current', source_ids: ['e1'], source_agents: [] }], transitions: [], constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1'] });
  assert.equal(score.metrics.current_state_accuracy, 0, '3-10 must not match gold 3-11');
});

test('11. correct Current, Historical, and Transition answer gets positive score', () => {
  const scenario = {
    category: 'memory_evolution',
    gold: {
      required_facts: ['revised', 'prototype'],
      current_facts: ['revised'],
      historical_facts: ['prototype'],
      stale_as_current: ['prototype'],
      transitions: [{ key: 'status', from_value: 'prototype', to_value: 'revised' }],
    },
  };
  const answer = {
    answer: 'test',
    facts: [
      { key: 'status', value: 'revised', state: 'current', source_ids: ['e2'], source_agents: [] },
      { key: 'status', value: 'prototype', state: 'historical', source_ids: ['e1'], source_agents: [] },
    ],
    transitions: [{ key: 'status', from_value: 'prototype', to_value: 'revised', source_ids: ['e1', 'e2'] }],
    constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null,
  };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1', 'e2'] });
  assert.ok(score.metrics.current_state_accuracy > 0, 'current must be >0');
  assert.ok(score.metrics.historical_state_preservation > 0, 'historical must be >0');
  assert.ok(score.metrics.temporal_ordering_accuracy > 0, 'temporal must be >0');
});

test('12. only wrong-order Transition gets 0 for temporal ordering', () => {
  const scenario = {
    category: 'memory_evolution',
    gold: {
      required_facts: ['revised', 'prototype'],
      current_facts: ['revised'],
      historical_facts: ['prototype'],
      stale_as_current: ['prototype'],
      transitions: [{ key: 'status', from_value: 'prototype', to_value: 'revised' }],
    },
  };
  const answer = {
    answer: 'test',
    facts: [
      { key: 'status', value: 'revised', state: 'current', source_ids: ['e2'], source_agents: [] },
      { key: 'status', value: 'prototype', state: 'historical', source_ids: ['e1'], source_agents: [] },
    ],
    transitions: [{ key: 'status', from_value: 'revised', to_value: 'prototype', source_ids: ['e1', 'e2'] }],
    constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null,
  };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1', 'e2'] });
  assert.equal(score.metrics.temporal_ordering_accuracy, 0, 'reversed transition must score 0');
});

test('13. only last Current but wrong Historical gets no Historical score', () => {
  const scenario = {
    category: 'memory_evolution',
    gold: {
      required_facts: ['revised', 'prototype'],
      current_facts: ['revised'],
      historical_facts: ['prototype'],
      stale_as_current: ['prototype'],
      transitions: [{ key: 'status', from_value: 'prototype', to_value: 'revised' }],
    },
  };
  const answer = {
    answer: 'test',
    facts: [
      { key: 'status', value: 'revised', state: 'current', source_ids: ['e2'], source_agents: [] },
      { key: 'status', value: 'wrong', state: 'historical', source_ids: ['e1'], source_agents: [] },
    ],
    transitions: [],
    constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null,
  };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1', 'e2'] });
  assert.equal(score.metrics.historical_state_preservation, 0, 'wrong historical must score 0');
});
