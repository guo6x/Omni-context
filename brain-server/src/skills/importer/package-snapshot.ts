/**
 * Goal24 Checkpoint 5 (Lane B) - managed immutable package snapshot.
 *
 * The source directory is mutable, so the Registry must never trust the
 * live folder. The snapshot materializes the inspected files under
 * `managed_skill_root/<package_digest>/` and re-hashes both the source and
 * the destination to make sure nothing changed during import. Any
 * divergence fails closed with PACKAGE_CHANGED_DURING_IMPORT.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sha256Hex } from './package-digest.js';
import type { SkillFileEntry } from './package-types.js';
import { isPathInsideRoot, normalizeRelativePath } from './path-policy.js';

export class SnapshotVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotVerificationError';
  }
}

export function managedSnapshotPath(managedSkillRoot: string, packageDigest: string): string {
  return path.join(managedSkillRoot, packageDigest);
}

interface DestinationFile {
  relativePath: string;
  size: number;
  sha256: string;
}

function readSourceFileChecked(sourceRoot: string, entry: SkillFileEntry): Buffer {
  const sourceFull = path.join(sourceRoot, ...entry.relative_path.split('/'));
  let real: string;
  try {
    real = fs.realpathSync(sourceFull);
  } catch {
    throw new SnapshotVerificationError(`source file '${entry.relative_path}' disappeared during import`);
  }
  if (!isPathInsideRoot(sourceRoot, real)) {
    throw new SnapshotVerificationError(`source file '${entry.relative_path}' escaped the package root during import`);
  }
  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(real);
  } catch {
    throw new SnapshotVerificationError(`source file '${entry.relative_path}' disappeared during import`);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new SnapshotVerificationError(`source file '${entry.relative_path}' is no longer a regular file`);
  }
  const bytes = fs.readFileSync(real);
  if (bytes.length !== entry.size || sha256Hex(bytes) !== entry.sha256) {
    throw new SnapshotVerificationError(`source file '${entry.relative_path}' changed during import`);
  }
  return bytes;
}

function walkDestination(snapshotRoot: string): DestinationFile[] {
  const found: DestinationFile[] = [];
  const stack: string[] = [snapshotRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const dirent of entries) {
      const full = path.join(dir, dirent.name);
      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(full);
      } catch {
        throw new SnapshotVerificationError(`snapshot entry '${full}' disappeared during verification`);
      }
      if (lstat.isSymbolicLink() || (!lstat.isDirectory() && !lstat.isFile())) {
        throw new SnapshotVerificationError(`snapshot contains an unexpected non-regular entry '${full}'`);
      }
      if (lstat.isDirectory()) {
        stack.push(full);
        continue;
      }
      const relative = path.relative(snapshotRoot, full).split(path.sep).join('/');
      const normalized = normalizeRelativePath(relative);
      if (normalized === null) {
        throw new SnapshotVerificationError(`snapshot contains an invalid path '${relative}'`);
      }
      const bytes = fs.readFileSync(full);
      found.push({ relativePath: normalized, size: bytes.length, sha256: sha256Hex(bytes) });
    }
  }
  return found;
}

function assertDestinationMatches(expected: readonly SkillFileEntry[], snapshotRoot: string): void {
  const expectedByPath = new Map(expected.map((entry) => [entry.relative_path, entry]));
  const actual = walkDestination(snapshotRoot);
  const actualByPath = new Map(actual.map((entry) => [entry.relativePath, entry]));
  if (actualByPath.size !== expectedByPath.size) {
    throw new SnapshotVerificationError('snapshot file count changed during import');
  }
  for (const entry of expected) {
    const found = actualByPath.get(entry.relative_path);
    if (!found) {
      throw new SnapshotVerificationError(`snapshot is missing '${entry.relative_path}'`);
    }
    if (found.size !== entry.size || found.sha256 !== entry.sha256) {
      throw new SnapshotVerificationError(`snapshot file '${entry.relative_path}' does not match the source digest`);
    }
  }
}

function removeSnapshotTree(managedSkillRoot: string, packageDigest: string): void {
  const snapshotRoot = managedSnapshotPath(managedSkillRoot, packageDigest);
  if (!isPathInsideRoot(managedSkillRoot, snapshotRoot)) return;
  if (!fs.existsSync(snapshotRoot)) return;
  fs.rmSync(snapshotRoot, { recursive: true, force: true });
}

/**
 * Materialize (or verify) the immutable snapshot for the inspected package.
 *
 * If the destination already exists it is verified in place and reused;
 * otherwise files are copied from the (re-verified) source, and both the
 * destination and the source are re-hashed before returning. Any divergence
 * throws SnapshotVerificationError and the freshly created tree is removed
 * (fail closed).
 */
export function materializeSnapshot(
  sourceRoot: string,
  managedSkillRoot: string,
  packageDigest: string,
  expected: readonly SkillFileEntry[],
): string {
  const snapshotRoot = managedSnapshotPath(managedSkillRoot, packageDigest);
  if (!isPathInsideRoot(managedSkillRoot, snapshotRoot)) {
    throw new SnapshotVerificationError('snapshot root escapes the managed skill root');
  }

  if (fs.existsSync(snapshotRoot)) {
    assertDestinationMatches(expected, snapshotRoot);
    return snapshotRoot;
  }

  fs.mkdirSync(snapshotRoot, { recursive: true });
  try {
    for (const entry of expected) {
      const bytes = readSourceFileChecked(sourceRoot, entry);
      const destination = path.join(snapshotRoot, ...entry.relative_path.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }

    // Destination re-hash: the written tree must equal the source enumeration.
    assertDestinationMatches(expected, snapshotRoot);

    // Source re-check: catch mutation between the copy and the verification.
    for (const entry of expected) {
      readSourceFileChecked(sourceRoot, entry);
    }

    return snapshotRoot;
  } catch (error) {
    removeSnapshotTree(managedSkillRoot, packageDigest);
    throw error;
  }
}