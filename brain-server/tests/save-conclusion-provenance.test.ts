import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { McpBusinessDispatcher } from '../src/mcp/dispatch.js';
import type { Entity } from '../src/shared-types.js';

const now = '2026-10-23T00:00:00.000Z';

function extractedMemory(id: string, name: string, description: string): Entity {
  return {
    id,
    name,
    type: 'memory',
    description,
    created_at: now,
    updated_at: now,
    last_accessed: now,
    access_count: 0,
  };
}

function createDispatcher(db: ReturnType<typeof initDatabase>, memory: Entity): McpBusinessDispatcher {
  const extractor = {
    extract: async () => ({ entities: [memory], relationships: [], principles: [], assertions: [] }),
    summarizeEntities: async () => 'A saved test conclusion',
    getLlmConfig: () => ({ apiUrl: '', apiKey: '', model: '' }),
  } as any;

  // These tests exercise resolver policy without invoking local embeddings or a
  // remote provider; embeddings are not required for exact-name matching.
  return new McpBusinessDispatcher({ db, extractor, embeddingService: undefined as any });
}

describe('save_conclusion provenance and confirmed-memory protection', () => {
  let db: ReturnType<typeof initDatabase>;

  beforeAll(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  }, 30_000);

  afterAll(async () => { await db.close(); });

  it('marks extracted entities as AI-derived before resolution and persists the provenance', async () => {
    const dispatcher = createDispatcher(db, extractedMemory('new-memory', 'A useful conclusion', 'An AI-extracted conclusion.'));

    const result = await dispatcher.callTool('save_conclusion', { summary: 'Please remember this conclusion.' });

    expect(result).toMatchObject({ savedEntities: 1 });
    await expect(db.getEntity('new-memory')).resolves.toMatchObject({
      metadata: {
        authority: 'ai_derived',
        user_confirmed: false,
        provenance: { source: 'external_ai', tool: 'save_conclusion' },
      },
    });
  });

  it('preserves extracted provenance fields while adding save_conclusion provenance', async () => {
    const memory = extractedMemory('memory-with-source', 'Source-backed conclusion', 'A sourced conclusion.');
    memory.metadata = {
      provenance: { source: 'imported_document', document_id: 'fixture-doc', source_span: 'lines 3-4' },
    };
    const dispatcher = createDispatcher(db, memory);

    await dispatcher.callTool('save_conclusion', { summary: 'Please remember this sourced conclusion.' });

    await expect(db.getEntity(memory.id)).resolves.toMatchObject({
      metadata: {
        provenance: {
          source: 'external_ai',
          tool: 'save_conclusion',
          document_id: 'fixture-doc',
          source_span: 'lines 3-4',
        },
      },
    });
  });

  it('routes an exact AI update to review without changing a user-confirmed memory', async () => {
    const original = await db.addEntity({
      id: 'confirmed-memory',
      name: 'Launch constraint',
      type: 'memory',
      description: 'The user confirmed the original launch constraint.',
      metadata: {
        authority: 'user_confirmed',
        user_confirmed: true,
        provenance: { source: 'user-confirmed' },
      },
    });
    const dispatcher = createDispatcher(db, extractedMemory(
      'ai-launch-constraint',
      'Launch constraint',
      'A longer AI rewrite that must not replace the confirmed statement.',
    ));

    const result = await dispatcher.callTool('save_conclusion', { summary: 'Please remember this conclusion.' });

    expect(result).toMatchObject({ savedEntities: 1 });
    await expect(db.getEntity(original.id)).resolves.toMatchObject({
      description: 'The user confirmed the original launch constraint.',
      metadata: {
        authority: 'user_confirmed',
        user_confirmed: true,
        provenance: { source: 'user-confirmed' },
      },
    });
    const review = await db.get<{ canonical_id: string; candidate_entity_id: string; reason: string }>(
      'SELECT canonical_id, candidate_entity_id, reason FROM entity_merge_candidates WHERE canonical_id = ?',
      [original.id],
    );
    expect(review).toMatchObject({
      canonical_id: original.id,
      candidate_entity_id: 'ai-launch-constraint',
      reason: 'confirmed_memory_update_requires_review',
    });
    await expect(db.getEntity('ai-launch-constraint')).resolves.toMatchObject({
      metadata: {
        authority: 'ai_derived',
        user_confirmed: false,
        provenance: { source: 'external_ai', tool: 'save_conclusion' },
      },
    });
  });

  it('continues merging an exact-name memory when the existing memory is not confirmed', async () => {
    const existing = await db.addEntity({
      id: 'unconfirmed-memory',
      name: 'Retry policy',
      type: 'memory',
      description: 'Use bounded retries.',
      metadata: { authority: 'ai_derived', user_confirmed: false },
    });
    const dispatcher = createDispatcher(db, extractedMemory(
      'ai-retry-policy',
      'Retry policy',
      'Use bounded retries with jitter and preserve the request key across retries.',
    ));

    const result = await dispatcher.callTool('save_conclusion', { summary: 'Please remember this conclusion.' });

    expect(result).toMatchObject({ savedEntities: 2 });
    await expect(db.getEntity(existing.id)).resolves.toMatchObject({
      description: 'Use bounded retries with jitter and preserve the request key across retries.',
      metadata: {
        authority: 'ai_derived',
        user_confirmed: false,
        provenance: { source: 'external_ai', tool: 'save_conclusion' },
      },
    });
    await expect(db.all('SELECT id FROM entity_merge_candidates WHERE canonical_id = ?', [existing.id])).resolves.toEqual([]);
  });
});
