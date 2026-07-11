import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { resolveEntities } from '../src/graphrag/entity-resolver.js';
import { Entity, EntityType } from '../src/shared-types.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function entity(id: string, name: string, type: EntityType, extra: Partial<Entity> = {}): Entity {
  const now = '2026-07-12T00:00:00.000Z';
  return {
    id,
    name,
    type,
    created_at: now,
    updated_at: now,
    last_accessed: now,
    access_count: 0,
    ...extra,
  };
}

describe('type-specific entity resolution policy', () => {
  it('does not auto-merge a same-name person without compatible context', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const existing = await db.addEntity({ id: 'person-existing', name: 'Alex Kim', type: 'person' });
    const result = await resolveEntities([entity('person-new', ' alex kim ', 'person')], [], db);
    expect(result.idMap['person-new']).toBe('person-new');
    expect(result.entitiesToCreate).toEqual([expect.objectContaining({ id: 'person-new' })]);
    expect(result.mergeCandidates).toEqual([
      expect.objectContaining({ canonicalId: existing.id, reason: 'exact_name_context_mismatch' }),
    ]);
    expect(await db.get<any>('SELECT status FROM entity_merge_candidates WHERE canonical_id = ?', [existing.id]))
      .toMatchObject({ status: 'pending' });
    await db.close();
  });

  it('allows an exact-name person merge when document context is the same', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const metadata = { extraction_chunks: [{ document_id: 'doc-shared', source: 'chat' }] };
    const existing = await db.addEntity({ id: 'person-context', name: 'Alex Kim', type: 'person', metadata });
    const result = await resolveEntities([
      entity('person-context-new', 'Alex Kim', 'person', { metadata }),
    ], [], db);
    expect(result.idMap['person-context-new']).toBe(existing.id);
    expect(result.entitiesToCreate[0].metadata).toMatchObject({
      merged_into: existing.id,
      merge_reason: 'normalized_name_exact',
      merge_operator: 'system',
      similarity: 1,
    });
    await db.close();
  });

  it('never auto-merges decisions even with exact name and context', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const metadata = { extraction_chunks: [{ document_id: 'decision-doc' }] };
    const existing = await db.addEntity({ id: 'decision-old', name: 'Choose database', type: 'decision', metadata });
    const result = await resolveEntities([
      entity('decision-new', 'Choose database', 'decision', { metadata }),
    ], [], db);
    expect(result.idMap['decision-new']).toBe('decision-new');
    expect(result.mergeCandidates[0]).toMatchObject({
      canonicalId: existing.id,
      reason: 'exact_name_manual_only',
    });
    await db.close();
  });

  it('auto-merges a high-confidence tool candidate and preserves conflicting provenance fields', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const existing = await db.addEntity({
      id: 'tool-existing',
      name: 'Postgres',
      type: 'tool',
      embedding: [1, 0, 0],
      metadata: { provenance: { source: 'official-docs', document_id: 'old-doc' } },
    });
    const result = await resolveEntities([
      entity('tool-new', 'PostgreSQL DB', 'tool', {
        embedding: [1, 0, 0],
        metadata: { provenance: { source: 'captured-page', document_id: 'new-doc' } },
      }),
    ], [], db);
    expect(result.idMap['tool-new']).toBe(existing.id);
    expect(result.entitiesToCreate[0].metadata).toMatchObject({
      merged_into: existing.id,
      merge_reason: 'type_specific_semantic_match',
      merge_operator: 'system',
    });
    expect(result.entitiesToUpdate[0].metadata?.provenance).toMatchObject({
      source: 'official-docs',
      document_id: 'old-doc',
      _field_conflicts: {
        source: ['official-docs', 'captured-page'],
        document_id: ['old-doc', 'new-doc'],
      },
    });
    await db.close();
  });

  it('limits embedding concurrency to four workers', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    let active = 0;
    let peak = 0;
    const embeddingService = {
      embed: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { embedding: [0.1, 0.2, 0.3] };
      },
    };
    const inputs = Array.from({ length: 12 }, (_, index) => entity(`concept-${index}`, `Concept ${index}`, 'concept'));
    await resolveEntities(inputs, [], db, embeddingService);
    expect(peak).toBeLessThanOrEqual(4);
    await db.close();
  });

  it('upgrades a persisted v16 database with review and audit tables', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-entity-resolution-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'legacy.db');
    const legacy = initDatabase({ dbPath });
    await legacy.runMigrations();
    await legacy.addEntity({ id: 'kept', name: 'Kept', type: 'concept' });
    await legacy.run('DROP TABLE entity_merge_audit');
    await legacy.run('DROP TABLE entity_merge_candidates');
    await legacy.run("DROP INDEX idx_entities_type_normalized_name");
    await legacy.run("DELETE FROM migrations WHERE name = 'add_entity_resolution_review_queue'");
    await legacy.close();

    const upgraded = initDatabase({ dbPath });
    await upgraded.runMigrations();
    expect(await upgraded.get('SELECT id FROM entities WHERE id = ?', ['kept'])).toBeTruthy();
    const tables = await upgraded.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('entity_merge_candidates', 'entity_merge_audit') ORDER BY name"
    );
    expect(tables.map((row) => row.name)).toEqual(['entity_merge_audit', 'entity_merge_candidates']);
    await upgraded.close();
  });
});
