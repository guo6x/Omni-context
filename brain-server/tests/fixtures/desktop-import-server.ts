/**
 * CONTROLLED_FIXTURE only: real auth, HTTP import, SQLite persistence and retrieval;
 * synthetic in-memory data and a deterministic loopback LLM are not installed-app acceptance.
 * Importing this module does not construct a server, touch a database, or change the environment.
 */
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Database } from '../../src/db/sqlite.js';

export const FIXTURE_GOOD_PHRASE = 'TEST_FIXTURE：合成资料用于验证导入来源回执和恢复流程，不代表真实用户内容。';
const FIXTURE_MODEL = 'fixture-model';
const fixtureTime = Date.parse('2026-10-18T00:00:00Z') / 1000;

function conversation(title: string, content: string) {
  return {
    title, create_time: fixtureTime,
    mapping: {
      user: { message: { author: { role: 'user' }, content: { parts: [content] }, create_time: fixtureTime } },
    },
  };
}

export const fixtureConversations = [
  conversation('产品方向', FIXTURE_GOOD_PHRASE),
  conversation('受控失败记录', '[fixture-fail] 这段对话用于验证部分导入，不是用户数据。'),
];

const relationshipFixtureText = '[fixture-relationships] 用户关注 FixtureProject。FixtureProject 关联 FixtureConcept。用户关联用户。';
export const fixtureRelationshipConversations = [
  conversation('受控关系记录一', relationshipFixtureText),
  conversation('受控关系记录二', relationshipFixtureText),
];

interface FixtureOptions { port?: number; llmPort?: number; dbPath?: string }
interface FixtureCalls {
  extractions: number;
  graphAnswers: number;
  receivedAuthorization: boolean;
  holdExtractions: boolean;
  heldExtractions: number;
  releaseHeldExtractions: Array<() => void>;
}

export interface DesktopImportFixture {
  db: Database;
  baseUrl: string;
  llmUrl: string;
  llmCalls: FixtureCalls;
  setHoldExtractions: (hold: boolean) => void;
  releaseHeldExtractions: () => void;
  close: () => Promise<void>;
}

let fixtureActive = false;

function portValue(value: string | number | undefined, name: string): number {
  const parsed = value === undefined || value === '' ? NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Controlled fixture requires a valid ${name}`);
  }
  return parsed;
}

function validateFixtureEnvironment(): void {
  if (process.env.OMNI_DESKTOP_IMPORT_FIXTURE !== '1') {
    throw new Error('Controlled fixture requires OMNI_DESKTOP_IMPORT_FIXTURE=1');
  }
  if (!process.env.LOCAL_API_TOKEN?.trim()) throw new Error('Controlled fixture requires LOCAL_API_TOKEN');
  const origins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!origins?.length) throw new Error('Controlled fixture requires explicit CORS_ORIGINS');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.origin !== origin) {
      throw new Error('Controlled fixture allows only explicit loopback browser origins');
    }
  }
}

async function listen(server: http.Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

async function closeServer(server?: http.Server): Promise<void> {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeIdleConnections();
  });
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function completion(response: http.ServerResponse, content: unknown): void {
  sendJson(response, 200, {
    model: FIXTURE_MODEL,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  });
}

function createFixtureLlm(calls: FixtureCalls): http.Server {
  return http.createServer(async (request, response) => {
    try {
      calls.receivedAuthorization ||= Boolean(request.headers.authorization);
      if (request.method === 'GET' && request.url === '/v1/models') {
        sendJson(response, 200, { data: [{ id: FIXTURE_MODEL, object: 'model' }] });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        sendJson(response, 404, { error: 'Fixture route not found' });
        return;
      }
      let raw = '';
      for await (const chunk of request) {
        raw += chunk.toString();
        if (raw.length > 1_000_000) throw new Error('Fixture request too large');
      }
      const body = JSON.parse(raw) as { model?: string; messages?: Array<{ role?: string; content?: string }>; tools?: unknown[] };
      const system = body.messages?.find((message) => message.role === 'system')?.content || '';
      const extractionInput = body.messages?.find((message) => message.role === 'user' && message.content?.includes('<USER_CONTENT>'))?.content;
      if (extractionInput) {
        calls.extractions += 1;
        if (calls.holdExtractions || extractionInput.includes('[fixture-hold]')) {
          calls.heldExtractions += 1;
          await new Promise<void>((resolve) => calls.releaseHeldExtractions.push(resolve));
        }
        if (extractionInput.includes('[fixture-fail]')) {
          sendJson(response, 500, { error: 'CONTROLLED_FIXTURE_EXTRACTION_FAILURE' });
          return;
        }
        if (extractionInput.includes('[fixture-relationships]')) {
          completion(response, {
            entities: [
              { name: '用户', type: 'person', description: '受控导入参与者', importance: 0.8 },
              { name: 'FixtureProject', type: 'project', description: '受控关系测试项目', importance: 0.8 },
              { name: 'FixtureConcept', type: 'concept', description: '受控关系测试概念', importance: 0.8 },
            ],
            facts: [
              { subject: '用户', predicate: 'relates_to', object: 'FixtureProject', confidence: 0.9, source_span: '用户关注 FixtureProject。' },
              { subject: 'FixtureProject', predicate: 'relates_to', object: 'FixtureConcept', confidence: 0.9, source_span: 'FixtureProject 关联 FixtureConcept。' },
              // A valid extracted fact that entity resolution deliberately rejects
              // as a self-edge must not inflate the persisted relationship count.
              { subject: '用户', predicate: 'relates_to', object: '用户', confidence: 0.9, source_span: '用户关联用户。' },
            ],
            principles: [],
          });
          return;
        }
        completion(response, {
          // The real raw-event layer also identifies this source participant;
          // using the same entity keeps the fixture to exactly one memory.
          entities: [{ name: '用户', type: 'person', description: FIXTURE_GOOD_PHRASE, importance: 0.8 }],
          facts: [], principles: [],
        });
        return;
      }
      if (Array.isArray(body.tools)) {
        completion(response, 'DONE');
        return;
      }
      if (system.includes('只输出 JSON：{"conclusion"')) {
        calls.graphAnswers += 1;
        // Production graph_answer sends numbered memories, not UUIDs. Its real
        // dispatcher maps this prompt-derived ref back to the retrieved UUID.
        const source = system.match(/^\[(\d+)\] \([^)]+\) ([^:\n]+): ([^\n]*)/m);
        completion(response, {
          conclusion: source ? source[3] : '没有足够的已导入来源。',
          reasons: source ? [{ text: `导入记录「${source[2]}」：${source[3]}`, refs: [Number(source[1])] }] : [],
          questions: [], is_decision: false,
        });
        return;
      }
      completion(response, 'pong');
    } catch {
      if (!response.writableEnded) sendJson(response, 400, { error: 'Invalid controlled fixture request' });
    }
  });
}

export async function startDesktopImportFixture(options: FixtureOptions = {}): Promise<DesktopImportFixture> {
  validateFixtureEnvironment();
  if (fixtureActive) throw new Error('Only one controlled fixture may run in this process');
  const apiPort = portValue(options.port ?? process.env.PORT, 'PORT');
  const llmPort = portValue(options.llmPort ?? process.env.OMNI_FIXTURE_LLM_PORT, 'OMNI_FIXTURE_LLM_PORT');
  fixtureActive = true;
  const envNames = [
    'LLM_API_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_EXTRACTION_MAX_ATTEMPTS',
    'OMNI_REMOTE_AI_ENABLED', 'OMNI_AI_AUDIT_PATH', 'OMNI_EVALUATION_MODE', 'PAIR_CODE', 'PAIR_CODE_FILE',
  ];
  const originalEnvironment = new Map(envNames.map((name) => [name, process.env[name]]));
  let database: Database | undefined;
  let api: http.Server | undefined;
  let llm: http.Server | undefined;
  let scratch: string | undefined;
  let releaseHeldExtractions = () => {};
  let restoreExtractor = () => {};
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      releaseHeldExtractions();
      await closeServer(api);
      await closeServer(llm);
      await database?.close();
    } finally {
      restoreExtractor();
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      fixtureActive = false;
      if (scratch) await rm(scratch, { recursive: true, force: true });
    }
  })();

  try {
    const llmCalls: FixtureCalls = {
      extractions: 0,
      graphAnswers: 0,
      receivedAuthorization: false,
      holdExtractions: false,
      heldExtractions: 0,
      releaseHeldExtractions: [],
    };
    releaseHeldExtractions = () => {
      for (const release of llmCalls.releaseHeldExtractions.splice(0)) release();
    };
    llm = createFixtureLlm(llmCalls);
    await listen(llm, llmPort);
    const llmUrl = `http://127.0.0.1:${(llm.address() as AddressInfo).port}/v1`;
    scratch = await mkdtemp(path.join(tmpdir(), 'omni-desktop-import-fixture-'));
    process.env.LLM_API_URL = llmUrl;
    process.env.LLM_API_KEY = '';
    process.env.LLM_MODEL = FIXTURE_MODEL;
    process.env.LLM_EXTRACTION_MAX_ATTEMPTS = '1';
    process.env.OMNI_REMOTE_AI_ENABLED = 'false';
    process.env.OMNI_AI_AUDIT_PATH = path.join(scratch, 'ai-audit.jsonl');
    process.env.OMNI_EVALUATION_MODE = '0';
    process.env.PAIR_CODE = '';
    process.env.PAIR_CODE_FILE = '';

    // Dynamic imports occur after the owned loopback provider is selected;
    // no production api-server entrypoint or ambient database is loaded.
    // Load the cold TypeScript module graph sequentially. Concurrent imports
    // contend in the Windows test transform/runtime and can exceed Vitest's
    // setup-hook timeout before the in-memory fixture is reachable.
    const { default: initDatabase } = await import('../../src/db/sqlite.js');
    const { createServer } = await import('../../src/api/routes.js');
    const { GraphRAGExtractor } = await import('../../src/graphrag/extractor.js');
    const { MemoryDecayScheduler } = await import('../../src/memory/decay-scheduler.js');
    const { testEmbeddingService } = await import('../helpers/test-embedding-service.js');
    const originalExtract = GraphRAGExtractor.prototype.extract;
    const originalSetLlm = GraphRAGExtractor.prototype.setLlmConfig;
    const originalGetLlm = GraphRAGExtractor.prototype.getLlmConfig;
    GraphRAGExtractor.prototype.extract = function (input) {
      // Test-only strict failure propagation exercises real import failure
      // persistence rather than the production regex-only fallback.
      return originalExtract.call(this, { ...input, requireLlmSuccess: true });
    };
    GraphRAGExtractor.prototype.setLlmConfig = function (config) {
      if (config.apiUrl.replace(/\/+$/, '') !== llmUrl) throw new Error('CONTROLLED_FIXTURE_LLM_ONLY');
      return originalSetLlm.call(this, { apiUrl: llmUrl, apiKey: '', model: FIXTURE_MODEL });
    };
    GraphRAGExtractor.prototype.getLlmConfig = () => ({ apiUrl: llmUrl, apiKey: '', model: FIXTURE_MODEL });
    restoreExtractor = () => {
      GraphRAGExtractor.prototype.extract = originalExtract;
      GraphRAGExtractor.prototype.setLlmConfig = originalSetLlm;
      GraphRAGExtractor.prototype.getLlmConfig = originalGetLlm;
    };

    database = initDatabase({ dbPath: options.dbPath ?? ':memory:' });
    await database.runMigrations();
    await database.rebuildAllEmbeddings(testEmbeddingService as never);
    const decayScheduler = new MemoryDecayScheduler(database, { autoStart: false });
    api = createServer(database, undefined, testEmbeddingService as never, decayScheduler);
    await listen(api, apiPort);
    return {
      db: database,
      baseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
      llmUrl,
      llmCalls,
      setHoldExtractions(hold) { llmCalls.holdExtractions = hold; },
      releaseHeldExtractions,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function runExecutableFixture(): Promise<void> {
  // Emit only READY/CLOSED lifecycle records. Real-route logs may otherwise
  // contain synthetic conversation titles; never print tokens/content.
  const output = process.stdout.write.bind(process.stdout);
  const errorOutput = process.stderr.write.bind(process.stderr);
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    const fixture = await startDesktopImportFixture();
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      process.stdin.destroy();
      void fixture.close().then(
        () => { output('CLOSED\n'); },
        () => { errorOutput('CONTROLLED_FIXTURE_CLOSE_FAILED\n'); process.exitCode = 1; },
      );
    };
    // Windows terminate() cannot deliver SIGTERM. The owning headless runner
    // uses this private pipe so the fixture closes its in-memory DB, listeners,
    // and synthetic temporary audit directory before its process exits.
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (command) => {
      if (String(command).trim() === 'SHUTDOWN') shutdown();
    });
    process.stdin.once('end', shutdown);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    output('READY\n');
  } catch {
    errorOutput('CONTROLLED_FIXTURE_START_FAILED\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runExecutableFixture();
}
