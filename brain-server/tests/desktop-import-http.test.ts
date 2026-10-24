import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureConversations,
  fixtureRelationshipConversations,
  FIXTURE_GOOD_PHRASE,
  startDesktopImportFixture,
  type DesktopImportFixture,
} from './fixtures/desktop-import-server.js';

describe('CONTROLLED_FIXTURE: authenticated Desktop import HTTP path', () => {
  let fixture: DesktopImportFixture | undefined;
  let token: string;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    token = randomBytes(32).toString('hex');
    vi.stubEnv('OMNI_DESKTOP_IMPORT_FIXTURE', '1');
    vi.stubEnv('LOCAL_API_TOKEN', token);
    vi.stubEnv('CORS_ORIGINS', 'http://127.0.0.1:3018');
    fixture = await startDesktopImportFixture({ port: 0, llmPort: 0 });
  // On a cold Windows checkout, Vitest's first dynamic import of the API route
  // graph plus native SQLite setup can exceed one minute before the in-memory
  // fixture is reachable. Keep this bounded without timing out mid-startup.
  }, 120_000);

  afterEach(async () => {
    try {
      await fixture?.close();
    } finally {
      fixture = undefined;
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });

  async function request(method: string, route: string, body?: unknown, authenticated = true) {
    const response = await fetch(`${fixture!.baseUrl}${route}`, {
      method,
      headers: {
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }

  async function importConversations(conversations: unknown[]) {
    const submitted = await request('POST', '/api/import/chat', { text: JSON.stringify(conversations) });
    expect(submitted.status).toBe(200);
    expect(submitted.body.jobId).toEqual(expect.any(String));
    let terminal: any;
    await vi.waitFor(async () => {
      const response = await request('GET', `/api/ingest/job/${submitted.body.jobId}`);
      expect(response.status).toBe(200);
      expect(['queued', 'running']).not.toContain(response.body.status);
      terminal = response.body;
    }, { timeout: 30_000, interval: 50 });
    return terminal;
  }

  async function retryFailedImport(batchId: string) {
    const submitted = await request('POST', `/api/import/chat/failed/${batchId}/retry`);
    expect(submitted.status).toBe(202);
    expect(submitted.body.jobId).toEqual(expect.any(String));
    let terminal: any;
    await vi.waitFor(async () => {
      const response = await request('GET', `/api/ingest/job/${submitted.body.jobId}`);
      expect(response.status).toBe(200);
      expect(['queued', 'running']).not.toContain(response.body.status);
      terminal = response.body;
    }, { timeout: 30_000, interval: 50 });
    return terminal;
  }

  async function addFailedImportTask(batchId: string, taskId: string, text = FIXTURE_GOOD_PHRASE) {
    await fixture!.db.recordFailedTask({
      task_id: taskId,
      batch_id: batchId,
      task_type: 'chat_import',
      conversation_title: '受控恢复来源',
      stage: 'extracting',
      error: 'CONTROLLED_FIXTURE_TRANSIENT_FAILURE',
      payload_snapshot: JSON.stringify({
        title: '受控恢复来源',
        text,
        time: new Date(fixtureConversations[0].create_time * 1000).toISOString(),
        platform: 'chatgpt',
        extractionMode: 'default',
      }),
    });
  }

  async function importedRelationships(batchId: string) {
    return fixture!.db.all<{ id: string }>(
      `SELECT r.id FROM relationships r
       JOIN assertions a ON a.id = 'relationship:' || r.id
       WHERE a.provenance LIKE ?`,
      [`%"import_batch_id":"${batchId}"%`],
    );
  }

  async function entityRows() {
    return fixture!.db.all<{ id: string; tags: string; metadata: string }>(
      'SELECT id, tags, metadata FROM entities',
    );
  }

  function expectImportSource(row: Awaited<ReturnType<typeof entityRows>>[number], jobId: string) {
    const originalTime = new Date(fixtureConversations[0].create_time * 1000).toISOString();
    expect(JSON.parse(row.tags)).toEqual(expect.arrayContaining(['imported', 'import:chatgpt']));
    expect(JSON.parse(row.metadata).provenance).toMatchObject({
      source: 'import', platform: 'chatgpt', import_batch_id: jobId,
      original_timestamp: originalTime,
    });
  }

  it('requires explicit fixture opt-in before constructing another server', async () => {
    vi.stubEnv('OMNI_DESKTOP_IMPORT_FIXTURE', '0');
    await expect(startDesktopImportFixture({ port: 0, llmPort: 0 }))
      .rejects.toThrow('OMNI_DESKTOP_IMPORT_FIXTURE=1');
  });

  it('applies back-pressure at the active-job limit without evicting running imports', async () => {
    fixture!.setHoldExtractions(true);
    const payload = {
      filename: 'capacity-fixture.txt',
      contentType: 'text/plain',
      base64: Buffer.from('A synthetic capacity fixture used only to verify active-job back-pressure.').toString('base64'),
    };
    const active = await Promise.all(Array.from({ length: 100 }, (_, index) => request(
      'POST', '/api/ingest/file', { ...payload, filename: `capacity-fixture-${index}.txt` },
    )));
    expect(active.every(response => response.status === 200)).toBe(true);
    const jobIds = active.map(response => response.body.jobId as string);
    await vi.waitFor(() => expect(fixture!.llmCalls.heldExtractions).toBe(100), { timeout: 60_000, interval: 50 });

    const overloaded = await request('POST', '/api/ingest/file', { ...payload, filename: 'capacity-fixture-overflow.txt' });
    expect(overloaded.status).toBe(429);
    expect(overloaded.body.error).toContain('Too many active import tasks');
    const firstJob = await request('GET', `/api/ingest/job/${jobIds[0]}`);
    expect(firstJob.status).toBe(200);
    expect(firstJob.body.status).toBe('running');

    fixture!.setHoldExtractions(false);
    fixture!.releaseHeldExtractions();
    const placeholders = jobIds.map(() => '?').join(',');
    await vi.waitFor(async () => {
      const activeCount = await fixture!.db.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM import_job_receipts
         WHERE job_id IN (${placeholders}) AND status IN ('queued', 'running')`,
        jobIds,
      );
      expect(activeCount?.count).toBe(0);
    }, { timeout: 60_000, interval: 100 });
  }, 120_000);

  it('starts empty and rejects unauthenticated graph/import calls without writing', async () => {
    const graph = await request('POST', '/api/graph/context', { depth: 3, limit: 100 }, false);
    const imported = await request('POST', '/api/import/chat', {
      text: JSON.stringify(fixtureConversations),
    }, false);
    expect(graph.status).toBe(401);
    expect(imported.status).toBe(401);
    const empty = await request('POST', '/api/graph/context', { depth: 3, limit: 100 });
    expect(empty.status).toBe(200);
    expect(empty.body.entities).toEqual([]);
    expect(await fixture!.db.all('SELECT task_id FROM failed_tasks')).toEqual([]);
  });

  it('permits the explicit controlled browser origin for authenticated API requests', async () => {
    const preflight = await fetch(`${fixture!.baseUrl}/api/import/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://127.0.0.1:3018',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3018');
    expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('persists one good conversation through real import routes with source provenance', async () => {
    const terminal = await importConversations(fixtureConversations.slice(0, 1));
    expect(terminal.status).toBe('success');
    expect(terminal.importProgress).toEqual({ done: 1, total: 1, entities: 1 });
    expect(terminal.result.entities).toBe(1);
    const graph = await request('POST', '/api/graph/context', { depth: 3, limit: 100 });
    expect(graph.status).toBe(200);
    expect(graph.body.entities).toHaveLength(1);
    const saved = await fixture!.db.getEntity(graph.body.entities[0].id);
    expect(saved?.description).toBe(FIXTURE_GOOD_PHRASE);
    expect(saved?.metadata?.provenance).toMatchObject({
      source: 'import', platform: 'chatgpt', title: fixtureConversations[0].title,
      import_batch_id: terminal.jobId,
    });
    expect(saved?.tags).toContain('imported');
  });

  it('counts and decorates an internally persisted same-name person against the actual database increase', async () => {
    await fixture!.db.addEntity({ id: 'existing-user', name: '用户', type: 'person' });
    const before = new Set((await entityRows()).map(row => row.id));

    const terminal = await importConversations(fixtureConversations.slice(0, 1));

    expect(terminal.status).toBe('success');
    const added = (await entityRows()).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(terminal.result.entities).toBe(added.length);
    expect(terminal.importProgress.entities).toBe(added.length);
    expectImportSource(added[0], terminal.jobId);
  });

  it('reports each consecutive import batch independently without losing saved counts or source identity', async () => {
    const first = await importConversations(fixtureConversations.slice(0, 1));
    const firstRows = await entityRows();
    const before = new Set(firstRows.map(row => row.id));

    const second = await importConversations(fixtureConversations.slice(0, 1));

    expect(first.status).toBe('success');
    expect(second.status).toBe('success');
    const after = await entityRows();
    const added = after.filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(second.result.entities).toBe(added.length);
    expect(second.importProgress.entities).toBe(added.length);
    expectImportSource(added[0], second.jobId);
    expectImportSource(after.find(row => row.id === firstRows[0].id)!, first.jobId);
  });

  it('retains a committed resolver entity in a failed receipt when later review-queue persistence fails', async () => {
    await fixture!.db.addEntity({ id: 'existing-user', name: '用户', type: 'person' });
    const before = new Set((await entityRows()).map(row => row.id));
    const run = fixture!.db.run.bind(fixture!.db);
    vi.spyOn(fixture!.db, 'run').mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO entity_merge_candidates')) {
        return Promise.reject(new Error('CONTROLLED_FIXTURE_MERGE_QUEUE_FAILURE'));
      }
      return run(sql, params);
    });

    const terminal = await importConversations(fixtureConversations.slice(0, 1));

    expect(terminal.status).toBe('failed');
    const added = (await entityRows()).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(terminal.result.entities).toBe(added.length);
    expect(terminal.importProgress.entities).toBe(added.length);
    expect(terminal.result.failed_conversations).toHaveLength(1);
    expectImportSource(added[0], terminal.jobId);
  });

  it('preserves an earlier committed entity count when a later entity write rolls back', async () => {
    await fixture!.db.addEntity({ id: 'existing-user', name: '用户', type: 'person' });
    const before = new Set((await entityRows()).map(row => row.id));
    const addEntity = fixture!.db.addEntity.bind(fixture!.db);
    let writes = 0;
    let rolledBackId: string | undefined;
    vi.spyOn(fixture!.db, 'addEntity').mockImplementation(async (input) => {
      const saved = await addEntity(input);
      writes += 1;
      if (writes === 2) {
        rolledBackId = saved.id;
        throw new Error('CONTROLLED_FIXTURE_ENTITY_FAILURE_AFTER_INSERT');
      }
      return saved;
    });

    const terminal = await importConversations([
      fixtureConversations[0], { ...fixtureConversations[0], title: '受控后续实体写入失败' },
    ]);

    expect(terminal.status).toBe('partial');
    expect(writes).toBe(2);
    const added = (await entityRows()).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(terminal.result.entities).toBe(added.length);
    expect(terminal.importProgress.entities).toBe(added.length);
    expect(await fixture!.db.get('SELECT id FROM entities WHERE id = ?', [rolledBackId])).toBeUndefined();
    expectImportSource(added[0], terminal.jobId);
  });

  it('keeps rejected import recovery detail locally while redacting it from logs', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const terminal = await importConversations(fixtureConversations);
    expect(terminal.status).toBe('partial');
    expect(terminal.importProgress).toEqual({ done: 2, total: 2, entities: 1 });
    expect(terminal.result.failed_conversations).toHaveLength(1);
    expect(terminal.result.failed_conversations[0].title).toBe(fixtureConversations[1].title);
    expect(errorLog).toHaveBeenCalledWith('[Import] conversation processing failed:', 'Error');
    const loggedErrors = errorLog.mock.calls.flat().join(' ');
    expect(loggedErrors).not.toContain(fixtureConversations[1].title);
    expect(loggedErrors).not.toContain('CONTROLLED_FIXTURE_EXTRACTION_FAILURE');
    const failures = await fixture!.db.getFailedTasks(terminal.jobId);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ task_type: 'chat_import', status: 'pending', stage: 'extracting' });
    expect(failures[0].conversation_title).toBe(fixtureConversations[1].title);
    expect(failures[0].payload_snapshot).toContain('[fixture-fail]');
    const failureReadback = await request('GET', `/api/import/chat/failed?batchId=${terminal.jobId}`);
    expect(failureReadback.status).toBe(200);
    expect(failureReadback.body.count).toBe(1);
    expect(failureReadback.body.tasks[0]).not.toHaveProperty('payload_snapshot');
    const graph = await request('POST', '/api/graph/context', { depth: 3, limit: 100 });
    expect(graph.body.entities).toHaveLength(1);
  });

  it('retains retry provenance and counts a resolver-persisted review candidate', async () => {
    const batchId = 'controlled-retry-review-batch';
    const taskId = 'controlled-retry-review-task';
    await fixture!.db.addEntity({ id: 'existing-user', name: '用户', type: 'person' });
    await addFailedImportTask(batchId, taskId);
    const before = new Set((await entityRows()).map(row => row.id));

    const terminal = await retryFailedImport(batchId);

    expect(terminal.status).toBe('success');
    const added = (await entityRows()).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(terminal.result.entities).toBe(added.length);
    expect(terminal.importProgress.entities).toBe(added.length);
    expect(added[0].tags && JSON.parse(added[0].tags)).toEqual(expect.arrayContaining([
      'imported', 'import:chatgpt', 'retry',
    ]));
    expect(JSON.parse(added[0].metadata).provenance).toMatchObject({
      source: 'import-retry', platform: 'chatgpt', import_batch_id: batchId, retry_of: taskId,
    });
    expect((await fixture!.db.getFailedTask(taskId))?.status).toBe('resolved');
  });

  it('retains retry provenance and counts a newly planned entity in the saved receipt', async () => {
    const batchId = 'controlled-retry-new-batch';
    const taskId = 'controlled-retry-new-task';
    await addFailedImportTask(batchId, taskId);
    const before = new Set((await entityRows()).map(row => row.id));

    const terminal = await retryFailedImport(batchId);

    expect(terminal.status).toBe('success');
    const added = (await entityRows()).filter(row => !before.has(row.id));
    expect(added).toHaveLength(1);
    expect(terminal.result.entities).toBe(added.length);
    expect(terminal.importProgress.entities).toBe(added.length);
    expect(added[0].tags && JSON.parse(added[0].tags)).toEqual(expect.arrayContaining([
      'imported', 'import:chatgpt', 'retry',
    ]));
    expect(JSON.parse(added[0].metadata).provenance).toMatchObject({
      source: 'import-retry', platform: 'chatgpt', import_batch_id: batchId, retry_of: taskId,
    });
    expect((await fixture!.db.getFailedTask(taskId))?.status).toBe('resolved');
  });

  it('counts only relationships actually committed by a recovered import', async () => {
    const batchId = 'controlled-retry-relationships-batch';
    const taskId = 'controlled-retry-relationships-task';
    await addFailedImportTask(
      batchId,
      taskId,
      '[fixture-relationships] 用户关注 FixtureProject。FixtureProject 关联 FixtureConcept。用户关联用户。',
    );

    const terminal = await retryFailedImport(batchId);

    const saved = await importedRelationships(batchId);
    expect(terminal.status).toBe('success');
    expect(saved).toHaveLength(2);
    expect(terminal.result.entities).toBe(3);
    expect(terminal.importProgress.entities).toBe(3);
    expect(terminal.result.relationships).toBe(saved.length);
  });

  it('counts only committed import relationships across conversations, not candidates or unrelated edges', async () => {
    await fixture!.db.addEntity({ id: 'unrelated-source', name: 'Existing Source', type: 'concept' });
    await fixture!.db.addEntity({ id: 'unrelated-target', name: 'Existing Target', type: 'concept' });
    await fixture!.db.addRelationship({
      id: 'unrelated-edge', source_id: 'unrelated-source', target_id: 'unrelated-target',
      type: 'relates_to', weight: 1,
    });

    const terminal = await importConversations(fixtureRelationshipConversations);

    expect(terminal.status).toBe('success');
    const saved = await importedRelationships(terminal.jobId);
    expect(saved).toHaveLength(4);
    expect(terminal.result.relationships).toBe(saved.length);
    expect(await fixture!.db.all('SELECT id FROM relationships')).toHaveLength(saved.length + 1);
    expect(await fixture!.db.all('SELECT id FROM relationships WHERE source_id = target_id')).toEqual([]);
  }, 35_000);

  it('reports relationships already saved when another conversation fails extraction', async () => {
    const terminal = await importConversations([
      fixtureRelationshipConversations[0], fixtureConversations[1],
    ]);

    expect(terminal.status).toBe('partial');
    expect(terminal.result.failed_conversations).toHaveLength(1);
    const saved = await importedRelationships(terminal.jobId);
    expect(saved).toHaveLength(2);
    expect(terminal.result.relationships).toBe(saved.length);
  }, 35_000);

  it('retains earlier committed counts and excludes a later relationship transaction that rolls back', async () => {
    const addRelationship = fixture!.db.addRelationship.bind(fixture!.db);
    let writes = 0;
    let rolledBackId: string | undefined;
    vi.spyOn(fixture!.db, 'addRelationship').mockImplementation(async (relationship) => {
      const saved = await addRelationship(relationship);
      writes += 1;
      if (writes === 2) {
        rolledBackId = saved.id;
        throw new Error('CONTROLLED_FIXTURE_RELATIONSHIP_FAILURE_AFTER_INSERT');
      }
      return saved;
    });

    const terminal = await importConversations(fixtureRelationshipConversations.slice(0, 1));

    expect(terminal.status).toBe('failed');
    expect(writes).toBe(2);
    expect(terminal.result.conflict_failures).toHaveLength(1);
    const saved = await importedRelationships(terminal.jobId);
    expect(saved).toHaveLength(1);
    expect(terminal.result.relationships).toBe(saved.length);
    expect(await fixture!.db.get('SELECT id FROM relationships WHERE id = ?', [rolledBackId])).toBeUndefined();
    expect(await fixture!.db.get('SELECT id FROM assertions WHERE id = ?', [`relationship:${rolledBackId}`])).toBeUndefined();
    expect(await fixture!.db.getFailedTasks(terminal.jobId)).toEqual([
      expect.objectContaining({ task_type: 'conflict_resolution', stage: 'resolving', status: 'pending' }),
    ]);
  });

  it('maps the stub answer reference to the UUID actually retrieved from the persisted graph', async () => {
    await importConversations(fixtureConversations.slice(0, 1));
    const graph = await request('POST', '/api/graph/context', { depth: 3, limit: 100 });
    const savedId = graph.body.entities[0].id;
    const answer = await request('POST', '/api/mcp/tool/graph_answer', {
      arguments: { messages: [{ role: 'user', content: 'TEST_FIXTURE 合成资料用于验证什么？' }] },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.conclusion).toContain('导入来源回执和恢复流程');
    expect(answer.body.sources.map((source: any) => source.id)).toContain(savedId);
    expect(answer.body.reasons[0].entityIds).toContain(savedId);
    expect(answer.body.citedEntityIds).toContain(savedId);
    expect(fixture!.llmCalls.graphAnswers).toBe(1);
    expect(fixture!.llmCalls.extractions).toBe(1);
  });

  it('allows only the owned loopback LLM and never forwards a supplied provider key', async () => {
    const models = await fetch(`${fixture!.llmUrl}/models`);
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ data: [{ id: 'fixture-model', object: 'model' }] });
    const accepted = await request('POST', '/api/settings/llm', {
      apiUrl: fixture!.llmUrl, model: 'fixture-model', apiKey: 'not-a-real-key',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.healthy).toBe(true);
    expect(fixture!.llmCalls.receivedAuthorization).toBe(false);
    const rejected = await request('POST', '/api/settings/llm', {
      apiUrl: 'https://example.invalid/v1', model: 'fixture-model',
    });
    expect(rejected.status).toBe(500);
    expect(fixture!.llmCalls.receivedAuthorization).toBe(false);
  });
});
