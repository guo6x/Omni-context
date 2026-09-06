/**
 * ExecutionPlan and evidence/approval/risk snapshot contracts
 * (Goal24 Checkpoint 2, hardened in 2.1).
 *
 * The ExecutionPlan is the only formal handoff between Decision / Evidence /
 * Approval and Adapter execution. It must never carry shell strings or
 * executable command templates; adapters build argv from capability_id +
 * normalized_inputs only.
 */

import { z } from 'zod';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import {
  AUTHORITY_LEVELS,
  CAPABILITY_ID_PATTERN,
  EVIDENCE_CLASS_PATTERN,
  effectiveConflictPolicy,
  RISK_LEVELS,
  SEMVER_PATTERN,
  SIDE_EFFECT_CLASSES,
  VERIFICATION_REQUIREMENTS,
  type AuthorityLevel,
  type CapabilityDefinition,
  type EvidenceRequirement,
  type RiskLevel,
  type SideEffectClass,
  type VerificationRequirement,
} from '../capabilities/contracts.js';

const IsoTimestampSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Enums and bounds
// ---------------------------------------------------------------------------

export const EXECUTION_PLAN_STATES = [
  'draft',
  'awaiting_approval',
  'ready',
  'executing',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
] as const;
export type ExecutionPlanState = (typeof EXECUTION_PLAN_STATES)[number];

/** States in which a plan is (or was) eligible for adapter execution. */
export const EXECUTABLE_PLAN_STATES: readonly ExecutionPlanState[] = ['ready', 'executing'];

/** States that have acquired (or had) execution eligibility and must retain an audit record. */
export const APPROVAL_REQUIRED_STATES: readonly ExecutionPlanState[] = ['ready', 'executing', 'succeeded', 'failed'];

/** States in which no approval may yet exist. */
export const PRE_APPROVAL_STATES: readonly ExecutionPlanState[] = ['draft', 'awaiting_approval', 'blocked', 'cancelled'];

export const EVIDENCE_STATUSES = ['present', 'missing', 'stale', 'conflicted', 'unverified'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;
export const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export const TIMEOUT_MIN_MS = 100;
export const TIMEOUT_MAX_MS = 86_400_000; // 24 hours

/**
 * Reserved key names that must never appear at the top level of a plan's
 * normalized_inputs. Inputs are semantic parameters; a top-level key such as
 * `shell` or `command` is not a semantic input and is rejected at the contract
 * boundary. Note: semantic TEXT may legitimately mention commands (e.g. an
 * issue body saying "the command failed on Windows"); that text is a string
 * value and is never interpreted as an executable process specification.
 */
export const FORBIDDEN_INPUT_KEYS = ['shell', 'command', 'exec', 'bash', 'powershell', 'cmd', 'cmdline', 'script'] as const;

// ---------------------------------------------------------------------------
// Risk snapshot
// ---------------------------------------------------------------------------

/**
 * Frozen risk/authority view captured when the plan was created. The adapter
 * must not re-derive risk at execution time; audits use this snapshot. The
 * snapshot must equal the referenced capability declaration (enforced by
 * validateExecutionPlanAgainstCapabilities).
 */
export const RiskSnapshotSchema = z
  .strictObject({
    risk_level: z.enum(RISK_LEVELS),
    reversible: z.boolean(),
    side_effect_class: z.enum(SIDE_EFFECT_CLASSES),
    required_authority: z.enum(AUTHORITY_LEVELS),
    /** Required since 2.1: the capability version the snapshot was taken against. */
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic'),
  })
  .superRefine((snapshot, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (snapshot.side_effect_class === 'read_only' && snapshot.reversible) {
      addIssue('read_only risk snapshot must declare reversible=false', ['reversible']);
    }
    if (snapshot.side_effect_class === 'reversible_write' && !snapshot.reversible) {
      addIssue('reversible_write risk snapshot must declare reversible=true', ['reversible']);
    }
    if (snapshot.side_effect_class === 'destructive_write' && snapshot.reversible) {
      addIssue('destructive_write risk snapshot must declare reversible=false', ['reversible']);
    }
  });
export type RiskSnapshot = z.infer<typeof RiskSnapshotSchema>;

// ---------------------------------------------------------------------------
// Evidence coverage snapshot
// ---------------------------------------------------------------------------

/**
 * One coverage entry. Status-specific invariants (2.1):
 * - present:     at least one evidence id; no conflict ids; no stale_since
 * - missing:     no evidence ids; no conflict ids; no stale_since
 * - stale:       at least one evidence id; stale_since required
 * - conflicted:  at least one evidence id; at least one conflict id; the two
 *                sets must be disjoint
 * - unverified:  at least one evidence id
 */
export const EvidenceCoverageEntrySchema = z
  .strictObject({
    evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
    status: z.enum(EVIDENCE_STATUSES),
    /** Verification level achieved for this evidence (2.1: required). */
    verification_level: z.enum(VERIFICATION_REQUIREMENTS),
    evidence_ids: z.array(z.string().trim().min(1).max(500)).max(1000),
    checked_at: IsoTimestampSchema,
    stale_since: IsoTimestampSchema.optional(),
    conflict_evidence_ids: z.array(z.string().trim().min(1).max(500)).max(1000).optional(),
    note: z.string().max(2000).optional(),
  })
  .superRefine((entry, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (new Set(entry.evidence_ids).size !== entry.evidence_ids.length) {
      addIssue('evidence_ids must not contain duplicates', ['evidence_ids']);
    }
    if (entry.conflict_evidence_ids && new Set(entry.conflict_evidence_ids).size !== entry.conflict_evidence_ids.length) {
      addIssue('conflict_evidence_ids must not contain duplicates', ['conflict_evidence_ids']);
    }

    switch (entry.status) {
      case 'present':
        if (entry.evidence_ids.length < 1) addIssue('status=present requires at least one evidence id', ['evidence_ids']);
        if (entry.conflict_evidence_ids) addIssue('status=present must not carry conflict_evidence_ids', ['conflict_evidence_ids']);
        if (entry.stale_since) addIssue('status=present must not carry stale_since', ['stale_since']);
        break;
      case 'missing':
        if (entry.evidence_ids.length !== 0) addIssue('status=missing requires empty evidence_ids', ['evidence_ids']);
        if (entry.conflict_evidence_ids) addIssue('status=missing must not carry conflict_evidence_ids', ['conflict_evidence_ids']);
        if (entry.stale_since) addIssue('status=missing must not carry stale_since', ['stale_since']);
        break;
      case 'stale':
        if (entry.evidence_ids.length < 1) addIssue('status=stale requires at least one evidence id', ['evidence_ids']);
        if (!entry.stale_since) addIssue('status=stale requires stale_since', ['stale_since']);
        break;
      case 'conflicted':
        if (entry.evidence_ids.length < 1) addIssue('status=conflicted requires at least one evidence id', ['evidence_ids']);
        if (!entry.conflict_evidence_ids || entry.conflict_evidence_ids.length < 1) {
          addIssue('status=conflicted requires at least one conflict_evidence_id', ['conflict_evidence_ids']);
        }
        if (entry.conflict_evidence_ids && entry.conflict_evidence_ids.some((id) => entry.evidence_ids.includes(id))) {
          addIssue('conflict_evidence_ids must be disjoint from evidence_ids', ['conflict_evidence_ids']);
        }
        break;
      case 'unverified':
        if (entry.evidence_ids.length < 1) addIssue('status=unverified requires at least one evidence id', ['evidence_ids']);
        break;
    }
  });
export type EvidenceCoverageEntry = z.infer<typeof EvidenceCoverageEntrySchema>;

export const EvidenceCoverageSnapshotSchema = z
  .strictObject({
    entries: z.array(EvidenceCoverageEntrySchema).max(1000),
  })
  .superRefine((snapshot, ctx) => {
    const classIds = snapshot.entries.map((entry) => entry.evidence_class);
    if (new Set(classIds).size !== classIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'coverage entries must be unique by evidence_class', path: ['entries'] });
    }
  });
export type EvidenceCoverageSnapshot = z.infer<typeof EvidenceCoverageSnapshotSchema>;

// ---------------------------------------------------------------------------
// Approval reference
// ---------------------------------------------------------------------------

/**
 * Approval grant record (schema only; 2.1 audit-shaped model).
 *
 * The raw token is not stored on the plan; the plan carries an opaque
 * token_reference and a token_digest placeholder. Real token validation and
 * digest computation are a Checkpoint 7 concern — no cryptography is
 * implemented here. Completed plans keep this record for auditability.
 */
export const ApprovalReferenceSchema = z.strictObject({
  approval_id: z.string().trim().min(1).max(200),
  plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
  granted_by: z.string().trim().min(1).max(200),
  granted_at: IsoTimestampSchema,
  policy_version: z.string().trim().min(1).max(50),
  /** Opaque reference to the stored approval record (no raw token on the wire). */
  token_reference: z.string().trim().min(1).max(500),
  /** Opaque digest placeholder; real computation is a Checkpoint 7 concern. */
  token_digest: z.string().trim().min(1).max(500),
});
export type ApprovalReference = z.infer<typeof ApprovalReferenceSchema>;

// ---------------------------------------------------------------------------
// Verification / rollback plans
// ---------------------------------------------------------------------------

export const VerificationPlanSchema = z.strictObject({
  verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'verification_capability_id must be a capability id'),
  /** Normalized mapping from verification capability inputs to values (JSON-safe). */
  verification_inputs: JsonObjectSchema,
  description: z.string().max(2000).optional(),
});
export type VerificationPlan = z.infer<typeof VerificationPlanSchema>;

export const RollbackPlanSchema = z.strictObject({
  rollback_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'rollback_capability_id must be a capability id'),
  /** Normalized mapping from rollback capability inputs to values (JSON-safe). */
  rollback_inputs: JsonObjectSchema,
  description: z.string().max(2000).optional(),
});
export type RollbackPlan = z.infer<typeof RollbackPlanSchema>;

// ---------------------------------------------------------------------------
// Execution plan
// ---------------------------------------------------------------------------

export const ExecutionPlanSchema = z
  .strictObject({
    plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
    decision_id: z.string().trim().min(1).max(200),
    capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic'),
    /** Implementation identity (e.g. `github-cli`); strictly separate from capability_id. */
    adapter_id: z.string().regex(ADAPTER_ID_PATTERN, 'adapter_id must be a lowercase implementation identifier'),
    normalized_inputs: JsonObjectSchema,
    required_approval: z.boolean(),
    /**
     * Approval record (2.1: replaces the bare approval_token of Checkpoint 2).
     * Null until an approval is granted.
     */
    approval: ApprovalReferenceSchema.nullable(),
    risk_snapshot: RiskSnapshotSchema,
    evidence_coverage_snapshot: EvidenceCoverageSnapshotSchema,
    timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
    verification_plan: VerificationPlanSchema.nullable(),
    rollback_plan: RollbackPlanSchema.nullable(),
    state: z.enum(EXECUTION_PLAN_STATES),
    created_at: IsoTimestampSchema,
    expires_at: IsoTimestampSchema.optional(),
    correlation_id: z.string().trim().min(1).max(200).optional(),
    requested_by: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((plan, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    for (const forbidden of FORBIDDEN_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(plan.normalized_inputs, forbidden)) {
        addIssue(`normalized_inputs must not contain a reserved top-level key '${forbidden}'`, ['normalized_inputs', forbidden]);
      }
    }

    if (plan.expires_at && Date.parse(plan.expires_at) <= Date.parse(plan.created_at)) {
      addIssue('expires_at must be after created_at', ['expires_at']);
    }

    if (plan.state === 'awaiting_approval' && !plan.required_approval) {
      addIssue('state=awaiting_approval requires required_approval=true', ['state']);
    }

    if (plan.approval) {
      if (plan.approval.plan_id !== plan.plan_id) {
        addIssue('approval.plan_id must match the plan_id', ['approval', 'plan_id']);
      }
      if (!plan.required_approval) {
        addIssue('approval must be null when required_approval=false', ['approval']);
      }
    }

    if (plan.required_approval && APPROVAL_REQUIRED_STATES.includes(plan.state) && !plan.approval) {
      addIssue('plan in an executed/executable state with required_approval=true must carry an approval reference', ['approval']);
    }

    if (PRE_APPROVAL_STATES.includes(plan.state) && plan.approval) {
      addIssue('approval must be null in pre-approval states (draft/awaiting_approval/blocked/cancelled)', ['approval']);
    }

    if (plan.risk_snapshot.side_effect_class === 'read_only' && plan.rollback_plan) {
      addIssue('read_only plans must not carry a rollback_plan', ['rollback_plan']);
    }

    if (plan.risk_snapshot.side_effect_class !== 'read_only' && !plan.verification_plan) {
      addIssue('write plans must carry a verification_plan', ['verification_plan']);
    }

    if (plan.rollback_plan && !plan.risk_snapshot.reversible) {
      addIssue('rollback_plan requires risk_snapshot.reversible=true', ['rollback_plan']);
    }
  });

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// ---------------------------------------------------------------------------
// Coverage assessment (pure contract-level logic, no retrieval)
// ---------------------------------------------------------------------------

const VERIFICATION_RANK: Record<VerificationRequirement, number> = { none: 0, asserted: 1, verified: 2 };

export interface CoverageAssessmentEntry {
  class_id: string;
  status: EvidenceStatus | 'not_checked';
  verification_level: VerificationRequirement;
  satisfied: boolean;
}

export interface CoverageAssessment {
  entries: CoverageAssessmentEntry[];
  mandatory_satisfied: boolean;
  missing_mandatory: string[];
  blocking_reasons: string[];
  warnings: string[];
  /** Non-blocking findings (optional-evidence gaps) that must never gate execution. */
  non_blocking_findings: string[];
}

/**
 * Assess a coverage snapshot against evidence requirements (2.2 fail-closed).
 *
 * Fail-closed satisfaction rules:
 * - An entry satisfies its requirement only when status is `present` AND
 *   verification_level meets the requirement, or status is `conflicted` with
 *   an effective conflict_policy of `warn`/`allow` (verification still met).
 * - status=missing, stale and unverified NEVER satisfy a requirement.
 *   In particular, status=unverified cannot satisfy a mandatory requirement
 *   even when verification_requirement is undefined or `none` (fail-closed).
 * - An undeclared conflict_policy defaults to `reject` through
 *   effectiveConflictPolicy, the single canonical rule for all callers.
 * - Optional requirements never contribute to blocking_reasons or
 *   mandatory_satisfied; their findings land in non_blocking_findings (or
 *   warnings when conflict_policy=warn tolerates the conflict).
 *
 * Pure function: no retrieval, no time, no registry access.
 */
export function assessEvidenceCoverage(
  requirements: readonly EvidenceRequirement[],
  coverage: EvidenceCoverageSnapshot,
): CoverageAssessment {
  const byClass = new Map(coverage.entries.map((entry) => [entry.evidence_class, entry]));
  const missingMandatory: string[] = [];
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  const nonBlockingFindings: string[] = [];

  const entries: CoverageAssessmentEntry[] = requirements.map((requirement) => {
    const entry = byClass.get(requirement.class_id);
    if (!entry) {
      const finding = `evidence class '${requirement.class_id}' was not checked`;
      if (requirement.mandatory) {
        missingMandatory.push(requirement.class_id);
        blockingReasons.push(finding);
      } else {
        nonBlockingFindings.push(`${finding} (non-blocking: optional requirement)`);
      }
      return { class_id: requirement.class_id, status: 'not_checked', verification_level: 'none', satisfied: false };
    }

    const levelRequirement = requirement.verification_requirement ?? 'none';
    const levelOk = VERIFICATION_RANK[entry.verification_level] >= VERIFICATION_RANK[levelRequirement];

    let satisfied = false;
    const describe = `evidence class '${requirement.class_id}' (status=${entry.status})`;
    const fail = (reason: string) => {
      if (requirement.mandatory) {
        blockingReasons.push(reason);
      } else {
        nonBlockingFindings.push(`${reason} (non-blocking: optional requirement)`);
      }
    };

    switch (entry.status) {
      case 'present':
        satisfied = levelOk;
        if (!levelOk) {
          fail(`${describe}: verification_requirement=${levelRequirement} not met by verification_level=${entry.verification_level}`);
        }
        break;
      case 'stale':
        fail(`${describe}: evidence is stale`);
        break;
      case 'conflicted': {
        const policy = effectiveConflictPolicy(requirement);
        if (policy === 'reject') {
          fail(`${describe}: conflict_policy=reject${requirement.conflict_policy === undefined ? ' (default)' : ''} cannot be satisfied by conflicted evidence`);
        } else if (policy === 'warn') {
          satisfied = levelOk;
          if (!levelOk) {
            fail(`${describe}: verification_requirement=${levelRequirement} not met by verification_level=${entry.verification_level}`);
          } else {
            warnings.push(`${describe}: conflicted evidence tolerated by conflict_policy=warn`);
          }
        } else {
          satisfied = levelOk;
          if (!levelOk) {
            fail(`${describe}: verification_requirement=${levelRequirement} not met by verification_level=${entry.verification_level}`);
          }
        }
        break;
      }
      case 'unverified':
        fail(`${describe}: unverified evidence cannot satisfy the requirement (verification_requirement=${levelRequirement}, fail-closed)`);
        break;
      case 'missing':
      default:
        fail(`${describe}: evidence is missing`);
        break;
    }

    if (requirement.mandatory && !satisfied) {
      missingMandatory.push(requirement.class_id);
    }
    return { class_id: requirement.class_id, status: entry.status, verification_level: entry.verification_level, satisfied };
  });

  return {
    entries,
    mandatory_satisfied: missingMandatory.length === 0,
    missing_mandatory: missingMandatory,
    blocking_reasons: blockingReasons,
    warnings: warnings,
    non_blocking_findings: nonBlockingFindings,
  };
}

// ---------------------------------------------------------------------------
// Expiry helper (deterministic)
// ---------------------------------------------------------------------------

/**
 * Deterministic expiry check (2.1). `now` is injected so tests are
 * reproducible; the Checkpoint 3 broker must call this before spawning any
 * process for a plan.
 */
export function isExecutionPlanExpired(plan: ExecutionPlan, now: string | Date): boolean {
  if (!plan.expires_at) return false;
  const nowMs = typeof now === 'string' ? Date.parse(now) : now.getTime();
  return nowMs >= Date.parse(plan.expires_at);
}

// ---------------------------------------------------------------------------
// Registry-bound validation
// ---------------------------------------------------------------------------

export interface ExecutionPlanValidationIssue {
  path: string;
  message: string;
}

/**
 * Validate a parsed ExecutionPlan against the capability it references.
 *
 * Registry lookup is injected (no Registry runtime exists yet). Checks:
 * capability existence; version chain (risk_snapshot.capability_version ==
 * plan.capability_version == capability.version); risk-snapshot equality with
 * the capability declaration; verification/rollback binding to the declared
 * capabilities (with referential existence checks); and policy-aware mandatory
 * evidence coverage for executable states.
 */
export function validateExecutionPlanAgainstCapabilities(
  plan: ExecutionPlan,
  lookup: (capabilityId: string) => CapabilityDefinition | undefined,
): ExecutionPlanValidationIssue[] {
  const issues: ExecutionPlanValidationIssue[] = [];
  const capability = lookup(plan.capability_id);
  if (!capability) {
    issues.push({ path: 'capability_id', message: `capability '${plan.capability_id}' not found in registry` });
    return issues;
  }

  if (plan.capability_version !== capability.version) {
    issues.push({
      path: 'capability_version',
      message: `plan capability_version '${plan.capability_version}' does not match capability version '${capability.version}'`,
    });
  }
  if (plan.risk_snapshot.capability_version !== plan.capability_version) {
    issues.push({
      path: 'risk_snapshot.capability_version',
      message: 'risk snapshot capability_version must equal the plan capability_version',
    });
  }
  if (plan.risk_snapshot.capability_version !== capability.version) {
    issues.push({
      path: 'risk_snapshot.capability_version',
      message: 'risk snapshot capability_version must equal the capability version',
    });
  }

  const snapshot = plan.risk_snapshot;
  if (capability.risk_level !== snapshot.risk_level) {
    issues.push({ path: 'risk_snapshot.risk_level', message: 'risk snapshot does not match capability declaration' });
  }
  if (capability.reversible !== snapshot.reversible) {
    issues.push({ path: 'risk_snapshot.reversible', message: 'risk snapshot does not match capability declaration' });
  }
  if (capability.side_effect_class !== snapshot.side_effect_class) {
    issues.push({ path: 'risk_snapshot.side_effect_class', message: 'risk snapshot does not match capability declaration' });
  }
  if (capability.required_authority !== snapshot.required_authority) {
    issues.push({ path: 'risk_snapshot.required_authority', message: 'risk snapshot does not match capability declaration' });
  }

  // Verification binding (2.1).
  if (plan.verification_plan) {
    if (!capability.verification_capability) {
      issues.push({
        path: 'verification_plan',
        message: 'plan carries a verification_plan but the capability declares no verification_capability',
      });
    } else if (plan.verification_plan.verification_capability_id !== capability.verification_capability) {
      issues.push({
        path: 'verification_plan.verification_capability_id',
        message: `verification capability must be '${capability.verification_capability}' per the capability contract`,
      });
    } else if (!lookup(plan.verification_plan.verification_capability_id)) {
      issues.push({
        path: 'verification_plan.verification_capability_id',
        message: `verification capability '${plan.verification_plan.verification_capability_id}' not found in registry`,
      });
    }
  }

  // Rollback binding (2.1).
  if (plan.rollback_plan) {
    if (!capability.rollback_capability) {
      issues.push({
        path: 'rollback_plan',
        message: 'plan carries a rollback_plan but the capability declares no rollback_capability',
      });
    } else if (plan.rollback_plan.rollback_capability_id !== capability.rollback_capability) {
      issues.push({
        path: 'rollback_plan.rollback_capability_id',
        message: `rollback capability must be '${capability.rollback_capability}' per the capability contract`,
      });
    } else if (!lookup(plan.rollback_plan.rollback_capability_id)) {
      issues.push({
        path: 'rollback_plan.rollback_capability_id',
        message: `rollback capability '${plan.rollback_plan.rollback_capability_id}' not found in registry`,
      });
    }
  }

  if (EXECUTABLE_PLAN_STATES.includes(plan.state)) {
    const assessment = assessEvidenceCoverage(capability.required_evidence, plan.evidence_coverage_snapshot);
    if (!assessment.mandatory_satisfied) {
      issues.push({
        path: 'evidence_coverage_snapshot',
        message: `mandatory evidence not satisfied for executable state: ${assessment.missing_mandatory.join(', ')}`,
      });
    }
  }

  return issues;
}

export type { AuthorityLevel, RiskLevel, SideEffectClass, VerificationRequirement };
