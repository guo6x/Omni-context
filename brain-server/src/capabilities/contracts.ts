/**
 * Transport-independent Capability contracts (Goal24 Checkpoint 2, hardened in 2.1).
 *
 * A Capability describes a semantic action the system allows ("what"),
 * never a command ("how"). CLI/API/MCP bindings are adapter concerns and are
 * not part of this contract. The contract layer must not be able to express
 * shell strings or executable command templates.
 */

import { z } from 'zod';
import { JsonObjectSchema } from '../contracts/json-safe.js';

// ---------------------------------------------------------------------------
// Shared identifiers
// ---------------------------------------------------------------------------

/**
 * Capability ID format: `provider.resource.action` with 3..5 dot-separated
 * segments. Segments are lowercase, start with a letter, and may contain
 * digits afterwards (e.g. `github.issue.create`, `github.pr.checks.read`).
 */
export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,4}$/;

/**
 * Capability semantic version. Adapter implementation versions are a separate
 * concern and must not be encoded here.
 */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * First-segment names that are reserved for transports. A capability ID must
 * never start with a transport name (`cli.github.issue.create` is invalid).
 */
export const RESERVED_TRANSPORT_PREFIXES = [
  'cli',
  'mcp',
  'api',
  'http',
  'transport',
  'shell',
  'exec',
  'cmd',
] as const;

/** Evidence class ID format: dotted identifier, e.g. `pull_request.current_state`. */
export const EVIDENCE_CLASS_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*){1,3}$/;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Minimal capability authority model (Goal24 design authority, section 8).
 *
 * Decision authority (who may decide) and execution authority (who may
 * execute) are deliberately distinct concepts; `required_authority` declares
 * the minimum execution authority needed to run the capability. User override
 * remains highest priority but is a later-checkpoint runtime concern.
 *
 * L0 - no special authority required (safe reads)
 * L1 - trusted local actor authority (routine local writes)
 * L2 - elevated authority (gated writes with evidence requirements)
 * L3 - highest authority (destructive or external-impact actions)
 */
export const AUTHORITY_LEVELS = ['L0', 'L1', 'L2', 'L3'] as const;
export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SIDE_EFFECT_CLASSES = [
  'read_only',
  'reversible_write',
  'destructive_write',
  'external_effect',
] as const;
export type SideEffectClass = (typeof SIDE_EFFECT_CLASSES)[number];

export const CONFLICT_POLICIES = ['reject', 'warn', 'allow'] as const;
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export const VERIFICATION_REQUIREMENTS = ['none', 'asserted', 'verified'] as const;
export type VerificationRequirement = (typeof VERIFICATION_REQUIREMENTS)[number];

/**
 * Side-effect semantics (hardened in 2.1).
 *
 * read_only         - no state change; reversible=false, no rollback capability.
 * reversible_write  - a write that can be rolled back by a declared rollback
 *                     capability; reversible=true.
 * destructive_write - a write that destroys state and cannot be cleanly
 *                     reversed; reversible=false.
 * external_effect   - an effect outside the local system (e.g. a remote API
 *                     call). Reversibility is capability-specific and is NOT
 *                     forced by the contract; each capability must declare it
 *                     explicitly.
 */

// ---------------------------------------------------------------------------
// Evidence requirement
// ---------------------------------------------------------------------------

/**
 * Machine-validatable evidence requirement attached to a capability or skill.
 * This is the canonical evidence policy source for capabilities. This is a
 * contract only: retrieval and the Evidence Surface Guard runtime are later
 * checkpoints.
 */
export const EvidenceRequirementSchema = z.strictObject({
  class_id: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence class id must be a dotted identifier'),
  mandatory: z.boolean(),
  /**
   * Freshness policy: how old evidence may be before it counts as stale.
   * Bounded only by positive safe integers; Omni-Context is a long-lived
   * context system and no arbitrary 7-day cap is imposed (2.1 hardening).
   */
  freshness_policy: z
    .strictObject({
      max_age_ms: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .optional(),
  /** How to treat conflicting evidence for this class. */
  conflict_policy: z.enum(CONFLICT_POLICIES).optional(),
  /** Minimum verification level for evidence of this class. */
  verification_requirement: z.enum(VERIFICATION_REQUIREMENTS).optional(),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;
/**
 * Canonical default for an undeclared conflict_policy (2.2 fail-closed).
 *
 * All policy consumers (Execution validator, future Evidence Guard) must use
 * this single helper so an undeclared conflict_policy always means `reject`,
 * never a per-caller guess. The schema deliberately keeps conflict_policy
 * optional so wire serialization stays explicit and unchanged.
 */
export function effectiveConflictPolicy(requirement: EvidenceRequirement): ConflictPolicy {
  return requirement.conflict_policy ?? 'reject';
}

// ---------------------------------------------------------------------------
// Capability definition
// ---------------------------------------------------------------------------

export const CapabilityDefinitionSchema = z
  .strictObject({
    id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability id must be provider.resource.action'),
    version: z.string().regex(SEMVER_PATTERN, 'capability version must be semantic (major.minor.patch)'),
    description: z.string().trim().min(1).max(2000),
    /**
     * JSON-compatible schema descriptor for this capability's inputs.
     * This is a descriptive object, not a claim of full JSON Schema
     * validation support. Values must be JSON-safe.
     */
    input_schema: JsonObjectSchema,
    required_authority: z.enum(AUTHORITY_LEVELS),
    risk_level: z.enum(RISK_LEVELS),
    reversible: z.boolean(),
    side_effect_class: z.enum(SIDE_EFFECT_CLASSES),
    /**
     * Canonical evidence policy for this capability (2.1 hardening: was a
     * plain class-id list in Checkpoint 2; now the full EvidenceRequirement
     * model so safety policy is not lost). Unique by class_id.
     */
    required_evidence: z.array(EvidenceRequirementSchema).max(100),
    /** Read-back capability used to verify the outcome of this capability. */
    verification_capability: z
      .string()
      .regex(CAPABILITY_ID_PATTERN, 'verification capability must be a capability id')
      .optional(),
    /** Capability that can roll this action back. Optional; must not be a shell string. */
    rollback_capability: z
      .string()
      .regex(CAPABILITY_ID_PATTERN, 'rollback capability must be a capability id')
      .optional(),
  })
  .superRefine((capability, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    const firstSegment = capability.id.split('.')[0];
    if ((RESERVED_TRANSPORT_PREFIXES as readonly string[]).includes(firstSegment)) {
      addIssue(`capability id must not start with a transport prefix (${firstSegment})`, ['id']);
    }

    const classIds = capability.required_evidence.map((requirement) => requirement.class_id);
    if (new Set(classIds).size !== classIds.length) {
      addIssue('required_evidence must not contain duplicate class_ids', ['required_evidence']);
    }

    if (capability.rollback_capability && !capability.reversible) {
      addIssue('rollback_capability requires reversible=true', ['rollback_capability']);
    }

    if (capability.rollback_capability === capability.id) {
      addIssue('rollback_capability must reference a different capability', ['rollback_capability']);
    }

    if (capability.verification_capability === capability.id) {
      addIssue('verification_capability must reference a different capability', ['verification_capability']);
    }

    if (capability.side_effect_class === 'read_only') {
      if (capability.risk_level !== 'low') {
        addIssue('read_only capabilities must declare risk_level=low', ['risk_level']);
      }
      if (capability.reversible) {
        addIssue('read_only capabilities must declare reversible=false', ['reversible']);
      }
      if (capability.rollback_capability) {
        addIssue('read_only capabilities must not declare a rollback_capability', ['rollback_capability']);
      }
    } else {
      if (!capability.verification_capability) {
        // Every future write capability requires read-back verification.
        addIssue('write capabilities must declare a verification_capability', ['verification_capability']);
      }
      if (capability.side_effect_class === 'reversible_write' && !capability.reversible) {
        addIssue('reversible_write capabilities must declare reversible=true', ['reversible']);
      }
      if (capability.side_effect_class === 'destructive_write' && capability.reversible) {
        addIssue('destructive_write capabilities must declare reversible=false', ['reversible']);
      }
    }
  });

export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
