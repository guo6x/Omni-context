/**
 * ExecutionPlan and evidence/approval/risk snapshot contracts (Goal24 Checkpoint 2).
 *
 * The ExecutionPlan is the only formal handoff between Decision / Evidence /
 * Approval and Adapter execution. It must never carry shell strings or
 * executable command templates; adapters build argv from capability_id +
 * normalized_inputs only.
 */

import { z } from 'zod';
import {
  AUTHORITY_LEVELS,
  CAPABILITY_ID_PATTERN,
  EVIDENCE_CLASS_PATTERN,
  RISK_LEVELS,
  SEMVER_PATTERN,
  SIDE_EFFECT_CLASSES,
  type AuthorityLevel,
  type CapabilityDefinition,
  type EvidenceRequirement,
  type RiskLevel,
  type SideEffectClass,
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

export const EVIDENCE_STATUSES = ['present', 'missing', 'stale', 'conflicted', 'unverified'] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const PLAN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;
export const ADAPTER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const TIMEOUT_MIN_MS = 100;
export const TIMEOUT_MAX_MS = 86_400_000; // 24 hours

/**
 * Reserved key names that must never appear in a plan's normalized_inputs.
 * Inputs are semantic parameters; a key such as `shell` or `command` is not
 * a semantic input and is rejected at the contract boundary.
 */
export const FORBIDDEN_INPUT_KEYS = ['shell', 'command', 'exec', 'bash', 'powershell', 'cmd', 'cmdline', 'script'] as const;

// ---------------------------------------------------------------------------
// Risk snapshot
// ---------------------------------------------------------------------------

/**
 * Frozen risk/authority view captured when the plan was created. The adapter
 * must not re-derive risk at execution time; audits use this snapshot.
 */
export const RiskSnapshotSchema = z.strictObject({
  risk_level: z.enum(RISK_LEVELS),
  reversible: z.boolean(),
  side_effect_class: z.enum(SIDE_EFFECT_CLASSES),
  required_authority: z.enum(AUTHORITY_LEVELS),
  capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic').optional(),
});
export type RiskSnapshot = z.infer<typeof RiskSnapshotSchema>;

// ---------------------------------------------------------------------------
// Evidence coverage snapshot
// ---------------------------------------------------------------------------

export const EvidenceCoverageEntrySchema = z
  .strictObject({
    evidence_class: z.string().regex(EVIDENCE_CLASS_PATTERN, 'evidence_class must be a dotted identifier'),
    status: z.enum(EVIDENCE_STATUSES),
    evidence_ids: z.array(z.string().trim().min(1).max(500)).max(1000),
    checked_at: IsoTimestampSchema,
    stale_since: IsoTimestampSchema.optional(),
    conflict_evidence_ids: z.array(z.string().trim().min(1).max(500)).max(1000).optional(),
    note: z.string().max(2000).optional(),
  })
  .superRefine((entry, ctx) => {
    if (new Set(entry.evidence_ids).size !== entry.evidence_ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence_ids must not contain duplicates', path: ['evidence_ids'] });
    }
    if (entry.conflict_evidence_ids && new Set(entry.conflict_evidence_ids).size !== entry.conflict_evidence_ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'conflict_evidence_ids must not contain duplicates', path: ['conflict_evidence_ids'] });
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
 * Approval grant record (schema only). Enforcement (token verification,
 * cryptography) is a later checkpoint; required_approval=true plans must carry
 * an approval_token before entering an executable state.
 */
export const ApprovalReferenceSchema = z.strictObject({
  approval_id: z.string().trim().min(1).max(200),
  plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
  granted_by: z.string().trim().min(1).max(200),
  granted_at: IsoTimestampSchema,
  token: z.string().trim().min(1).max(500),
  policy_version: z.string().trim().min(1).max(50).optional(),
});
export type ApprovalReference = z.infer<typeof ApprovalReferenceSchema>;

// ---------------------------------------------------------------------------
// Verification / rollback plans
// ---------------------------------------------------------------------------

export const VerificationPlanSchema = z.strictObject({
  verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'verification_capability_id must be a capability id'),
  /** Normalized mapping from verification capability inputs to values. */
  verification_inputs: z.record(z.unknown()),
  description: z.string().max(2000).optional(),
});
export type VerificationPlan = z.infer<typeof VerificationPlanSchema>;

export const RollbackPlanSchema = z.strictObject({
  rollback_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'rollback_capability_id must be a capability id'),
  /** Normalized mapping from rollback capability inputs to values. */
  rollback_inputs: z.record(z.unknown()),
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
    normalized_inputs: z.record(z.unknown()),
    required_approval: z.boolean(),
    approval_token: z.string().trim().min(1).max(500).optional(),
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
        addIssue(`normalized_inputs must not contain a reserved key '${forbidden}'`, ['normalized_inputs', forbidden]);
      }
    }

    if (plan.state === 'awaiting_approval' && !plan.required_approval) {
      addIssue('state=awaiting_approval requires required_approval=true', ['state']);
    }

    if (EXECUTABLE_PLAN_STATES.includes(plan.state) && plan.required_approval && !plan.approval_token) {
      addIssue('executable plan with required_approval=true must carry an approval_token', ['approval_token']);
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

export interface CoverageAssessmentEntry {
  class_id: string;
  status: EvidenceStatus | 'not_checked';
  satisfied: boolean;
}

export interface CoverageAssessment {
  entries: CoverageAssessmentEntry[];
  mandatory_satisfied: boolean;
  missing_mandatory: string[];
}

/**
 * Assess a coverage snapshot against evidence requirements. An entry is
 * satisfied only when its status is `present`. This is contract logic for
 * the future Evidence Surface Guard; no retrieval happens here.
 */
export function assessEvidenceCoverage(
  requirements: readonly EvidenceRequirement[],
  coverage: EvidenceCoverageSnapshot,
): CoverageAssessment {
  const byClass = new Map(coverage.entries.map((entry) => [entry.evidence_class, entry]));
  const missingMandatory: string[] = [];
  const entries: CoverageAssessmentEntry[] = requirements.map((requirement) => {
    const entry = byClass.get(requirement.class_id);
    if (!entry) {
      if (requirement.mandatory) missingMandatory.push(requirement.class_id);
      return { class_id: requirement.class_id, status: 'not_checked', satisfied: false };
    }
    const satisfied = entry.status === 'present';
    if (requirement.mandatory && !satisfied) missingMandatory.push(requirement.class_id);
    return { class_id: requirement.class_id, status: entry.status, satisfied };
  });
  return {
    entries,
    mandatory_satisfied: missingMandatory.length === 0,
    missing_mandatory: missingMandatory,
  };
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
 * This check cannot live inside the Zod schema because the schema is
 * standalone; the registry lookup is injected (no Registry runtime exists in
 * this checkpoint). Checks: capability existence, version match, risk-snapshot
 * equality with the capability declaration, and mandatory evidence coverage
 * for executable states.
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

  if (capability.version !== plan.capability_version) {
    issues.push({
      path: 'capability_version',
      message: `plan capability_version '${plan.capability_version}' does not match capability version '${capability.version}'`,
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

  if (EXECUTABLE_PLAN_STATES.includes(plan.state)) {
    const requirements: EvidenceRequirement[] = capability.required_evidence_classes.map((classId) => ({
      class_id: classId,
      mandatory: true,
    }));
    const assessment = assessEvidenceCoverage(requirements, plan.evidence_coverage_snapshot);
    if (!assessment.mandatory_satisfied) {
      issues.push({
        path: 'evidence_coverage_snapshot',
        message: `mandatory evidence not satisfied for executable state: ${assessment.missing_mandatory.join(', ')}`,
      });
    }
  }

  return issues;
}

export type { AuthorityLevel, RiskLevel, SideEffectClass };
