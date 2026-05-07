#!/usr/bin/env node
import initDatabase from './db/sqlite.js';
import { createServer } from './api/routes.js';
import { AgentLoop } from './agent/agent-loop.js';
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
    const server = createServer(db);
    server.listen(PORT, HOST, () => {
        console.log(`Omni-Context API Server running on http://${HOST}:${PORT}`);
        console.log(`Database: ${DB_PATH}`);
    });
    const agentLoop = new AgentLoop(db);
    // 默认 10 分钟一轮，避免本地 LLM 频繁被唤起；测试可通过 INSIGHT_INTERVAL_MS 缩短
    const insightIntervalMs = process.env.INSIGHT_INTERVAL_MS
        ? Number(process.env.INSIGHT_INTERVAL_MS)
        : 10 * 60 * 1000;
    agentLoop.start(insightIntervalMs);
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
