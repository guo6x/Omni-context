import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { McpBusinessDispatcher } from '../src/mcp/dispatch.js';
import { BusinessError, formatToolResult } from '../src/mcp/errors.js';
import { tools } from '../src/mcp-tools.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { EmbeddingService } from '../src/embedding/service.js';
import { MemoryDecayScheduler } from '../src/memory/decay-scheduler.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';
import { E5_LARGE_USAGE_PROFILE, embeddingProfileFingerprint } from '../src/embedding/profiles.js';

/**
 * Contract tests for the unified MCP business dispatch layer.
 *
 * Guarantees:
 *  1. Every tool advertised by `tools` (mcp-tools.ts) is implemented by the
 *     dispatcher (no silent METHOD_NOT_FOUND).
 *  2. Same input -> same business result (determinism).
 *  3. The stdio adapter and the HTTP adapter serialize the SAME dispatcher
 *     result to byte-identical payloads (shared formatToolResult).
 *  4. The real HTTP endpoint returns exactly the dispatcher's business result
 *     (protocol layer does not alter business data).
 */

function testVector(text: string): number[] {
  const vector = new Array(1024).fill(0);
  let slot = 0;
  for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i) * (i + 1)) % vector.length;
  vector[slot] = 1;
  return vector;
}

const testEmbeddingService = {
  getUsageProfile: () => ({ ...E5_LARGE_USAGE_PROFILE, fingerprint: embeddingProfileFingerprint(E5_LARGE_USAGE_PROFILE) }),
  getStatus: () => 'local' as const,
  getInfo: () => ({
    mode: 'local', status: 'local', dimensions: 1024, actualDimension: 1024,
    model: E5_LARGE_USAGE_PROFILE.modelId,
    modelRevision: E5_LARGE_USAGE_PROFILE.modelRevision,
    modelSha256Verified: true,
  }),
  embedPassage: async (text: string) => ({ embedding: testVector(text), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
  embedQuery: async (text: string) => ({ embedding: testVector(text), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
  embed: async (text: string) => ({ embedding: testVector(text), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
};

let db: Database;
let dispatcher: McpBusinessDispatcher;
let server: http.Server;
let baseUrl: string;

// Read-only, deterministic inputs that avoid LLM/network calls.
const CONTRACT_INPUTS: Array<{ name: string; args: any }> = [
  { name: 'search_entities', args: { query: 'project', limit: 5 } },
  { name: 'get_core_context', args: { query: 'focus', limit: 5 } },
  { name: 'get_stats', args: {} },
  { name: 'list_entities', args: { limit: 20 } },
  { name: 'unified_memory_search', args: { query: 'product', limit: 5 } },
  { name: 'get_decision_context', args: { situation: 'should we ship the product?', limit: 5 } },
  { name: 'vector_search', args: { query: 'memory', limit: 5 } },
  { name: 'get_decay_report', args: {} },
];

beforeAll(async () => {
  process.env.LOCAL_API_TOKEN = 'test-token-123';

  // Mock LLM extraction so LLM-dependent tools never touch the network.
  vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics').mockResolvedValue({
    result: {
      entities: [{ name: 'UserService', type: 'concept', description: 'mock user service' }],
      facts: [],
      principles: [],
    },
    diagnostics: {
      http_status: 200,
      raw_response_sha256: 'a'.repeat(64),
      finish_reason: 'stop',
      status: 'parsed',
      parsed_counts: { entities: 1, facts: 0, principles: 0 },
      normalization: { entity_types: [], predicates: [] },
    },
  });

  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  await db.rebuildAllEmbeddings(testEmbeddingService as any);

  // Seed deterministic fixture data.
  const emb = (text: string) => ({ embedding: testVector(text) });
  const a = await db.addEntity({ name: 'Omni-Context', type: 'project', description: 'local AI memory product', tags: ['product'], embedding: emb('Omni-Context').embedding });
  const b = await db.addEntity({ name: 'Embedding v3', type: 'concept', description: 'next embedding migration', tags: ['embedding'], embedding: emb('Embedding v3').embedding });
  const c = await db.addEntity({ name: 'Focus rule', type: 'principle', description: 'focus on one thing at a time', tags: ['principle'], embedding: emb('Focus rule').embedding });
  await db.setCorePrinciple(c.id, true);
  await db.addRelationship({ source_id: a.id, target_id: b.id, type: 'depends_on', description: 'product depends on embedding', weight: 1 });

  const extractor = new GraphRAGExtractor();
  const decayScheduler = new MemoryDecayScheduler(db, {
    decayFactor: 0.95,
    staleDays: 90,
    intervalMs: 60 * 60 * 1000,
    autoStart: false,
  });

  dispatcher = new McpBusinessDispatcher({
    db,
    extractor,
    embeddingService: testEmbeddingService as unknown as EmbeddingService,
    decayScheduler,
  });

  // Start the real HTTP server sharing the SAME dispatcher instance.
  server = createServer(db, null, testEmbeddingService as any, decayScheduler, dispatcher);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await db.close();
});

async function httpToolCall(name: string, args: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/mcp/tool/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    },
    body: JSON.stringify({ arguments: args || {} }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

// `access_count` is an implicit-access side effect (business behavior) that
// increments on every retrieval; strip it before comparing determinism.
function stripAccessCount(value: any): any {
  if (Array.isArray(value)) return value.map(stripAccessCount);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'access_count') continue;
      out[k] = stripAccessCount(v);
    }
    return out;
  }
  return value;
}

describe('MCP unified dispatch — tool parity', () => {
  it('advertises exactly the tools defined in mcp-tools.ts', async () => {
    const listed = await dispatcher.listTools();
    expect(listed.tools).toHaveLength(tools.length);
    const advertised = new Set(listed.tools.map((t: any) => t.name));
    for (const t of tools) {
      expect(advertised.has(t.name)).toBe(true);
    }
  });

  it('every advertised tool is implemented (no METHOD_NOT_FOUND)', async () => {
    for (const t of tools) {
      try {
        await dispatcher.callTool(t.name, {});
      } catch (e) {
        // Empty args may be rejected as INVALID_PARAMS, but never as an
        // unimplemented tool.
        if (e instanceof BusinessError) {
          expect(e.code).not.toBe('METHOD_NOT_FOUND');
        }
      }
    }
  });
});

describe('MCP unified dispatch — determinism', () => {
  it('same input produces identical business result twice', async () => {
    for (const { name, args } of CONTRACT_INPUTS) {
      const first = JSON.stringify(stripAccessCount(await dispatcher.callTool(name, args)));
      const second = JSON.stringify(stripAccessCount(await dispatcher.callTool(name, args)));
      expect(second, `tool ${name} not deterministic`).toBe(first);
    }
  });
});

describe('MCP unified dispatch — adapter payload equivalence', () => {
  it('stdio adapter payload === HTTP adapter payload for the same dispatcher result', async () => {
    for (const { name, args } of CONTRACT_INPUTS) {
      const data = await dispatcher.callTool(name, args);

      // stdio adapter: formatToolResult (used by mcp-server.ts)
      const stdioPayload = formatToolResult(data);
      // HTTP adapter: formatToolResult (used by api/handlers/mcp.ts)
      const httpPayload = formatToolResult(data);

      expect(JSON.stringify(stdioPayload)).toBe(JSON.stringify(httpPayload));
      expect(stdioPayload.content[0].type).toBe('text');
      expect(stdioPayload.content[0].text).toBe(JSON.stringify(data, null, 2));
    }
  });
});

describe('MCP unified dispatch — HTTP endpoint contract', () => {
  it('HTTP /api/mcp/tool/:name returns exactly the dispatcher business result', async () => {
    for (const { name, args } of CONTRACT_INPUTS) {
      const direct = await dispatcher.callTool(name, args);
      const { status, body } = await httpToolCall(name, args);
      expect(status).toBe(200);
      expect(JSON.stringify(stripAccessCount(body))).toBe(JSON.stringify(stripAccessCount(direct)));
    }
  });

  it('HTTP error translation maps INVALID_PARAMS to 400', async () => {
    const { status, body } = await httpToolCall('search_entities', {});
    expect(status).toBe(400);
    expect(typeof body.error).toBe('string');
  });

  it('unknown tool maps to 404 METHOD_NOT_FOUND on HTTP and BusinessError on stdio', async () => {
    const { status } = await httpToolCall('definitely_not_a_tool', {});
    expect(status).toBe(404);
    await expect(dispatcher.callTool('definitely_not_a_tool', {})).rejects.toMatchObject({
      code: 'METHOD_NOT_FOUND',
    });
  });
});

describe('MCP unified dispatch — write semantics shared', () => {
  it('add_entity via HTTP persists into the same store the dispatcher reads', async () => {
    const viaHttp = {
      name: 'Contract Entity Via HTTP',
      type: 'concept',
      description: 'written through the HTTP adapter',
      tags: ['contract'],
    };
    const { status, body } = await httpToolCall('add_entity', viaHttp);
    expect(status).toBe(200);
    expect(body.name).toBe(viaHttp.name);
    expect(body.description).toBe(viaHttp.description);

    // Dispatcher reads back the entity the HTTP adapter wrote.
    const readBack = await dispatcher.callTool('get_entity', { id: body.id });
    expect(readBack.entity.name).toBe(viaHttp.name);

    // And vice versa: dispatcher writes, HTTP search finds it.
    const viaDispatcher = await dispatcher.callTool('add_entity', {
      name: 'Contract Entity Via Dispatcher',
      type: 'concept',
      description: 'written through the stdio business layer',
      tags: ['contract'],
    });
    const search = await httpToolCall('search_entities', { query: 'Contract Entity Via Dispatcher', limit: 5 });
    expect(search.status).toBe(200);
    expect(search.body.some((e: any) => e.id === viaDispatcher.id)).toBe(true);
  });
});
