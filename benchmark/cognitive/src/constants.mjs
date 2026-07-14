export const CATEGORY_SPECS = Object.freeze({
  cognitive_continuity: {
    label: 'Cognitive Continuity',
    formal_count: 40,
    metrics: ['profile_recall', 'profile_consistency', 'constraint_utilization', 'personalization_accuracy', 'contradiction_rate', 'unsupported_personalization_rate'],
  },
  memory_evolution: {
    label: 'Memory Evolution',
    formal_count: 40,
    metrics: ['current_state_accuracy', 'historical_state_preservation', 'temporal_ordering_accuracy', 'evolution_interpretation_accuracy', 'stale_memory_leakage', 'state_transition_accuracy'],
  },
  conflict_resolution: {
    label: 'Memory Conflict Resolution',
    formal_count: 40,
    metrics: ['conflict_resolution_accuracy', 'latest_valid_fact_accuracy', 'historical_query_accuracy', 'invalidated_fact_rejection', 'conflict_disclosure_accuracy', 'unsupported_resolution_rate'],
  },
  cross_agent_transfer: {
    label: 'Cross-Agent Memory Transfer',
    formal_count: 30,
    metrics: ['cross_agent_recall', 'cross_agent_consistency', 'update_propagation_accuracy', 'provenance_preservation', 'agent_isolation_error_rate', 'stale_transfer_rate'],
  },
  human_like_forgetting: {
    label: 'Human-like Forgetting',
    formal_count: 40,
    metrics: ['salient_memory_retention', 'noise_suppression', 'false_forgetting_rate', 'stale_retention_rate', 'memory_precision', 'memory_compression_ratio', 'invalidation_accuracy'],
  },
  proactive_insight: {
    label: 'Proactive Insight',
    formal_count: 30,
    metrics: ['insight_precision', 'insight_recall', 'blind_spot_detection_rate', 'constraint_awareness', 'actionability', 'unsupported_claim_rate', 'redundant_insight_rate', 'overreach_rate'],
  },
  decision_quality: {
    label: 'Decision Quality',
    formal_count: 30,
    metrics: ['constraint_coverage', 'goal_alignment', 'personalization', 'option_comparison_quality', 'risk_awareness', 'actionability', 'internal_consistency', 'unsupported_assumption_rate', 'overall_decision_quality'],
  },
});

export const CATEGORY_KEYS = Object.freeze(Object.keys(CATEGORY_SPECS));
export const MODES = Object.freeze(['no_memory', 'retrieval_only', 'full_omni']);
export const STATES = Object.freeze(['completed', 'partial', 'blocked', 'not_implemented']);
export const FORGETTING_CAPABILITIES = Object.freeze({
  physical_deletion: 'not_implemented',
  logical_invalidation: 'implemented',
  retrieval_suppression: 'implemented',
  noise_filtering: 'implemented',
  memory_compression: 'not_implemented',
});

export function difficultyFor(index, total) {
  const ratio = index / total;
  if (ratio < 0.3) return 'easy';
  if (ratio < 0.8) return 'medium';
  return 'hard';
}
