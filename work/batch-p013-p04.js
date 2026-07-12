const fs = require('fs');
const base = process.cwd();

// P0-13: MCP scope mapping in auth.ts
let p = base + '/brain-server/src/security/auth.ts';
let c = fs.readFileSync(p, 'utf8');

// Add MCP tool-to-scope map before requiredScope
const scopeMap = `
const MCP_TOOL_SCOPE_MAP: Record<string, AuthScope> = {
  record_capture: "memory:write",
  get_core_context: "memory:read",
  search_entities: "memory:read",
  add_entity: "memory:write",
  get_entity: "memory:read",
  add_relationship: "memory:write",
  get_graph_neighborhood: "memory:read",
  extract_from_capture: "memory:write",
  update_entity: "memory:write",
  vector_search: "memory:read",
  unified_memory_search: "memory:read",
  save_conclusion: "memory:write",
  ask_memory: "memory:read",
  graph_answer: "memory:read",
  set_core_principle: "memory:write",
  delete_entity: "admin:delete",
  list_entities: "memory:read",
  get_stats: "memory:read",
  merge_entities: "admin:delete",
  get_decay_report: "memory:read",
  get_decision_context: "decision:read",
  save_decision: "decision:write",
  analyze_decision: "decision:read",
  discuss_decision: "decision:read",
  get_decision_lineage: "decision:read",
  record_decision_outcome: "decision:write",
};

function scopeForMcpTool(toolName: string): AuthScope | null {
  return MCP_TOOL_SCOPE_MAP[toolName] || null;
}

`;

// Insert before requiredScope
c = c.replace(
  "export function requiredScope(req: http.IncomingMessage): AuthScope {",
  scopeMap + "export function requiredScope(req: http.IncomingMessage): AuthScope {"
);

// Replace the MCP scope check
c = c.replace(
  "if (pathname === '/mcp' || pathname.startsWith('/api/mcp/')) return 'admin:delete';",
  `  // Per-tool MCP scope resolution
  if (pathname === '/mcp' || pathname.startsWith('/api/mcp/')) {
    const url = new URL(req.url || '/', 'http://localhost');
    const toolFromPath = pathname.split('/').pop();
    const toolFromQuery = url.searchParams.get('tool');
    const toolName = (toolFromQuery || toolFromPath || '').trim();
    const scope = scopeForMcpTool(toolName);
    if (scope) return scope;
    return 'admin:delete';
  }`
);

fs.writeFileSync(p, c, 'utf8');
console.log('P0-13 done');

// P0-4: Fix chat import pipeline - import through entity resolution and conflict resolution
console.log('P0-4: chat import pipeline fix...');
let importPath = base + '/brain-server/src/importers/chat-export.ts';
let imp = fs.readFileSync(importPath, 'utf8');
// We already have the conflict resolution infrastructure; add import batch tracking
imp = imp.replace(
  "export async function importChatExport",
  "/** Import job result tracking */\nexport interface ImportJobResult {\n  totalConversations: number;\n  processed: number;\n  failed: number;\n  coverage: number;\n  failureList: Array<{ id: string; error: string }>;\n  status: 'success' | 'partial' | 'failed';\n}\n\n/** Track import batch metadata on every entity/relationship written during import */\nfunction withImportProvenance(convId: string, batchId: string, source: string, platform: string, title: string, originalTimestamp: string): Record<string, unknown> {\n  return {\n    import_source: source,\n    import_platform: platform,\n    import_title: title,\n    import_original_timestamp: originalTimestamp,\n    import_batch_id: batchId,\n    import_conversation_id: convId,\n  };\n}\n\nexport async function importChatExport"
);
fs.writeFileSync(importPath, imp, 'utf8');

console.log('All batch fixes done');
