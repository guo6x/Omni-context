import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { RecordDecisionOutcomeSchema } from '../src/mcp-tools.js';
import { recordDecisionOutcome } from '../src/decision/decision-store.js';

describe('decision outcome journal idempotency', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function setup() {
    const directory = await mkdtemp(join(tmpdir(), 'omni-outcome-journal-'));
    directories.push(directory);
    const db = initDatabase(join(directory, 'brain.sqlite'));
    await db.runMigrations();
    const decision = await db.addEntity({
      id: 'fixture-decision-outcome',
      name: 'Synthetic decision',
      type: 'decision',
      description: 'Synthetic local-only decision fixture',
      metadata: { conclusion: 'Keep this fixture local', outcomes: [] },
    });
    return { db, decision };
  }

  function input(decisionId: string, actualOutcome = 'Synthetic observed result') {
    return RecordDecisionOutcomeSchema.parse({
      decision_id: decisionId,
      idempotency_key: 'outcome:fixture:one',
      actual_outcome: actualOutcome,
      outcome_timestamp: '2026-10-23T00:00:00.000Z',
      outcome_score: 0.75,
      provenance: { source: 'desktop-decision-log', authority: 'user-journal' },
    });
  }

  it('replays a lost response without creating duplicate events, relationships, or journal entries', async () => {
    const { db, decision } = await setup();
    try {
      const first = await recordDecisionOutcome(db, input(decision.id));
      const retry = await recordDecisionOutcome(db, input(decision.id));
      const refreshed = await db.getEntity(decision.id);
      const events = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'event' AND json_extract(metadata, '$.outcome_id') = ?", [first?.outcome.outcome_id]);
      const relationships = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM relationships WHERE type = 'outcome_of' AND source_id = ?", [first?.outcome_entity_id]);

      expect(retry?.replayed).toBe(true);
      expect(retry?.outcome.outcome_id).toBe(first?.outcome.outcome_id);
      expect(retry?.outcome_entity_id).toBe(first?.outcome_entity_id);
      expect(refreshed?.metadata?.outcomes).toHaveLength(1);
      expect(refreshed?.metadata?.outcomes?.[0]).toMatchObject({ outcome_authority: 'journal', verified: false });
      expect(events[0].count).toBe(1);
      expect(relationships[0].count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('serializes concurrent retries that share one idempotency key', async () => {
    const { db, decision } = await setup();
    try {
      const attempts = await Promise.all(Array.from({ length: 4 }, () => recordDecisionOutcome(db, input(decision.id))));
      const refreshed = await db.getEntity(decision.id);
      const events = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'event' AND json_extract(metadata, '$.outcome_authority') = 'journal'");
      const relationships = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM relationships WHERE type = 'outcome_of'");

      expect(new Set(attempts.map((attempt) => attempt?.outcome.outcome_id)).size).toBe(1);
      expect(refreshed?.metadata?.outcomes).toHaveLength(1);
      expect(events[0].count).toBe(1);
      expect(relationships[0].count).toBe(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rejects a different payload reusing the same idempotency key', async () => {
    const { db, decision } = await setup();
    try {
      await recordDecisionOutcome(db, input(decision.id));
      await expect(recordDecisionOutcome(db, input(decision.id, 'Different result')))
        .rejects.toMatchObject({ code: 'INVALID_PARAMS', message: 'IDEMPOTENCY_KEY_REUSED' });
      const refreshed = await db.getEntity(decision.id);
      expect(refreshed?.metadata?.outcomes).toHaveLength(1);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('does not allow recording a user outcome against an explicitly unconfirmed AI-derived decision', async () => {
    const { db, decision } = await setup();
    try {
      await db.updateEntity(decision.id, {
        metadata: { ...decision.metadata, authority: 'ai_derived', user_confirmed: false },
      });

      await expect(recordDecisionOutcome(db, input(decision.id)))
        .rejects.toMatchObject({ code: 'INVALID_PARAMS', message: 'DECISION_NOT_USER_CONFIRMED' });
      const refreshed = await db.getEntity(decision.id);
      const events = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'event' AND json_extract(metadata, '$.outcome_authority') = 'journal'");
      expect(refreshed?.metadata?.outcomes).toEqual([]);
      expect(events[0].count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rejects legacy AI conclusions by provenance but still accepts unmarked historical user decisions', async () => {
    const { db, decision } = await setup();
    try {
      await db.updateEntity(decision.id, {
        metadata: {
          ...decision.metadata,
          provenance: { source: 'external_ai', tool: 'save_conclusion', at: '2026-10-22T00:00:00.000Z' },
        },
      });

      await expect(recordDecisionOutcome(db, input(decision.id)))
        .rejects.toMatchObject({ code: 'INVALID_PARAMS', message: 'DECISION_NOT_USER_CONFIRMED' });
      const refreshed = await db.getEntity(decision.id);
      const events = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'event' AND json_extract(metadata, '$.outcome_authority') = 'journal'");
      expect(refreshed?.metadata?.outcomes).toEqual([]);
      expect(events[0].count).toBe(0);

      const { provenance: _legacyProvenance, ...historicalMetadata } = refreshed!.metadata!;
      await db.updateEntity(decision.id, { metadata: historicalMetadata });
      const historicalOutcome = await recordDecisionOutcome(db, input(decision.id, 'Synthetic historical user result'));
      expect(historicalOutcome?.replayed).toBe(false);
      await expect(db.getEntity(decision.id)).resolves.toMatchObject({
        metadata: { outcomes: [expect.objectContaining({ actual_outcome: 'Synthetic historical user result' })] },
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it('rolls back the whole journal write when relationship creation fails', async () => {
    const { db, decision } = await setup();
    try {
      vi.spyOn(db, 'addRelationship').mockRejectedValueOnce(new Error('synthetic relationship failure'));
      await expect(recordDecisionOutcome(db, input(decision.id))).rejects.toThrow('synthetic relationship failure');
      const refreshed = await db.getEntity(decision.id);
      const events = await db.all<{ count: number }>("SELECT COUNT(*) AS count FROM entities WHERE type = 'event' AND json_extract(metadata, '$.outcome_authority') = 'journal'");
      expect(refreshed?.metadata?.outcomes).toEqual([]);
      expect(events[0].count).toBe(0);
    } finally {
      await db.close();
    }
  }, 30_000);
});
