import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import initDatabase from '../src/db/sqlite.js';
import { LITERAL_TYPES } from '../src/shared-types.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Assertion fact layer — literal types, versioning, FTS, consistency scan', () => {
  it('stores literal assertions with all 11 literal types', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'person-1', name: 'Alice', type: 'person' });

    const literalFixtures: Array<{ predicate: string; value: string; type: typeof LITERAL_TYPES[number] }> = [
      { predicate: 'name', value: 'Alice', type: 'string' },
      { predicate: 'age', value: '30', type: 'number' },
      { predicate: 'birthday', value: '1996-05-10', type: 'date' },
      { predicate: 'last_seen', value: '2026-07-13T10:00:00Z', type: 'datetime' },
      { predicate: 'is_active', value: 'true', type: 'boolean' },
      { predicate: 'salary', value: '50000 USD', type: 'currency' },
      { predicate: 'current_city', value: 'Tokyo, Japan', type: 'location_text' },
      { predicate: 'employment_status', value: 'employed', type: 'status' },
      { predicate: 'team_size', value: '5', type: 'quantity' },
      { predicate: 'email', value: 'alice@example.com', type: 'contact' },
      { predicate: 'summary', value: 'Alice is a senior engineer', type: 'conclusion' },
    ];

    for (const fixture of literalFixtures) {
      await db.addAssertion({
        subject_id: person.id,
        predicate: fixture.predicate,
        literal_value: fixture.value,
        literal_type: fixture.type,
        confidence: 0.9,
        source_span: `source:${fixture.predicate}`,
      });
    }

    const assertions = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    expect(assertions).toHaveLength(literalFixtures.length);
    for (const fixture of literalFixtures) {
      const found = assertions.find((a) => a.predicate === fixture.predicate);
      expect(found).toBeDefined();
      expect(found!.literal_value).toBe(fixture.value);
      expect(found!.literal_type).toBe(fixture.type);
      expect(found!.source_span).toBe(`source:${fixture.predicate}`);
      expect(found!.version).toBe(1);
    }
    await db.close();
  });

  it('stores entity-object assertions alongside literal assertions', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p1', name: 'Bob', type: 'person' });
    const company = await db.addEntity({ id: 'c1', name: 'Corp', type: 'project' });

    // Entity-object assertion (via relationship mirror)
    await db.addRelationship({
      id: 'rel-1',
      source_id: person.id,
      target_id: company.id,
      type: 'works_at',
      weight: 1.0,
    });

    // Literal assertion
    await db.addAssertion({
      subject_id: person.id,
      predicate: 'age',
      literal_value: '42',
      literal_type: 'number',
      confidence: 1.0,
    });

    const all = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    expect(all).toHaveLength(2);
    const entityAssertion = all.find((a) => a.id === 'relationship:rel-1');
    expect(entityAssertion).toBeDefined();
    expect(entityAssertion!.object_id).toBe(company.id);
    const literalAssertion = all.find((a) => a.predicate === 'age');
    expect(literalAssertion).toBeDefined();
    expect(literalAssertion!.literal_value).toBe('42');
    expect(literalAssertion!.literal_type).toBe('number');
    await db.close();
  });

  it('searches assertions via FTS', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p2', name: 'Charlie', type: 'person' });

    await db.addAssertion({
      subject_id: person.id,
      predicate: 'favorite_language',
      literal_value: 'TypeScript',
      literal_type: 'string',
      confidence: 1.0,
      source_span: 'mentioned in chat about TypeScript preference',
    });
    await db.addAssertion({
      subject_id: person.id,
      predicate: 'current_project',
      literal_value: 'Omni-Context memory system',
      literal_type: 'string',
      confidence: 0.9,
      source_span: 'discussed project architecture',
    });

    const results = await db.searchAssertions('TypeScript', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((a) => a.predicate === 'favorite_language')).toBe(true);

    const projectResults = await db.searchAssertions('project', 10);
    expect(projectResults.some((a) => a.predicate === 'current_project')).toBe(true);
    await db.close();
  });

  it('removes invalidated assertions from FTS', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p3', name: 'Dave', type: 'person' });

    const assertion = await db.addAssertion({
      subject_id: person.id,
      predicate: 'old_preference',
      literal_value: 'vim',
      literal_type: 'string',
      confidence: 1.0,
      source_span: 'Dave liked vim',
    });

    // Should be searchable before invalidation
    const before = await db.searchAssertions('vim', 10);
    expect(before.some((a) => a.id === assertion.id)).toBe(true);

    // Invalidate
    await db.invalidateAssertion(assertion.id, 'preference changed to emacs');

    // Should NOT be searchable after invalidation
    const after = await db.searchAssertions('vim', 10);
    expect(after.some((a) => a.id === assertion.id)).toBe(false);

    // Should still be retrievable via getAssertions with includeHistorical
    const historical = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    expect(historical.some((a) => a.id === assertion.id)).toBe(true);
    expect(historical.find((a) => a.id === assertion.id)?.invalidated_at).toBeDefined();
    await db.close();
  });

  it('syncs relationship weight updates to mirror assertion confidence', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p4', name: 'Eve', type: 'person' });
    const company = await db.addEntity({ id: 'c4', name: 'Corp', type: 'project' });

    const rel = await db.addRelationship({
      id: 'rel-sync',
      source_id: person.id,
      target_id: company.id,
      type: 'works_at',
      weight: 0.5,
    });

    // Verify initial sync
    const before = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    const initial = before.find((a) => a.id === `relationship:${rel.id}`);
    expect(initial).toBeDefined();
    expect(initial!.confidence).toBeCloseTo(0.5, 5);

    // Update weight
    await db.updateRelationshipWeight(rel.id, 0.3);

    // Verify assertion confidence synced
    const after = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    const updated = after.find((a) => a.id === `relationship:${rel.id}`);
    expect(updated).toBeDefined();
    expect(updated!.confidence).toBeCloseTo(0.8, 5);
    await db.close();
  });

  it('invalidates mirror assertion when relationship is deleted (not destroyed)', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p5', name: 'Frank', type: 'person' });
    const company = await db.addEntity({ id: 'c5', name: 'Corp', type: 'project' });

    const rel = await db.addRelationship({
      id: 'rel-del',
      source_id: person.id,
      target_id: company.id,
      type: 'works_at',
      weight: 1.0,
    });

    await db.deleteRelationship(rel.id);

    // Relationship is gone
    const rels = await db.getRelationshipsForEntity(person.id, true);
    expect(rels.some((r) => r.id === rel.id)).toBe(false);

    // Mirror assertion still exists but is invalidated
    const assertions = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    const mirror = assertions.find((a) => a.id === `relationship:${rel.id}`);
    expect(mirror).toBeDefined();
    expect(mirror!.invalidated_at).toBeDefined();
    expect(mirror!.invalidation_reason).toBe('relationship_deleted');

    // Not in active assertions
    const active = await db.getAssertions({ subjectId: person.id, includeHistorical: false });
    expect(active.some((a) => a.id === `relationship:${rel.id}`)).toBe(false);
    await db.close();
  });

  it('passes consistency scan on a clean database', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p6', name: 'Grace', type: 'person' });
    const company = await db.addEntity({ id: 'c6', name: 'Corp', type: 'project' });

    await db.addRelationship({
      id: 'rel-clean',
      source_id: person.id,
      target_id: company.id,
      type: 'works_at',
      weight: 1.0,
    });

    const scan = await db.consistencyScan();
    expect(scan.relationshipsWithoutAssertion).toBe(0);
    expect(scan.invalidatedInFts).toBe(0);
    await db.close();
  });

  it('detects orphaned FTS rows in consistency scan after manual FTS insertion', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();

    // Insert a row into fts_assertions that has no backing assertion
    await db.run(
      `INSERT INTO fts_assertions (assertion_id, subject_id, predicate, literal_value, source_span)
       VALUES (?, ?, ?, ?, ?)`,
      ['fake-assertion', 'fake-subject', 'fake_predicate', 'fake value', 'fake span'],
    );

    const scan = await db.consistencyScan();
    expect(scan.ftsOrphans).toBeGreaterThanOrEqual(1);
    await db.close();
  });

  it('supports version numbers and previous_version_id for assertion versioning', async () => {
    const db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const person = await db.addEntity({ id: 'p7', name: 'Henry', type: 'person' });

    // Version 1: old salary
    const v1 = await db.addAssertion({
      subject_id: person.id,
      predicate: 'salary',
      literal_value: '40000 USD',
      literal_type: 'currency',
      confidence: 1.0,
      version: 1,
    });

    // Version 2: new salary, links to previous
    const v2 = await db.addAssertion({
      subject_id: person.id,
      predicate: 'salary',
      literal_value: '55000 USD',
      literal_type: 'currency',
      confidence: 1.0,
      version: 2,
      previous_version_id: v1.id,
    });

    // Invalidate v1
    await db.invalidateAssertion(v1.id, 'superseded by newer salary');

    const active = await db.getAssertions({ subjectId: person.id, includeHistorical: false });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(v2.id);
    expect(active[0].version).toBe(2);
    expect(active[0].previous_version_id).toBe(v1.id);

    const historical = await db.getAssertions({ subjectId: person.id, includeHistorical: true });
    expect(historical).toHaveLength(2);
    const oldV = historical.find((a) => a.id === v1.id);
    expect(oldV).toBeDefined();
    expect(oldV!.invalidated_at).toBeDefined();
    expect(oldV!.version).toBe(1);
    await db.close();
  });
});
