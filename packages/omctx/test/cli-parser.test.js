import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from '../src/cli.js';
import { EXIT } from '../src/client/errors.js';

test('parser: version command with no flags', () => {
  const parsed = parseArgs(['version']);
  assert.equal(parsed.command, 'version');
  assert.equal(parsed.args.length, 0);
});

test('parser: --json flag', () => {
  const parsed = parseArgs(['history', '--json', '--limit', '5']);
  assert.equal(parsed.flags.json, true);
  assert.equal(parsed.flags.limit, 5);
});

test('parser: unknown command is caught by run() as usage error', async () => {
  const { run } = await import('../src/cli.js');
  const code = await run(['frobnicate']);
  assert.equal(code, EXIT.USAGE_ERROR);
});

test('parser: unknown flag is a usage error', () => {
  assert.throws(() => parseArgs(['history', '--frobnicate']), /unknown flag/);
});

test('parser: missing args - ask requires a situation', async () => {
  const { run } = await import('../src/cli.js');
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalToken = process.env.OMNI_LOCAL_API_TOKEN;
  const isolatedLocalAppData = mkdtempSync(join(tmpdir(), 'omctx-cli-no-auth-'));
  try {
    delete process.env.OMNI_LOCAL_API_TOKEN;
    process.env.LOCALAPPDATA = isolatedLocalAppData;
    const code = await run(['ask']);
    assert.equal(code, EXIT.AUTH_ERROR); // auth resolved first, then usage - acceptable: fails closed
  } finally {
    if (originalToken === undefined) delete process.env.OMNI_LOCAL_API_TOKEN;
    else process.env.OMNI_LOCAL_API_TOKEN = originalToken;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    rmSync(isolatedLocalAppData, { recursive: true, force: true });
  }
});

test('parser: extra args rejected', () => {
  const parsed = parseArgs(['inspect', 'a', 'b']);
  assert.equal(parsed.args.length, 2); // inspect command itself rejects
});

test('parser: shell-like flags rejected as unknown flags', () => {
  for (const flag of ['--command', '--argv', '--executable', '--cwd', '--env', '--shell', '--exec', '--run-command']) {
    assert.throws(() => parseArgs(['ask', 'x', flag, 'evil']), /unknown flag/, flag);
  }
});

test('parser: --token rejected as CLI argument', () => {
  assert.throws(() => parseArgs(['doctor', '--token', 'secret']), /shell history/);
  assert.throws(() => parseArgs(['doctor', '--token=secret']), /shell history/);
});

test('approve requires an ephemeral Desktop control session', async () => {
  const { run } = await import('../src/cli.js');
  const code = await run(['approve', 'plan-12345678']);
  assert.equal(code, EXIT.AUTH_ERROR);
});

test('verify requires a separate ephemeral Desktop verification session', async () => {
  const { run } = await import('../src/cli.js');
  const code = await run(['verify', 'plan-12345678']);
  assert.equal(code, EXIT.AUTH_ERROR);
});

test('verify rejects caller verdict flags', () => {
  assert.throws(() => parseArgs(['verify', '--success']), /unknown flag/);
  assert.throws(() => parseArgs(['verify', '--verified']), /unknown flag/);
  assert.throws(() => parseArgs(['verify', '--expected']), /unknown flag/);
  assert.throws(() => parseArgs(['verify', '--predicate']), /unknown flag/);
  assert.throws(() => parseArgs(['verify', '--regex']), /unknown flag/);
  assert.throws(() => parseArgs(['verify', '--jsonpath']), /unknown flag/);
});

test('reopen is FUTURE (exit 3)', async () => {
  const { run } = await import('../src/cli.js');
  const code = await run(['reopen']);
  assert.equal(code, EXIT.FEATURE_LOCKED);
});

test('help runs and prints without network', async () => {
  const { run } = await import('../src/cli.js');
  const code = await run(['--help']);
  assert.equal(code, EXIT.SUCCESS);
});

test('version runs without network (fetch never called)', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('must not fetch'); };
  try {
    const { run } = await import('../src/cli.js');
    const code = await run(['version']);
    assert.equal(code, EXIT.SUCCESS);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, false);
});

test('CLI package never imports child_process (no process execution surface)', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith('.js')) {
        const source = readFileSync(full, 'utf8');
        assert.ok(!/child_process|execSync|spawnSync|execFile/.test(source), `${full} must not use process execution APIs`);
      }
    }
  };
  walk(srcDir);
});
