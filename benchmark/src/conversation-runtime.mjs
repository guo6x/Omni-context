import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrainServerClient } from './brain-server-client.mjs';
import { sha256File } from './integrity.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BRAIN_SERVER_ROOT = path.resolve(MODULE_DIR, '../../brain-server');

export function conversationDirectory(runDir, conversationId) {
  return path.join(runDir, `conversation-${Number(conversationId)}`);
}

export async function findAvailablePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export class ConversationRuntime {
  constructor({
    runDir,
    conversationId,
    resume = false,
    brainServerRoot = DEFAULT_BRAIN_SERVER_ROOT,
    serverEntry,
    host = '127.0.0.1',
    token = process.env.LOCAL_API_TOKEN || '',
    extraEnv = {},
    startupTimeoutMs = 120_000,
    shutdownTimeoutMs = 15_000,
  }) {
    if (!runDir) throw new Error('ConversationRuntime requires runDir');
    if (!Number.isInteger(Number(conversationId)) || Number(conversationId) < 1) {
      throw new Error(`Invalid conversationId: ${conversationId}`);
    }
    this.runDir = runDir;
    this.conversationId = Number(conversationId);
    this.resume = resume;
    this.brainServerRoot = brainServerRoot;
    this.serverEntry = serverEntry || path.join(brainServerRoot, 'dist', 'api-server.js');
    this.host = host;
    // A per-process token prevents the isolated server from falling back to a
    // separately generated credential that the parent runner cannot know.
    // It is passed only through the child environment and client memory.
    this.token = token || randomBytes(32).toString('hex');
    this.extraEnv = extraEnv;
    this.startupTimeoutMs = startupTimeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;

    this.conversationDir = conversationDirectory(runDir, this.conversationId);
    this.dbPath = path.join(this.conversationDir, 'brain.db');
    this.logPath = path.join(this.conversationDir, 'server.log');
    this.pidPath = path.join(this.conversationDir, 'server.pid');
    this.runtimePath = path.join(this.conversationDir, 'runtime.json');
    this.databaseHashPath = path.join(this.conversationDir, 'database-hash.txt');
    this.child = null;
    this.logHandle = null;
    this.port = null;
    this.client = null;
  }

  async start() {
    await mkdir(this.conversationDir, { recursive: true });
    await this.cleanupOrphan();
    await access(this.serverEntry).catch(() => {
      throw new Error(
        `Brain Server entry not found: ${this.serverEntry}. ` +
        'Build it first with npm ci && npm run build in brain-server.',
      );
    });

    const dbExists = await exists(this.dbPath);
    if (this.resume && !dbExists) {
      throw new Error(`Resume requires the original conversation database: ${this.dbPath}`);
    }
    if (!this.resume && dbExists) {
      throw new Error(`New conversation runtime requires an empty database path: ${this.dbPath}`);
    }

    this.logHandle = await open(this.logPath, 'a');
    let lastError;
    for (let attempt = 1; attempt <= 5; attempt++) {
      this.port = await findAvailablePort(this.host);
      const env = {
        ...process.env,
        ...this.extraEnv,
        HOST: this.host,
        PORT: String(this.port),
        DB_PATH: this.dbPath,
        LOCAL_API_TOKEN: this.token,
        OMNI_EVALUATION_MODE: '1',
        INSIGHT_INTERVAL_MS: this.extraEnv.INSIGHT_INTERVAL_MS || '3600000',
      };
      this.child = spawn(process.execPath, [this.serverEntry], {
        cwd: this.brainServerRoot,
        env,
        stdio: ['ignore', this.logHandle.fd, this.logHandle.fd, 'ipc'],
        windowsHide: true,
      });
      await this.persistRuntime('starting');
      await writeFile(this.pidPath, `${this.child.pid}\n`);

      try {
        await this.waitForReady();
        this.client = new BrainServerClient({
          baseUrl: `http://${this.host}:${this.port}`,
          token: this.token,
        });
        await this.persistRuntime('running');
        return this;
      } catch (error) {
        lastError = error;
        if (isChildRunning(this.child)) this.child.kill('SIGTERM');
        await waitForExit(this.child, 5_000).catch(() => {});
        this.child = null;
      }
    }

    await this.closeLog();
    throw new Error(`Unable to start isolated Brain Server after 5 port attempts: ${lastError?.message || lastError}`);
  }

  async waitForReady() {
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      if (!isChildRunning(this.child)) {
        throw new Error(`Brain Server exited before readiness (exit=${this.child?.exitCode ?? this.child?.signalCode ?? 'unknown'})`);
      }
      try {
        const response = await fetch(`http://${this.host}:${this.port}/health`);
        if (response.ok) return;
        lastError = new Error(`health returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    throw new Error(`Brain Server readiness timed out: ${lastError?.message || 'no health response'}`);
  }

  async stop() {
    if (isChildRunning(this.child)) {
      if (this.child.connected) {
        this.child.send({ type: 'omni-evaluation-shutdown' });
      } else {
        this.child.kill('SIGTERM');
      }
      try {
        await waitForExit(this.child, this.shutdownTimeoutMs);
      } catch {
        this.child.kill('SIGKILL');
        await waitForExit(this.child, 5_000).catch(() => {});
      }
    }
    const exitCode = this.child?.exitCode ?? null;
    await this.closeLog();
    let databaseHash = null;
    if (await exists(this.dbPath)) {
      databaseHash = await sha256File(this.dbPath);
      await writeFile(this.databaseHashPath, `${databaseHash}\n`);
    }
    await this.persistRuntime('stopped', { exit_code: exitCode, database_hash: databaseHash });
    return { exitCode, databaseHash };
  }

  async cleanupOrphan() {
    let previous;
    try {
      previous = JSON.parse(await readFile(this.runtimePath, 'utf8'));
    } catch {
      return false;
    }
    if (!['starting', 'running'].includes(previous.status) || !Number.isInteger(previous.pid)) {
      return false;
    }
    if (!isProcessAlive(previous.pid)) {
      await this.persistRuntime('crashed', { previous_pid: previous.pid });
      return false;
    }
    process.kill(previous.pid, 'SIGTERM');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && isProcessAlive(previous.pid)) await delay(100);
    if (isProcessAlive(previous.pid)) process.kill(previous.pid, 'SIGKILL');
    await this.persistRuntime('orphan_cleaned', { previous_pid: previous.pid });
    return true;
  }

  async persistRuntime(status, extra = {}) {
    const previous = await readJson(this.runtimePath);
    const record = {
      schema_version: 1,
      conversation_id: this.conversationId,
      status,
      pid: this.child?.pid ?? previous?.pid ?? null,
      host: this.host,
      port: this.port ?? previous?.port ?? null,
      db_file: 'brain.db',
      log_file: 'server.log',
      server_entry: path.relative(this.brainServerRoot, this.serverEntry).replaceAll('\\', '/'),
      started_at: previous?.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resume: this.resume,
      ...extra,
    };
    await writeFile(this.runtimePath, `${JSON.stringify(record, null, 2)}\n`);
  }

  async closeLog() {
    if (this.logHandle) {
      await this.logHandle.close().catch(() => {});
      this.logHandle = null;
    }
  }
}

export function createConversationRuntime(options) {
  return new ConversationRuntime(options);
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function readJson(target) {
  try { return JSON.parse(await readFile(target, 'utf8')); } catch { return null; }
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function waitForExit(child, timeoutMs) {
  if (!isChildRunning(child)) return Promise.resolve(child?.exitCode ?? child?.signalCode ?? null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Process ${child.pid} did not exit within ${timeoutMs}ms`)), timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
