#!/usr/bin/env node

import initDatabase from './db/sqlite.js';
import { createServer } from './api/routes.js';
import { AgentLoop } from './agent/agent-loop.js';
import { MemoryDecayScheduler } from './memory/decay-scheduler.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || './data/omni-context.db';

async function main() {
  const db = initDatabase({
    dbPath: DB_PATH,
    enableWAL: true,
    busyTimeout: 5000,
  });

  await db.runMigrations();

  const decayScheduler = new MemoryDecayScheduler(db, {
    decayFactor: 0.95,
    staleDays: 90,
    intervalMs: 60 * 60 * 1000,
    autoStart: true,
  });

  const agentLoop = new AgentLoop(db, decayScheduler);
  // 默认 10 分钟一轮，避免本地 LLM 频繁被唤起；测试可通过 INSIGHT_INTERVAL_MS 缩短
  const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
    ? Number(process.env.INSIGHT_INTERVAL_MS)
    : 10 * 60 * 1000;
  agentLoop.start(insightIntervalMs);

  const server = createServer(db, agentLoop, undefined, decayScheduler);

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
    console.log(`Database: ${DB_PATH}`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    agentLoop.stop();
    await db.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    agentLoop.stop();
    await db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
