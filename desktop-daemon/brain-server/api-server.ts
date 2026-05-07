#!/usr/bin/env node

import initDatabase from './db/sqlite.js';
import { createServer } from './api/routes.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DB_PATH = process.env.DB_PATH || './data/omni-context.db';

async function main() {
  const db = initDatabase({
    dbPath: DB_PATH,
    enableWAL: true,
    busyTimeout: 5000,
  });

  await db.runMigrations();

  const server = createServer(db);

  server.listen(PORT, () => {
    console.log(`Omni-Context API Server running on port ${PORT}`);
    console.log(`Database: ${DB_PATH}`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await db.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
