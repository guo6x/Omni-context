import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { MemoryDecayScheduler } from '../src/memory/decay-scheduler.js';

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('incremental relationship decay', () => {
  it('decays only elapsed time since last_decay_at and does not compound the same interval twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T00:00:00.000Z'));
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'decay-a', name: 'A', type: 'concept' });
    await db.addEntity({ id: 'decay-b', name: 'B', type: 'concept' });
    const relationship = await db.addRelationship({
      id: 'decay-rel', source_id: 'decay-a', target_id: 'decay-b', type: 'relates_to', weight: 1,
    });
    await db.run(
      `UPDATE relationships SET last_decay_at = ?, last_activated = ?, base_weight = 1 WHERE id = ?`,
      ['2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z', relationship.id]
    );
    const scheduler = new MemoryDecayScheduler(db, { autoStart: false, decayFactor: 0.95 });
    await (scheduler as any)._decayRelationships({
      relationshipsProcessed: 0, relationshipsDecayed: 0, relationshipsDormant: 0,
      entitiesStale: 0, durationMs: 0, timestamp: new Date().toISOString(),
    });
    const first = await db.get<any>('SELECT weight, base_weight, last_decay_at, decay_version FROM relationships WHERE id = ?', [relationship.id]);
    expect(first.weight).toBeCloseTo(Math.pow(0.95, 10), 3);
    expect(first).toMatchObject({ base_weight: 1, last_decay_at: '2026-07-12T00:00:00.000Z', decay_version: 1 });

    await (scheduler as any)._decayRelationships({
      relationshipsProcessed: 0, relationshipsDecayed: 0, relationshipsDormant: 0,
      entitiesStale: 0, durationMs: 0, timestamp: new Date().toISOString(),
    });
    const second = await db.get<any>('SELECT weight FROM relationships WHERE id = ?', [relationship.id]);
    expect(second.weight).toBe(first.weight);
    await db.close();
  });

  it('reinforces once per new activation event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'reinforce-a', name: 'A', type: 'concept' });
    await db.addEntity({ id: 'reinforce-b', name: 'B', type: 'concept' });
    const relationship = await db.addRelationship({
      id: 'reinforce-rel', source_id: 'reinforce-a', target_id: 'reinforce-b', type: 'relates_to', weight: 1,
    });
    const scheduler = new MemoryDecayScheduler(db, { autoStart: false });
    await (scheduler as any)._reinforceActiveRelationships();
    const first = await db.get<any>('SELECT weight, last_reinforced_at, reinforcement_reason FROM relationships WHERE id = ?', [relationship.id]);
    expect(first).toMatchObject({ weight: 1.01, reinforcement_reason: 'recent_endpoint_activation' });
    await (scheduler as any)._reinforceActiveRelationships();
    expect((await db.get<any>('SELECT weight FROM relationships WHERE id = ?', [relationship.id])).weight).toBe(1.01);

    await db.run('UPDATE relationships SET last_activated = ? WHERE id = ?', ['2026-07-12T12:01:00.000Z', relationship.id]);
    await (scheduler as any)._reinforceActiveRelationships();
    expect((await db.get<any>('SELECT weight FROM relationships WHERE id = ?', [relationship.id])).weight).toBeCloseTo(1.0201, 4);
    await db.close();
  });

  it('upgrades a persisted v18 database and initializes decay baselines', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-decay-migration-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'legacy.db');
    const legacy = initDatabase({ dbPath });
    await legacy.runMigrations();
    await legacy.addEntity({ id: 'legacy-a', name: 'A', type: 'concept' });
    await legacy.addEntity({ id: 'legacy-b', name: 'B', type: 'concept' });
    await legacy.addRelationship({ id: 'legacy-decay', source_id: 'legacy-a', target_id: 'legacy-b', type: 'relates_to', weight: 0.8 });
    await legacy.run('DROP INDEX idx_relationships_decay_due');
    for (const column of ['base_weight', 'last_decay_at', 'last_reinforced_at', 'reinforcement_reason', 'decay_version']) {
      await legacy.run(`ALTER TABLE relationships DROP COLUMN ${column}`);
    }
    await legacy.run("DELETE FROM migrations WHERE name = 'add_incremental_relationship_decay'");
    await legacy.close();

    const upgraded = initDatabase({ dbPath });
    await upgraded.runMigrations();
    const row = await upgraded.get<any>('SELECT weight, base_weight, last_decay_at, decay_version FROM relationships WHERE id = ?', ['legacy-decay']);
    expect(row.base_weight).toBe(row.weight);
    expect(row.last_decay_at).toBeTruthy();
    expect(row.decay_version).toBe(1);
    await upgraded.close();
  });
});
