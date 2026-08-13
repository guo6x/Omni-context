/**
 * Goal24 Checkpoint 5 - the formal bridge between the safe importer (Lane B)
 * and the Skill Registry V1 (Lane A).
 *
 * importSkillPackage: import -> verify managed snapshot -> validate omni
 * manifest -> validate against the capability registry -> register. Imported
 * packages ALWAYS start `quarantined`; this bridge never auto-trusts and
 * never lets a caller choose a trust state at import time. SKILL.md-only
 * packages are quarantined as QUARANTINED_UNBOUND and are never registered
 * as usable skills.
 *
 * resolveSkillForUse: the single formal entry point for obtaining a skill
 * package for future orchestration. Policy eligibility alone is not enough:
 * the managed snapshot digest is re-computed from disk and compared with the
 * registry package_digest before anything is returned. Any divergence fails
 * closed with SKILL_PACKAGE_INTEGRITY_FAILURE. Scripts and binaries inside
 * the package are never executed, neither here nor anywhere else in CP5.
 */

import { importSkillPackage } from './importer/package-loader.js';
import { SnapshotVerificationError, verifyManagedSnapshot } from './importer/package-snapshot.js';
import type { ImportedSkillPackage, SkillFileEntry } from './importer/package-types.js';
import { SkillRegistry } from './registry.js';
import {
  SkillRegistryError,
  type SkillRegistryRecord,
} from './registry-types.js';

export type SkillImportBridgeStatus =
  | 'REGISTERED_QUARANTINED'
  | 'QUARANTINED_UNBOUND'
  | 'QUARANTINED_INVALID_MANIFEST'
  | 'QUARANTINED_NAME_MISMATCH'
  | 'IMPORT_FAILED'
  | 'REGISTRATION_REJECTED';

export interface SkillImportBridgeResult {
  status: SkillImportBridgeStatus;
  imported: ImportedSkillPackage;
  record: SkillRegistryRecord | null;
  error: string | null;
}

export interface ResolvedSkillForUse {
  record: SkillRegistryRecord;
  snapshotRoot: string;
  files: SkillFileEntry[];
}

export interface SkillPackageRegistryServiceOptions {
  /** Injected managed snapshot root, shared with the importer. */
  managedSkillRoot: string;
}

export class SkillPackageRegistryService {
  private readonly managedSkillRoot: string;

  constructor(
    private readonly registry: SkillRegistry,
    options: SkillPackageRegistryServiceOptions,
  ) {
    if (
      typeof options.managedSkillRoot !== 'string' ||
      options.managedSkillRoot.length === 0
    ) {
      throw new TypeError('managedSkillRoot must be a non-empty path string');
    }
    this.managedSkillRoot = options.managedSkillRoot;
  }

  /**
   * Import an external Agent Skills directory and bind it to the registry.
   * The registry derives all trust state; imported packages always start
   * quarantined (hard gate). A registered package whose record is somehow
   * not quarantined fails closed with SKILL_INPUT_INVALID.
   */
  async importSkillPackage(sourceRoot: string): Promise<SkillImportBridgeResult> {
    const imported = importSkillPackage(sourceRoot, {
      managedSkillRoot: this.managedSkillRoot,
    });
    if (imported.failure) {
      return {
        status: 'IMPORT_FAILED',
        imported,
        record: null,
        error: `${imported.failure.code}: ${imported.failure.message}`,
      };
    }
    if (
      imported.import_status !== 'ready_for_registry_validation' ||
      !imported.manifest ||
      !imported.package_digest ||
      !imported.manifest_digest
    ) {
      return { status: imported.import_status as SkillImportBridgeStatus, imported, record: null, error: null };
    }
    try {
      const { name, version } = imported.manifest;
      const preExisting = this.registry.get(name, version);
      const record = await this.registry.register({
        manifest: imported.manifest,
        package_digest: imported.package_digest,
        manifest_digest: imported.manifest_digest,
        source_type: 'imported',
        source_id: imported.source_root.canonical,
        source_reference: imported.source_root.requested,
      });
      // A freshly registered imported package must start quarantined.
      // Idempotent re-registration of identical content legitimately returns
      // the existing record (revoked/disabled state preserved), which is
      // exactly the re-registration safety semantics required by CP5.
      if (!preExisting && record.trust_status !== 'quarantined') {
        throw new SkillRegistryError(
          'SKILL_INPUT_INVALID',
          `imported package '${record.name}@${record.version}' must start quarantined, got '${record.trust_status}'`,
        );
      }
      return { status: 'REGISTERED_QUARANTINED', imported, record, error: null };
    } catch (error) {
      if (error instanceof SkillRegistryError) {
        return {
          status: 'REGISTRATION_REJECTED',
          imported,
          record: null,
          error: error.message,
        };
      }
      throw error;
    }
  }

  /**
   * Resolve a registered skill for future use. Policy eligibility is
   * checked first, then the managed snapshot is re-hashed from disk and
   * compared with the registry package_digest (TOCTOU defense). Failures
   * throw SKILL_NOT_ELIGIBLE or SKILL_PACKAGE_INTEGRITY_FAILURE; this method
   * never returns a mutated or unregistered package and never executes
   * bundled code.
   */
  resolveSkillForUse(name: string, version?: string): ResolvedSkillForUse {
    const record = version
      ? this.registry.get(name, version)
      : this.registry.resolveLatestTrusted(name);
    if (!record) {
      if (this.registry.listVersions(name).length > 0) {
        throw new SkillRegistryError(
          'SKILL_NOT_ELIGIBLE',
          `skill '${name}' is registered but no version is currently eligible for use`,
        );
      }
      throw new SkillRegistryError(
        'SKILL_NOT_FOUND',
        `skill '${name}${version !== undefined ? `@${version}` : ''}' is not registered`,
      );
    }
    if (!this.registry.isEligibleForUse(record)) {
      throw new SkillRegistryError(
        'SKILL_NOT_ELIGIBLE',
        `skill '${record.name}@${record.version}' is not eligible for use (trust/validation/capability gate)`,
      );
    }
    try {
      const verified = verifyManagedSnapshot(this.managedSkillRoot, record.package_digest);
      return { record, snapshotRoot: verified.snapshotRoot, files: verified.files };
    } catch (error) {
      if (error instanceof SnapshotVerificationError) {
        throw new SkillRegistryError('SKILL_PACKAGE_INTEGRITY_FAILURE', error.message);
      }
      throw error;
    }
  }
}
