import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { McpBusinessDispatcher } from '../src/mcp/dispatch.js';

function fixtureVector(_text: string): number[] {
  const vector = new Array(384).fill(0);
  vector[0] = 1;
  return vector;
}

const fixtureEmbeddingService = {
  getStatus: () => 'local' as const,
  embed: async (text: string) => ({ embedding: fixtureVector(text), dimensions: 384, model: 'synthetic-test' }),
  embedQuery: async (text: string) => ({ embedding: fixtureVector(text), dimensions: 384, model: 'synthetic-test' }),
};

describe('save_decision idempotency', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function setup() {
    const directory = await mkdtemp(join(tmpdir(), 'omni-decision-idempotency-'));
    directories.push(directory);
    const db = initDatabase(join(directory, 'brain.sqlite'));
    await db.runMigrations();
    const extractor = new GraphRAGExtractor();
    vi.spyOn(extractor, 'getLlmConfig').mockReturnValue({ apiUrl: '', apiKey: '', model: '' });
    return { db, dispatcher: new McpBusinessDispatcher({ db, extractor, embeddingService: fixtureEmbeddingService as any }) };
  }

  it('returns the original decision after a lost-response retry without duplicating links or archival memory', async () => {
    const { db, dispatcher } = await setup();
    try {
      const source = await db.addEntity({ name: 'Synthetic cited source', type: 'memory', description: 'fixture only' });
      const args = {
        idempotency_key: 'decision:fixture-session:fixture-turn:fixture-conclusion',
        situation: 'Synthetic retry scenario',
        conclusion: 'Keep the fixture local',
        cited_entity_ids: [source.id],
      };

      const first = await dispatcher.callTool('save_decision', args);
      const savedDecision = await db.getEntity(first.id);
      // Model the response being lost: the caller repeats the exact same request.
      const retry = await dispatcher.callTool('save_decision', args);
      const entities = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'decision'");
      const relationships = await db.all<{ count: number }>('SELECT COUNT(*) AS count FROM relationships WHERE source_id = ?', [first.id]);
      const archive = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM archival_memory WHERE content LIKE '%Keep the fixture local%'");

      expect(retry.id).toBe(first.id);
      expect(savedDecision?.metadata).toMatchObject({ authority: 'user_confirmed', user_confirmed: true });
      expect(entities[0].count).toBe(1);
      expect(relationships[0].count).toBe(1);
      expect(archive[0].count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rejects reuse of an idempotency key for a different decision payload', async () => {
    const { db, dispatcher } = await setup();
    try {
      const idempotency_key = 'decision:fixture-session:fixture-turn:fixture-conclusion';
      await dispatcher.callTool('save_decision', {
        idempotency_key,
        situation: 'Synthetic retry scenario',
        conclusion: 'Keep the fixture local',
      });

      await expect(dispatcher.callTool('save_decision', {
        idempotency_key,
        situation: 'Synthetic retry scenario',
        conclusion: 'Send the fixture to a provider',
      })).rejects.toMatchObject({ code: 'INVALID_PARAMS', message: 'IDEMPOTENCY_KEY_REUSED' });

      const entities = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'decision'");
      expect(entities[0].count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rolls back a decision, evidence links, and archival row together when a link write fails', async () => {
    const { db, dispatcher } = await setup();
    try {
      const source = await db.addEntity({ name: 'Synthetic rollback source', type: 'memory', description: 'fixture only' });
      const args = {
        idempotency_key: 'decision:fixture-rollback:one',
        situation: 'Synthetic rollback scenario',
        conclusion: 'Keep the fixture local',
        cited_entity_ids: [source.id],
      };
      vi.spyOn(db, 'addRelationship').mockRejectedValueOnce(new Error('synthetic relationship failure'));

      await expect(dispatcher.callTool('save_decision', args)).rejects.toThrow('synthetic relationship failure');
      const failedDecision = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'decision'");
      const failedArchive = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM archival_memory WHERE content LIKE '%Keep the fixture local%'");
      expect(failedDecision[0].count).toBe(0);
      expect(failedArchive[0].count).toBe(0);

      const retry = await dispatcher.callTool('save_decision', args);
      const savedDecision = await db.getEntity(retry.id);
      const relationships = await db.all<{ count: number }>('SELECT COUNT(*) AS count FROM relationships WHERE source_id = ?', [retry.id]);
      const archive = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM archival_memory WHERE content LIKE '%Keep the fixture local%'");
      expect(savedDecision?.type).toBe('decision');
      expect(relationships[0].count).toBe(1);
      expect(archive[0].count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);
});
