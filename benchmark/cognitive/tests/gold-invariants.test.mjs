import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSplit } from '../src/scenarios.mjs';

test('memory_evolution gold current_facts includes all transition to_values', () => {
  const dev = generateSplit('development');
  const memoryScenarios = dev.filter((s) => s.category === 'memory_evolution');
  for (const scenario of memoryScenarios) {
    const gold = scenario.gold;
    const transitionToValues = gold.transitions.map((t) => t.to_value);
    for (const toValue of transitionToValues) {
      assert.ok(
        gold.current_facts.includes(toValue),
        `${scenario.scenario_id}: current_facts must include transition to_value "${toValue}". Got: ${JSON.stringify(gold.current_facts)}`
      );
    }
  }
});

test('memory_evolution gold historical_facts includes all transition from_values', () => {
  const dev = generateSplit('development');
  const memoryScenarios = dev.filter((s) => s.category === 'memory_evolution');
  for (const scenario of memoryScenarios) {
    const gold = scenario.gold;
    const transitionFromValues = gold.transitions.map((t) => t.from_value);
    for (const fromValue of transitionFromValues) {
      assert.ok(
        gold.historical_facts.includes(fromValue),
        `${scenario.scenario_id}: historical_facts must include transition from_value "${fromValue}". Got: ${JSON.stringify(gold.historical_facts)}`
      );
    }
  }
});

test('memory_evolution gold invariant: current corresponds to latest current event per state_key', () => {
  const dev = generateSplit('development');
  const memoryScenarios = dev.filter((s) => s.category === 'memory_evolution');
  for (const scenario of memoryScenarios) {
    const events = scenario.events;
    const gold = scenario.gold;
    // For each transition key, the to_value must be the value of the latest current event with that state_key
    for (const transition of gold.transitions) {
      const keyEvents = events.filter((e) => e.state_key === transition.key);
      const currentEvents = keyEvents.filter((e) => e.status === 'current');
      if (currentEvents.length > 0) {
        const latest = currentEvents[currentEvents.length - 1];
        assert.equal(
          latest.value,
          transition.to_value,
          `${scenario.scenario_id}: latest current event for key "${transition.key}" must equal transition.to_value`
        );
        assert.ok(
          gold.current_facts.includes(latest.value),
          `${scenario.scenario_id}: current_facts must include latest current value "${latest.value}" for key "${transition.key}"`
        );
      }
    }
  }
});

test('memory_evolution gold invariant: historical comes from earlier valid state', () => {
  const dev = generateSplit('development');
  const memoryScenarios = dev.filter((s) => s.category === 'memory_evolution');
  for (const scenario of memoryScenarios) {
    const events = scenario.events;
    const gold = scenario.gold;
    for (const transition of gold.transitions) {
      const keyEvents = events.filter((e) => e.state_key === transition.key);
      const historicalEvents = keyEvents.filter((e) => e.status === 'historical');
      for (const histEvent of historicalEvents) {
        assert.ok(
          gold.historical_facts.includes(histEvent.value),
          `${scenario.scenario_id}: historical_facts must include historical event value "${histEvent.value}" for key "${transition.key}"`
        );
      }
    }
  }
});

test('memory_evolution gold invariant: transitions consistent with event timeline order', () => {
  const dev = generateSplit('development');
  const memoryScenarios = dev.filter((s) => s.category === 'memory_evolution');
  for (const scenario of memoryScenarios) {
    const events = scenario.events;
    const gold = scenario.gold;
    for (const transition of gold.transitions) {
      const keyEvents = events
        .filter((e) => e.state_key === transition.key)
        .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      const fromEvent = keyEvents.find((e) => e.value === transition.from_value);
      const toEvent = keyEvents.find((e) => e.value === transition.to_value);
      if (fromEvent && toEvent) {
        assert.ok(
          String(fromEvent.timestamp) <= String(toEvent.timestamp),
          `${scenario.scenario_id}: transition from_value event must be before or equal to to_value event for key "${transition.key}"`
        );
      }
    }
  }
});
