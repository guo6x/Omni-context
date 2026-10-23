import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpBusinessDispatcher } from '../src/mcp/dispatch.js';
import {
  ASK_HISTORY_MAX_CHARS,
  ASK_MESSAGE_MAX_CHARS,
  ASK_MESSAGES_MAX_ITEMS,
  ASK_QUERY_MAX_CHARS,
  resolveAskTurn,
} from '../src/mcp/ask-messages.js';
import { AskMemorySchema, tools } from '../src/mcp-tools.js';

const askTools = ['ask_memory', 'graph_answer'] as const;
const forbiddenRoles = ['system', 'developer', 'tool', 'arbitrary'] as const;

function createDispatcher() {
  const db = {
    searchEntities: vi.fn(async () => []),
    vectorSearch: vi.fn(async () => []),
    getCorePrinciples: vi.fn(async () => []),
    getEntitiesByTimeWindow: vi.fn(async () => []),
    getGraphNeighborhood: vi.fn(async () => ({ nodes: [], edges: [] })),
    getRelationshipsForEntity: vi.fn(async () => []),
    getAssertions: vi.fn(async () => []),
    bumpAccessCounts: vi.fn(async () => undefined),
    addEntity: vi.fn(async () => ({ id: 'unexpected-entity' })),
    updateEntity: vi.fn(async () => undefined),
    addRelationship: vi.fn(async () => undefined),
    addAssertion: vi.fn(async () => undefined),
  } as any;
  const extractor = {
    getLlmConfig: vi.fn(() => ({ apiUrl: 'https://provider.invalid', apiKey: 'fixture-only', model: 'fixture' })),
  } as any;
  const embeddingService = {
    getStatus: vi.fn(() => 'local' as const),
    embedQuery: vi.fn(async () => ({ embedding: new Array(384).fill(0), dimensions: 384, model: 'fixture' })),
    embed: vi.fn(async () => ({ embedding: new Array(384).fill(0), dimensions: 384, model: 'fixture' })),
  } as any;

  return {
    dispatcher: new McpBusinessDispatcher({ db, extractor, embeddingService }),
    db,
    extractor,
    embeddingService,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Ask tool message role boundary', () => {
  it('keeps user/assistant history and query fallback semantics', () => {
    const messages = [
      { role: 'user' as const, content: 'first question' },
      { role: 'assistant' as const, content: 'first answer' },
      { role: 'user' as const, content: 'latest question' },
    ];

    expect(resolveAskTurn('fallback query', messages)).toEqual({ messages, question: 'latest question' });
    expect(resolveAskTurn('fallback query', [{ role: 'assistant', content: 'prior answer' }])).toEqual({
      messages: [
        { role: 'assistant', content: 'prior answer' },
        { role: 'user', content: 'fallback query' },
      ],
      question: 'fallback query',
    });
    expect(resolveAskTurn('fallback query', [{ role: 'user', content: ' \n\t ' }])).toEqual({
      messages: [{ role: 'user', content: 'fallback query' }],
      question: 'fallback query',
    });
    expect(resolveAskTurn('query-only fallback', undefined)).toEqual({
      messages: [{ role: 'user', content: 'query-only fallback' }],
      question: 'query-only fallback',
    });
  });

  it('publishes matching MCP input bounds and requires a non-empty user question', () => {
    for (const name of askTools) {
      const schema = tools.find((tool) => tool.name === name)?.inputSchema as any;
      expect(schema.properties.query.maxLength).toBe(ASK_QUERY_MAX_CHARS);
      expect(schema.properties.messages.maxItems).toBe(ASK_MESSAGES_MAX_ITEMS);
      expect(schema.properties.messages.items.properties.content.maxLength).toBe(ASK_MESSAGE_MAX_CHARS);
      expect(ASK_HISTORY_MAX_CHARS).toBe(ASK_MESSAGES_MAX_ITEMS * ASK_MESSAGE_MAX_CHARS);
    }

    expect(AskMemorySchema.safeParse({ messages: [] }).success).toBe(false);
    expect(AskMemorySchema.safeParse({ messages: [{ role: 'user', content: ' \t ' }] }).success).toBe(false);
    expect(AskMemorySchema.safeParse({ messages: [
      { role: 'user', content: 'earlier question' },
      { role: 'user', content: ' \t ' },
    ] }).success).toBe(false);
    expect(AskMemorySchema.safeParse({ query: 'useful fallback', messages: [{ role: 'user', content: ' \t ' }] }).success).toBe(true);
  });

  it('rejects empty and oversized questions before provider configuration or retrieval', async () => {
    const { dispatcher, db, extractor, embeddingService } = createDispatcher();
    const fetchSpy = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', fetchSpy);
    const invalidInputs = [
      { messages: [] },
      { messages: [{ role: 'user', content: ' \n\t ' }] },
      { query: ' \n\t ' },
      { query: 'q'.repeat(8_001) },
      { messages: [{ role: 'user', content: 'q'.repeat(8_001) }] },
      { messages: Array.from({ length: 9 }, () => ({ role: 'user', content: 'q' })) },
      { messages: Array.from({ length: 8 }, () => ({ role: 'user', content: 'q'.repeat(4_001) })) },
    ];

    for (const input of invalidInputs) {
      for (const tool of askTools) {
        await expect(dispatcher.callTool(tool, input)).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      }
    }

    expect(extractor.getLlmConfig).not.toHaveBeenCalled();
    expect(embeddingService.embedQuery).not.toHaveBeenCalled();
    expect(db.searchEntities).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps AI-derived authority markers on Ask memory source projections', async () => {
    const { dispatcher, db } = createDispatcher();
    const memory = {
      id: 'fixture-ai-memory',
      name: 'Alpha rollout notes',
      type: 'memory',
      description: 'A fixture source about the alpha rollout.',
      tags: [],
      metadata: { authority: 'ai_derived', user_confirmed: false },
    };
    db.searchEntities.mockResolvedValue([memory]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'A fixture-grounded answer.' } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await dispatcher.callTool('ask_memory', { query: 'Alpha rollout' });

    expect(result.sources).toEqual([expect.objectContaining({
      id: memory.id,
      authority: 'ai_derived',
      user_confirmed: false,
    })]);
  });

  it('sends a valid fallback query to the Ask provider after assistant-only history', async () => {
    const { dispatcher, db } = createDispatcher();
    db.searchEntities.mockResolvedValue([{
      id: 'fixture-fallback-memory',
      name: 'Fallback query support',
      type: 'memory',
      description: 'A fixture source for the fallback question.',
      tags: [],
    }]);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'A fixture-grounded answer.' } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const query = 'What did I retain about fallback behavior?';

    await dispatcher.callTool('ask_memory', {
      query,
      messages: [{ role: 'assistant', content: 'A previous answer.' }],
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body));
    expect(requestBody.messages.at(-1)).toEqual({ role: 'user', content: query });
  });

  it('rejects non-user/assistant roles before provider configuration, retrieval, or mutation', async () => {
    const { dispatcher, db, extractor, embeddingService } = createDispatcher();
    const fetchSpy = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', fetchSpy);

    for (const role of forbiddenRoles) {
      for (const tool of askTools) {
        await expect(dispatcher.callTool(tool, {
          query: 'query fallback must not bypass message validation',
          messages: [{ role, content: 'untrusted role content' }],
        })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
      }
      await expect(dispatcher.callTool('discuss_decision', {
        situation: 'test decision',
        messages: [{ role, content: 'untrusted role content' }],
      })).rejects.toMatchObject({ code: 'INVALID_PARAMS' });
    }

    expect(extractor.getLlmConfig).not.toHaveBeenCalled();
    expect(embeddingService.embedQuery).not.toHaveBeenCalled();
    expect(db.searchEntities).not.toHaveBeenCalled();
    expect(db.vectorSearch).not.toHaveBeenCalled();
    expect(db.getCorePrinciples).not.toHaveBeenCalled();
    expect(db.addEntity).not.toHaveBeenCalled();
    expect(db.updateEntity).not.toHaveBeenCalled();
    expect(db.addRelationship).not.toHaveBeenCalled();
    expect(db.addAssertion).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses query fallback for both tools when legal history has no user turn', async () => {
    const { dispatcher, db, embeddingService } = createDispatcher();
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'DONE' } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const query = 'offline alpha follow-up';

    for (const tool of askTools) {
      await dispatcher.callTool(tool, {
        query,
        messages: [{ role: 'assistant', content: 'previous answer' }],
      });
    }

    expect(db.searchEntities).toHaveBeenCalledTimes(2);
    expect(db.searchEntities).toHaveBeenNthCalledWith(1, query, expect.any(Number));
    expect(db.searchEntities).toHaveBeenNthCalledWith(2, query, expect.any(Number));
    expect(embeddingService.embedQuery).toHaveBeenCalledTimes(2);
    expect(embeddingService.embedQuery).toHaveBeenNthCalledWith(1, query);
    expect(embeddingService.embedQuery).toHaveBeenNthCalledWith(2, query);
    // graph_answer performs additive agentic enrichment even with no initial hits;
    // that request must receive the resolved query, not the assistant-only history.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    expect(requestBody.messages.at(-1).content).toContain(query);
  });
});
