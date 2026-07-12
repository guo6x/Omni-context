import { describe, expect, it } from 'vitest';
import initDatabase from '../src/db/sqlite.js';

describe('behavior events', () => {
  it('stores typed consumption and action events independently of access_count', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'event-entity', name: 'Event entity', type: 'concept' });
    await db.recordBehaviorEvents([
      { eventType: 'viewed', entityId: 'event-entity', topic: 'retrieval quality', intent: 'informational' },
      { eventType: 'task_created', entityId: 'event-entity', topic: 'retrieval quality', intent: 'action' },
    ]);
    const rows = await db.all<{ event_type: string; intent: string }>(
      'SELECT event_type, intent FROM behavior_events ORDER BY occurred_at, rowid',
    );
    expect(rows).toEqual([
      { event_type: 'viewed', intent: 'informational' },
      { event_type: 'task_created', intent: 'action' },
    ]);
    const entity = await db.get<{ access_count: number }>('SELECT access_count FROM entities WHERE id = ?', ['event-entity']);
    expect(entity?.access_count).toBe(0);
    await db.close();
  });

  it('deduplicates idempotent events', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.recordBehaviorEvent({ eventType: 'searched', topic: 'same', idempotencyKey: 'search:1' });
    await db.recordBehaviorEvent({ eventType: 'searched', topic: 'same', idempotencyKey: 'search:1' });
    const row = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM behavior_events');
    expect(row?.count).toBe(1);
    await db.close();
  });
});
