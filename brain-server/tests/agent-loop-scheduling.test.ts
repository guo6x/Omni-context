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
});
