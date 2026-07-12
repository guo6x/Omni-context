import { describe, expect, it, vi } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { AgentLoop } from '../src/agent/agent-loop.js';
import { MemoryDecayScheduler } from '../src/memory/decay-scheduler.js';

describe('AgentLoop independent scheduling', () => {
  it('runs decay and increments cycles even when there are no consolidation entities', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const getMostDecayedItems = vi.fn().mockResolvedValue([]);
    const decay = { getMostDecayedItems } as unknown as MemoryDecayScheduler;
    const agent = new AgentLoop(db, decay);

    await (agent as any).runCycle();
    await (agent as any).runCycle();

    expect(getMostDecayedItems).toHaveBeenCalledTimes(1);
    expect((agent as any).cycleCount).toBe(2);
    await db.close();
  });

  it('continues decay work when insight generation throws', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    vi.spyOn(db, 'getEntitiesForConsolidation').mockRejectedValueOnce(new Error('fixture insight failure'));
    const getMostDecayedItems = vi.fn().mockResolvedValue([]);
    const agent = new AgentLoop(db, { getMostDecayedItems } as unknown as MemoryDecayScheduler);

    await (agent as any).runCycle();

    expect(getMostDecayedItems).toHaveBeenCalledOnce();
    expect((agent as any).cycleCount).toBe(1);
    await db.close();
  });

  it('creates one review reminder for a due decision without an outcome', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const decision = await db.addEntity({
      name: 'Adopt local-first storage',
      type: 'decision',
      metadata: { revisit_at: '2025-01-01T00:00:00.000Z', outcomes: [] },
    });
    const agent = new AgentLoop(db);
    await (agent as any).runCycle();
    await (agent as any).runCycle();
    const notifications = await db.getUnreadNotifications();
    const reviews = notifications.filter((notification) => notification.title === 'Decision review due');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].related_entities).toContain(decision.id);
    await db.close();
  });
});
