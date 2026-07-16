import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { attestBrainServerBuild } from '../src/runtime-attestation.mjs';

const execFileAsync = promisify(execFile);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('Brain Server runtime attestation', () => {
  let root;
  let serverEntry;
  let selectorEntry;
  let commit;

  before(async () => {
    root = await mkdtemp(path.join(TEST_DIR, '..', 'runs', 'runtime-attestation-'));
    serverEntry = path.join(root, 'dist', 'api-server.js');
    selectorEntry = path.join(root, 'dist', 'retrieval', 'evidence-selector.js');
    await mkdir(path.dirname(selectorEntry), { recursive: true });
    await writeFile(serverEntry, 'export const fixture = true;\n');
    await writeFile(selectorEntry, "export const EVIDENCE_SELECTOR_VERSION = 'evidence-selector-v1';\n");
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['-c', 'user.name=Omni Test', '-c', 'user.email=omni-test@example.invalid', 'commit', '-m', 'fixture'], { cwd: root });
    commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('binds the runtime to an exact clean commit, build hash, root, and selector version', async () => {
    const result = await attestBrainServerBuild({
      brainServerRoot: root,
      serverEntry,
      expectedProductCommit: commit,
      expectedSelectorVersion: 'evidence-selector-v1',
    });

    assert.strictEqual(result.product_commit, commit);
    assert.strictEqual(result.clean, true);
    assert.strictEqual(result.brain_server_root, await realpathPortable(root));
    assert.match(result.build_sha256, /^[a-f0-9]{64}$/);
    assert.match(result.selector.sha256, /^[a-f0-9]{64}$/);
    assert.deepStrictEqual(result.selector, {
      enabled: true,
      version: 'evidence-selector-v1',
      sha256: result.selector.sha256,
      entry: path.join('dist', 'retrieval', 'evidence-selector.js').replaceAll('\\', '/'),
    });
  });

  it('fails before process launch when the exact product commit does not match', async () => {
    await assert.rejects(() => attestBrainServerBuild({
      brainServerRoot: root,
      serverEntry,
      expectedProductCommit: '0'.repeat(40),
      expectedSelectorVersion: 'evidence-selector-v1',
    }), /Product commit mismatch/);
  });

  it('fails closed when the product worktree becomes dirty', async () => {
    await writeFile(serverEntry, 'export const fixture = false;\n');
    await assert.rejects(() => attestBrainServerBuild({
      brainServerRoot: root,
      serverEntry,
      expectedProductCommit: commit,
      expectedSelectorVersion: 'evidence-selector-v1',
    }), /Product worktree must be clean/);
    await execFileAsync('git', ['checkout', '--', 'dist/api-server.js'], { cwd: root });
  });

  it('fails closed when the expected selector version is absent', async () => {
    await assert.rejects(() => attestBrainServerBuild({
      brainServerRoot: root,
      serverEntry,
      expectedProductCommit: commit,
      expectedSelectorVersion: 'evidence-selector-v999',
    }), /Evidence Selector version mismatch/);
  });
});

async function realpathPortable(value) {
  const { realpath } = await import('node:fs/promises');
  return realpath(value);
}
