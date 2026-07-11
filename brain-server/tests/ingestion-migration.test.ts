import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import initDatabase from '../src/db/sqlite.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('ingestion chunk migration', () => {
  it('upgrades an existing v15 database without changing legacy entities', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'omni-ingestion-migration-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'legacy.db');
    const legacy = initDatabase({ dbPath });
    await legacy.runMigrations();
    await legacy.addEntity({ id: 'legacy-entity', name: 'Legacy', type: 'concept' });
    await legacy.run("DROP TABLE ingestion_chunks");
    await legacy.run("DROP TABLE ingestion_documents");
    await legacy.run("DELETE FROM migrations WHERE name = 'add_ingestion_documents_and_chunks'");
    await legacy.close();

    const upgraded = initDatabase({ dbPath });
    await upgraded.runMigrations();
    expect(await upgraded.get('SELECT id FROM entities WHERE id = ?', ['legacy-entity'])).toBeTruthy();
    const tables = await upgraded.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ingestion_%' ORDER BY name"
    );
    expect(tables.map((row) => row.name)).toEqual(['ingestion_chunks', 'ingestion_documents']);
    await upgraded.close();
  });
});
