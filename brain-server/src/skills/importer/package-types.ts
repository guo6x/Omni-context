/**
 * Goal24 Checkpoint 5 (Lane B) - Agent Skills / SKILL.md safe importer types.
 *
 * The importer follows: discover -> inspect -> snapshot -> classify.
 * It never follows: discover -> execute. No process execution, no trust
 * decision, and no capability-registry wiring happen in this lane; the
 * result below is pure inspection/snapshot evidence. Trust state is owned
 * by the future Skill Registry, never by the importer.
 */

import type { SkillManifest } from '../contracts.js';

export const IMPORT_STATUSES = [
  'ready_for_registry_validation',
  'QUARANTINED_UNBOUND',
  'QUARANTINED_INVALID_MANIFEST',
  'QUARANTINED_NAME_MISMATCH',
  'IMPORT_REJECTED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const PACKAGE_FAILURE_CODES = [
  'IMPORT_REJECTED',
  'PACKAGE_PATH_ESCAPE',
  'PACKAGE_LIMIT_EXCEEDED',
  'PACKAGE_CHANGED_DURING_IMPORT',
] as const;
export type PackageFailureCode = (typeof PACKAGE_FAILURE_CODES)[number];

export const QUARANTINE_REASONS = [
  'MISSING_OMNI_MANIFEST',
  'OMNI_MANIFEST_INVALID',
  'NAME_MISMATCH',
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

export const FILE_CLASSIFICATIONS = [
  'skill_md',
  'omni_manifest',
  'script',
  'binary',
  'text',
] as const;
export type FileClassification = (typeof FILE_CLASSIFICATIONS)[number];

/** One file recorded by the snapshot enumeration. relative_path is normalized with `/`. */
export interface SkillFileEntry {
  relative_path: string;
  sha256: string;
  size: number;
  classification: FileClassification;
}

export interface ImportWarning {
  code: string;
  message: string;
  path?: string;
}

/**
 * Metadata read from the SKILL.md YAML frontmatter. Only `name` and
 * `description` become structured metadata; all other frontmatter keys are
 * ignored with a warning and can never change Omni safety policy.
 */
export interface AgentSkillMetadata {
  name: string;
  description: string;
  unknown_frontmatter_keys: string[];
}

export interface ImportFailure {
  code: PackageFailureCode;
  message: string;
  path?: string;
}

export interface ImportedSkillPackage {
  source_type: 'agent_skill_directory';
  source_root: {
    requested: string;
    canonical: string;
  };
  managed_snapshot_root: string | null;
  agent_skill_metadata: AgentSkillMetadata | null;
  omni_manifest_present: boolean;
  omni_manifest_valid: boolean;
  manifest: SkillManifest | null;
  manifest_digest: string | null;
  package_digest: string | null;
  files: SkillFileEntry[];
  warnings: ImportWarning[];
  bundled_code_present: boolean;
  script_files: string[];
  import_status: ImportStatus;
  quarantine_reasons: QuarantineReason[];
  eligible: boolean;
  failure: ImportFailure | null;
}