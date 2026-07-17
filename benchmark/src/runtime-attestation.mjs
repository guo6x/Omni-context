import { execFile } from 'node:child_process';
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { sha256File } from './integrity.mjs';

const execFileAsync = promisify(execFile);
const SHA_1_RE = /^[a-f0-9]{40}$/;

export async function attestBrainServerBuild({
  brainServerRoot,
  serverEntry,
  expectedProductCommit,
  expectedSelectorVersion,
}) {
  if (!brainServerRoot) throw new Error('Brain Server root is required for runtime attestation');
  if (!expectedProductCommit || !SHA_1_RE.test(expectedProductCommit)) {
    throw new Error('Expected product commit must be an exact 40-character Git SHA');
  }
  if (!expectedSelectorVersion) throw new Error('Expected Evidence Selector version is required');

  const resolvedRoot = await realpath(brainServerRoot).catch(() => {
    throw new Error(`Brain Server root not found: ${brainServerRoot}`);
  });
  const resolvedEntry = await realpath(serverEntry).catch(() => {
    throw new Error(`Brain Server entry not found: ${serverEntry}`);
  });
  assertInsideRoot(resolvedRoot, resolvedEntry, 'Brain Server entry');

  const gitRoot = (await git(resolvedRoot, ['rev-parse', '--show-toplevel'])).trim();
  const resolvedGitRoot = await realpath(gitRoot);
  const productCommit = (await git(resolvedRoot, ['rev-parse', 'HEAD'])).trim();
  if (productCommit !== expectedProductCommit) {
    throw new Error(`Product commit mismatch: expected ${expectedProductCommit}, actual ${productCommit}`);
  }

  const status = await git(resolvedRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.trim()) {
    const changed = status.trim().split(/\r?\n/).map((line) => line.slice(0, 2) + ' ' + line.slice(3)).join(', ');
    throw new Error(`Product worktree must be clean before evaluation: ${changed}`);
  }

  const selectorEntry = path.join(resolvedRoot, 'dist', 'retrieval', 'evidence-selector.js');
  await access(selectorEntry).catch(() => {
    throw new Error(`Evidence Selector build not found: ${selectorEntry}`);
  });
  const selectorSource = await readFile(selectorEntry, 'utf8');
  const selectorVersion = selectorSource.match(/EVIDENCE_SELECTOR_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || null;
  if (selectorVersion !== expectedSelectorVersion) {
    throw new Error(`Evidence Selector version mismatch: expected ${expectedSelectorVersion}, actual ${selectorVersion || 'absent'}`);
  }

  return {
    schema_version: 1,
    product_commit: productCommit,
    expected_product_commit: expectedProductCommit,
    clean: true,
    git_root: resolvedGitRoot,
    brain_server_root: resolvedRoot,
    server_entry: normalizeRelative(resolvedRoot, resolvedEntry),
    build_sha256: await sha256File(resolvedEntry),
    selector: {
      enabled: true,
      version: selectorVersion,
      sha256: await sha256File(selectorEntry),
      entry: normalizeRelative(resolvedRoot, selectorEntry),
    },
    attested_at: new Date().toISOString(),
  };
}

function assertInsideRoot(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) return;
  throw new Error(`${label} must be inside the attested Brain Server root`);
}

function normalizeRelative(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

async function git(cwd, args) {
  try {
    return (await execFileAsync('git', args, { cwd, windowsHide: true })).stdout;
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`Unable to attest Brain Server Git state: ${detail}`);
  }
}
