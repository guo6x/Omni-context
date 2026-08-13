/**
 * Goal24 Checkpoint 5 - Skill Registry V1 runtime core (Lane A).
 *
 * The registry stores validated procedural artifact metadata and enforces
 * the CP5 trust / provenance / version-conflict model. It never executes
 * scripts, commands, shells, Python, JS, PowerShell or binaries; it never
 * interprets SKILL.md natural-language text as authority or executable
 * instruction; and it never treats `adapter_preference` as transport
 * authority (a preference can never override capability authority, bypass
 * evidence, change risk, select an executable or generate argv).
 *
 * `setTrustStatus` is an internal service API only. It is not exposed over
 * MCP or Tauri IPC, and it always requires an explicit actor/provenance
 * object. Imported skills default to `quarantined`; nothing in this module
 * auto-promotes trust.
 */

import {
  validateSkillManifestAgainstCapabilities,
  type SkillValidationIssue,
} from './contracts.js';
import { type RiskLevel } from '../capabilities/contracts.js';
import {
  SHA256_HEX_PATTERN,
  SkillProvenanceSchema,
  SkillRegistryError,
  SkillRegistryRegistrationInputSchema,
  TRUST_PROMOTION_MECHANISMS,
  skillRecordKey,
  type BuiltinTrustedPolicy,
  type CapabilityLookup,
  type SkillProvenance,
  type SkillRegistryRecord,
  type SkillRegistryRegistrationInput,
  type SkillTrustStatus,
} from './registry-types.js';
import {
  SKILL_REGISTRY_STORE_VERSION,
  loadSkillRegistryStore,
  saveSkillRegistryStore,
  type SkillRegistryStoreData,
} from './registry-store.js';

// ---------------------------------------------------------------------------
// Semantic version comparison (major.minor.patch only; no prerelease/range)
// ---------------------------------------------------------------------------

/**
 * Compare two `major.minor.patch` versions numerically. Returns <0 when
 * `a < b`, 0 when equal, >0 when `a > b`. Never compares as strings, so
 * `1.10.0 > 1.9.0` holds.
 */
export function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  if (aMajor !== bMajor) return aMajor < bMajor ? -1 : 1;
  if (aMinor !== bMinor) return aMinor < bMinor ? -1 : 1;
  if (aPatch !== bPatch) return aPatch < bPatch ? -1 : 1;
  return 0;
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export interface SkillRegistryOptions {
  /** Injected capability lookup; the registry never rebuilds capability schemas. */
  capabilityLookup: CapabilityLookup;
  /** Injectable clock (tests use a fixed clock for determinism). */
  now?: () => Date;
  /** Separately defined trusted built-in policy; applies to builtins only. */
  builtinTrustedPolicy?: BuiltinTrustedPolicy;
}

/**
 * V1 Skill Registry. Records are keyed by canonical identity `name@version`.
 * Version conflicts fail closed: same identity with different content is
 * rejected (SKILL_VERSION_CONFLICT), never overwritten and never resolved
 * last-write-wins.
 */
export class SkillRegistry {
  private readonly records = new Map<string, SkillRegistryRecord>();
  private readonly capabilityLookup: CapabilityLookup;
  private readonly now: () => Date;
  private readonly builtinTrustedPolicy: BuiltinTrustedPolicy | undefined;
  private readonly storePath: string | undefined;

  constructor(options: SkillRegistryOptions, storePath?: string) {
    this.capabilityLookup = options.capabilityLookup;
    this.now = options.now ?? (() => new Date());
    this.builtinTrustedPolicy = options.builtinTrustedPolicy;
    this.storePath = storePath;
  }

  /** Open a persistent registry: loads and strictly validates the store. */
  static async open(storePath: string, options: SkillRegistryOptions): Promise<SkillRegistry> {
    const data = await loadSkillRegistryStore(storePath);
    const registry = new SkillRegistry(options, storePath);
    for (const record of data.records) {
      registry.records.set(skillRecordKey(record.name, record.version), record);
    }
    return registry;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  /**
   * Validate a manifest against the injected capability registry: existence
   * plus full safety inheritance (evidence, conflict, verification,
   * freshness, risk).
   */
  validateManifest(manifest: SkillRegistryRecord['manifest']): SkillValidationIssue[] {
    return validateSkillManifestAgainstCapabilities(manifest, this.capabilityLookup);
  }

  /** Recompute validation issues for a stored record (fail-closed input). */
  validateRecord(record: SkillRegistryRecord): SkillValidationIssue[] {
    const issues: SkillValidationIssue[] = [];
    for (const capabilityId of record.capability_ids) {
      if (!this.capabilityLookup(capabilityId)) {
        issues.push({
          path: 'capability_ids',
          message: `capability '${capabilityId}' does not exist in the capability registry`,
        });
      }
    }
    issues.push(...this.validateManifest(record.manifest));
    return issues;
  }

  /**
   * Default trust for a registration. Imported and local packages always
   * start `quarantined`; builtins start `quarantined` unless a separately
   * defined trusted built-in policy explicitly allows `trusted`.
   */
  private defaultTrustFor(input: SkillRegistryRegistrationInput): {
    status: SkillTrustStatus;
    provenance: SkillProvenance[];
  } {
    const provenance: SkillProvenance[] = [
      { actor: 'registry', mechanism: 'registration', at: this.timestamp() },
    ];
    if (
      input.source_type === 'builtin' &&
      this.builtinTrustedPolicy?.({
        name: input.manifest.name,
        version: input.manifest.version,
        source_type: input.source_type,
      })
    ) {
      provenance.push({
        actor: 'registry',
        mechanism: 'builtin-policy',
        reason: 'allowed by the separately defined trusted built-in policy',
        at: this.timestamp(),
      });
      return { status: 'trusted', provenance };
    }
    return { status: 'quarantined', provenance };
  }

  /**
   * Register a skill. Rejects schema-invalid inputs, safety-weakening
   * manifests and capability references that do not exist. Same
   * `name@version` with identical content is idempotent; same `name@version`
   * with different content throws SKILL_VERSION_CONFLICT (no overwrite).
   */
  async register(input: SkillRegistryRegistrationInput): Promise<SkillRegistryRecord> {
    const parsed = SkillRegistryRegistrationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new SkillRegistryError(
        'SKILL_INPUT_INVALID',
        `registration input failed strict schema validation: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    const registration = parsed.data;
    const { name, version } = registration.manifest;

    const issues = validateSkillManifestAgainstCapabilities(
      registration.manifest,
      this.capabilityLookup,
    );
    if (issues.length > 0) {
      throw new SkillRegistryError(
        'SKILL_VALIDATION_FAILED',
        `skill '${name}@${version}' weakens referenced capability safety: ${issues
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join('; ')}`,
      );
    }

    const key = skillRecordKey(name, version);
    const existing = this.records.get(key);
    if (existing) {
      const sameContent =
        existing.package_digest === registration.package_digest &&
        existing.manifest_digest === registration.manifest_digest;
      if (sameContent) {
        // Idempotent re-registration of identical content.
        return existing;
      }
      throw new SkillRegistryError(
        'SKILL_VERSION_CONFLICT',
        `skill '${key}' already exists with different content; publish a new version or explicitly remove the old one before re-registering`,
      );
    }

    let highestCapabilityRisk: RiskLevel = 'low';
    for (const capabilityId of registration.manifest.capabilities) {
      const capability = this.capabilityLookup(capabilityId);
      if (!capability) {
        throw new SkillRegistryError(
          'SKILL_VALIDATION_FAILED',
          `capability '${capabilityId}' does not exist in the capability registry`,
        );
      }
      if (RISK_RANK[capability.risk_level] > RISK_RANK[highestCapabilityRisk]) {
        highestCapabilityRisk = capability.risk_level;
      }
    }

    const timestamp = this.timestamp();
    const trust = this.defaultTrustFor(registration);
    const record: SkillRegistryRecord = {
      name,
      version,
      manifest: registration.manifest,
      package_digest: registration.package_digest,
      manifest_digest: registration.manifest_digest,
      source_type: registration.source_type,
      source_id: registration.source_id,
      ...(registration.source_reference !== undefined
        ? { source_reference: registration.source_reference }
        : {}),
      trust_status: trust.status,
      installed_at: timestamp,
      updated_at: timestamp,
      enabled: true,
      revoked: false,
      validation_status: 'valid',
      validation_issues: [],
      capability_ids: [...registration.manifest.capabilities],
      risk_snapshot: {
        risk_level: registration.manifest.risk,
        highest_capability_risk: highestCapabilityRisk,
        capability_count: registration.manifest.capabilities.length,
      },
      provenance: trust.provenance,
    };
    this.records.set(key, record);
    await this.persist();
    return record;
  }

  /** Exact version lookup by canonical identity `name@version`. */
  get(name: string, version: string): SkillRegistryRecord | undefined {
    return this.records.get(skillRecordKey(name, version));
  }

  /** All records, sorted by name and then semantic version ascending. */
  list(): SkillRegistryRecord[] {
    return [...this.records.values()].sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      return compareSemver(a.version, b.version);
    });
  }

  /** Every registered version of a name, semantic version ascending. */
  listVersions(name: string): SkillRegistryRecord[] {
    return this.list().filter((record) => record.name === name);
  }

  /**
   * Latest trusted version of a name: only `trusted`, enabled and
   * non-revoked records participate; the winner is the numerically greatest
   * `major.minor.patch` version.
   */
  resolveLatestTrusted(name: string): SkillRegistryRecord | undefined {
    const candidates = this.listVersions(name).filter(
      (record) => record.trust_status === 'trusted' && record.enabled && !record.revoked,
    );
    if (candidates.length === 0) return undefined;
    return candidates[candidates.length - 1];
  }

  /**
   * True when this record may be *considered* by a future skill
   * orchestration layer. Eligibility is not execution: it only means the
   * record passes the CP5 gates (schema, inheritance, capability existence,
   * digests, trust, enabled, not revoked).
   */
  isEligibleForUse(record: SkillRegistryRecord): boolean {
    return eligible_for_use(record, this.capabilityLookup);
  }

  /** Disable a version. */
  async disable(name: string, version: string): Promise<SkillRegistryRecord> {
    const record = this.requireRecord(name, version);
    record.enabled = false;
    record.updated_at = this.timestamp();
    await this.persist();
    return record;
  }

  /** Revoke a version: trust withdrawn and never re-usable as-is. */
  async revoke(
    name: string,
    version: string,
    provenance: SkillProvenance,
  ): Promise<SkillRegistryRecord> {
    const record = this.requireRecord(name, version);
    const parsed = SkillProvenanceSchema.safeParse(provenance);
    if (!parsed.success) {
      throw new SkillRegistryError(
        'SKILL_INPUT_INVALID',
        `revocation provenance is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    record.trust_status = 'revoked';
    record.revoked = true;
    record.updated_at = this.timestamp();
    record.provenance.push(parsed.data);
    await this.persist();
    return record;
  }

  /**
   * Trust transition (internal service API only - never exposed over MCP or
   * Tauri IPC). Requires an explicit actor/provenance object; promotion to
   * `trusted` additionally requires an owner/admin decision or a trusted
   * built-in policy mechanism. Revoked records must go through the trust
   * flow again as a new version (no silent un-revocation).
   */
  async setTrustStatus(
    name: string,
    version: string,
    status: SkillTrustStatus,
    provenance: SkillProvenance,
  ): Promise<SkillRegistryRecord> {
    if (status === 'revoked') {
      throw new SkillRegistryError(
        'SKILL_TRUST_TRANSITION_INVALID',
        "use revoke() to revoke a skill; 'revoked' is not a direct transition target",
      );
    }
    const record = this.requireRecord(name, version);
    if (record.revoked) {
      throw new SkillRegistryError(
        'SKILL_TRUST_TRANSITION_INVALID',
        `skill '${name}@${version}' is revoked; re-register as a new version and re-run the trust flow`,
      );
    }
    const parsed = SkillProvenanceSchema.safeParse(provenance);
    if (!parsed.success) {
      throw new SkillRegistryError(
        'SKILL_INPUT_INVALID',
        `trust transition provenance is invalid: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    if (
      status === 'trusted' &&
      !(TRUST_PROMOTION_MECHANISMS as readonly string[]).includes(parsed.data.mechanism)
    ) {
      throw new SkillRegistryError(
        'SKILL_TRUST_TRANSITION_INVALID',
        `promoting '${name}@${version}' to trusted requires an explicit owner/admin decision or a trusted built-in policy (mechanism '${parsed.data.mechanism}' is not allowed)`,
      );
    }
    record.trust_status = status;
    record.revoked = false;
    record.updated_at = this.timestamp();
    record.provenance.push(parsed.data);
    await this.persist();
    return record;
  }

  private requireRecord(name: string, version: string): SkillRegistryRecord {
    const record = this.records.get(skillRecordKey(name, version));
    if (!record) {
      throw new SkillRegistryError(
        'SKILL_NOT_FOUND',
        `skill '${name}@${version}' is not registered`,
      );
    }
    return record;
  }

  private storeData(): SkillRegistryStoreData {
    return {
      schema_version: SKILL_REGISTRY_STORE_VERSION,
      updated_at: this.timestamp(),
      records: this.list(),
    };
  }

  private async persist(): Promise<void> {
    if (!this.storePath) return;
    await saveSkillRegistryStore(this.storePath, this.storeData());
  }
}

/**
 * Pure eligibility gate (CP5): a record may only be *considered* for use
 * when every gate below passes. This is not execution - the skill
 * orchestration layer decides what to do with an eligible record.
 */
export function eligible_for_use(
  record: SkillRegistryRecord,
  lookup: CapabilityLookup,
): boolean {
  if (record.revoked) return false;
  if (!record.enabled) return false;
  if (record.trust_status !== 'trusted') return false;
  if (record.validation_status !== 'valid' || record.validation_issues.length > 0) return false;
  if (
    !SHA256_HEX_PATTERN.test(record.package_digest) ||
    !SHA256_HEX_PATTERN.test(record.manifest_digest)
  ) {
    return false;
  }
  if (record.capability_ids.length === 0) return false;
  const manifestCapabilities = [...record.manifest.capabilities].sort();
  const recordedCapabilities = [...record.capability_ids].sort();
  if (manifestCapabilities.join(',') !== recordedCapabilities.join(',')) return false;
  for (const capabilityId of record.capability_ids) {
    if (!lookup(capabilityId)) return false;
  }
  return validateSkillManifestAgainstCapabilities(record.manifest, lookup).length === 0;
}