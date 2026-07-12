import re, os

base = r"C:\Users\我的开挂系统\Documents\Codex\2026-07-12\omni-context-https-github-com-guo6x"

# === P0-12: AgentLoop concurrency lock ===
path = os.path.join(base, "brain-server", "src", "agent", "agent-loop.ts")
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

c = c.replace(
    "private cycleCount = 0;",
    "private cycleCount = 0;\n  private isCycleRunning = false;\n  private skippedCycleCount = 0;\n  private cycleTimeoutMs = 4 * 60 * 1000;"
)

c = c.replace(
    "this.interval = setInterval(() => this.runCycle(), intervalMs);",
    """    this.interval = setInterval(() => {
      if (this.isCycleRunning) {
        this.skippedCycleCount++;
        return;
      }
      this.runCycle();
    }, intervalMs);"""
)

c = c.replace(
    "console.log('[AgentLoop] \u5524\u9192\uff0c\u6267\u884c\u5468\u671f\u4efb\u52a1...');",
    """    if (this.isCycleRunning) {
      this.skippedCycleCount++;
      return;
    }
    this.isCycleRunning = true;
    const cycleTimeout = setTimeout(() => {
      if (this.isCycleRunning) {
        console.warn('[AgentLoop] Cycle timeout - forcing completion');
        this.isCycleRunning = false;
      }
    }, this.cycleTimeoutMs);

    console.log('[AgentLoop] \u5524\u9192\uff0c\u6267\u884c\u5468\u671f\u4efb\u52a1...');"""
)

c = c.replace(
    "console.error('[AgentLoop] \u5468\u671f\u5f02\u5e38:', error);",
    "console.error('[AgentLoop] \u5468\u671f\u5f02\u5e38:', error);\n    } finally {\n      clearTimeout(cycleTimeout);\n      this.isCycleRunning = false;"
)

c = c.replace(
    "getCycleCount(): number { return this.cycleCount; }",
    "getCycleCount(): number { return this.cycleCount; }\n\n  getSkippedCount(): number { return this.skippedCycleCount; }\n\n  isRunning(): boolean { return this.isCycleRunning; }"
)

with open(path, "w", encoding="utf-8") as f:
    f.write(c)
print("P0-12: AgentLoop lock done")

# === P0-13: MCP device scope mapping ===
path2 = os.path.join(base, "brain-server", "src", "security", "auth.ts")
with open(path2, "r", encoding="utf-8") as f:
    c2 = f.read()

# Add per-tool scope mapping
OLD = """export function requiredScope(req: http.IncomingMessage): AuthScope {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const method = req.method || 'GET';

  if (pathname === '/api/admin/export') return 'admin:export';
  if (pathname === '/api/admin/import') return 'admin:import';
  if (pathname === '/api/mcp/tool/ask_memory') return 'memory:read';
  if (pathname === '/mcp' || pathname.startsWith('/api/mcp/')) return 'admin:delete';
  if (pathname.startsWith('/api/settings')) return 'admin:import';
  if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/auth/devices')) {
    return 'admin:delete';
  }
  if (method === 'DELETE') return 'admin:delete';

  const decisionRoute = pathname.includes('/decision') || pathname.includes('/discussions');
  if (decisionRoute) return method === 'GET' ? 'decision:read' : 'decision:write';
  return method === 'GET' ? 'memory:read' : 'memory:write';
}"""

NEW = """const MCP_TOOL_SCOPE_MAP: Record<string, AuthScope> = {
  record_capture: 'memory:write',
  get_core_context: 'memory:read',
  search_entities: 'memory:read',
  add_entity: 'memory:write',
  get_entity: 'memory:read',
  add_relationship: 'memory:write',
  get_graph_neighborhood: 'memory:read',
  extract_from_capture: 'memory:write',
  update_entity: 'memory:write',
  vector_search: 'memory:read',
  unified_memory_search: 'memory:read',
  save_conclusion: 'memory:write',
  ask_memory: 'memory:read',
  graph_answer: 'memory:read',
  set_core_principle: 'memory:write',
  delete_entity: 'admin:delete',
  list_entities: 'memory:read',
  get_stats: 'memory:read',
  merge_entities: 'admin:delete',
  get_decay_report: 'memory:read',
  get_decision_context: 'decision:read',
  save_decision: 'decision:write',
  analyze_decision: 'decision:read',
  discuss_decision: 'decision:read',
  get_decision_lineage: 'decision:read',
  record_decision_outcome: 'decision:write',
};

function scopeForMcpTool(toolName: string): AuthScope | null {
  return MCP_TOOL_SCOPE_MAP[toolName] || null;
}

export function requiredScope(req: http.IncomingMessage): AuthScope {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');

  if (pathname === '/api/admin/export') return 'admin:export';
  if (pathname === '/api/admin/import') return 'admin:import';

  // Per-tool scope for MCP endpoints
  if (pathname === '/mcp' || pathname.startsWith('/api/mcp/tool/')) {
    const toolName = url.searchParams.get('tool') || pathname.split('/').pop() || '';
    const scope = scopeForMcpTool(toolName);
    if (scope) return scope;
    return 'admin:delete';
  }

  if (pathname.startsWith('/api/settings')) return 'admin:import';
  if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/auth/devices')) {
    return 'admin:delete';
  }
  if (method === 'DELETE') return 'admin:delete';

  const decisionRoute = pathname.includes('/decision') || pathname.includes('/discussions');
  if (decisionRoute) return method === 'GET' ? 'decision:read' : 'decision:write';
  return method === 'GET' ? 'memory:read' : 'memory:write';
}"""

c2 = c2.replace(OLD, NEW)

# Add MCP tool name extraction for POST /mcp with body tool name
OLD2 = """  isPairExchange(req: http.IncomingMessage): boolean {
    return req.method === 'POST'
      && new URL(req.url || '/', 'http://localhost').pathname === '/api/auth/pair/exchange';
  }"""

NEW2 = """  isPairExchange(req: http.IncomingMessage): boolean {
    return req.method === 'POST'
      && new URL(req.url || '/', 'http://localhost').pathname === '/api/auth/pair/exchange';
  }

  static extractMcpToolFromRequest(req: http.IncomingMessage): string | null {
    const url = new URL(req.url || '/', 'http://localhost');
    const fromPath = url.pathname.split('/').pop();
    if (fromPath && MCP_TOOL_SCOPE_MAP[fromPath]) return fromPath;
    const fromQuery = url.searchParams.get('tool');
    if (fromQuery && MCP_TOOL_SCOPE_MAP[fromQuery]) return fromQuery;
    return null;
  }"""

c2 = c2.replace(OLD2, NEW2)

# Also need to export MCP_TOOL_SCOPE_MAP
c2 = c2.replace(
    "const MCP_TOOL_SCOPE_MAP: Record<string, AuthScope> = {",
    "export const MCP_TOOL_SCOPE_MAP: Record<string, AuthScope> = {"
)

with open(path2, "w", encoding="utf-8") as f:
    f.write(c2)
print("P0-13: MCP scope mapping done")
