import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAudit, familyAudit, difficultyAudit } from '../src/audits.mjs';
import { CATEGORY_KEYS, CATEGORY_SPECS } from '../src/constants.mjs';
import { generateSplit, selectComparisonSubset, validateCrossAgentProvenance } from '../src/scenarios.mjs';

function leadingAgent(text) {
  const match = text.match(/^(Agent-[A-Z])\b/);
  return match?.[1] || null;
}

test('generates isolated v2 sets and preselects 70 comparison IDs', () => {
  const smoke = generateSplit('smoke');
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  const comparison = selectComparisonSubset(formal);
  assert.deepEqual([smoke.length, development.length, formal.length, comparison.length], [21, 35, 250, 70]);
  assert.equal(new Set([...smoke, ...development, ...formal].map((scenario) => scenario.scenario_id)).size, 306);
  assert.equal(new Set(comparison).size, 70);
  for (const category of CATEGORY_KEYS) {
    assert.equal(formal.filter((scenario) => scenario.category === category).length, CATEGORY_SPECS[category].formal_count);
    assert.equal(comparison.filter((id) => id.includes(`-${category}-`)).length, 10);
  }
});

test('passes family, duplicate, and real structural difficulty audits', () => {
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  assert.equal(duplicateAudit(formal).status, 'pass');
  const families = familyAudit(formal, development);
  assert.equal(families.status, 'pass');
  for (const category of CATEGORY_KEYS) {
    assert.ok(families.formal[category].family_count >= 5);
    assert.ok(families.formal[category].max_family_share <= 0.25);
    assert.ok(families.development[category].family_count >= 3);
    assert.deepEqual(new Set(development.filter((scenario) => scenario.category === category).map((scenario) => scenario.difficulty)), new Set(['easy', 'medium', 'hard']));
  }
  assert.equal(difficultyAudit(formal).status, 'pass');
});

test('Cross-Agent provenance has one Agent source across fields, text, and Gold', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const scenarios = generateSplit(split).filter((scenario) => scenario.category === 'cross_agent_transfer');
    assert.ok(scenarios.some((scenario) => scenario.difficulty === 'easy'));
    assert.ok(scenarios.some((scenario) => scenario.difficulty === 'medium'));
    assert.ok(scenarios.some((scenario) => scenario.difficulty === 'hard'));
    for (const scenario of scenarios) {
      const audit = validateCrossAgentProvenance(scenario);
      assert.equal(audit.status, 'pass', scenario.scenario_id);
      assert.equal(audit.agent_text_field_mismatches.length, 0, scenario.scenario_id);
      assert.equal(audit.unknown_text_agents.length, 0, scenario.scenario_id);
      assert.equal(audit.missing_required_sources.length, 0, scenario.scenario_id);
      assert.ok(audit.unique_agents.length >= 2, scenario.scenario_id);
      assert.equal(scenario.agent_count, audit.unique_agents.length, scenario.scenario_id);
      for (const event of scenario.events) {
        const textAgent = leadingAgent(event.text);
        if (textAgent) assert.equal(textAgent, event.agent, event.id);
      }
    }
  }
});

test('Cross-Agent Easy scenarios deduplicate wrapped required sources without inventing Agent-C', () => {
  for (const split of ['smoke', 'development', 'formal']) {
    const easy = generateSplit(split).find((scenario) => scenario.category === 'cross_agent_transfer' && scenario.difficulty === 'easy');
    assert.ok(easy, `${split} easy Cross-Agent scenario`);
    assert.deepEqual(easy.gold.required_sources, ['Agent-A', 'Agent-B']);
    assert.equal(easy.events.some((event) => event.text.startsWith('Agent-C')), false);
  }
});

test('Cross-Agent conflict reports use a real Agent and low-confidence report metadata', () => {
  for (const scenario of generateSplit('formal').filter((row) => row.category === 'cross_agent_transfer')) {
    const reports = scenario.events.filter((event) => event.value === 'cancelled');
    assert.ok(reports.length > 0, scenario.scenario_id);
    for (const report of reports) {
      assert.equal(leadingAgent(report.text), report.agent, report.id);
      assert.equal(report.conflict, true, report.id);
      assert.ok(report.confidence < 0.5, report.id);
      assert.equal(report.source_type, 'low_confidence_agent_report', report.id);
      assert.ok(scenario.events.some((event) => event.agent === report.agent), report.id);
    }
  }
});
