#!/usr/bin/env node

import initDatabase from './db/sqlite.js';
import { createDefaultEmbeddingService, createServer } from './api/routes.js';
import type { EmbeddingService } from './embedding/service.js';
import { AgentLoop } from './agent/agent-loop.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';
import { createProductionAuthorizationRuntime } from './approval/production-runtime.js';
import {
  createD1b1ControlledFixture,
  createD1b1ControlledFixtureProviders,
} from './approval/d1b1-controlled-fixture.js';
import { registerD1b2ControlledCases } from './control/verification-runtime.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentPilotAdapter } from './agent/pilot.js';
import { createProductionRevisionRuntime } from './revision/production-runtime.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || './data/omni-context.db';
const EMBEDDING_PREWARM_TIMEOUT_MS = 20_000;

/**
 * Warm the local embedding runtime after HTTP startup without making health or
 * schema readiness wait on model loading.  The timeout only bounds the
 * startup observation; the underlying embedding promise is intentionally
 * allowed to finish so a slow, valid local model can still serve the first
 * user action.  Remote/API embedding is never probed implicitly because that
 * could create an unrequested paid/network call.
 */
function startLocalEmbeddingPrewarm(embeddingService: EmbeddingService, evaluationMode: boolean): void {
  if (evaluationMode || embeddingService.getInfo().mode !== 'local') return;

  const startedAt = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`startup prewarm timed out after ${EMBEDDING_PREWARM_TIMEOUT_MS}ms`));
    }, EMBEDDING_PREWARM_TIMEOUT_MS);
  });

  void Promise.race([
    embeddingService.embedPassage('Omni-Context local embedding startup preflight'),
    timeout,
  ])
    .then(() => {
      console.log(`[EmbeddingService] local startup prewarm completed in ${Date.now() - startedAt}ms`);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[EmbeddingService] local startup prewarm skipped: ${message}`);
    })
    .finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
}

async function maybeCreateD1b1ControlledFixture() {
  if (process.env.OMNI_D1B1_E2E_FIXTURE !== '1') return null;
  const outputPath = process.env.OMNI_D1B1_E2E_FIXTURE_OUTPUT;
  if (!outputPath) throw new Error('D1B1 controlled fixture requires OMNI_D1B1_E2E_FIXTURE_OUTPUT');
  const clock = () => new Date();
  const runtime = createProductionAuthorizationRuntime({
    providers: createD1b1ControlledFixtureProviders(clock),
    clock,
  });
  const fixture = await createD1b1ControlledFixture(runtime);
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  // The file intentionally contains only plan/request ids and state; it never
  // contains a control session, native bridge secret, grant secret, or token.
  await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return runtime;
}

async function maybeCreateD1b2ControlledFixture(runtime: ReturnType<typeof createProductionAuthorizationRuntime>) {
  if (process.env.OMNI_D1B2_E2E_FIXTURE !== '1') return;
  const fixture = registerD1b2ControlledCases(runtime.verificationRuntime);
  const outputPath = process.env.OMNI_D1B2_E2E_FIXTURE_OUTPUT;
  if (!outputPath) return;
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    fixture_mode: 'D1B2_CONTROLLED_LOCAL_ONLY',
    ...fixture,
    secrets: 'REDACTED',
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function main() {
  const evaluationMode = process.env.OMNI_EVALUATION_MODE === '1';
  const db = initDatabase({
    dbPath: DB_PATH,
    enableWAL: true,
    busyTimeout: 5000,
  });

  // Database startup is staged (foreign_keys -> busy_timeout -> WAL ->
  // sqlite-vec). Wait for the recovery-sensitive stages before migrations so
  // a forced-stop journal cannot race schema initialization.
  await db.ready();
  await db.runMigrations();

  const decayScheduler = new MemoryDecayScheduler(db, {
    decayFactor: 0.95,
    staleDays: 90,
    intervalMs: 60 * 60 * 1000,
    // Evaluation databases are immutable evidence inputs while questions run.
    // Background decay would change the graph between question 1 and 199.
    autoStart: !evaluationMode,
  });

  const agentLoop = new AgentLoop(db, decayScheduler);
  // 默认 10 分钟一轮，避免本地 LLM 频繁被唤起；测试可通过 INSIGHT_INTERVAL_MS 缩短
  const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
    ? Number(process.env.INSIGHT_INTERVAL_MS)
    : 10 * 60 * 1000;
  // The agent loop executes immediately before scheduling its next interval,
  // so a long interval alone does not prevent evaluation contamination.
  if (!evaluationMode) agentLoop.start(insightIntervalMs);

  // One server-owned authorization runtime serves both plan creation and the
  // fixed control facade. The facade receives this exact service as its
  // narrow ControlApprovalRuntime; it never receives a raw store.
  const authorizationRuntime = await maybeCreateD1b1ControlledFixture()
    ?? createProductionAuthorizationRuntime();
  const revisionRuntime = createProductionRevisionRuntime(db, authorizationRuntime);
  const agentPilot = new AgentPilotAdapter({
    evidenceRuntime: authorizationRuntime.evidenceRuntime,
    authorizationService: authorizationRuntime.authorizationService,
    verificationRuntime: authorizationRuntime.verificationRuntime,
    revisionRuntime,
  });
  await maybeCreateD1b2ControlledFixture(authorizationRuntime);
  const embeddingService = createDefaultEmbeddingService();
  const server = createServer(
    db,
    agentLoop,
    embeddingService,
    decayScheduler,
    undefined,
    authorizationRuntime.controlRuntime,
    authorizationRuntime.verificationRuntime,
    agentPilot,
    revisionRuntime,
  );

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[api-server] HTTP 端口 ${HOST}:${PORT} 已被占用。`,
        '可能 Omni-Context 桌面应用 / 另一个实例已在运行。请检查或 kill 占用进程后重试。'
      );
      process.exit(1);
    }
    console.error('[api-server] HTTP server 错误:', err);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Omni-Context API Server running on http://${HOST}:${PORT}`);
    const displayedDbPath = process.env.OMNI_EVALUATION_MODE === '1' ? path.basename(DB_PATH) : DB_PATH;
    console.log(`Database: ${displayedDbPath}`);
    startLocalEmbeddingPrewarm(embeddingService, evaluationMode);
  });

  let shuttingDown = false;
  const shutdown = async (reason: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nShutting down (${reason})...`);
    await agentLoop.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('message', (message: unknown) => {
    if (
      process.env.OMNI_EVALUATION_MODE === '1' &&
      message && typeof message === 'object' &&
      (message as { type?: string }).type === 'omni-evaluation-shutdown'
    ) {
      void shutdown('evaluation IPC');
    }
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
