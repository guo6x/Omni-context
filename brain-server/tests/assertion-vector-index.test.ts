import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { E5_LARGE_USAGE_PROFILE, embeddingProfileFingerprint } from '../src/embedding/profiles.js';

function vectorFor(text: string): number[] {
  const vector = new Array(1024).fill(0);
  let slot = 0;
  for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i) * (i + 1)) % vector.length;
  vector[slot] = 1;
  return vector;
}

const embeddingService = {
  getUsageProfile: () => ({
    ...E5_LARGE_USAGE_PROFILE,
    fingerprint: embeddingProfileFingerprint(E5_LARGE_USAGE_PROFILE),
  }),
  embedPassage: async (text: string) => ({
    embedding: vectorFor(text),
    dimensions: 1024,
    model: E5_LARGE_USAGE_PROFILE.modelId,
    usage: 'passage' as const,
    usageProfileVersion: E5_LARGE_USAGE_PROFILE.usageProfileVersion,
    latencyMs: 1,
  }),
};

describe('assertion vector index', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.rebuildAllEmbeddings(embeddingService as any);
  });

  afterEach(async () => db.close());

  it('indexes every valid assertion as a separate readable passage', async () => {
    const subject = await db.addEntity({
      name: 'Caroline', type: 'person', description: 'Interested in counseling',
      embedding: vectorFor('Caroline'),
    });
    const assertion = await db.addAssertion({
      subject_id: subject.id,
      predicate: 'relates_to',
      original_predicate: 'has_goal',
      literal_value: 'counseling certification',
      confidence: 0.95,
      source_span: "I'm keen on counseling or working in mental health",
      provenance: { speaker: 'Caroline', session_id: '1' },
      version: 1,
    });
    const resolved = await db.getResolvedAssertion(assertion.id);
    const results = await db.assertionVectorSearch(vectorFor(resolved!.passage), 10);

    expect(results[0]).toMatchObject({ id: assertion.id, subjectName: 'Caroline' });
    expect(results[0].passage).toContain('Relation: has_goal');
    expect(results[0].passage).not.toContain(subject.id);
    const integrity = await db.scanEmbeddingIntegrity();
    expect(integrity.assertion).toMatchObject({ active: 1, vectors: 1, metadata: 1, coverage: 1 });
    expect(integrity).toMatchObject({ zeroVectors: 0, nanVectors: 0, wrongDimensions: 0, orphanVectors: 0, staleVectors: 0 });
  });

  it('re-embeds when assertion content changes and removes invalidated evidence', async () => {
    const subject = await db.addEntity({ name: 'Melanie', type: 'person', description: 'Runner', embedding: vectorFor('Melanie') });
    const assertion = await db.addAssertion({
      subject_id: subject.id, predicate: 'relates_to', original_predicate: 'attended',
      literal_value: 'charity race', confidence: 0.9, source_span: 'I ran a charity race.', version: 1,
    });
    const before = await db.get<{ content_sha256: string }>(
      'SELECT content_sha256 FROM assertion_embedding_metadata WHERE assertion_id = ?', [assertion.id],
    );

    await db.updateAssertion(assertion.id, { source_span: 'I ran a charity race for mental health.' });
    const after = await db.get<{ content_sha256: string }>(
      'SELECT content_sha256 FROM assertion_embedding_metadata WHERE assertion_id = ?', [assertion.id],
    );
    expect(after?.content_sha256).not.toBe(before?.content_sha256);

    await db.invalidateAssertion(assertion.id, 'superseded');
    const integrity = await db.scanEmbeddingIntegrity();
    expect(integrity.assertion).toMatchObject({ active: 0, vectors: 0, metadata: 0, coverage: 1 });
  });

  it('keeps historical assertions available only for an as-of interval', async () => {
    const subject = await db.addEntity({ name: 'Caroline', type: 'person', description: 'Traveler', embedding: vectorFor('Caroline') });
    const assertion = await db.addAssertion({
      subject_id: subject.id, predicate: 'relates_to', original_predicate: 'moved_from',
      literal_value: 'old home', confidence: 0.9, source_span: 'I moved from my old home.',
      valid_from: '2023-01-01T00:00:00.000Z', valid_until: '2023-06-01T00:00:00.000Z', version: 1,
    });
    const passage = (await db.getResolvedAssertion(assertion.id))!.passage;
    const query = vectorFor(passage);

    expect(await db.assertionVectorSearch(query, 10)).toHaveLength(0);
    expect(await db.assertionVectorSearch(query, 10, {
      includeHistorical: true,
      asOf: '2023-03-01T00:00:00.000Z',
    })).toHaveLength(1);
  });
});
