/**
 * Goal24 Checkpoint 5 (Lane B) - deterministic SHA-256 digests.
 *
 * The package digest is computed over the full sorted file listing so that
 * reordering files on disk never changes the digest. Every file contributes
 * its normalized relative path, its size, and its SHA-256 hex hash.
 *
 * Encoding is length-prefixed and therefore unambiguous: each record is
 * `hex(pathByteLength):<utf8 path>:<hex size>:<sha256>` and records are
 * joined with newlines. A path containing spaces, colons or even control
 * characters can never be re-parsed as a different path/size/hash tuple,
 * so no two distinct package listings can share a digest. (Control
 * characters are additionally rejected at the path-policy layer.)
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
 * hash the newline-joined, length-prefixed records described above.
 */
export function computePackageDigest(files: readonly SkillFileEntry[]): string {
  const sorted = [...files].sort((a, b) =>
    a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0,
  );
  const lines = sorted.map((entry) => {
    const pathBytes = Buffer.from(entry.relative_path, 'utf8');
    const pathLength = pathBytes.length.toString(16);
    const sizeHex = entry.size.toString(16);
    return `${pathLength}:${entry.relative_path}:${sizeHex}:${entry.sha256}`;
  });
  return sha256Hex(lines.join('\n'));
}

/** Digest of the raw omni-skill.json bytes, when a manifest is present. */
export function computeManifestDigest(manifestBytes: Uint8Array): string {
  return sha256Hex(manifestBytes);
}
