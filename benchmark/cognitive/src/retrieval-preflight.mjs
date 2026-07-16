const AGENT_RE = /^Agent-[A-Za-z0-9_]+$/;

export function evaluateRetrievalPreflight(scenario, retrieval, identity) {
  const candidatePool = Array.isArray(retrieval?.candidatePool) ? retrieval.candidatePool : [];
  const final20 = (Array.isArray(retrieval?.finalContext) ? retrieval.finalContext : []).slice(0, 20);
  const answerTop10 = final20.filter((item, index) => item.selected_for_answer === true || index < 10).slice(0, 10);
  const slots = requiredSlots(scenario);
  const validAgents = new Set((scenario.events || []).map((event) => event.agent).filter(Boolean));
  const visibleAgents = unique([...candidatePool, ...final20].flatMap(sourceAgents));
  const invalidSourceAgents = visibleAgents.filter((agent) => !AGENT_RE.test(agent) || !validAgents.has(agent));
  const selectorExecuted = Boolean(identity?.expectedSelectorVersion)
    && retrieval?.fusionConfig?.evidence_selector_version === identity.expectedSelectorVersion
    && retrieval?.trace?.status === 'written';
  const serviceCommitVerified = Boolean(
    identity?.productCommit
    && identity.productCommit === identity.expectedProductCommit,
  );
  const top10SupportOrRelationOnly = answerTop10.length === 0 || answerTop10.every(isSupportOrRelationNoise);
  const slotCoverage = {
    candidate_pool: coverage(slots, candidatePool),
    final20: coverage(slots, final20),
    top10: coverage(slots, answerTop10),
  };

  const hardChecks = {
    service_commit_verified: serviceCommitVerified,
    selector_executed: selectorExecuted,
    top10_not_support_or_relation_only: !top10SupportOrRelationOnly,
    source_agents_valid: invalidSourceAgents.length === 0,
  };
  return {
    scenario_id: scenario.scenario_id,
    category: scenario.category,
    passed: Object.values(hardChecks).every(Boolean),
    hard_checks: hardChecks,
    selector_executed: selectorExecuted,
    service_commit_verified: serviceCommitVerified,
    top10_support_or_relation_only: top10SupportOrRelationOnly,
    invalid_source_agents: invalidSourceAgents,
    valid_source_agents: [...validAgents].sort(),
    required_slots: slots.map((slot) => slot.label),
    slot_coverage: slotCoverage,
    counts: {
      candidate_pool: candidatePool.length,
      final20: final20.length,
      top10: answerTop10.length,
    },
  };
}

export function aggregateRetrievalPreflight(records) {
  const completed = records.filter((record) => record.status === 'completed');
  const totalSlots = completed.reduce((sum, record) => sum + record.gate.slot_coverage.top10.total, 0);
  const coveredSlots = completed.reduce((sum, record) => sum + record.gate.slot_coverage.top10.covered, 0);
  const slotRatio = totalSlots ? coveredSlots / totalSlots : 0;
  return {
    schema_version: 1,
    completed: completed.length,
    total: records.length,
    errors: records.filter((record) => record.status === 'error').length,
    service_commit_verified: completed.every((record) => record.gate.service_commit_verified),
    selector_executed: completed.every((record) => record.gate.selector_executed),
    source_agents_valid: completed.every((record) => record.gate.invalid_source_agents.length === 0),
    top10_not_support_or_relation_only: completed.every((record) => !record.gate.top10_support_or_relation_only),
    top10_slot_coverage: {
      covered: coveredSlots,
      total: totalSlots,
      ratio: Number(slotRatio.toFixed(6)),
    },
    passed: completed.length === records.length
      && records.length > 0
      && completed.every((record) => record.gate.passed)
      && slotRatio >= 0.85,
  };
}

function requiredSlots(scenario) {
  const gold = scenario.gold || {};
  const valueSlot = (value, label = String(value)) => ({ label, alternatives: [String(value)] });
  switch (scenario.category) {
    case 'cognitive_continuity':
      return (gold.required_facts || []).map((value) => valueSlot(value));
    case 'memory_evolution': {
      const slots = [
        ...(gold.current_facts || []).map((value) => valueSlot(value, `current:${value}`)),
        ...(gold.historical_facts || []).map((value) => valueSlot(value, `historical:${value}`)),
      ];
      if ((gold.transitions || []).length) {
        slots.push(...gold.transitions.map((transition, index) => ({
          label: `transition:${index + 1}`,
          all: [String(transition.from_value), String(transition.to_value)],
        })));
      }
      return slots;
    }
    case 'conflict_resolution': {
      const slots = [
        ...(gold.current_facts || []).map((value) => valueSlot(value, `current:${value}`)),
        ...(gold.invalidated_facts || gold.historical_facts || []).map((value) => valueSlot(value, `invalidated:${value}`)),
      ];
      slots.push({ label: 'correction', alternatives: ['correct', 'invalidated', 'historical', 'low-confidence', 'low confidence'] });
      return slots;
    }
    case 'cross_agent_transfer':
      return [
        ...(gold.required_facts || []).map((value) => valueSlot(value)),
        ...(gold.required_sources || []).map((value) => valueSlot(value, `source:${value}`)),
      ];
    case 'human_like_forgetting':
      return [
        ...(gold.required_facts || []).map((value) => valueSlot(value, `salient:${value}`)),
        { label: 'rejected-item', alternatives: [...(gold.invalidated_facts || []), ...(gold.suppress || [])].map(String) },
      ];
    case 'proactive_insight':
      return (gold.required_facts || []).map((value) => valueSlot(value));
    case 'decision_quality':
      return uniqueSlots([
        ...(gold.required_option_comparison || []).map((value) => valueSlot(value, `option:${value}`)),
        ...(gold.required_constraints || []).map((value) => valueSlot(value, `constraint:${value}`)),
      ]);
    default:
      return (gold.required_facts || []).map((value) => valueSlot(value));
  }
}

function coverage(slots, items) {
  const text = normalize(items.map(searchableText).join('\n'));
  const coveredLabels = slots.filter((slot) => matchesSlot(slot, text)).map((slot) => slot.label);
  return {
    covered: coveredLabels.length,
    total: slots.length,
    ratio: slots.length ? Number((coveredLabels.length / slots.length).toFixed(6)) : 1,
    covered_slots: coveredLabels,
    missing_slots: slots.filter((slot) => !coveredLabels.includes(slot.label)).map((slot) => slot.label),
  };
}

function matchesSlot(slot, text) {
  if (slot.all) return slot.all.every((value) => text.includes(normalize(value)));
  return (slot.alternatives || []).some((value) => text.includes(normalize(value)));
}

function searchableText(item) {
  return [
    item?.passage,
    item?.reranker_summary,
    ...(item?.state_keys || []),
    ...(item?.states || []),
    ...sourceAgents(item),
  ].filter(Boolean).join('\n');
}

function sourceAgents(item) {
  return Array.isArray(item?.source_agents) ? item.source_agents.map(String) : [];
}

function isSupportOrRelationNoise(item) {
  const keys = (item?.state_keys || []).map((value) => String(value).toLowerCase());
  if (keys.length) return keys.every((key) => /^(?:support|conflict_support|noise|relationship|relates_to)/.test(key));
  return /(?:support note|relationship|relates_to)/i.test(String(item?.passage || ''));
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueSlots(slots) {
  const seen = new Set();
  return slots.filter((slot) => !seen.has(slot.label) && seen.add(slot.label));
}
