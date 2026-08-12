/**
 * Machine-readable Skill Manifest contracts (Goal24 Checkpoint 2, hardened in 2.1).
 *
 * A skill teaches procedure, not transport. The manifest carries the
 * enforceable safety/authority/evidence fields; an optional SKILL.md may hold
 * human/agent-readable instructions. The manifest must not be able to express
 * executable shell strings.
 */

import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  EvidenceRequirementSchema,
  RISK_LEVELS,
  SEMVER_PATTERN,
  type CapabilityDefinition,
  type EvidenceRequirement,
  type RiskLevel,
} from '../capabilities/contracts.js';

/** Skill name format: lowercase identifier with dashes, e.g. `github-issue-triage`. */
export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Step identifier format inside a procedure. */
export const STEP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** Transport preference for a skill. A preference, never a capability override. */
export const ADAPTER_PREFERENCES = ['any', 'cli', 'api', 'mcp', 'local'] as const;
export type AdapterPreference = (typeof ADAPTER_PREFERENCES)[number];

/**
 * A single structured procedure step. A step may reference a capability that
 * implements it, but the step itself is semantic knowledge, not a command.
 */
export const ProcedureStepSchema = z.strictObject({
  step_id: z.string().regex(STEP_ID_PATTERN, 'step_id must be a lowercase identifier'),
  description: z.string().trim().min(1).max(2000),
  /** Optional reference to a capability declared in the same manifest. */
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability reference must be a capability id').optional(),
  /** Optional human/agent-readable guidance for this step. */
  note: z.string().max(2000).optional(),
});
export type ProcedureStep = z.infer<typeof ProcedureStepSchema>;

/** Declared verification/rollback support: a capability reference, never a command. */
export const CapabilityReferenceSchema = z.strictObject({
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability reference must be a capability id'),
  description: z.string().max(2000).optional(),
});
export type CapabilityReference = z.infer<typeof CapabilityReferenceSchema>;

export const SkillManifestSchema = z
  .strictObject({
    name: z.string().regex(SKILL_NAME_PATTERN, 'skill name must be a lowercase identifier'),
    version: z.string().regex(SEMVER_PATTERN, 'skill version must be semantic (major.minor.patch)'),
    description: z.string().trim().min(1).max(2000),
    /** Capability IDs the skill uses. Unique; referential integrity is refined below. */
    capabilities: z.array(z.string().regex(CAPABILITY_ID_PATTERN)).min(1),
    /** Machine-readable prerequisite identifiers (e.g. `gh-cli-installed`). */
    prerequisites: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
    /** Evidence requirements strengthened at the skill level. Unique by class_id. */
    required_evidence: z.array(EvidenceRequirementSchema).max(100).optional(),
    /** Structured procedural knowledge. Not an execution layer. */
    procedure: z.array(ProcedureStepSchema).min(1).max(100),
    /**
     * Security risk of executing this skill (same enum and semantics as
     * capability risk). Must not be lower than the highest risk of the
     * referenced capabilities; enforced by
     * validateSkillManifestAgainstCapabilities (2.1).
     */
    risk: z.enum(RISK_LEVELS),
    verification: CapabilityReferenceSchema.optional(),
    rollback: CapabilityReferenceSchema.optional(),
    /** Transport preference only; cannot change authority/risk/evidence/reversibility. */
    adapter_preference: z.enum(ADAPTER_PREFERENCES),
  })
  .superRefine((manifest, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
      addIssue('capabilities must not contain duplicates', ['capabilities']);
    }

    if (manifest.required_evidence) {
      const classIds = manifest.required_evidence.map((requirement) => requirement.class_id);
      if (new Set(classIds).size !== classIds.length) {
        addIssue('required_evidence must not contain duplicate class_ids', ['required_evidence']);
      }
    }

    const capabilitySet = new Set(manifest.capabilities);
    for (const step of manifest.procedure) {
      if (step.capability_id && !capabilitySet.has(step.capability_id)) {
        addIssue(`procedure step ${step.step_id} references undeclared capability ${step.capability_id}`, ['procedure']);
      }
    }

    if (manifest.verification && !capabilitySet.has(manifest.verification.capability_id)) {
      addIssue('verification must reference a capability declared in capabilities', ['verification']);
    }
    if (manifest.rollback && !capabilitySet.has(manifest.rollback.capability_id)) {
      addIssue('rollback must reference a capability declared in capabilities', ['rollback']);
    }
  });

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ---------------------------------------------------------------------------
// Skill safety inheritance (2.1)
// ---------------------------------------------------------------------------

export interface SkillValidationIssue {
  path: string;
  message: string;
}

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

/**
 * Validate that a skill never weakens the safety declared by the capabilities
 * it references. Skill-level requirements may only strengthen capability
 * requirements (more classes, stricter freshness, stricter verification or
 * conflict policy); weakening is rejected. Registry lookup is injected; no
 * Registry runtime exists in this checkpoint.
 */
export function validateSkillManifestAgainstCapabilities(
  manifest: SkillManifest,
  lookup: (capabilityId: string) => CapabilityDefinition | undefined,
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  const skillReqsByClass = new Map<string, EvidenceRequirement>(
    (manifest.required_evidence ?? []).map((requirement) => [requirement.class_id, requirement]),
  );

  let maxReferencedRisk: RiskLevel = 'low';
  for (const capabilityId of manifest.capabilities) {
    const capability = lookup(capabilityId);
    if (!capability) {
      issues.push({ path: 'capabilities', message: `capability '${capabilityId}' not found in registry` });
      continue;
    }
    if (RISK_RANK[capability.risk_level] > RISK_RANK[maxReferencedRisk]) {
      maxReferencedRisk = capability.risk_level;
    }

    for (const requirement of capability.required_evidence) {
      if (!requirement.mandatory) continue;
      const skillRequirement = skillReqsByClass.get(requirement.class_id);
      if (!skillRequirement) {
        issues.push({
          path: 'required_evidence',
          message: `capability '${capabilityId}' mandates evidence class '${requirement.class_id}' but the skill does not require it`,
        });
        continue;
      }
      if (!skillRequirement.mandatory) {
        issues.push({
          path: 'required_evidence',
          message: `skill weakens mandatory evidence '${requirement.class_id}' to optional`,
        });
      }
      if (requirement.verification_requirement === 'verified' && (skillRequirement.verification_requirement ?? 'none') !== 'verified') {
        issues.push({
          path: 'required_evidence',
          message: `skill downgrades verification_requirement for '${requirement.class_id}' below verified`,
        });
      }
      if (requirement.conflict_policy === 'reject' && (skillRequirement.conflict_policy ?? 'allow') !== 'reject') {
        issues.push({
          path: 'required_evidence',
          message: `skill downgrades conflict_policy for '${requirement.class_id}' below reject`,
        });
      }
      if (requirement.freshness_policy) {
        if (!skillRequirement.freshness_policy) {
          issues.push({
            path: 'required_evidence',
            message: `skill drops freshness_policy for '${requirement.class_id}'`,
          });
        } else if (skillRequirement.freshness_policy.max_age_ms > requirement.freshness_policy.max_age_ms) {
          issues.push({
            path: 'required_evidence',
            message: `skill weakens freshness_policy for '${requirement.class_id}'`,
          });
        }
      }
    }
  }

  if (RISK_RANK[manifest.risk] < RISK_RANK[maxReferencedRisk]) {
    issues.push({
      path: 'risk',
      message: `skill risk '${manifest.risk}' is lower than the highest referenced capability risk '${maxReferencedRisk}'`,
    });
  }

  return issues;
}
