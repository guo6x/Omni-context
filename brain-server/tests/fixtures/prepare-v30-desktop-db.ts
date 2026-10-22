import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import initDatabase from '../../src/db/sqlite.js';

function isChildPath(parent: string, target: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const runnerTemp = process.env.RUNNER_TEMP;
  assert.ok(dbPath && runnerTemp, 'fixture requires an explicit database path under RUNNER_TEMP');
  const target = path.resolve(dbPath);
  assert.ok(isChildPath(runnerTemp, target), 'refusing to create a legacy database outside RUNNER_TEMP');
  await mkdir(path.dirname(target), { recursive: true });
  await stat(target).then(
    () => { throw new Error('refusing to overwrite an existing fixture database'); },
    (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; },
  );

  const db = initDatabase({ dbPath: target, enableWAL: true, busyTimeout: 5000 });
  try {
    await db.runMigrations();
    await db.addEntity({
      id: 'legacy-v30-installed-fixture',
      name: 'Existing v30 compatibility fixture',
      type: 'concept',
      description: 'Synthetic data from the pre-receipt desktop database schema.',
    });
    await db.run('DROP TABLE import_job_receipts');
    await db.run('DELETE FROM migrations WHERE name = ?', ['persist_privacy_minimal_import_job_receipts']);
    assert.equal(await db.get('SELECT id FROM entities WHERE id = ?', ['legacy-v30-installed-fixture']) !== undefined, true);
    assert.equal(await db.get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', 'import_job_receipts']), undefined);
    // The installed-app harness copies the database file as a single artifact.
    // Checkpoint the WAL before closing so the compatibility record is present
    // in that portable snapshot instead of stranded in a `-wal` sidecar.
    await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    await db.close();
  }
  console.log('synthetic pre-receipt desktop DB fixture prepared');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'legacy database fixture preparation failed');
  process.exitCode = 1;
});
