import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConversationRuntime, conversationDirectory } from '../src/conversation-runtime.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = path.join(TEST_DIR, 'fixtures', 'fake-brain-server.mjs');

describe('per-conversation isolated Brain Server runtime', () => {
  let runsRoot;
  let runDir;
  const active = [];

  before(async () => {
    await mkdir(path.join(TEST_DIR, '..', 'runs'), { recursive: true });
    runsRoot = await mkdtemp(path.join(TEST_DIR, '..', 'runs', 'conversation-runtime-'));
    runDir = path.join(runsRoot, 'run-1');
    await mkdir(runDir);
  });

  after(async () => {
    for (const runtime of active) await runtime.stop().catch(() => {});
    await rm(runsRoot, { recursive: true, force: true });
  });

  function runtime(conversationId, resume = false) {
    const instance = new ConversationRuntime({
      runDir,
      conversationId,
      resume,
      brainServerRoot: TEST_DIR,
      serverEntry: FAKE_SERVER,
      startupTimeoutMs: 10_000,
      shutdownTimeoutMs: 5_000,
    });
    active.push(instance);
    return instance;
  }

  it('gives Conversation A and B different ports, DBs, logs, and PID files', async () => {
    const a = runtime(1);
    const b = runtime(2);
    await Promise.all([a.start(), b.start()]);

    assert.notStrictEqual(a.port, b.port);
    assert.notStrictEqual(a.dbPath, b.dbPath);
    assert.strictEqual(a.dbPath, path.join(conversationDirectory(runDir, 1), 'brain.db'));
    assert.strictEqual(b.dbPath, path.join(conversationDirectory(runDir, 2), 'brain.db'));
    await Promise.all([access(a.logPath), access(b.logPath), access(a.pidPath), access(b.pidPath)]);

    const aPid = Number((await readFile(a.pidPath, 'utf8')).trim());
    const bPid = Number((await readFile(b.pidPath, 'utf8')).trim());
    assert.ok(Number.isInteger(aPid));
    assert.ok(Number.isInteger(bPid));
    assert.notStrictEqual(aPid, bPid);
  });

  it('does not expose Conversation A entity or count in Conversation B', async () => {
    const [a, b] = active.slice(0, 2);
    const unique = { id: 'only-in-a', name: 'Conversation A secret entity' };
    const write = await fetch(`http://127.0.0.1:${a.port}/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(unique),
    });
    assert.strictEqual(write.status, 200);

    const aEntities = await (await fetch(`http://127.0.0.1:${a.port}/entities`)).json();
    const bEntities = await (await fetch(`http://127.0.0.1:${b.port}/entities`)).json();
    const bStats = await (await fetch(`http://127.0.0.1:${b.port}/api/stats`)).json();
    assert.deepStrictEqual(aEntities.entities, [unique]);
    assert.deepStrictEqual(bEntities.entities, []);
    assert.strictEqual(bStats.database.entities, 0);
  });

  it('stops safely, records database hashes, and resumes the original DB', async () => {
    const [a, b] = active.slice(0, 2);
    const [aStop, bStop] = await Promise.all([a.stop(), b.stop()]);
    assert.match(aStop.databaseHash, /^[a-f0-9]{64}$/);
    assert.match(bStop.databaseHash, /^[a-f0-9]{64}$/);

    const resumed = runtime(1, true);
    await resumed.start();
    const data = await (await fetch(`http://127.0.0.1:${resumed.port}/entities`)).json();
    assert.strictEqual(data.entities[0].id, 'only-in-a');
    await resumed.stop();
  });

  it('refuses a new run over an existing conversation database', async () => {
    const duplicate = runtime(1, false);
    await assert.rejects(() => duplicate.start(), /requires an empty database path/);
  });

  it('cleans a recorded orphan before reconnecting the original database', async () => {
    const orphan = runtime(3, false);
    await orphan.start();
    const orphanPid = orphan.child.pid;

    const replacement = runtime(3, true);
    await replacement.start();
    assert.notStrictEqual(replacement.child.pid, orphanPid);
    assert.strictEqual(isAlive(orphanPid), false);
    await replacement.stop();
  });

  it('refuses resume when the original conversation database is absent', async () => {
    const missing = runtime(99, true);
    await assert.rejects(() => missing.start(), /requires the original conversation database/);
  });

  it('rejects a mismatched expected product commit before launching a process', async () => {
    const mismatched = new ConversationRuntime({
      runDir,
      conversationId: 100,
      brainServerRoot: TEST_DIR,
      serverEntry: FAKE_SERVER,
      expectedProductCommit: '0'.repeat(40),
      expectedSelectorVersion: 'evidence-selector-v1',
    });
    active.push(mismatched);
    await assert.rejects(() => mismatched.start(), /Product commit mismatch/);
    assert.strictEqual(mismatched.child, null);
  });
});

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
