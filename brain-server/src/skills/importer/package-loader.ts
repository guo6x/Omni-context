/**
 * Goal24 Checkpoint 5 (Lane B) - Agent Skills / SKILL.md safe importer.
 *
 * Pipeline: discover -> inspect -> snapshot -> classify.
 *
 * The importer accepts a trusted caller supplied source root, canonicalizes
 * it, requires SKILL.md at the exact root, walks the package without ever
 * following symlinks/junctions, enforces file/path limits, detects
 * case-insensitive destination collisions, parses the SKILL.md YAML
 * frontmatter as bounded JSON-safe data, optionally validates an
 * omni-skill.json companion manifest, and materializes a digest-addressed
 * managed snapshot under the configured managed skill root.
 *
 * It never executes bundled code, never runs package hooks, never infers
 * safety policy from prose, and never grants trust. Trust state and
 * capability-registry wiring belong to the Skill Registry bridge.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  SkillManifestSchema,
  type SkillManifest,
} from '../contracts.js';
import { computeManifestDigest, computePackageDigest, sha256Hex } from './package-digest.js';
import { materializeSnapshot, removeSnapshotTree, SnapshotVerificationError } from './package-snapshot.js';
import { parseSkillFrontmatter, SkillFrontmatterError } from './frontmatter.js';
import {
  canonicalizeExistingDirectory,
  caseFoldedPathKey,
  findCaseFoldedPathCollisions,
  IGNORED_DIRECTORY_NAMES,
  isPathInsideRoot,
  mergePackageLimits,
  normalizeRelativePath,
  type PackageLimits,
} from './path-policy.js';
import type {
  AgentSkillMetadata,
  FileClassification,
  ImportedSkillPackage,
  ImportFailure,
  ImportStatus,
  ImportWarning,
  PackageFailureCode,
  QuarantineReason,
  SkillFileEntry,
} from './package-types.js';

export interface SkillImporterOptions {
  /** Injected managed snapshot root. Never hard-coded to a machine path. */
  managedSkillRoot: string;
  /** Optional limit overrides (bounded subset of PackageLimits). */
  limits?: Partial<PackageLimits>;
  /** Test seam: runs after inspection and before the snapshot copy. */
  beforeSnapshotCopy?: () => void;
}

export const SKILL_MD_FILE_NAME = 'SKILL.md';
export const OMNI_MANIFEST_FILE_NAME = 'omni-skill.json';

const SCRIPT_EXTENSIONS = ['.py', '.js', '.ts', '.sh', '.ps1', '.cmd', '.bat'] as const;
const BINARY_EXTENSIONS = ['.exe', '.dll'] as const;

class PackageFailure extends Error {
  constructor(
    readonly code: PackageFailureCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'PackageFailure';
  }
}

interface EnumeratedFile extends SkillFileEntry {
  bytes: Buffer;
}

function isSkillMdPath(relativePath: string): boolean {
  return caseFoldedPathKey(relativePath) === SKILL_MD_FILE_NAME.toLowerCase();
}

function isOmniManifestPath(relativePath: string): boolean {
  return caseFoldedPathKey(relativePath) === OMNI_MANIFEST_FILE_NAME.toLowerCase();
}

function classifyFile(relativePath: string, bytes: Buffer): FileClassification {
  if (isSkillMdPath(relativePath)) return 'skill_md';
  if (isOmniManifestPath(relativePath)) return 'omni_manifest';
  const lower = relativePath.toLowerCase();
  if (SCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'script';
  if (BINARY_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'binary';
  const probe = bytes.subarray(0, 8192);
  if (probe.includes(0)) return 'binary';
  return 'text';
}

function relativeFrom(root: string, fullPath: string): string {
  const relative = path.relative(root, fullPath).split(path.sep).join('/');
  const normalized = normalizeRelativePath(relative);
  if (normalized === null) {
    throw new PackageFailure('PACKAGE_PATH_ESCAPE', `invalid package path '${relative}'`, relative);
  }
  return normalized;
}

function resolveCheckedEntry(root: string, fullPath: string, relativePath: string): string {
  let real: string;
  try {
    real = fs.realpathSync(fullPath);
  } catch {
    throw new PackageFailure('PACKAGE_PATH_ESCAPE', `entry '${relativePath}' cannot be resolved`, relativePath);
  }
  if (!isPathInsideRoot(root, real)) {
    throw new PackageFailure('PACKAGE_PATH_ESCAPE', `entry '${relativePath}' resolves outside the package root`, relativePath);
  }
  return real;
}

function enumerateSourceFiles(root: string, limits: PackageLimits): { files: EnumeratedFile[]; warnings: ImportWarning[] } {
  const files: EnumeratedFile[] = [];
  const warnings: ImportWarning[] = [];
  let totalBytes = 0;

  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    const { dir, depth } = current;
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const fullPath = path.join(dir, dirent.name);
      const relativePath = relativeFrom(root, fullPath);

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(fullPath);
      } catch {
        throw new PackageFailure('PACKAGE_PATH_ESCAPE', `entry '${relativePath}' cannot be statted`, relativePath);
      }

      // Symlinks, junctions and other reparse points are never followed.
      if (lstat.isSymbolicLink()) {
        throw new PackageFailure(
          'PACKAGE_PATH_ESCAPE',
          `symlink/junction/reparse point '${relativePath}' is not allowed inside a skill package`,
          relativePath,
        );
      }

      if (lstat.isDirectory()) {
        if ((IGNORED_DIRECTORY_NAMES as readonly string[]).includes(dirent.name)) {
          warnings.push({
            code: 'IGNORED_DIRECTORY',
            message: `package development directory '${dirent.name}' was skipped and not copied`,
            path: relativePath,
          });
          continue;
        }
        if (depth + 1 > limits.maxDepth) {
          throw new PackageFailure(
            'PACKAGE_LIMIT_EXCEEDED',
            `directory '${relativePath}' exceeds the max depth of ${limits.maxDepth}`,
            relativePath,
          );
        }
        resolveCheckedEntry(root, fullPath, relativePath);
        stack.push({ dir: fullPath, depth: depth + 1 });
        continue;
      }

      if (!lstat.isFile()) {
        throw new PackageFailure(
          'PACKAGE_PATH_ESCAPE',
          `entry '${relativePath}' is not a regular file`,
          relativePath,
        );
      }

      const normalized = normalizeRelativePath(relativePath);
      if (normalized === null) {
        throw new PackageFailure('PACKAGE_PATH_ESCAPE', `invalid relative path '${relativePath}'`, relativePath);
      }
      const real = resolveCheckedEntry(root, fullPath, normalized);

      const stat = fs.statSync(real);
      const perFileLimit =
        isSkillMdPath(normalized)
          ? limits.skillMdMaxBytes
          : isOmniManifestPath(normalized)
            ? limits.manifestMaxBytes
            : limits.maxSingleFileBytes;
      if (stat.size > perFileLimit) {
        throw new PackageFailure(
          'PACKAGE_LIMIT_EXCEEDED',
          `file '${normalized}' (${stat.size} bytes) exceeds its size limit of ${perFileLimit} bytes`,
          normalized,
        );
      }
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new PackageFailure(
          'PACKAGE_LIMIT_EXCEEDED',
          `package exceeds the total size limit of ${limits.maxTotalBytes} bytes`,
          normalized,
        );
      }

      const bytes = fs.readFileSync(real);
      if (bytes.length !== stat.size) {
        throw new PackageFailure(
          'PACKAGE_CHANGED_DURING_IMPORT',
          `file '${normalized}' changed size while being read`,
          normalized,
        );
      }
      if (bytes.length > perFileLimit) {
        throw new PackageFailure(
          'PACKAGE_LIMIT_EXCEEDED',
          `file '${normalized}' exceeds its size limit of ${perFileLimit} bytes`,
          normalized,
        );
      }

      files.push({
        relative_path: normalized,
        size: bytes.length,
        sha256: sha256Hex(bytes),
        classification: classifyFile(normalized, bytes),
        bytes,
      });

      if (files.length > limits.maxFiles) {
        throw new PackageFailure(
          'PACKAGE_LIMIT_EXCEEDED',
          `package exceeds the max file count of ${limits.maxFiles}`,
          normalized,
        );
      }
    }
  }

  files.sort((a, b) =>
    a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0,
  );

  // Case-insensitive destination collision guard: two distinct source paths
  // (e.g. A.txt and a.txt) would resolve to the same snapshot destination on
  // Windows and must fail closed rather than silently overwrite one another.
  const collisions = findCaseFoldedPathCollisions(files.map((file) => file.relative_path));
  if (collisions.length > 0) {
    const example = collisions[0].sort().join("', '");
    throw new PackageFailure(
      'PACKAGE_PATH_COLLISION',
      `package contains paths that collide on a case-insensitive filesystem: '${example}'`,
    );
  }

  return { files, warnings };
}

function buildFailure(code: PackageFailureCode, message: string, path?: string): ImportFailure {
  const failure: ImportFailure = { code, message };
  if (path !== undefined) failure.path = path;
  return failure;
}

function rejectFailure(code: PackageFailureCode, message: string, path?: string): ImportedSkillPackage {
  return {
    source_type: 'agent_skill_directory',
    source_root: { requested: '', canonical: '' },
    managed_snapshot_root: null,
    agent_skill_metadata: null,
    omni_manifest_present: false,
    omni_manifest_valid: false,
    manifest: null,
    manifest_digest: null,
    package_digest: null,
    files: [],
    warnings: [],
    bundled_code_present: false,
    script_files: [],
    import_status: 'IMPORT_REJECTED',
    quarantine_reasons: [],
    eligible: false,
    failure: buildFailure(code, message, path),
  };
}

/**
 * Import one Agent Skills directory: discover -> inspect -> snapshot -> classify.
 *
 * Returns an inspection/snapshot result; it never throws for package-level
 * problems and never returns an executable command. Invalid options (missing
 * or non-directory managed root) throw a TypeError because they are
 * programming errors, not package findings.
 */
export function importSkillPackage(sourceRoot: string, options: SkillImporterOptions): ImportedSkillPackage {
  if (typeof sourceRoot !== 'string' || sourceRoot.length === 0) {
    throw new TypeError('sourceRoot must be a non-empty path string');
  }
  if (typeof options.managedSkillRoot !== 'string' || options.managedSkillRoot.length === 0) {
    throw new TypeError('managedSkillRoot must be a non-empty path string');
  }
  const limits = mergePackageLimits(options.limits);

  const canonicalSource = canonicalizeExistingDirectory(sourceRoot);
  if (canonicalSource === null) {
    return rejectFailure('IMPORT_REJECTED', `source root is not an existing directory: ${sourceRoot}`);
  }

  const managedBase = path.resolve(options.managedSkillRoot);
  try {
    fs.mkdirSync(managedBase, { recursive: true });
  } catch {
    return rejectFailure('IMPORT_REJECTED', `managed skill root could not be created: ${managedBase}`);
  }
  let canonicalManaged: string;
  try {
    canonicalManaged = fs.realpathSync(managedBase);
  } catch {
    return rejectFailure('IMPORT_REJECTED', `managed skill root could not be resolved: ${managedBase}`);
  }

  let enumerated: { files: EnumeratedFile[]; warnings: ImportWarning[] };
  try {
    enumerated = enumerateSourceFiles(canonicalSource, limits);
  } catch (error) {
    if (error instanceof PackageFailure) {
      return rejectFailure(error.code, error.message, error.path);
    }
    throw error;
  }

  const { files, warnings } = enumerated;
  const entries: SkillFileEntry[] = files.map((file) => ({
    relative_path: file.relative_path,
    sha256: file.sha256,
    size: file.size,
    classification: file.classification,
  }));

  const skillMdFile = files.find((file) => isSkillMdPath(file.relative_path));
  if (!skillMdFile) {
    return rejectFailure('IMPORT_REJECTED', `${SKILL_MD_FILE_NAME} is required at the package root`);
  }

  let metadata: AgentSkillMetadata;
  try {
    const frontmatter = parseSkillFrontmatter(skillMdFile.bytes.toString('utf8'));
    metadata = {
      name: frontmatter.name,
      description: frontmatter.description,
      vendor_metadata: frontmatter.vendorMetadata,
      unknown_frontmatter_keys: frontmatter.unknownKeys,
    };
    if (frontmatter.unknownKeys.length > 0) {
      warnings.push({
        code: 'UNKNOWN_FRONTMATTER_KEY',
        message: `SKILL.md frontmatter keys ${frontmatter.unknownKeys.join(', ')} were ignored; they cannot change Omni safety policy`,
        path: skillMdFile.relative_path,
      });
    }
  } catch (error) {
    if (error instanceof SkillFrontmatterError) {
      return rejectFailure('IMPORT_REJECTED', error.message, skillMdFile.relative_path);
    }
    throw error;
  }

  const manifestFile = files.find((file) => isOmniManifestPath(file.relative_path));
  let manifest: SkillManifest | null = null;
  let manifestValid = false;
  let manifestDigest: string | null = null;
  if (manifestFile) {
    manifestDigest = computeManifestDigest(manifestFile.bytes);
    try {
      const parsed = JSON.parse(manifestFile.bytes.toString('utf8')) as unknown;
      const result = SkillManifestSchema.safeParse(parsed);
      if (result.success) {
        manifest = result.data;
        manifestValid = true;
      }
    } catch {
      manifestValid = false;
    }
  }

  const scriptFiles = files
    .filter((file) => file.classification === 'script' || file.classification === 'binary')
    .map((file) => file.relative_path);
  if (scriptFiles.length > 0) {
    warnings.push({
      code: 'BUNDLED_CODE_DETECTED',
      message: `package bundles ${scriptFiles.length} code file(s); they were recorded but never executed`,
    });
  }

  let importStatus: ImportStatus;
  let quarantineReasons: QuarantineReason[] = [];
  if (!manifestFile) {
    importStatus = 'QUARANTINED_UNBOUND';
    quarantineReasons = ['MISSING_OMNI_MANIFEST'];
  } else if (!manifestValid) {
    importStatus = 'QUARANTINED_INVALID_MANIFEST';
    quarantineReasons = ['OMNI_MANIFEST_INVALID'];
  } else if ((manifest as SkillManifest).name !== metadata.name) {
    importStatus = 'QUARANTINED_NAME_MISMATCH';
    quarantineReasons = ['NAME_MISMATCH'];
  } else {
    importStatus = 'ready_for_registry_validation';
  }

  const packageDigest = computePackageDigest(entries);

  try {
    if (options.beforeSnapshotCopy) options.beforeSnapshotCopy();
    const snapshotRoot = materializeSnapshot(canonicalSource, canonicalManaged, packageDigest, entries);

    // Fail closed when the source file set changed during snapshot
    // materialization (e.g. a file added mid-import): the inspected listing
    // must be exactly the listing that was snapshotted.
    const recheck = enumerateSourceFiles(canonicalSource, limits);
    const inspectedPaths = new Set(entries.map((entry) => entry.relative_path));
    const recheckPaths = new Set(recheck.files.map((file) => file.relative_path));
    if (
      inspectedPaths.size !== recheckPaths.size ||
      [...inspectedPaths].some((relativePath) => !recheckPaths.has(relativePath))
    ) {
      removeSnapshotTree(canonicalManaged, packageDigest);
      return rejectFailure(
        'PACKAGE_CHANGED_DURING_IMPORT',
        'the package file set changed while the snapshot was being materialized',
      );
    }

    return {
      source_type: 'agent_skill_directory',
      source_root: { requested: sourceRoot, canonical: canonicalSource },
      managed_snapshot_root: snapshotRoot,
      agent_skill_metadata: metadata,
      omni_manifest_present: manifestFile !== undefined,
      omni_manifest_valid: manifestValid,
      manifest,
      manifest_digest: manifestDigest,
      package_digest: packageDigest,
      files: entries,
      warnings,
      bundled_code_present: scriptFiles.length > 0,
      script_files: scriptFiles,
      import_status: importStatus,
      quarantine_reasons: quarantineReasons,
      eligible: importStatus === 'ready_for_registry_validation',
      failure: null,
    };
  } catch (error) {
    if (error instanceof SnapshotVerificationError) {
      // materializeSnapshot only raises import-time codes; anything else
      // (e.g. a nested integrity code) still fails closed at import.
      const code: PackageFailureCode =
        error.code === 'PACKAGE_CHANGED_DURING_IMPORT' || error.code === 'MANAGED_SNAPSHOT_CORRUPT'
          ? error.code
          : 'PACKAGE_CHANGED_DURING_IMPORT';
      return rejectFailure(code, error.message);
    }
    throw error;
  }
}
