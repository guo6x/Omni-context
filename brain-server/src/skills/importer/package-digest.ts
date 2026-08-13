/**
 * Goal24 Checkpoint 5 (Lane B) - deterministic SHA-256 digests.
 *
 * The package digest is computed over the full sorted file listing so that
 * reordering files on disk never changes the digest. Every file contributes
 * its normalized relative path, its size, and its SHA-256 hex hash.
 */

import { createHash } from 'node:crypto';
import type { SkillFileEntry } from './package-types.js';

/** Lowercase hex SHA-256 of a string or byte buffer. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Deterministic package digest.
 *
 * Algorithm: sort the entries by normalized relative path (byte-wise), then
 * hash the concatenation of `relative_path SPACE size SPACE sha256 LF` lines.
 */
export function computePackageDigest(files: readonly SkillFileEntry[]): string {
  const sorted = [...files].sort((a, b) =>
    a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0,
  );
  const lines = sorted.map((entry) => `${entry.relative_path} ${entry.size} ${entry.sha256}`);
  return sha256Hex(lines.join('\n'));
}

/** Digest of the raw omni-skill.json bytes, when a manifest is present. */
export function computeManifestDigest(manifestBytes: Uint8Array): string {
  return sha256Hex(manifestBytes);
}