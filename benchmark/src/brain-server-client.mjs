/**
 * HTTP client for the Omni-Context Brain Server.
 * Used by the benchmark runner to ingest conversations via real GraphRAG extraction,
 * retrieve memories, and get graph-augmented answers.
 */

export class BrainServerClient {
  constructor({ baseUrl, token }) {
    if (!baseUrl) throw new Error('BrainServerClient requires baseUrl');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token || '';
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = new Error(`Brain Server ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
      error.status = res.status;
      try { error.responseBody = JSON.parse(text); } catch { error.responseBody = text; }
      throw error;
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** GET /health — verify Brain Server is reachable. */
  async health() {
    return this.request('GET', '/health');
  }

  /** GET /api/admin/embedding/status — verify semantic embedding is available. */
  async getEmbeddingStatus() {
    return this.request('GET', '/api/admin/embedding/status');
  }

  /** Explicitly build shadow indexes and atomically activate them. */
  async rebuildEmbeddings() {
    return this.request('POST', '/api/admin/embedding/rebuild', { confirm: true });
  }

  /** GET /api/stats — verify DB is writable and get entity/relationship counts. */
  async getStats() {
    return this.request('GET', '/api/stats');
  }

  /**
   * POST /api/graph/extract — ingest text via real GraphRAG extraction.
   * This triggers: LLM extraction -> entity resolution -> assertion/relationship write -> embedding.
   * Returns { entities: number, relationships: number, principles: number, summary: string }.
   */
  async extract(text, source, { timestamp, sessionId, evaluationMode = false } = {}) {
    return this.request('POST', '/api/graph/extract', {
      text,
      source,
      timestamp,
      session_id: sessionId,
      evaluation_mode: evaluationMode,
    });
  }

  /**
   * POST /api/mcp/tool/unified_memory_search — retrieve memories via hybrid search.
   * Returns { results: [...], graphContext: {...}, searchMethods: {...} }.
   */
  async unifiedMemorySearch(query, limit = 10) {
    return this.request('POST', '/api/mcp/tool/unified_memory_search', {
      arguments: { query, limit, includeRelationships: true },
    });
  }

  /**
   * POST /api/mcp/tool/graph_answer — get a graph-augmented answer.
   * Returns { conclusion, reasons, sources, edges, citedEntityIds, grounding }.
   */
  async graphAnswer(query) {
    return this.request('POST', '/api/mcp/tool/graph_answer', {
      arguments: { query },
    });
  }

  /**
   * Pre-flight checks: verify Brain Server is healthy, embedding is available
   * (not hash-fallback), and DB is writable.
   * Throws if any check fails.
   */
  async preflight() {
    // 1. Health check
    let health;
    try {
      health = await this.health();
    } catch (err) {
      throw new Error(`Brain Server health check failed at ${this.baseUrl}: ${err.message}`);
    }
    if (!health || !health.ok) {
      throw new Error(`Brain Server unhealthy: ${JSON.stringify(health)}`);
    }

    // 2. Embedding status — must be semantic, not hash-fallback
    let embStatus;
    try {
      embStatus = await this.getEmbeddingStatus();
    } catch (err) {
      throw new Error(`Cannot retrieve embedding status: ${err.message}. Ensure LOCAL_API_TOKEN is set correctly.`);
    }
    if (!embStatus) {
      throw new Error('Embedding status endpoint returned empty response');
    }
    if (embStatus.status === 'hash-fallback' || embStatus.mode === 'hash') {
      throw new Error(
        `Semantic embedding is NOT available (status: ${embStatus.status}, mode: ${embStatus.mode}). ` +
        'Hash fallback is forbidden for formal evaluation. ' +
        'Set EMBEDDING_MODE=local or EMBEDDING_MODE=api with a valid model.'
      );
    }
    if (!embStatus.healthy) {
      throw new Error(`Embedding is not healthy: ${JSON.stringify(embStatus)}`);
    }

    // 3. DB writable — stats endpoint exercises the database
    let stats;
    try {
      stats = await this.getStats();
    } catch (err) {
      throw new Error(`Cannot retrieve database stats (DB may not be writable): ${err.message}`);
    }
    if (!stats || !stats.database) {
      throw new Error('Database stats returned invalid response');
    }

    return { health, embeddingStatus: embStatus, stats };
  }
}
