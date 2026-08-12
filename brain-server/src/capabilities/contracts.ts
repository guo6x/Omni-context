/**
 * Transport-independent Capability contracts (Goal24 Checkpoint 2).
 *
 * A Capability describes a semantic action the system allows ("what"),
 * never a command ("how"). CLI/API/MCP bindings are adapter concerns and are
 * not part of this contract. The contract layer must not be able to express
 * shell strings or executable command templates.
 */

import { z } from 'zod';

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


// ---------------------------------------------------------------------------
// Evidence requirement
// ---------------------------------------------------------------------------

/**
 * Machine-validatable evidence requirement attached to a capability or skill.
 * This is a contract only: retrieval and the Evidence Surface Guard runtime
 * are later checkpoints.
 */
export const EvidenceRequirementSchema = z.strictObject({
  class_id: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence class id must be a dotted identifier'),
  mandatory: z.boolean(),
  /** Freshness policy: how old evidence may be before it counts as stale. */
  freshness_policy: z
    .strictObject({
      max_age_ms: z.number().int().positive().max(86_400_000 * 7),
    })
    .optional(),
  /** How to treat conflicting evidence for this class. */
  conflict_policy: z.enum(CONFLICT_POLICIES).optional(),
  /** Minimum verification level for evidence of this class. */
  verification_requirement: z.enum(VERIFICATION_REQUIREMENTS).optional(),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

// ---------------------------------------------------------------------------
// Capability definition
// ---------------------------------------------------------------------------

export const CapabilityDefinitionSchema = z
  .strictObject({
    id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability id must be provider.resource.action'),
    version: z.string().regex(SEMVER_PATTERN, 'capability version must be semantic (major.minor.patch)'),
    description: z.string().trim().min(1).max(2000),
    /** JSON Schema-compatible input description. Values are JSON primitives only. */
    input_schema: z.record(z.unknown()),
    required_authority: z.enum(AUTHORITY_LEVELS),
    risk_level: z.enum(RISK_LEVELS),
    reversible: z.boolean(),
    side_effect_class: z.enum(SIDE_EFFECT_CLASSES),
    /** Evidence classes the capability needs before it may be executed. Unique. */
    required_evidence_classes: z.array(z.string().regex(EVIDENCE_CLASS_PATTERN)).min(0),
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

    if (new Set(capability.required_evidence_classes).size !== capability.required_evidence_classes.length) {
      addIssue('required_evidence_classes must not contain duplicates', ['required_evidence_classes']);
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
      if (capability.rollback_capability) {
        addIssue('read_only capabilities must not declare a rollback_capability', ['rollback_capability']);
      }
    } else if (!capability.verification_capability) {
      // Every future write capability requires read-back verification.
      addIssue('write capabilities must declare a verification_capability', ['verification_capability']);
    }
  });

export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
