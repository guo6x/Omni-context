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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('discussion continuity persistence', () => {
  it('restores a stable discussion ID, source and decision references after reopen, and upserts retries without duplicates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omni-discussion-continuity-'));
    const dbPath = join(directory, 'brain.sqlite');
    let db: ReturnType<typeof initDatabase> | null = initDatabase(dbPath);

    try {
      await db.runMigrations();
      const discussionId = 'discussion-stable-fixture-01';
      const legacyTurn = {
        question: 'What did I decide earlier?',
        conclusion: 'Keep the first answer available.',
        questions: [],
        sources: [],
        savedAsDecision: true,
      };
      const turnWithReferences = {
        question: 'Which sources supported the saved decision?',
        conclusion: 'Keep the offline import path.',
        questions: ['Should the constraint be revisited?'],
        isDecision: true,
        sources: [{ id: 'source-entity-fixture-01', name: 'Offline import note' }],
        savedAsDecision: true,
        savedDecisionId: 'decision-fixture-01',
        decisionConclusion: 'Keep the offline import path.',
      };
      const turns = [legacyTurn, turnWithReferences];

      await db.upsertDiscussion({ id: discussionId, title: legacyTurn.question, turns });
      await db.close();
      db = null;

      db = initDatabase(dbPath);
      await db.runMigrations();
      const restored = await db.getDiscussion(discussionId);
      expect(restored).toMatchObject({ id: discussionId, turns });
      expect(restored?.turns[0].savedAsDecision).toBe(true);
      expect(restored?.turns[1]).toMatchObject({
        sources: [{ id: 'source-entity-fixture-01' }],
        savedAsDecision: true,
        savedDecisionId: 'decision-fixture-01',
      });

      // A retry resubmits the same client-owned key and snapshot; it must update
      // that row, not append a duplicate discussion or duplicate turn.
      await db.upsertDiscussion({ id: discussionId, title: legacyTurn.question, turns });
      const rows = await db.all<{ id: string; turns: string }>(
        'SELECT id, turns FROM discussions WHERE id = ?',
        [discussionId],
      );
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].turns)).toEqual(turns);
    } finally {
      try {
        if (db) await db.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it('makes a saved decision retrievable through MCP decision context', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'omni-decision-retrieval-'));
    const db = initDatabase(join(directory, 'brain.sqlite'));

    try {
      await db.runMigrations();
      const extractor = new GraphRAGExtractor();
      // Keep this contract test hermetic even if a developer has configured a provider locally.
      vi.spyOn(extractor, 'getLlmConfig').mockReturnValue({ apiUrl: '', apiKey: '', model: '' });
      const dispatcher = new McpBusinessDispatcher({
        db,
        extractor,
        embeddingService: fixtureEmbeddingService as any,
      });

      const saved = await dispatcher.callTool('save_decision', {
        situation: 'offline alpha shard continuity',
        conclusion: 'Keep synthetic continuity data local',
        confidence: 'high',
      });
      const context = await dispatcher.callTool('get_decision_context', {
        situation: 'offline alpha shard continuity',
        limit: 5,
      });

      expect(saved).toMatchObject({ id: expect.any(String), type: 'decision' });
      expect(context.relevantMemories).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: saved.id, type: 'decision' }),
      ]));
    } finally {
      try {
        await db.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }, 30_000);
});
