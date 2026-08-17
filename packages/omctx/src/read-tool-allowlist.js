/**
 * Machine-readable read-only tool allowlist for the omctx D1A CLI.
 *
 * Only deterministic, side-effect-free Brain MCP tools are allowed. LLM-
 * invoking tools (analyze_decision / discuss_decision / ask_memory /
 * graph_answer) are deliberately excluded from the Alpha: their output is
 * model-generated and the Alpha surfaces only deterministic judgment data.
 * Every write/mutation tool is excluded by construction.
 */

export const READ_TOOL_ALLOWLIST = Object.freeze({
  get_decision_context: { scope: 'decision:read', description: 'principles, precedents, conflicts and context for a situation' },
  get_decision_lineage: { scope: 'decision:read', description: 'recursive lineage of one decision' },
  get_entity: { scope: 'memory:read', description: 'one entity by id' },
  list_entities: { scope: 'memory:read', description: 'entity listing' },
  unified_memory_search: { scope: 'memory:read', description: 'unified memory search' },
  get_core_context: { scope: 'memory:read', description: 'core context snapshot' },
  get_stats: { scope: 'memory:read', description: 'store statistics' },
  get_graph_neighborhood: { scope: 'memory:read', description: 'graph neighborhood of an entity' },
  get_decay_report: { scope: 'memory:read', description: 'memory decay report' },
});

export function isReadToolAllowed(toolName) {
  return Object.prototype.hasOwnProperty.call(READ_TOOL_ALLOWLIST, toolName);
}
