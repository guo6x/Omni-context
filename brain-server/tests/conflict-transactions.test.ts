import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { parseConflictResolution, resolveConflicts } from '../src/graphrag/conflict-resolver.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('assertion conflict transactions', () => {
  it('strictly validates model output and referenced relationship IDs', () => {
    const allowed = new Set(['old-1']);
    expect(() => parseConflictResolution(JSON.stringify({
      resolutions: [{ oldRelationshipId: 'old-1', status: 'conflict' }],
    }), allowed)).toThrow();
    expect(() => parseConflictResolution(JSON.stringify({
      resolutions: [{
        oldRelationshipId: 'unknown',
        status: 'conflict',
        confidence: 0.5,
        reason: 'ambiguous',
      }],
    }), allowed)).toThrow(/unknown relationship/);
  });

  it('atomically writes a new single-valued fact, closes the old assertion, and stores named evidence', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'person', name: 'Avery', type: 'person' });
    const oldCompany = await db.addEntity({ id: 'old-company', name: 'Old Corp', type: 'project' });
    const newCompany = await db.addEntity({ id: 'new-company', name: 'New Corp', type: 'project' });
    const old = await db.addRelationship({
      id: 'old-job', source_id: person.id, target_id: oldCompany.id, type: 'works_at',
      description: 'Avery worked at Old Corp', weight: 0.9,
    });
    const [inserted] = await resolveConflicts([{
      id: 'new-job', source_id: person.id, target_id: newCompany.id, type: 'works_at',
      description: 'Avery now works at New Corp', weight: 0.95,
      created_at: new Date(Date.now() + 86400000).toISOString(),
      last_activated: new Date(Date.now() + 86400000).toISOString(),
      valid_from: new Date(Date.now() + 86400000).toISOString(),
      provenance: { document_id: 'doc-1', chunk_id: 'chunk-2' },
    }], db, new GraphRAGExtractor({ useLocalExtraction: true }));

    expect(inserted.id).toBe('new-job');
    const historical = await db.getRelationshipsForEntity(person.id, true);
    expect(historical.find((relationship) => relationship.id === old.id)?.invalidated_at).toBeDefined();
    const assertions = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    expect(assertions.find((assertion) => assertion.id === 'relationship:old-job')?.invalidated_at).toBeDefined();
    expect(assertions.find((assertion) => assertion.id === 'relationship:new-job')).toBeDefined();
    const audit = await db.get<any>('SELECT * FROM assertion_conflict_audit WHERE new_assertion_id = ?', ['relationship:new-job']);
    expect(audit).toMatchObject({ operation: 'supersede', confidence: 1, status: 'applied' });
    expect(JSON.parse(audit.evidence)).toMatchObject({
      new: { source: { name: 'Avery' }, target: { name: 'New Corp' } },
      old: { fact: { text: 'Avery worked at Old Corp' } },
    });
    await db.close();
  });

  it('rolls back invalidation and audit if the new fact cannot be inserted', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'rollback-person', name: 'Jordan', type: 'person' });
    await db.addEntity({ id: 'rollback-old-company', name: 'Old Place', type: 'project' });
    const old = await db.addRelationship({
      id: 'rollback-old', source_id: 'rollback-person', target_id: 'rollback-old-company',
      type: 'works_at', weight: 1,
    });
    await expect(resolveConflicts([{
      id: 'rollback-new', source_id: 'rollback-person', target_id: 'missing-company',
      type: 'works_at', weight: 1,
      created_at: '2026-07-12T00:00:00.000Z',
      last_activated: '2026-07-12T00:00:00.000Z',
      valid_from: '2026-07-12T00:00:00.000Z',
    }], db, new GraphRAGExtractor({ useLocalExtraction: true }))).rejects.toThrow();
    const stillCurrent = await db.getRelationshipsForEntity('rollback-person');
    expect(stillCurrent.some((relationship) => relationship.id === old.id)).toBe(true);
    expect(await db.get('SELECT id FROM relationships WHERE id = ?', ['rollback-new'])).toBeUndefined();
    expect(await db.get('SELECT id FROM assertion_conflict_audit WHERE new_assertion_id = ?', ['relationship:rollback-new']))
      .toBeUndefined();
    await db.close();
  });

  it('upgrades a persisted v17 database without losing relationships', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-conflict-migration-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'legacy.db');
    const legacy = initDatabase({ dbPath });
    await legacy.runMigrations();
    await legacy.addEntity({ id: 'm-source', name: 'Source', type: 'concept' });
    await legacy.addEntity({ id: 'm-target', name: 'Target', type: 'concept' });
    await legacy.addRelationship({ id: 'm-rel', source_id: 'm-source', target_id: 'm-target', type: 'relates_to', weight: 1 });
    await legacy.run('DROP TABLE assertion_conflict_audit');
    await legacy.run("DELETE FROM migrations WHERE name = 'add_assertion_conflict_audit'");
    await legacy.close();

    const upgraded = initDatabase({ dbPath });
    await upgraded.runMigrations();
    expect(await upgraded.get('SELECT id FROM relationships WHERE id = ?', ['m-rel'])).toBeTruthy();
    expect(await upgraded.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assertion_conflict_audit'"))
      .toBeTruthy();
    await upgraded.close();
  });
});
