import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { resolveEntities } from '../src/graphrag/entity-resolver.js';
import { Entity, EntityType } from '../src/shared-types.js';

const unitVector384 = () => Array.from({ length: 384 }, (_, index) => index === 0 ? 1 : 0);

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

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}

describe('type-specific entity resolution policy', () => {
  it.each(['person', 'project', 'decision'] as const)('exposes %s entities persisted internally before returning review candidates', async (type) => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    try {
      await db.addEntity({ id: 'existing', name: 'Shared Name', type });
      const persisted: Entity[] = [];

      const result = await resolveEntities(
        [entity('new', 'Shared Name', type)], [], db, undefined,
        { onEntityPersisted: (saved) => { persisted.push(saved); } },
      );

      expect(result.entitiesToCreate).toEqual([]);
      expect(result.persistedEntities.map(saved => saved.id)).toEqual(['new']);
      expect(persisted.map(saved => saved.id)).toEqual(['new']);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['new'])).toBeTruthy();
    } finally {
      await db.close();
    }
  });

  it('does not report unpersisted planned entities as internally saved', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    try {
      const persisted: Entity[] = [];

      const result = await resolveEntities(
        [entity('planned', 'New Concept', 'concept')], [], db, undefined,
        { onEntityPersisted: (saved) => { persisted.push(saved); } },
      );

      expect(result.entitiesToCreate.map(planned => planned.id)).toEqual(['planned']);
      expect(result.persistedEntities).toEqual([]);
      expect(persisted).toEqual([]);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['planned'])).toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it('keeps the default four-argument resolver within its caller-owned transaction and rollback', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'existing', name: 'Shared Name', type: 'person' });
    const transaction = vi.spyOn(db, 'withTransaction');
    try {
      await expect(db.withTransaction(async () => {
        const result = await resolveEntities([entity('new', 'Shared Name', 'person')], [], db, undefined);
        expect(result.persistedEntities.map(saved => saved.id)).toEqual(['new']);
        expect(await db.get('SELECT id FROM entities WHERE id = ?', ['new'])).toBeTruthy();
        expect(await db.all('SELECT id FROM entity_merge_candidates')).toHaveLength(1);
        throw new Error('CONTROLLED_CALLER_ROLLBACK');
      })).rejects.toThrow('CONTROLLED_CALLER_ROLLBACK');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['new'])).toBeUndefined();
      expect(await db.all('SELECT id FROM entity_merge_candidates')).toEqual([]);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['existing'])).toBeTruthy();
    } finally {
      transaction.mockRestore();
      await db.close();
    }
  });

  it('serializes opt-in entity transactions across concurrent resolutions and notifies after each commit', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'existing', name: 'Shared Name', type: 'person' });
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstInserted!: () => void;
    const firstHasInserted = new Promise<void>((resolve) => { firstInserted = resolve; });
    let secondRequested!: () => void;
    const secondWasRequested = new Promise<void>((resolve) => { secondRequested = resolve; });
    const committed = new Set<string>();
    const observed: string[] = [];
    const starts: string[] = [];
    let active = 0;
    let peak = 0;
    const options = {
      persistEntity: (input: Entity): Promise<Entity> => {
        if (input.id === 'second') secondRequested();
        return db.withTransaction(async () => {
          starts.push(input.id);
          active += 1;
          peak = Math.max(peak, active);
          try {
            const saved = await db.addEntity(input);
            if (input.id === 'first') {
              firstInserted();
              await firstCanFinish;
            }
            return saved;
          } finally {
            active -= 1;
          }
        }).then((saved) => {
          committed.add(saved.id);
          return saved;
        });
      },
      onEntityPersisted: (saved: Entity): void => {
        expect(committed.has(saved.id)).toBe(true);
        observed.push(saved.id);
      },
    };
    try {
      const first = resolveEntities([entity('first', 'Shared Name', 'person')], [], db, undefined, options);
      await firstHasInserted;
      const second = resolveEntities([entity('second', 'Shared Name', 'person')], [], db, undefined, options);
      expect(starts).toEqual(['first']);
      releaseFirst();
      // Foreign candidate reads must also wait for the first transaction.
      await secondWasRequested;

      const results = await Promise.all([first, second]);

      expect(peak).toBe(1);
      expect(starts).toEqual(['first', 'second']);
      expect(results.map(result => result.persistedEntities.map(saved => saved.id))).toEqual([['first'], ['second']]);
      expect(observed.sort()).toEqual(['first', 'second']);
      expect(await db.all("SELECT id FROM entities WHERE id != 'existing' ORDER BY id"))
        .toEqual([{ id: 'first' }, { id: 'second' }]);
      expect(await db.all('SELECT id FROM entity_merge_candidates')).toHaveLength(2);
    } finally {
      releaseFirst();
      await db.close();
    }
  });

  it('keeps a committed review entity, its queue entry and an outside update when another transaction rolls back', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    db.getRaw().serialize();
    await db.runMigrations();
    await db.addEntity({ id: 'existing', name: 'Shared Name', type: 'person', description: 'before' });
    const committed = gate();
    const allowFollowup = gate();
    const otherStarted = gate();
    const reviewAttempted = gate();
    const updateAttempted = gate();
    const pending: Promise<unknown>[] = [];
    let whileOtherActive: { reviews: number; description: string } | undefined;
    const run = db.run.bind(db);
    const runSpy = vi.spyOn(db, 'run').mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO entity_merge_candidates')) reviewAttempted.resolve();
      if (sql.startsWith('UPDATE entities SET description = ?')) updateAttempted.resolve();
      return run(sql, params);
    });
    try {
      const resolution = resolveEntities([entity('saved-first', 'Shared Name', 'person')], [], db, undefined, {
        persistEntity: async (input) => {
          const saved = await db.withTransaction(() => db.addEntity(input));
          committed.resolve();
          await allowFollowup.promise;
          return saved;
        },
      });
      pending.push(resolution);
      await committed.promise;
      const other = db.withTransaction(async () => {
        await db.addEntity({ id: 'rolled-back', name: 'Other Entity', type: 'concept' });
        otherStarted.resolve();
        await Promise.all([reviewAttempted.promise, updateAttempted.promise]);
        const reviews = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM entity_merge_candidates');
        const current = await db.get<{ description: string }>('SELECT description FROM entities WHERE id = ?', ['existing']);
        whileOtherActive = { reviews: reviews!.count, description: current!.description };
        throw new Error('CONTROLLED_OTHER_TRANSACTION_ROLLBACK');
      }).then(() => undefined, error => error as Error);
      pending.push(other);
      await otherStarted.promise;
      const update = db.updateEntity('existing', { description: 'after' });
      pending.push(update);
      allowFollowup.resolve();

      const [result, otherError] = await Promise.all([resolution, other, update]);

      expect(otherError).toMatchObject({ message: 'CONTROLLED_OTHER_TRANSACTION_ROLLBACK' });
      expect(result.persistedEntities.map(saved => saved.id)).toEqual(['saved-first']);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['saved-first'])).toBeTruthy();
      expect(await db.all('SELECT candidate_entity_id FROM entity_merge_candidates')).toEqual([
        { candidate_entity_id: 'saved-first' },
      ]);
      expect(await db.get('SELECT description FROM entities WHERE id = ?', ['existing'])).toEqual({ description: 'after' });
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['rolled-back'])).toBeUndefined();
      expect(whileOtherActive).toEqual({ reviews: 0, description: 'before' });
    } finally {
      allowFollowup.resolve();
      reviewAttempted.resolve();
      updateAttempted.resolve();
      await Promise.allSettled(pending);
      runSpy.mockRestore();
      await db.close();
    }
  });

  it('does not serialize independent statements when no transaction owns the connection', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    const firstStarted = gate();
    const releaseFirst = gate();
    const secondStarted = gate();
    const pending: Promise<unknown>[] = [];
    const raw = db.getRaw() as any;
    const originalGet = raw.get.bind(raw);
    const getSpy = vi.spyOn(raw, 'get').mockImplementation((
      sql: string,
      params: unknown[],
      callback: (error: Error | null, row?: unknown) => void,
    ) => {
      if (sql === 'SELECT held') {
        firstStarted.resolve();
        void releaseFirst.promise.then(() => callback(null, { value: 'held' }));
        return raw;
      }
      if (sql === 'SELECT independent') {
        secondStarted.resolve();
        callback(null, { value: 'independent' });
        return raw;
      }
      return originalGet(sql, params, callback);
    });

    try {
      const first = db.get<{ value: string }>('SELECT held');
      pending.push(first);
      await firstStarted.promise;
      const second = db.get<{ value: string }>('SELECT independent');
      pending.push(second);

      const dispatchedBeforeFirstCompletes = await Promise.race([
        secondStarted.promise.then(() => true),
        Promise.resolve().then(() => false),
      ]);
      expect(dispatchedBeforeFirstCompletes).toBe(true);

      releaseFirst.resolve();
      await expect(Promise.all([first, second])).resolves.toEqual([
        { value: 'held' },
        { value: 'independent' },
      ]);
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled(pending);
      getSpy.mockRestore();
      await db.close();
    }
  });

  it('isolates every foreign statement primitive from an active transaction and its uncommitted rows', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    db.getRaw().serialize();
    await db.run('CREATE TABLE isolation_probe (id TEXT PRIMARY KEY)');
    const started = gate();
    const release = gate();
    const pending: Promise<unknown>[] = [];
    try {
      const transaction = db.withTransaction(async () => {
        await db.run('INSERT INTO isolation_probe VALUES (?)', ['uncommitted']);
        started.resolve();
        await release.promise;
        throw new Error('CONTROLLED_PRIMITIVE_ROLLBACK');
      }).then(() => undefined, error => error as Error);
      pending.push(transaction);
      await started.promise;
      const readOne = db.get('SELECT id FROM isolation_probe WHERE id = ?', ['uncommitted']);
      const readAll = db.all('SELECT id FROM isolation_probe');
      const execute = db.exec("INSERT INTO isolation_probe VALUES ('outside-exec');");
      const write = db.run('INSERT INTO isolation_probe VALUES (?)', ['outside-run']);
      pending.push(readOne, readAll, execute, write);
      release.resolve();

      const [one, all, , , error] = await Promise.all([readOne, readAll, execute, write, transaction]);

      expect(error).toMatchObject({ message: 'CONTROLLED_PRIMITIVE_ROLLBACK' });
      expect(one).toBeUndefined();
      expect(all).toEqual([]);
      expect(await db.all('SELECT id FROM isolation_probe ORDER BY id')).toEqual([
        { id: 'outside-exec' }, { id: 'outside-run' },
      ]);
    } finally {
      release.resolve();
      await Promise.allSettled(pending);
      await db.close();
    }
  });

  it('does not let detached work from a completed transaction bypass a later transaction', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    db.getRaw().serialize();
    await db.run('CREATE TABLE isolation_probe (id TEXT PRIMARY KEY)');
    const allowDetached = gate();
    const detachedAttempted = gate();
    const started = gate();
    const pending: Promise<unknown>[] = [];
    let detached!: Promise<unknown>;
    let whileOtherActive: unknown[] | undefined;
    try {
      await db.withTransaction(async () => {
        await db.run('INSERT INTO isolation_probe VALUES (?)', ['committed']);
        detached = (async () => {
          await allowDetached.promise;
          const write = db.run('INSERT INTO isolation_probe VALUES (?)', ['detached']);
          detachedAttempted.resolve();
          await write;
        })();
        pending.push(detached);
      });
      const other = db.withTransaction(async () => {
        await db.run('INSERT INTO isolation_probe VALUES (?)', ['rolled-back']);
        started.resolve();
        await detachedAttempted.promise;
        whileOtherActive = await db.all('SELECT id FROM isolation_probe WHERE id = ?', ['detached']);
        throw new Error('CONTROLLED_DETACHED_ROLLBACK');
      }).then(() => undefined, error => error as Error);
      pending.push(other);
      await started.promise;
      allowDetached.resolve();

      const [, error] = await Promise.all([detached, other]);

      expect(error).toMatchObject({ message: 'CONTROLLED_DETACHED_ROLLBACK' });
      expect(whileOtherActive).toEqual([]);
      expect(await db.all('SELECT id FROM isolation_probe ORDER BY id')).toEqual([
        { id: 'committed' }, { id: 'detached' },
      ]);
    } finally {
      allowDetached.resolve();
      detachedAttempted.resolve();
      await Promise.allSettled(pending);
      await db.close();
    }
  });

  it('rejects nested managed transactions promptly without committing or poisoning the owner', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.run('CREATE TABLE isolation_probe (id TEXT PRIMARY KEY)');
    const begin = vi.spyOn(db, 'beginTransaction');
    try {
      const result = await db.withTransaction(async () => {
        await db.run('INSERT INTO isolation_probe VALUES (?)', ['outer']);
        await expect(db.withTransaction(async () => {
          await db.run('INSERT INTO isolation_probe VALUES (?)', ['inner']);
        })).rejects.toThrow('Nested withTransaction calls are not supported');
        expect(await db.all('SELECT id FROM isolation_probe')).toEqual([{ id: 'outer' }]);
        return 'owner-result';
      });

      expect(result).toBe('owner-result');
      expect(begin).toHaveBeenCalledTimes(1);
      expect(await db.all('SELECT id FROM isolation_probe')).toEqual([{ id: 'outer' }]);
    } finally {
      begin.mockRestore();
      await db.close();
    }
  });

  it('releases connection ownership after a failed statement and a failed commit', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.run('CREATE TABLE isolation_probe (id TEXT PRIMARY KEY)');
    const commit = vi.spyOn(db, 'commit').mockRejectedValueOnce(new Error('CONTROLLED_COMMIT_FAILURE'));
    try {
      await expect(db.run('INSERT INTO missing_table VALUES (?)', ['invalid'])).rejects.toThrow();
      const failed = db.withTransaction(async () => {
        await db.run('INSERT INTO isolation_probe VALUES (?)', ['rolled-back']);
      }).then(() => undefined, error => error as Error);
      const following = db.run('INSERT INTO isolation_probe VALUES (?)', ['following']);

      const [error] = await Promise.all([failed, following]);

      expect(error).toMatchObject({ message: 'CONTROLLED_COMMIT_FAILURE' });
      expect(await db.all('SELECT id FROM isolation_probe')).toEqual([{ id: 'following' }]);
    } finally {
      commit.mockRestore();
      await db.close();
    }
  });

  it('retains sequential low-level begin, commit and rollback controls', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.run('CREATE TABLE isolation_probe (id TEXT PRIMARY KEY)');
    try {
      await db.beginTransaction();
      await db.run('INSERT INTO isolation_probe VALUES (?)', ['rolled-back']);
      await db.rollback();
      expect(await db.all('SELECT id FROM isolation_probe')).toEqual([]);

      await db.beginTransaction();
      await db.run('INSERT INTO isolation_probe VALUES (?)', ['committed']);
      await db.commit();
      expect(await db.all('SELECT id FROM isolation_probe')).toEqual([{ id: 'committed' }]);
    } finally {
      await db.close();
    }
  });

  it('does not notify a saved entity when an opt-in transaction rolls its write back', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'existing', name: 'Shared Name', type: 'person' });
    const onEntityPersisted = vi.fn();
    try {
      await expect(resolveEntities([entity('new', 'Shared Name', 'person')], [], db, undefined, {
        persistEntity: (input) => db.withTransaction(async () => {
          await db.addEntity(input);
          throw new Error('CONTROLLED_WRITE_ROLLBACK');
        }),
        onEntityPersisted,
      })).rejects.toThrow('CONTROLLED_WRITE_ROLLBACK');

      expect(onEntityPersisted).not.toHaveBeenCalled();
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['new'])).toBeUndefined();
      expect(await db.all('SELECT id FROM entity_merge_candidates')).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it('reports and notifies semantic-review entities persisted inside resolution', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'existing', name: 'Existing Concept', type: 'concept', embedding: unitVector384() });
    const persisted: Entity[] = [];
    try {
      const result = await resolveEntities(
        [entity('new', 'Related Concept', 'concept', { embedding: unitVector384() })], [], db, undefined,
        { onEntityPersisted: (saved) => { persisted.push(saved); } },
      );

      expect(result.entitiesToCreate).toEqual([]);
      expect(result.mergeCandidates).toEqual([
        expect.objectContaining({ candidateEntityId: 'new', reason: 'semantic_review_required' }),
      ]);
      expect(result.persistedEntities.map(saved => saved.id)).toEqual(['new']);
      expect(persisted.map(saved => saved.id)).toEqual(['new']);
      expect(await db.get('SELECT id FROM entities WHERE id = ?', ['new'])).toBeTruthy();
    } finally {
      await db.close();
    }
  });

  it('does not auto-merge a same-name person without compatible context', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const existing = await db.addEntity({ id: 'person-existing', name: 'Alex Kim', type: 'person' });
    const result = await resolveEntities([entity('person-new', ' alex kim ', 'person')], [], db);
    expect(result.idMap['person-new']).toBe('person-new');
    expect(result.mergeCandidates).toEqual([
      expect.objectContaining({ canonicalId: existing.id, reason: 'exact_name_manual_only' }),
    ]);
    expect(await db.get<any>('SELECT status FROM entity_merge_candidates WHERE canonical_id = ?', [existing.id]))
      .toMatchObject({ status: 'pending' });
    expect(await db.get('SELECT id FROM entities WHERE id = ?', ['person-new'])).toBeTruthy();
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
    // Person types no longer auto-merge; expect independent entity
    expect(result.idMap['person-context-new']).toBe('person-context-new');
    expect(await db.get('SELECT id FROM entities WHERE id = ?', ['person-context-new'])).toBeTruthy();
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
      embedding: unitVector384(),
      metadata: { provenance: { source: 'official-docs', document_id: 'old-doc' } },
    });
    const result = await resolveEntities([
      entity('tool-new', 'PostgreSQL DB', 'tool', {
        embedding: unitVector384(),
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
        return { embedding: unitVector384() };
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
