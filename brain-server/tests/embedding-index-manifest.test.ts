import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import initDatabase, { Database, EmbeddingIndexSpec } from '../src/db/sqlite.js';

const specs: EmbeddingIndexSpec[] = [
  {
    indexName: 'vec_entities',
    modelId: 'Xenova/multilingual-e5-large',
    modelRevision: 'a19b072cb4f0cc8bf98b4e46f90a787a61380979',
    dimension: 1024,
    usageProfileVersion: 'e5-large-v1',
    serializationVersion: 'entity-passage-v2',
  },
  {
    indexName: 'vec_assertions',
    modelId: 'Xenova/multilingual-e5-large',
    modelRevision: 'a19b072cb4f0cc8bf98b4e46f90a787a61380979',
    dimension: 1024,
    usageProfileVersion: 'e5-large-v1',
    serializationVersion: 'assertion-passage-v1',
  },
];

describe('explicit embedding index manifests', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates separate 1024-dimensional entity and assertion indexes', async () => {
    await db.prepareEmbeddingIndexes(specs);
    await db.activateEmbeddingIndex('vec_entities', 0);
    await db.activateEmbeddingIndex('vec_assertions', 0);

    const manifests = await db.getEmbeddingIndexManifests();
    expect(manifests).toHaveLength(2);
    expect(manifests.every((item) => item.dimension === 1024 && item.status === 'active')).toBe(true);
    const tables = await db.all<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE name IN ('vec_entities','vec_assertions') ORDER BY name",
    );
    expect(tables).toHaveLength(2);
    expect(tables.every((table) => table.sql.includes('FLOAT[1024]'))).toBe(true);
  });

  it('rejects a mismatched query without rebuilding or dropping the active index', async () => {
    await db.prepareEmbeddingIndexes(specs);
    await db.activateEmbeddingIndex('vec_entities', 0);
    await db.activateEmbeddingIndex('vec_assertions', 0);

    await expect(db.vectorSearch(new Array(384).fill(0.01), 5)).rejects.toThrow('ENTITY_VECTOR_DIMENSION_MISMATCH');
    const table = await db.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE name='vec_entities'");
    expect(table?.sql).toContain('FLOAT[1024]');
  });

  it('archives the old manifest when a profile version forces an explicit rebuild', async () => {
    await db.prepareEmbeddingIndexes(specs);
    await db.activateEmbeddingIndex('vec_entities', 0);
    await db.activateEmbeddingIndex('vec_assertions', 0);
    const changed = specs.map((spec) => ({ ...spec, usageProfileVersion: 'e5-large-v2' }));

    await db.prepareEmbeddingIndexes(changed, { force: true });

    const history = await db.all<{ index_name: string; manifest_json: string }>(
      'SELECT index_name, manifest_json FROM embedding_index_manifest_history ORDER BY id',
    );
    expect(history).toHaveLength(2);
    expect(history.every((row) => JSON.parse(row.manifest_json).usage_profile_version === 'e5-large-v1')).toBe(true);
  });

  it('requires force before clearing indexes for a non-empty database', async () => {
    await db.addEntity({ name: 'Existing', type: 'concept', description: 'kept until explicit rebuild' });
    await expect(db.prepareEmbeddingIndexes(specs)).rejects.toThrow('REQUIRES_FORCE');
  });
});
