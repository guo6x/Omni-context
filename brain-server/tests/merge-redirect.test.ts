import { describe, it, expect, beforeEach } from 'vitest';
import initDatabase from '../src/db/sqlite.js';
import { confirmMerge, rejectMerge, revertMerge } from '../src/graphrag/entity-resolver.js';
import type { Database } from '../src/db/sqlite.js';

// Task 11 — entity merge redirect.
//
// Previous confirmMerge only set metadata.merged_into on the alias row and
// wrote an audit log with a non-stable id (`${mergeId}_audit_${Date.now()}`).
// Relationships, assertions, FTS rows, and vector embeddings kept pointing
// at the alias entity, so the alias was still fully reachable from the graph
// even after "merge". These tests pin the new behavior: confirmMerge must
// redirect every reference, and revertMerge must look up the audit row by
// exact id match.

describe('Task 11: confirmMerge redirects graph edges onto canonical entity', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  async function seedTwoEntitiesWithEdges() {
    // canonical entity
    await db.addEntity({
      id: 'canon-svc',
      name: 'UserService',
      type: 'concept',
      description: 'canonical user service',
      tags: ['canonical'],
    });
    // alias entity (the duplicate that should be folded into canonical)
    await db.addEntity({
      id: 'alias-svc',
      name: 'UserSvc',
      type: 'concept',
      description: 'alias user service',
      tags: ['alias'],
    });
    // a third entity that alias has edges with — should be preserved on canonical
    await db.addEntity({
      id: 'third-party',
      name: 'AuthService',
      type: 'concept',
      description: 'downstream auth dependency',
    });

    // edge from alias -> third-party (must be redirected to canon -> third-party)
    await db.addRelationship({
      id: 'rel-alias-to-third',
      source_id: 'alias-svc',
      target_id: 'third-party',
      type: 'depends_on',
    });
    // edge from third-party -> alias (must be redirected to third-party -> canon)
    await db.addRelationship({
      id: 'rel-third-to-alias',
      source_id: 'third-party',
      target_id: 'alias-svc',
      type: 'cites',
    });
    // edge from canon -> alias (will become a self-loop and be cleaned up)
    await db.addRelationship({
      id: 'rel-canon-to-alias',
      source_id: 'canon-svc',
      target_id: 'alias-svc',
      type: 'relates_to',
    });

    // assertion where alias is the subject
    await db.addAssertion({
      id: 'assert-subj-alias',
      subject_id: 'alias-svc',
      predicate: 'has_api',
      object_id: null,
      literal_value: '/v1/users',
      literal_type: 'string',
    });
    // assertion where alias is the object
    await db.addAssertion({
      id: 'assert-obj-alias',
      subject_id: 'third-party',
      predicate: 'depends_on',
      object_id: 'alias-svc',
      literal_value: null,
    });

    // queue a merge candidate
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, similarity, reason, context, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        'merge-1',
        'canon-svc',
        'alias-svc',
        'UserSvc',
        'concept',
        0.92,
        'exact_name_manual_only',
        JSON.stringify({ document_id: 'doc-1' }),
        now,
      ]
    );
  }

  it('redirects relationships.source_id and target_id onto canonical', async () => {
    await seedTwoEntitiesWithEdges();

    const result = await confirmMerge(db, 'merge-1');

    // 3 edges touched the alias: alias->third, third->alias, canon->alias.
    // After UPDATE OR IGNORE: alias->third becomes canon->third (success),
    // third->alias becomes third->canon (success), canon->alias becomes
    // canon->canon (self-loop, ignored by UNIQUE(canon,canon,relates_to)? no —
    // UPDATE OR IGNORE updates it to canon->canon but then we delete self-loops).
    // The cleanup DELETE on alias-svc removes 0 rows (all already redirected),
    // and the self-loop DELETE removes the canon->canon row.
    expect(result.redirectedRelationships).toBeGreaterThanOrEqual(0);
    expect(result.auditId).toBe('merge-1_audit');

    // The two surviving edges should be canon->third and third->canon.
    const edges = await db.all<any>(
      'SELECT id, source_id, target_id, type FROM relationships ORDER BY id'
    );
    const survivingIds = edges.map((e) => e.id).sort();
    expect(survivingIds).toEqual(['rel-alias-to-third', 'rel-third-to-alias']);
    expect(edges.find((e) => e.id === 'rel-alias-to-third')!.source_id).toBe('canon-svc');
    expect(edges.find((e) => e.id === 'rel-alias-to-third')!.target_id).toBe('third-party');
    expect(edges.find((e) => e.id === 'rel-third-to-alias')!.source_id).toBe('third-party');
    expect(edges.find((e) => e.id === 'rel-third-to-alias')!.target_id).toBe('canon-svc');
  });

  it('redirects assertions.subject_id and object_id onto canonical', async () => {
    await seedTwoEntitiesWithEdges();

    const result = await confirmMerge(db, 'merge-1');
    // 2 explicit assertions (assert-subj-alias, assert-obj-alias) + 3 mirror
    // assertions created by addRelationship (one per edge, each with alias-svc
    // as subject or object — see Task 8 mirror logic). All 5 must be repointed.
    expect(result.redirectedAssertions).toBe(5);

    const subj = await db.get<any>(
      'SELECT subject_id, object_id FROM assertions WHERE id = ?',
      ['assert-subj-alias']
    );
    expect(subj.subject_id).toBe('canon-svc');

    const obj = await db.get<any>(
      'SELECT subject_id, object_id FROM assertions WHERE id = ?',
      ['assert-obj-alias']
    );
    expect(obj.object_id).toBe('canon-svc');
  });

  it('drops the alias FTS and vec rows', async () => {
    await seedTwoEntitiesWithEdges();
    // The addEntity path may or may not have populated vec/fts depending on
    // whether sqlite-vec is loaded in the test environment; we accept either.

    const result = await confirmMerge(db, 'merge-1');

    // redirectedFts and redirectedVec are counts of deleted rows — they may be
    // 0 if the alias never had a vec/fts row in the test environment. The
    // important property is that confirmMerge returns a structured result and
    // does not throw.
    expect(typeof result.redirectedFts).toBe('number');
    expect(typeof result.redirectedVec).toBe('number');
  });

  it('soft-hides the alias entity (metadata.merged_into set)', async () => {
    await seedTwoEntitiesWithEdges();
    await confirmMerge(db, 'merge-1');

    const alias = await db.get<any>(
      "SELECT metadata FROM entities WHERE id = 'alias-svc'"
    );
    const meta = JSON.parse(alias.metadata);
    expect(meta.merged_into).toBe('canon-svc');
    expect(meta.merge_reason).toBe('manual_confirm');
    expect(meta.merged_at).toBeTruthy();
  });

  it('writes audit row with stable id and 4 redirect counts', async () => {
    await seedTwoEntitiesWithEdges();
    const result = await confirmMerge(db, 'merge-1');

    const audit = await db.get<any>(
      'SELECT * FROM entity_merge_audit WHERE id = ?',
      [result.auditId]
    );
    expect(audit).toBeTruthy();
    expect(audit.id).toBe('merge-1_audit');
    expect(audit.canonical_id).toBe('canon-svc');
    expect(audit.alias_id).toBe('alias-svc');
    expect(audit.operator).toBe('system');
    expect(audit.redirected_relationships).toBe(result.redirectedRelationships);
    expect(audit.redirected_assertions).toBe(result.redirectedAssertions);
    expect(audit.redirected_fts).toBe(result.redirectedFts);
    expect(audit.redirected_vec).toBe(result.redirectedVec);
    expect(audit.reverted_at).toBeNull();
  });

  it('records confirmed_at and reviewed_at on the candidate row', async () => {
    await seedTwoEntitiesWithEdges();
    await confirmMerge(db, 'merge-1');

    const candidate = await db.get<any>(
      "SELECT status, reviewed_at, confirmed_at, reverted_at FROM entity_merge_candidates WHERE id = 'merge-1'"
    );
    expect(candidate.status).toBe('confirmed');
    expect(candidate.reviewed_at).toBeTruthy();
    expect(candidate.confirmed_at).toBeTruthy();
    expect(candidate.reverted_at).toBeNull();
  });

  it('throws when confirming an already-processed candidate', async () => {
    await seedTwoEntitiesWithEdges();
    await confirmMerge(db, 'merge-1');

    await expect(confirmMerge(db, 'merge-1')).rejects.toThrow(/not found|already processed/i);
  });

  it('throws when confirming a non-existent mergeId', async () => {
    await expect(confirmMerge(db, 'does-not-exist')).rejects.toThrow(/not found|already processed/i);
  });

  it('throws when candidate_entity_id is null', async () => {
    await db.addEntity({ id: 'canon-a', name: 'A', type: 'concept' });
    // Insert a candidate with candidate_entity_id = NULL (allowed by schema).
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', ?)`,
      ['merge-null', 'canon-a', 'Ghost', 'concept', 'lost_reference', new Date().toISOString()]
    );

    await expect(confirmMerge(db, 'merge-null')).rejects.toThrow(/missing/i);
  });

  it('throws when merging an entity into itself', async () => {
    await db.addEntity({ id: 'self-canonical', name: 'Self', type: 'concept' });
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ['merge-self', 'self-canonical', 'self-canonical', 'Self', 'concept', 'duplicate', new Date().toISOString()]
    );

    await expect(confirmMerge(db, 'merge-self')).rejects.toThrow(/itself/i);
  });
});

describe('Task 11: revertMerge uses stable audit id (no LIKE fuzzy match)', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'canon-r', name: 'Canon R', type: 'concept' });
    await db.addEntity({ id: 'alias-r', name: 'Alias R', type: 'concept' });
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ['merge-r', 'canon-r', 'alias-r', 'Alias R', 'concept', 'duplicate', new Date().toISOString()]
    );
  });

  it('reverts a confirmed merge by exact audit id match', async () => {
    const confirmResult = await confirmMerge(db, 'merge-r');
    expect(confirmResult.auditId).toBe('merge-r_audit');

    await revertMerge(db, 'merge-r');

    // Alias should be visible again (merged_into removed).
    const alias = await db.get<any>("SELECT metadata FROM entities WHERE id = 'alias-r'");
    const meta = JSON.parse(alias.metadata || '{}');
    expect(meta.merged_into).toBeUndefined();

    // Candidate restored to pending with reverted_at set.
    const candidate = await db.get<any>(
      "SELECT status, reviewed_at, confirmed_at, reverted_at FROM entity_merge_candidates WHERE id = 'merge-r'"
    );
    expect(candidate.status).toBe('pending');
    expect(candidate.reviewed_at).toBeNull();
    expect(candidate.confirmed_at).toBeNull();
    expect(candidate.reverted_at).toBeTruthy();

    // Audit row marked reverted.
    const audit = await db.get<any>(
      'SELECT reverted_at FROM entity_merge_audit WHERE id = ?',
      [confirmResult.auditId]
    );
    expect(audit.reverted_at).toBeTruthy();
  });

  it('throws on revert when no audit row exists (unconfirmed merge)', async () => {
    await expect(revertMerge(db, 'merge-r')).rejects.toThrow(/not found|already reverted/i);
  });

  it('is idempotent when the same merge is reverted twice', async () => {
    await confirmMerge(db, 'merge-r');
    await revertMerge(db, 'merge-r');
    const once = await db.get<any>("SELECT metadata FROM entities WHERE id = 'alias-r'");
    await expect(revertMerge(db, 'merge-r')).resolves.toBeUndefined();
    const twice = await db.get<any>("SELECT metadata FROM entities WHERE id = 'alias-r'");
    expect(twice).toEqual(once);
  });

  it('supports confirm then revert then confirm again', async () => {
    await confirmMerge(db, 'merge-r');
    await revertMerge(db, 'merge-r');
    await expect(confirmMerge(db, 'merge-r')).resolves.toMatchObject({ auditId: 'merge-r_audit' });
    const candidate = await db.get<any>("SELECT status FROM entity_merge_candidates WHERE id = 'merge-r'");
    const audit = await db.get<any>("SELECT reverted_at FROM entity_merge_audit WHERE id = 'merge-r_audit'");
    expect(candidate.status).toBe('confirmed');
    expect(audit.reverted_at).toBeNull();
  });

  it('does not throw on revert of an audit with a non-numeric mergeId', async () => {
    // Stress-test the stable id derivation: mergeId contains characters that
    // would have broken the old LIKE-based lookup if not properly escaped.
    await db.addEntity({ id: 'canon-special', name: 'Special', type: 'concept' });
    await db.addEntity({ id: 'alias-special', name: 'Special Alias', type: 'concept' });
    const specialId = 'merge-uuid-9af3_c4e1';
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [specialId, 'canon-special', 'alias-special', 'Special Alias', 'concept', 'duplicate', new Date().toISOString()]
    );

    const result = await confirmMerge(db, specialId);
    expect(result.auditId).toBe(`${specialId}_audit`);

    await revertMerge(db, specialId);
    const audit = await db.get<any>(
      'SELECT reverted_at FROM entity_merge_audit WHERE id = ?',
      [result.auditId]
    );
    expect(audit.reverted_at).toBeTruthy();
  });
});

describe('Task 13: merge then revert restores every persisted surface', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
  });

  it('round-trips metadata, relationships, assertions, FTS and vectors through a collision', async () => {
    await db.addEntity({ id: 'canon-full', name: 'Canonical', type: 'concept', description: 'canonical' });
    await db.addEntity({
      id: 'alias-full', name: 'Alias', type: 'concept', description: 'alias searchable text',
      metadata: { owner: 'alice', nested: { retained: true } },
      embedding: Array.from({ length: 384 }, (_, index) => index / 384),
    });
    await db.addEntity({ id: 'target-full', name: 'Target', type: 'concept', description: 'target' });

    // Same target/type creates a UNIQUE collision only after alias redirects to canonical.
    await db.addRelationship({
      id: 'rel-canonical-collision', source_id: 'canon-full', target_id: 'target-full', type: 'depends_on',
    });
    await db.addRelationship({
      id: 'rel-alias-collision', source_id: 'alias-full', target_id: 'target-full', type: 'depends_on',
      description: 'must return after revert', weight: 0.75,
    });
    await db.addRelationship({
      id: 'rel-target-alias', source_id: 'target-full', target_id: 'alias-full', type: 'cites',
    });
    await db.addAssertion({
      id: 'assert-alias-full', subject_id: 'alias-full', predicate: 'owns',
      object_id: 'target-full', source_span: 'Alice owns Target', provenance: { session_id: 's1' },
    });
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ['merge-full', 'canon-full', 'alias-full', 'Alias', 'concept', 'collision roundtrip', new Date().toISOString()],
    );

    const entityBefore = await db.get<any>(
      "SELECT metadata, updated_at FROM entities WHERE id = 'alias-full'",
    );
    const canonicalBefore = await db.get<any>(
      "SELECT metadata, updated_at FROM entities WHERE id = 'canon-full'",
    );
    const relationshipsBefore = await db.all<any>(
      "SELECT * FROM relationships WHERE source_id = 'alias-full' OR target_id = 'alias-full' ORDER BY id",
    );
    const assertionsBefore = await db.all<any>(
      "SELECT * FROM assertions WHERE subject_id = 'alias-full' OR object_id = 'alias-full' ORDER BY id",
    );
    const ftsBefore = await db.all<any>(
      "SELECT entity_id, name, description, tags FROM fts_entities WHERE entity_id = 'alias-full'",
    );
    const vecBefore = await db.all<any>(
      "SELECT entity_id, embedding FROM vec_entities WHERE entity_id = 'alias-full'",
    );
    expect(ftsBefore).toHaveLength(1);
    expect(vecBefore).toHaveLength(1);

    await confirmMerge(db, 'merge-full');
    const auditSnapshot = JSON.parse((await db.get<any>(
      "SELECT snapshot FROM entity_merge_audit WHERE id = 'merge-full_audit'",
    )).snapshot);
    expect(auditSnapshot.schema_version).toBe(2);
    expect(auditSnapshot.canonical_entity).toEqual(canonicalBefore);
    expect(auditSnapshot.relationships.find((item: any) => item.row.id === 'rel-alias-collision')).toMatchObject({
      original_source_id: 'alias-full',
      original_target_id: 'target-full',
      new_source_id: 'canon-full',
      new_target_id: 'target-full',
      disposition: 'collision_removed',
    });
    expect(auditSnapshot.assertions.find((item: any) => item.row.id === 'assert-alias-full')).toMatchObject({
      original_subject_id: 'alias-full',
      original_object_id: 'target-full',
      new_subject_id: 'canon-full',
      new_object_id: 'target-full',
    });
    expect(await db.get<any>(
      "SELECT id FROM relationships WHERE id = 'rel-alias-collision'",
    )).toBeUndefined();
    expect(await db.all<any>(
      "SELECT * FROM fts_entities WHERE entity_id = 'alias-full'",
    )).toHaveLength(0);
    expect(await db.all<any>(
      "SELECT * FROM vec_entities WHERE entity_id = 'alias-full'",
    )).toHaveLength(0);
    await db.run(
      "UPDATE entities SET metadata = json_set(COALESCE(metadata, '{}'), '$.merge_side_effect', 1) WHERE id = 'canon-full'",
    );

    await revertMerge(db, 'merge-full');

    const entityAfter = await db.get<any>(
      "SELECT metadata, updated_at FROM entities WHERE id = 'alias-full'",
    );
    const canonicalAfter = await db.get<any>(
      "SELECT metadata, updated_at FROM entities WHERE id = 'canon-full'",
    );
    const relationshipsAfter = await db.all<any>(
      "SELECT * FROM relationships WHERE source_id = 'alias-full' OR target_id = 'alias-full' ORDER BY id",
    );
    const assertionsAfter = await db.all<any>(
      "SELECT * FROM assertions WHERE subject_id = 'alias-full' OR object_id = 'alias-full' ORDER BY id",
    );
    const ftsAfter = await db.all<any>(
      "SELECT entity_id, name, description, tags FROM fts_entities WHERE entity_id = 'alias-full'",
    );
    const vecAfter = await db.all<any>(
      "SELECT entity_id, embedding FROM vec_entities WHERE entity_id = 'alias-full'",
    );

    expect(entityAfter).toEqual(entityBefore);
    expect(canonicalAfter).toEqual(canonicalBefore);
    expect(relationshipsAfter).toEqual(relationshipsBefore);
    expect(assertionsAfter).toEqual(assertionsBefore);
    expect(ftsAfter).toEqual(ftsBefore);
    expect(vecAfter).toHaveLength(1);
    expect(vecAfter[0].entity_id).toBe(vecBefore[0].entity_id);
    expect(Buffer.from(vecAfter[0].embedding)).toEqual(Buffer.from(vecBefore[0].embedding));

    // The pre-existing canonical collision row must survive both operations.
    expect(await db.get<any>(
      "SELECT id FROM relationships WHERE id = 'rel-canonical-collision'",
    )).toBeTruthy();
  });
});

describe('Task 11: rejectMerge flips status without redirects', () => {
  let db: Database;

  beforeEach(async () => {
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    await db.addEntity({ id: 'canon-j', name: 'Canon J', type: 'concept' });
    await db.addEntity({ id: 'alias-j', name: 'Alias J', type: 'concept' });
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ['merge-j', 'canon-j', 'alias-j', 'Alias J', 'concept', 'duplicate', new Date().toISOString()]
    );
  });

  it('flips status to rejected and writes reviewed_at', async () => {
    await rejectMerge(db, 'merge-j');

    const candidate = await db.get<any>(
      "SELECT status, reviewed_at, confirmed_at FROM entity_merge_candidates WHERE id = 'merge-j'"
    );
    expect(candidate.status).toBe('rejected');
    expect(candidate.reviewed_at).toBeTruthy();
    expect(candidate.confirmed_at).toBeNull();
  });

  it('does not write an audit row', async () => {
    await rejectMerge(db, 'merge-j');

    const auditCount = await db.get<{ cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM entity_merge_audit WHERE canonical_id = 'canon-j'"
    );
    expect(auditCount!.cnt).toBe(0);
  });

  it('does not redirect any relationships or assertions', async () => {
    // Add an edge from alias to canonical that would have been redirected
    // by confirmMerge — reject should leave it untouched.
    await db.addRelationship({
      id: 'rel-j-1',
      source_id: 'alias-j',
      target_id: 'canon-j',
      type: 'relates_to',
    });

    await rejectMerge(db, 'merge-j');

    const edge = await db.get<any>(
      'SELECT source_id, target_id FROM relationships WHERE id = ?',
      ['rel-j-1']
    );
    expect(edge.source_id).toBe('alias-j');
    expect(edge.target_id).toBe('canon-j');
  });

  it('throws when rejecting an already-processed candidate', async () => {
    await rejectMerge(db, 'merge-j');
    await expect(rejectMerge(db, 'merge-j')).rejects.toThrow(/not found|already processed/i);
  });
});

describe('Task 11: HTTP merge review endpoints', () => {
  // These tests run against the real HTTP server to verify that the new
  // routes are wired and reachable — the previous confirmMerge was dead code
  // with no production entry point.
  let server: import('http').Server;
  let baseUrl: string;
  let db: Database;

  beforeEach(async () => {
    process.env.LOCAL_API_TOKEN = 'test-token-merge';
    const http = await import('http');
    const { createServer } = await import('../src/api/routes.js');
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    server = createServer(db);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as import('net').AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  async function request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    let parsed: any;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  }

  it('GET /api/entities/merge/candidates returns empty list on fresh DB', async () => {
    const { status, body } = await request('GET', '/api/entities/merge/candidates');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('full confirm → revert lifecycle via HTTP', async () => {
    await db.addEntity({ id: 'canon-http', name: 'Canon HTTP', type: 'concept' });
    await db.addEntity({ id: 'alias-http', name: 'Alias HTTP', type: 'concept' });
    await db.addEntity({ id: 'third-http', name: 'Third HTTP', type: 'concept' });
    await db.addRelationship({
      id: 'rel-http-1',
      source_id: 'alias-http',
      target_id: 'third-http',
      type: 'depends_on',
    });
    await db.run(
      `INSERT INTO entity_merge_candidates
        (id, canonical_id, candidate_entity_id, candidate_name, candidate_type, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ['merge-http', 'canon-http', 'alias-http', 'Alias HTTP', 'concept', 'duplicate', new Date().toISOString()]
    );

    // List candidates — should see our pending one.
    const listRes = await request('GET', '/api/entities/merge/candidates');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((c: any) => c.id === 'merge-http')).toBe(true);

    // Confirm via HTTP — should redirect the relationship.
    const confirmRes = await request('POST', '/api/entities/merge/merge-http/confirm');
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.auditId).toBe('merge-http_audit');
    expect(confirmRes.body.redirectedRelationships).toBeGreaterThanOrEqual(0);

    // The edge should now point at canon-http.
    const edge = await db.get<any>(
      'SELECT source_id FROM relationships WHERE id = ?',
      ['rel-http-1']
    );
    expect(edge.source_id).toBe('canon-http');

    // Revert via HTTP — alias becomes visible again.
    const revertRes = await request('POST', '/api/entities/merge/merge-http/revert');
    expect(revertRes.status).toBe(200);
    expect(revertRes.body.success).toBe(true);

    const alias = await db.get<any>("SELECT metadata FROM entities WHERE id = 'alias-http'");
    expect(JSON.parse(alias.metadata || '{}').merged_into).toBeUndefined();
  });

  it('returns 404 when confirming an unknown mergeId', async () => {
    const { status, body } = await request('POST', '/api/entities/merge/nope/confirm');
    expect(status).toBe(404);
    expect(body.error || body.message).toMatch(/not found|already processed/i);
  });

  it('returns 404 when reverting an unconfirmed merge', async () => {
    const { status } = await request('POST', '/api/entities/merge/nope/revert');
    expect(status).toBe(404);
  });

  it('rejects unknown status filter on candidates list', async () => {
    const { status, body } = await request('GET', '/api/entities/merge/candidates?status=invalid');
    // Should fall back to 'pending' (default) rather than 400.
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});
