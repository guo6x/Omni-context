import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { E5_LARGE_USAGE_PROFILE, E5_SMALL_USAGE_PROFILE, embeddingProfileFingerprint } from '../src/embedding/profiles.js';

/**
 * Phase 3 (embedding v3 migration) fixture verification.
 *
 * Uses mock/fixture embeddings only — no remote model downloads, no full real
 * re-embed. Verifies the migration flow:
 *   1. per-row metadata records model/dimension/serialization/normalized/
 *      content hash/generated_at;
 *   2. the migration is resumable and interruptible (shadow build survives);
 *   3. the old index stays live until the new index is verified (no swap on
 *      incomplete/failed builds);
 *   4. mixed-generation indexes are rejected before activation
 *      (EMBEDDING_SERIALIZATION_MIX).
 */

function makeFixtureService(profile: any) {
  const fingerprint = embeddingProfileFingerprint(profile);
  const vector = (text: string) => {
    const v = new Array(profile.dimension).fill(0);
    let slot = 0;
    for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i) * (i + 1)) % profile.dimension;
    v[slot] = 1;
    return v;
  };
  return {
    getUsageProfile: () => ({ ...profile, fingerprint }),
    getStatus: () => 'local' as const,
    getInfo: () => ({ mode: 'local', status: 'local', dimensions: profile.dimension, model: profile.modelId }),
    embedPassage: async (text: string) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
    embedQuery: async (text: string) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
    embed: async (text: string) => ({ embedding: vector(text), dimensions: profile.dimension, model: profile.modelId }),
  };
}

let db: Database;

beforeAll(async () => {
  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  const emb = (text: string) => makeFixtureService(E5_SMALL_USAGE_PROFILE).embedPassage(text);
  const a = await db.addEntity({ name: 'Alpha', type: 'concept', description: 'alpha concept', embedding: (await emb('Alpha')).embedding });
  const b = await db.addEntity({ name: 'Beta', type: 'project', description: 'beta project', embedding: (await emb('Beta')).embedding });
  await db.addEntity({ name: 'Gamma', type: 'person', description: 'gamma person', embedding: (await emb('Gamma')).embedding });
  await db.addAssertion({ subject_id: a.id, predicate: 'relates_to', original_predicate: 'has_goal', literal_value: 'counseling', confidence: 0.9, source_span: 'Alpha wants counseling.', version: 1 });
  await db.addAssertion({ subject_id: b.id, predicate: 'depends_on', original_predicate: 'uses', literal_value: 'vector db', confidence: 0.9, source_span: 'Beta uses a vector db.', version: 1 });
});

afterAll(async () => {
  await db.close();
});

describe('embedding v3 migration — fixture flow', () => {
  it('writes full per-row metadata (model/dimension/serialization/normalized/hash/at) and activates manifests', async () => {
    const large = makeFixtureService(E5_LARGE_USAGE_PROFILE);
    const counts = await db.rebuildAllEmbeddings(large as any, undefined, { verifyBeforeActivate: true });
    expect(counts.entities).toBe(3);
    expect(counts.assertions).toBe(2);

    const entityMeta = await db.all<any>('SELECT * FROM entity_embedding_metadata ORDER BY entity_id');
    expect(entityMeta).toHaveLength(3);
    for (const row of entityMeta) {
      expect(row.embedding_model).toBe(E5_LARGE_USAGE_PROFILE.modelId);
      expect(row.dimension).toBe(1024);
      expect(row.serialization_version).toBe('entity-passage-v2');
      expect(row.normalized).toBe(1);
      expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.embedded_at).toBeTruthy();
    }
    const assertionMeta = await db.all<any>('SELECT * FROM assertion_embedding_metadata ORDER BY assertion_id');
    expect(assertionMeta).toHaveLength(2);
    for (const row of assertionMeta) {
      expect(row.embedding_model).toBe(E5_LARGE_USAGE_PROFILE.modelId);
      expect(row.dimension).toBe(1024);
      expect(row.serialization_version).toBe('assertion-passage-v3');
      expect(row.normalized).toBe(1);
      expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    const entityCheck = await db.verifyEmbeddingIndexConsistency('vec_entities');
    const assertionCheck = await db.verifyEmbeddingIndexConsistency('vec_assertions');
    expect(entityCheck.ok).toBe(true);
    expect(assertionCheck.ok).toBe(true);
    expect(entityCheck.serializationVersion).toBe('entity-passage-v2');
    expect(assertionCheck.serializationVersion).toBe('assertion-passage-v3');
  });

  it('keeps the old index live on interruption, then resumes to completion', async () => {
    // Build an initial "old" index with the 384-dim small profile.
    const small = makeFixtureService(E5_SMALL_USAGE_PROFILE);
    await db.rebuildAllEmbeddings(small as any, undefined, { verifyBeforeActivate: true });
    const oldManifest = await db.getEmbeddingIndexManifest('vec_entities');
    expect(oldManifest?.dimension).toBe(384);
    expect(oldManifest?.status).toBe('active');

    // Interrupted v3 rebuild: fixture service that throws after 2 embeds.
    let calls = 0;
    const throwingLarge = {
      ...makeFixtureService(E5_LARGE_USAGE_PROFILE),
      embedPassage: async (text: string) => {
        calls++;
        if (calls > 2) throw new Error('SIMULATED_INTERRUPT');
        return { embedding: new Array(1024).fill(0), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId };
      },
    };
    await expect(db.rebuildAllEmbeddings(throwingLarge as any)).rejects.toThrow('SIMULATED_INTERRUPT');

    // Old index still active and queryable with its own dimension.
    const stillOld = await db.getEmbeddingIndexManifest('vec_entities');
    expect(stillOld?.dimension).toBe(384);
    expect(stillOld?.status).toBe('active');
    const queryBlob = Buffer.from(new Float32Array(384).buffer);
    const legacyResults = await db.vectorSearch(Array(384).fill(0), 3);
    expect(legacyResults.length).toBeGreaterThanOrEqual(1);

    // Resume: same target profile -> shadow build continues (no re-embed of
    // unchanged rows), then swaps to 1024 and verifies.
    const resumed = await db.rebuildAllEmbeddings(makeFixtureService(E5_LARGE_USAGE_PROFILE) as any, undefined, { verifyBeforeActivate: true });
    expect(resumed.entities).toBe(3);
    const newManifest = await db.getEmbeddingIndexManifest('vec_entities');
    expect(newManifest?.dimension).toBe(1024);
    expect(newManifest?.status).toBe('active');
    const check = await db.verifyEmbeddingIndexConsistency('vec_entities');
    expect(check.ok).toBe(true);
    expect(check.dimension).toBe(1024);
  });

  it('rejects mixed-generation shadow builds before activation (EMBEDDING_SERIALIZATION_MIX)', async () => {
    // Rebuild with large profile but stop after 1 entity, tamper the shadow
    // metadata row, then resume: the tampered row is unchanged (hash matches)
    // so it is NOT re-embedded -> verification must fail BEFORE swap.
    let calls = 0;
    const stopAfterOne = {
      ...makeFixtureService(E5_LARGE_USAGE_PROFILE),
      embedPassage: async (text: string) => {
        calls++;
        if (calls > 1) throw new Error('STOP_AFTER_ONE');
        const v = new Array(1024).fill(0); v[0] = 1;
        return { embedding: v, dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId };
      },
    };
    await expect(db.rebuildAllEmbeddings(stopAfterOne as any)).rejects.toThrow('STOP_AFTER_ONE');

    await db.run(
      `UPDATE entity_embedding_metadata_build SET serialization_version = 'entity-passage-v1' WHERE entity_id = (
         SELECT entity_id FROM entity_embedding_metadata_build LIMIT 1
       )`,
    );

    // Resuming with a healthy fixture must now fail the pre-activation guard.
    await expect(
      db.rebuildAllEmbeddings(makeFixtureService(E5_LARGE_USAGE_PROFILE) as any, undefined, { verifyBeforeActivate: true }),
    ).rejects.toThrow('EMBEDDING_SERIALIZATION_MIX');

    // The live index must still be the pre-migration one (no partial swap).
    const manifest = await db.getEmbeddingIndexManifest('vec_entities');
    expect(manifest?.status).toBe('active');
    expect(manifest?.dimension).toBe(1024); // from the previous successful test
  });
});
