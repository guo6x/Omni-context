import { defineConfig } from 'vitest/config';

// sqlite3/sqlite-vec are native Node modules.  On Windows, starting many
// Vitest file workers at once can race native initialization and turn ordinary
// database work into timeout noise or a napi_fatal_error.  Keep the default
// test command deterministic on that platform; POSIX CI retains file-level
// parallelism.
const windowsNativeSqlite = process.platform === 'win32';

export default defineConfig({
  test: windowsNativeSqlite
    ? {
        fileParallelism: false,
        maxWorkers: 1,
        minWorkers: 1,
      }
    : {},
});
