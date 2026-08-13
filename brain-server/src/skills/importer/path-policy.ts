/**
 * Goal24 Checkpoint 5 (Lane B) - filesystem path policy for skill packages.
 *
 * Every accepted path must be a regular file whose realpath stays inside the
 * canonical source root. Symlinks, junctions and other reparse points are
 * never followed and are rejected outright. Package development noise
 * directories are skipped with a recorded warning; nothing inside them is
 * copied and no hooks or lifecycle scripts are ever executed.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Development/derived directories that are never copied into a managed snapshot. */
export const IGNORED_DIRECTORY_NAMES = [
  '.git',
  'node_modules',
  'target',
  'dist',
  'cache',
  '__pycache__',
] as const;

export interface PackageLimits {
  maxFiles: number;
  skillMdMaxBytes: number;
  manifestMaxBytes: number;
  maxSingleFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  /** Longest accepted normalized relative path (chars). Bounds Windows MAX_PATH growth under managed_skill_root/<digest>/. */
  maxRelativePathLength: number;
}

export const DEFAULT_PACKAGE_LIMITS: PackageLimits = {
  maxFiles: 256,
  skillMdMaxBytes: 256 * 1024,
  manifestMaxBytes: 128 * 1024,
  maxSingleFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxDepth: 8,
  maxRelativePathLength: 180,
};

export function mergePackageLimits(overrides?: Partial<PackageLimits>): PackageLimits {
  if (!overrides) return { ...DEFAULT_PACKAGE_LIMITS };
  return {
    maxFiles: overrides.maxFiles ?? DEFAULT_PACKAGE_LIMITS.maxFiles,
    skillMdMaxBytes: overrides.skillMdMaxBytes ?? DEFAULT_PACKAGE_LIMITS.skillMdMaxBytes,
    manifestMaxBytes: overrides.manifestMaxBytes ?? DEFAULT_PACKAGE_LIMITS.manifestMaxBytes,
    maxSingleFileBytes: overrides.maxSingleFileBytes ?? DEFAULT_PACKAGE_LIMITS.maxSingleFileBytes,
    maxTotalBytes: overrides.maxTotalBytes ?? DEFAULT_PACKAGE_LIMITS.maxTotalBytes,
    maxDepth: overrides.maxDepth ?? DEFAULT_PACKAGE_LIMITS.maxDepth,
    maxRelativePathLength: overrides.maxRelativePathLength ?? DEFAULT_PACKAGE_LIMITS.maxRelativePathLength,
  };
}

/**
 * Validate a relative package path and normalize it to `/` separators.
 * Returns null for absolute paths, drive letters, backslashes, NUL bytes,
 * empty segments, and `.` / `..` segments.
 */
export function normalizeRelativePath(relativePath: string): string | null {
  if (typeof relativePath !== 'string') return null;
  if (relativePath.length === 0) return null;
  if (relativePath.includes('\u0000')) return null;
  // C0/C1 control characters are never valid in a normalized relative path.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(relativePath)) return null;
  if (relativePath.includes('\\')) return null;
  if (relativePath.startsWith('/')) return null;
  if (/^[A-Za-z]:/.test(relativePath)) return null;
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null;
  }
  const normalized = segments.join('/');
  if (normalized.length > DEFAULT_PACKAGE_LIMITS.maxRelativePathLength) return null;
  return normalized;
}

/** Containment check between two absolute real paths (case-insensitive on Windows). */
export function caseFoldedPathKey(relativePath: string): string {
  return relativePath.toLowerCase();
}

/**
 * Find collisions between normalized relative paths that would resolve to
 * the same destination path on a case-insensitive filesystem (e.g. A.txt vs
 * .txt). The caller must fail closed when this returns a non-empty list.
 */
export function findCaseFoldedPathCollisions(relativePaths: readonly string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const relativePath of relativePaths) {
    const key = caseFoldedPathKey(relativePath);
    const group = groups.get(key);
    if (group) group.push(relativePath);
    else groups.set(key, [relativePath]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function isPathInsideRoot(canonicalRoot: string, candidate: string): boolean {
  let root = path.resolve(canonicalRoot);
  let target = path.resolve(candidate);
  if (root.endsWith(path.sep) && root.length > 1) root = root.slice(0, -1);
  if (target.endsWith(path.sep) && target.length > 1) target = target.slice(0, -1);
  if (process.platform === 'win32') {
    root = root.toLowerCase();
    target = target.toLowerCase();
  }
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Resolve an existing directory to its canonical realpath. Returns null when
 * the path does not exist, is not a directory, or cannot be resolved.
 */
export function canonicalizeExistingDirectory(input: string): string | null {
  let resolved: string;
  try {
    resolved = path.resolve(input);
  } catch {
    return null;
  }
  let real: string;
  try {
    real = fs.realpathSync(resolved);
  } catch {
    return null;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return null;
  return real;
}
