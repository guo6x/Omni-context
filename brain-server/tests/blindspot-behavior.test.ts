import { describe, expect, it } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { detectBlindspots } from '../src/agent/blindspot-detector.js';

describe('behavior-grounded blindspots', () => {
  it('requires action-intent consumption and suppresses reminders after real action', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'topic-entity', name: 'Retrieval rollout', type: 'project' });
    for (let index = 0; index < 5; index++) {
      await db.recordBehaviorEvent({
        eventType: 'viewed', entityId: 'topic-entity', intent: 'action',
        occurredAt: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    let blindspots = await detectBlindspots(db);
    expect(blindspots.some((item) => item.type === 'consumption_without_action')).toBe(true);

    await db.recordBehaviorEvent({ eventType: 'task_created', entityId: 'topic-entity', intent: 'action' });
    blindspots = await detectBlindspots(db);
    expect(blindspots.some((item) => item.type === 'consumption_without_action')).toBe(false);
    await db.close();
  });

  it('uses a semantic search topic instead of noisy Chinese bigrams', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.recordBehaviorEvent({ eventType: 'searched', topic: '长期记忆迁移策略' });
    await db.recordBehaviorEvent({ eventType: 'searched', topic: '长期记忆迁移策略' });
    const blindspots = await detectBlindspots(db);
    expect(blindspots.some((item) => item.title.includes('长期记忆迁移策略'))).toBe(true);
    expect(blindspots.some((item) => item.title.includes('长期') && !item.title.includes('长期记忆迁移策略'))).toBe(false);
    await db.close();
  });
});
