export interface McpScenario {
  id: string;
  icon: string;
  titleKey: string;
  promptKey: string;
  tool: string;
  toolDescription: string;
}

export const MCP_SCENARIOS: McpScenario[] = [
  {
    id: 'search_notes',
    icon: 'Search',
    titleKey: 'settings.mcp.scenarios.search_notes_title',
    promptKey: 'settings.mcp.scenarios.search_notes_prompt',
    tool: 'unified_memory_search',
    toolDescription:
      'Fused memory search combining text search, vector similarity, and graph traversal. Returns the most relevant entities for a given query across all three methods, deduplicated.',
  },
  {
    id: 'decision_context',
    icon: 'Lightbulb',
    titleKey: 'settings.mcp.scenarios.decision_context_title',
    promptKey: 'settings.mcp.scenarios.decision_context_prompt',
    tool: 'get_decision_context',
    toolDescription:
      'When you are facing a specific situation or decision and need context from the user\'s knowledge graph to inform your judgment. Returns relevant principles, related memories, historical conflicts, and graph neighborhood.',
  },
  {
    id: 'record_knowledge',
    icon: 'Camera',
    titleKey: 'settings.mcp.scenarios.record_knowledge_title',
    promptKey: 'settings.mcp.scenarios.record_knowledge_prompt',
    tool: 'record_capture',
    toolDescription:
      'Store a capture event (screenshot, clipboard content, system logs) into the knowledge graph. Use when the user explicitly wants to save a moment or piece of context for future reference.',
  },
  {
    id: 'explore_entities',
    icon: 'GitBranch',
    titleKey: 'settings.mcp.scenarios.explore_entities_title',
    promptKey: 'settings.mcp.scenarios.explore_entities_prompt',
    tool: 'search_entities + get_graph_neighborhood',
    toolDescription:
      'Search for entities in the knowledge graph by name or description, then get the graph neighborhood around a specific entity to understand its context and connections.',
  },
  {
    id: 'decay_report',
    icon: 'AlertTriangle',
    titleKey: 'settings.mcp.scenarios.decay_report_title',
    promptKey: 'settings.mcp.scenarios.decay_report_prompt',
    tool: 'get_decay_report',
    toolDescription:
      'Get the memory decay report showing which entities have decayed over time and may need reinforcement or cleanup.',
  },
];
