import { afterEach, describe, expect, it } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { buildDecisionMetadata, getRecursiveDecisionLineage, recordDecisionOutcome } from '../src/decision/decision-store.js';
import { RecordDecisionOutcomeSchema, SaveDecisionSchema } from '../src/mcp-tools.js';

const databases: Array<ReturnType<typeof initDatabase>> = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe('decision intelligence persistence', () => {
  it('stores the complete decision structure without inventing lineage', () => {
    const input = SaveDecisionSchema.parse({
      situation: 'Choose a database',
      conclusion: 'Use SQLite for local-first v1',
      decision_question: 'Which database fits offline use?',
      goals: ['offline operation'],
      hard_constraints: ['no cloud dependency'],
      assumptions: ['single user'],
      uncertainties: ['future collaboration'],
      expected_outcomes: ['simple deployment'],
      risks: ['write contention'],
      revisit_at: '2026-08-01T00:00:00.000Z',
    });
    expect(buildDecisionMetadata(input)).toMatchObject({
      decision_question: 'Which database fits offline use?',
      selected_option: 'Use SQLite for local-first v1',
      goals: ['offline operation'],
      hard_constraints: ['no cloud dependency'],
      outcomes: [],
    });
  });

  it('recursively traces explicit lineage and records outcomes without changing principles', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    databases.push(db);
    await db.runMigrations();
    const principle = await db.addEntity({
      id: 'principle-local', name: 'Prefer local ownership', type: 'principle',
      metadata: { isCore: true, version: 4 },
    });
    const first = await db.addEntity({
      id: 'decision-1', name: 'First', type: 'decision',
      metadata: { conclusion: 'A', situation: 'S', confidence: 'medium', outcomes: [] },
    });
    const second = await db.addEntity({
      id: 'decision-2', name: 'Second', type: 'decision',
      metadata: { conclusion: 'B', situation: 'S', confidence: 'high', outcomes: [] },
    });
    const third = await db.addEntity({
      id: 'decision-3', name: 'Third', type: 'decision',
      metadata: { conclusion: 'C', situation: 'S', confidence: 'low', outcomes: [] },
    });
    await db.addRelationship({ source_id: second.id, target_id: first.id, type: 'revises', weight: 1 });
    await db.addRelationship({ source_id: third.id, target_id: second.id, type: 'supersedes', weight: 1 });
    await db.addRelationship({ source_id: third.id, target_id: principle.id, type: 'supported_by', weight: 1 });

    const outcomeInput = RecordDecisionOutcomeSchema.parse({
      decision_id: third.id,
      actual_outcome: 'Deployment succeeded but collaboration was delayed',
      outcome_timestamp: '2026-07-20T00:00:00.000Z',
      outcome_score: 0.7,
      assumption_failures: ['single-user assumption ended'],
      lessons_learned: ['validate collaboration earlier'],
      confidence_calibration: -0.1,
      follow_up_actions: ['review sync design'],
    });
    const saved = await recordDecisionOutcome(db, outcomeInput);
    expect(saved?.outcome_entity_id).toBeDefined();

    const lineage = await getRecursiveDecisionLineage(db, third.id);
    expect(lineage?.recursive).toBe(true);
    expect(lineage?.chain.map((node) => node.id)).toEqual(expect.arrayContaining([second.id, first.id]));
    expect(lineage?.chain.find((node) => node.id === first.id)?.depth).toBe(2);
    expect(lineage?.sources).toContainEqual(expect.objectContaining({ entity_id: principle.id, relationship: 'supported_by' }));
    expect((lineage?.current.outcomes as unknown[]).length).toBe(1);
    const unchangedPrinciple = await db.getEntity(principle.id);
    expect(unchangedPrinciple?.metadata).toEqual({ isCore: true, version: 4 });
    const outcomeRelationships = await db.getRelationshipsForEntity(third.id, true);
    expect(outcomeRelationships.some((relationship) => relationship.type === 'outcome_of')).toBe(true);
  });
});
