import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';

async function addSubject(db: ReturnType<typeof initDatabase>, id: string) {
  await db.addEntity({
    id,
    name: id,
    type: 'person',
    description: '',
    tags: [],
  });
}

describe('temporal assertions', () => {
  it('distinguishes current facts from state at a historical point in time', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await addSubject(db, 'person-1');

    await db.addAssertion({
      id: 'home-old',
      subject_id: 'person-1',
      predicate: 'lives_in',
      literal_value: 'Shanghai',
      confidence: 0.95,
      source_span: 'I lived in Shanghai until June.',
      provenance: { document_id: 'doc-1', chunk_id: 'chunk-1' },
      valid_from: '2025-01-01T00:00:00.000Z',
      valid_until: '2025-06-01T00:00:00.000Z',
      temporal_confidence: 0.9,
      temporal_source: 'explicit_date',
      timezone: 'Asia/Shanghai',
    });
    await db.addAssertion({
      id: 'home-current',
      subject_id: 'person-1',
      predicate: 'lives_in',
      literal_value: 'Beijing',
      confidence: 0.98,
      source_span: 'I moved to Beijing in June.',
      valid_from: '2025-06-01T00:00:00.000Z',
    });

    const historical = await db.getAssertions({
      subjectId: 'person-1',
      predicate: 'lives_in',
      asOf: '2025-03-01T00:00:00.000Z',
    });
    const current = await db.getAssertions({
      subjectId: 'person-1',
      predicate: 'lives_in',
      asOf: '2025-08-01T00:00:00.000Z',
    });

    expect(historical.map((fact) => fact.literal_value)).toEqual(['Shanghai']);
    expect(current.map((fact) => fact.literal_value)).toEqual(['Beijing']);
    expect(historical[0].provenance).toEqual({ document_id: 'doc-1', chunk_id: 'chunk-1' });
    await db.close();
  });

  it('invalidates without deleting history and rejects malformed facts', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await addSubject(db, 'person-2');
    await db.addAssertion({
      id: 'preference-1',
      subject_id: 'person-2',
      predicate: 'prefers_editor',
      literal_value: 'Vim',
      confidence: 0.8,
      valid_from: '2025-01-01T00:00:00.000Z',
    });
    await db.invalidateAssertion('preference-1', 'user changed preference', '2025-02-01T00:00:00.000Z');

    expect(await db.getAssertions({ subjectId: 'person-2', asOf: '2025-03-01T00:00:00.000Z' })).toEqual([]);
    const history = await db.getAssertions({ subjectId: 'person-2', includeHistorical: true });
    expect(history).toHaveLength(1);
    expect(history[0].invalidation_reason).toBe('user changed preference');
    await expect(db.addAssertion({
      subject_id: 'person-2',
      predicate: 'bad predicate with spaces',
      literal_value: 'x',
      confidence: 1,
    })).rejects.toThrow(/predicate/);
    await db.close();
  });

  it('writes new relationships through to provenance-linked assertions', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await addSubject(db, 'source-1');
    await addSubject(db, 'target-1');
    await db.addRelationship({
      id: 'relationship-1',
      source_id: 'source-1',
      target_id: 'target-1',
      type: 'knows',
      weight: 0.7,
      description: 'legacy evidence',
      event_time: '2025-04-01T00:00:00.000Z',
      valid_from: '2025-04-01T00:00:00.000Z',
      temporal_confidence: 0.85,
      temporal_source: 'explicit_date',
    });

    const assertions = await db.getAssertions({ subjectId: 'source-1' });
    expect(assertions).toHaveLength(1);
    expect(assertions[0]).toMatchObject({
      id: 'relationship:relationship-1',
      predicate: 'knows',
      object_id: 'target-1',
      confidence: 0.7,
      event_time: '2025-04-01T00:00:00.000Z',
      temporal_confidence: 0.85,
      temporal_source: 'explicit_date',
    });
    await db.close();
  });

  it('upgrades a persisted v14 database without deleting legacy relationships', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-temporal-v14-'));
    const dbPath = path.join(directory, 'legacy.db');
    try {
      const legacy = initDatabase({ dbPath });
      await legacy.runMigrations();
      await addSubject(legacy, 'legacy-source');
      await addSubject(legacy, 'legacy-target');
      await legacy.addRelationship({
        id: 'legacy-relationship',
        source_id: 'legacy-source',
        target_id: 'legacy-target',
        type: 'knows',
        weight: 0.9,
      });
      await legacy.run('DROP TABLE assertions');
      for (const column of [
        'observed_at', 'recorded_at', 'event_time', 'valid_from', 'valid_until',
        'temporal_confidence', 'temporal_source', 'timezone',
      ]) {
        await legacy.run(`ALTER TABLE entities DROP COLUMN ${column}`);
      }
      await legacy.run("DELETE FROM migrations WHERE name = 'add_temporal_assertions'");
      await legacy.close();

      const upgraded = initDatabase({ dbPath });
      await upgraded.runMigrations();
      const relationship = await upgraded.get<{ id: string }>(
        "SELECT id FROM relationships WHERE id = 'legacy-relationship'",
      );
      const assertion = await upgraded.getAssertions({ subjectId: 'legacy-source' });
      expect(relationship?.id).toBe('legacy-relationship');
      expect(assertion).toHaveLength(1);
      expect(assertion[0].id).toBe('relationship:legacy-relationship');
      await upgraded.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
