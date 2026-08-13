/**
 * Goal24 Checkpoint 5 - Skill Registry V1 types and strict schemas (Lane A).
 *
 * The registry stores *validated procedural artifact metadata*, never
 * trusted executable code and never raw executable commands. Every schema in
 * this module is a strict Zod object: unknown fields (including `command`,
 * `shell`, `exec` and `argv`) are rejected at parse time, both for
 * registration inputs and for persisted store records.
 */

import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  RISK_LEVELS,
  SEMVER_PATTERN,
  type CapabilityDefinition,
} from '../capabilities/contracts.js';
import { SKILL_NAME_PATTERN, SkillManifestSchema } from './contracts.js';

/** SHA-256 hex digest (lowercase); MD5/SHA-1 are not accepted. */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const SKILL_SOURCE_TYPES = ['builtin', 'local', 'imported'] as const;
export type SkillSourceType = (typeof SKILL_SOURCE_TYPES)[number];

/**
 * Canonical trust states:
 * - quarantined: registered but not yet usable (default for imported/local)
 * - reviewed: reviewed but not yet trusted
 * - trusted: usable (only via explicit owner/admin decision or a separately
 *   defined trusted built-in policy)
 * - revoked: trust withdrawn; never usable
 */
export const SKILL_TRUST_STATES = ['quarantined', 'reviewed', 'trusted', 'revoked'] as const;
export type SkillTrustStatus = (typeof SKILL_TRUST_STATES)[number];

export const SKILL_VALIDATION_STATES = ['valid', 'invalid'] as const;
export type SkillValidationStatus = (typeof SKILL_VALIDATION_STATES)[number];

/**
 * The only mechanisms that may promote a record to `trusted`. Anything else
 * (including model-initiated or self-service transitions) is rejected.
 */
export const TRUST_PROMOTION_MECHANISMS = [
  'owner-decision',
  'admin-decision',
  'builtin-policy',
] as const;
export type TrustPromotionMechanism = (typeof TRUST_PROMOTION_MECHANISMS)[number];

/** Explicit actor/provenance object required for every trust transition. */
export const SkillProvenanceSchema = z.strictObject({
  actor: z.string().trim().min(1).max(200),
  mechanism: z.string().trim().min(1).max(100),
  reason: z.string().trim().min(1).max(1000).optional(),
  at: z.string().min(1).max(100),
});
export type SkillProvenance = z.infer<typeof SkillProvenanceSchema>;

export const SkillValidationIssueSchema = z.strictObject({
  path: z.string().min(1),
  message: z.string().min(1),
});
export type SkillValidationIssueRecord = z.infer<typeof SkillValidationIssueSchema>;

/**
 * Skill-level risk snapshot captured at registration time. Distinct from the
 * per-capability `RiskSnapshot` in execution/contracts.ts: a skill spans
 * multiple capabilities, so the snapshot records the declared skill risk and
 * the highest referenced capability risk.
 */
export const SkillRiskSnapshotSchema = z.strictObject({
  risk_level: z.enum(RISK_LEVELS),
  highest_capability_risk: z.enum(RISK_LEVELS),
  capability_count: z.number().int().nonnegative(),
});
export type SkillRiskSnapshot = z.infer<typeof SkillRiskSnapshotSchema>;

/**
 * One persisted registry record. Strict on purpose: persisted unknown fields
 * fail closed instead of being silently dropped.
 */
export const SkillRegistryRecordSchema = z.strictObject({
  name: z.string().regex(SKILL_NAME_PATTERN, 'skill name must be a lowercase identifier').max(64, 'skill name must be at most 64 characters'),
  version: z.string().regex(SEMVER_PATTERN, 'skill version must be semantic (major.minor.patch)'),
  manifest: SkillManifestSchema,
  package_digest: z.string().regex(SHA256_HEX_PATTERN, 'package_digest must be lowercase SHA-256 hex'),
  manifest_digest: z.string().regex(SHA256_HEX_PATTERN, 'manifest_digest must be lowercase SHA-256 hex'),
  source_type: z.enum(SKILL_SOURCE_TYPES),
  source_id: z.string().trim().min(1).max(500),
  source_reference: z.string().trim().min(1).max(2000).optional(),
  trust_status: z.enum(SKILL_TRUST_STATES),
  installed_at: z.string().min(1).max(100),
  updated_at: z.string().min(1).max(100),
  enabled: z.boolean(),
  revoked: z.boolean(),
  validation_status: z.enum(SKILL_VALIDATION_STATES),
  validation_issues: z.array(SkillValidationIssueSchema),
  capability_ids: z.array(z.string().regex(CAPABILITY_ID_PATTERN)).max(100),
  risk_snapshot: SkillRiskSnapshotSchema,
  provenance: z.array(SkillProvenanceSchema),
});
export type SkillRegistryRecord = z.infer<typeof SkillRegistryRecordSchema>;

/**
 * Registration input: the only data the registry accepts from callers. The
 * registry (not the caller) derives trust, timestamps and validation state.
 */
export const SkillRegistryRegistrationInputSchema = z.strictObject({
  manifest: SkillManifestSchema,
  package_digest: z.string().regex(SHA256_HEX_PATTERN, 'package_digest must be lowercase SHA-256 hex'),
  manifest_digest: z.string().regex(SHA256_HEX_PATTERN, 'manifest_digest must be lowercase SHA-256 hex'),
  source_type: z.enum(SKILL_SOURCE_TYPES),
  source_id: z.string().trim().min(1).max(500),
  source_reference: z.string().trim().min(1).max(2000).optional(),
});
export type SkillRegistryRegistrationInput = z.infer<typeof SkillRegistryRegistrationInputSchema>;

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

export const SKILL_REGISTRY_ERROR_CODES = [
  'SKILL_INPUT_INVALID',
  'SKILL_VALIDATION_FAILED',
  'SKILL_VERSION_CONFLICT',
  'SKILL_NOT_FOUND',
  'SKILL_PACKAGE_INTEGRITY_FAILURE',
  'SKILL_TRUST_TRANSITION_INVALID',
  'SKILL_NOT_ELIGIBLE',
  'SKILL_REGISTRY_CORRUPT',
] as const;
export type SkillRegistryErrorCode = (typeof SKILL_REGISTRY_ERROR_CODES)[number];

export class SkillRegistryError extends Error {
  readonly code: SkillRegistryErrorCode;

  constructor(code: SkillRegistryErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SkillRegistryError';
    this.code = code;
  }
}

/** Injected capability lookup; the registry never rebuilds capability schemas. */
export type CapabilityLookup = (capabilityId: string) => CapabilityDefinition | undefined;

/**
 * Separately defined trusted built-in policy: a pure predicate that decides
 * which builtin skills may start as `trusted`. Imported/local skills are
 * never eligible for this policy.
 */
export type BuiltinTrustedPolicy = (skill: {
  name: string;
  version: string;
  source_type: SkillSourceType;
}) => boolean;

/** Canonical version identity: `name@version`. */
export function skillRecordKey(name: string, version: string): string {
  return `${name}@${version}`;
}
