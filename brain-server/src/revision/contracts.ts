/**
 * Goal27 persistent decision-revision contracts.
 *
 * A revision is a new immutable judgment, not a mutation, retry, rollback or
 * replay of the historical decision.  The strict schemas below intentionally
 * omit approval grants, bearer tokens, native bridge material and raw store
 * paths.
 */

import { z } from 'zod';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import { RiskSnapshotSchema, EvidenceCoverageSnapshotSchema } from '../execution/contracts.js';
import { SHA256_HEX_PATTERN } from '../evidence/model.js';
import { DECISION_DISPOSITIONS } from '../decision/kernel.js';

export const REVISION_TRIGGER_TYPES = [
  'OUTCOME_MISMATCH',
  'OUTCOME_INCONCLUSIVE',
  'OWNER_RECONSIDERATION',
] as const;
export type RevisionTriggerType = (typeof REVISION_TRIGGER_TYPES)[number];

export const REVISION_STATUSES = ['OPEN', 'DECIDED', 'ABANDONED'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_EVENT_TYPES = [
  'REOPEN_REQUESTED',
  'REOPEN_AUTHORIZED',
  'REVISION_CREATED',
  'EVIDENCE_REQUALIFIED',
  'REVISION_DECIDED',
  'REVISION_ABANDONED',
] as const;
export type RevisionEventType = (typeof REVISION_EVENT_TYPES)[number];

/**
 * Read paths are intentionally bounded.  A long-lived root can accumulate
 * many immutable revisions, but an Agent or renderer must never turn that
 * history into an unbounded store-export channel.
 */
export const REVISION_PROJECTION_HISTORY_LIMIT = 50;
export const REVISION_PROJECTION_EVIDENCE_DELTA_LIMIT = 50;
export const REVISION_PROJECTION_REASON_CODE_LIMIT = 50;

const DecisionIdSchema = z.string().trim().min(1).max(200);
const RevisionIdSchema = z.string().regex(/^rev-[A-Za-z0-9_-]{8,200}$/, 'revision_id must be a core-generated revision id');
const IsoTimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(SHA256_HEX_PATTERN, 'must be a lowercase SHA-256 hex digest');

/**
 * Reason text is human-readable audit metadata, not an instruction channel.
 * Reject controls and Unicode format characters rather than silently
 * normalising a potentially deceptive reason into a different statement.
 */
export const RevisionReasonSchema = z.string().trim().min(1).max(1000).superRefine((value, ctx) => {
  if (Buffer.byteLength(value, 'utf8') > 4096) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reason exceeds 4096 UTF-8 bytes' });
  }
  if (/[\p{Cc}\p{Cf}]/u.test(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'reason must not contain control or format characters' });
  }
});

export const RevisionOutcomeSnapshotSchema = z.strictObject({
  outcome_id: z.string().trim().min(1).max(200).nullable(),
  verification_status: z.enum(['not_required', 'pending', 'verified', 'mismatch', 'inconclusive', 'verification_failed']).nullable(),
  revisit_required: z.boolean(),
  execution_receipt_id: z.string().trim().min(1).max(200).nullable(),
  receipt_digest: DigestSchema.nullable(),
  expected_outcome_digest: DigestSchema.nullable(),
  latest_observation_digest: DigestSchema.nullable(),
  observation_id: z.string().trim().min(1).max(200).nullable(),
  expected_state: JsonObjectSchema.nullable(),
  trusted_observed_state: JsonObjectSchema.nullable(),
  reason_codes: z.array(z.string().trim().min(1).max(200)).max(50),
});
export type RevisionOutcomeSnapshot = z.infer<typeof RevisionOutcomeSnapshotSchema>;

export const OriginalDecisionSnapshotSchema = z.strictObject({
  decision_id: DecisionIdSchema,
  disposition: z.literal('DECIDE'),
  plan: z.strictObject({
    plan_id: z.string().trim().min(1).max(200),
    plan_semantics_digest: DigestSchema,
    capability_id: z.string().trim().min(1).max(200),
    capability_version: z.string().trim().min(1).max(100),
    adapter_id: z.string().trim().min(1).max(200),
    normalized_inputs_digest: DigestSchema,
    risk_snapshot: RiskSnapshotSchema,
    state: z.string().trim().min(1).max(100),
    approval_reference_id: z.string().trim().min(1).max(200).nullable(),
    approval_request_id: z.string().trim().min(1).max(200).nullable(),
  }),
  evidence: z.strictObject({
    guard_run_id: z.string().trim().min(1).max(200),
    coverage_snapshot: EvidenceCoverageSnapshotSchema,
    coverage_digest: DigestSchema,
    qualified_evidence_ids: z.array(DigestSchema).max(2000),
  }),
  outcome: RevisionOutcomeSnapshotSchema,
});
export type OriginalDecisionSnapshot = z.infer<typeof OriginalDecisionSnapshotSchema>;

export const CurrentEvidenceSnapshotSchema = z.strictObject({
  guard_run_id: z.string().trim().min(1).max(200),
  action: z.enum(['proceed', 'retrieve_more', 'clarify', 'defer', 'block']),
  subject_key: z.string().trim().min(1).max(200),
  coverage_snapshot: EvidenceCoverageSnapshotSchema,
  coverage_digest: DigestSchema,
  qualified_evidence_ids: z.array(DigestSchema).max(2000),
  reason_codes: z.array(z.string().trim().min(1).max(200)).max(100),
});
export type CurrentEvidenceSnapshot = z.infer<typeof CurrentEvidenceSnapshotSchema>;

export const EvidenceDeltaEntrySchema = z.strictObject({
  evidence_class: z.string().trim().min(1).max(200),
  category: z.enum(['UNCHANGED', 'NEW', 'STALE_NOW', 'CONFLICTED_NOW', 'MISSING_NOW', 'QUALIFICATION_CHANGED']),
  original_status: z.string().trim().min(1).max(100).nullable(),
  current_status: z.string().trim().min(1).max(100).nullable(),
  original_evidence_ids: z.array(DigestSchema).max(2000),
  current_evidence_ids: z.array(DigestSchema).max(2000),
});
export type EvidenceDeltaEntry = z.infer<typeof EvidenceDeltaEntrySchema>;

/**
 * The projection exposes classification only.  Evidence identifiers belong in
 * the immutable server-side context and are never sent to Agent Pilot or the
 * Desktop renderer merely to render a delta summary.
 */
export const RevisionEvidenceDeltaSummarySchema = z.strictObject({
  evidence_class: z.string().trim().min(1).max(200),
  category: z.enum(['UNCHANGED', 'NEW', 'STALE_NOW', 'CONFLICTED_NOW', 'MISSING_NOW', 'QUALIFICATION_CHANGED']),
  original_status: z.string().trim().min(1).max(100).nullable(),
  current_status: z.string().trim().min(1).max(100).nullable(),
});
export type RevisionEvidenceDeltaSummary = z.infer<typeof RevisionEvidenceDeltaSummarySchema>;

export const DecisionRevisionContextSchema = z.strictObject({
  root_decision_id: DecisionIdSchema,
  parent_decision_id: DecisionIdSchema,
  original: OriginalDecisionSnapshotSchema,
  trigger: z.strictObject({
    trigger_type: z.enum(REVISION_TRIGGER_TYPES),
    trigger_outcome_id: z.string().trim().min(1).max(200).nullable(),
    trigger_reason: RevisionReasonSchema,
  }),
  current_evidence: CurrentEvidenceSnapshotSchema,
  evidence_delta: z.array(EvidenceDeltaEntrySchema).max(200),
  decision_kernel_id: z.string().trim().min(1).max(200),
});
export type DecisionRevisionContext = z.infer<typeof DecisionRevisionContextSchema>;

export const DecisionRevisionRecordSchema = z.strictObject({
  revision_id: RevisionIdSchema,
  root_decision_id: DecisionIdSchema,
  parent_decision_id: DecisionIdSchema,
  revision_index: z.number().int().min(1).max(100_000),
  trigger_type: z.enum(REVISION_TRIGGER_TYPES),
  trigger_outcome_id: z.string().trim().min(1).max(200).nullable(),
  trigger_reason: RevisionReasonSchema,
  requested_by: z.string().trim().min(1).max(200),
  authorized_by: z.string().trim().min(1).max(200),
  opened_at: IsoTimestampSchema,
  status: z.enum(REVISION_STATUSES),
  revision_context_digest: DigestSchema,
  context: DecisionRevisionContextSchema,
  new_decision_id: DecisionIdSchema.nullable(),
  new_disposition: z.enum(DECISION_DISPOSITIONS).nullable(),
  new_plan_id: z.string().trim().min(1).max(200).nullable(),
  resolved_at: IsoTimestampSchema.nullable(),
  idempotency_digest: DigestSchema,
}).superRefine((record, ctx) => {
  if (record.context.root_decision_id !== record.root_decision_id || record.context.parent_decision_id !== record.parent_decision_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'context root/parent links must match record links', path: ['context'] });
  }
  if (record.context.original.decision_id !== record.parent_decision_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'the immutable source judgment must remain the parent decision being revised', path: ['context', 'original', 'decision_id'] });
  }
  if (record.context.trigger.trigger_type !== record.trigger_type || record.context.trigger.trigger_outcome_id !== record.trigger_outcome_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'context trigger must match record trigger', path: ['context', 'trigger'] });
  }
  if (record.status === 'DECIDED') {
    if (!record.new_decision_id || !record.new_disposition || !record.resolved_at) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DECIDED revisions require a new decision, disposition and resolved_at', path: ['status'] });
    }
    if (record.new_disposition === 'DECIDE' && !record.new_plan_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DECIDE revisions require a new plan id', path: ['new_plan_id'] });
    }
    if (record.new_disposition === 'DECIDE' && record.new_plan_id === record.context.original.plan.plan_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a revised DECIDE judgment must never reuse the historical plan id', path: ['new_plan_id'] });
    }
    if (record.new_disposition !== 'DECIDE' && record.new_plan_id !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'non-DECIDE revisions must not retain a plan id', path: ['new_plan_id'] });
    }
  }
  if (record.status !== 'DECIDED' && (record.new_decision_id || record.new_disposition || record.new_plan_id || record.resolved_at)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'unresolved revisions must not carry resolved decision fields', path: ['status'] });
  }
});
export type DecisionRevisionRecord = z.infer<typeof DecisionRevisionRecordSchema>;

export const DecisionRevisionEventSchema = z.strictObject({
  revision_id: RevisionIdSchema,
  event_type: z.enum(REVISION_EVENT_TYPES),
  created_at: IsoTimestampSchema,
  payload: z.strictObject({
    root_decision_id: DecisionIdSchema,
    parent_decision_id: DecisionIdSchema,
    revision_index: z.number().int().min(1).max(100_000),
    trigger_type: z.enum(REVISION_TRIGGER_TYPES),
    disposition: z.enum(DECISION_DISPOSITIONS).nullable(),
    new_decision_id: DecisionIdSchema.nullable(),
  }),
});
export type DecisionRevisionEvent = z.infer<typeof DecisionRevisionEventSchema>;

/** The only public control request shape; caller-supplied root/parent/index/trigger are forbidden. */
export const ReopenControlRequestSchema = z.strictObject({
  decision_id: DecisionIdSchema,
  reason: RevisionReasonSchema.optional(),
  outcome_id: z.string().trim().min(1).max(200).optional(),
});
export type ReopenControlRequest = z.infer<typeof ReopenControlRequestSchema>;

/** Immutable, bounded chain view. It deliberately omits evidence payloads,
 * plan inputs, approval material, receipt internals and native bridge data. */
export const RevisionHistoryEntrySchema = z.strictObject({
  revision_id: RevisionIdSchema,
  revision_index: z.number().int().min(1).max(100_000),
  parent_decision_id: DecisionIdSchema,
  new_decision_id: DecisionIdSchema,
  trigger_type: z.enum(REVISION_TRIGGER_TYPES),
  status: z.enum(REVISION_STATUSES),
  new_disposition: z.enum(DECISION_DISPOSITIONS),
  opened_at: IsoTimestampSchema,
  resolved_at: IsoTimestampSchema,
  revision_context_digest: DigestSchema,
});
export type RevisionHistoryEntry = z.infer<typeof RevisionHistoryEntrySchema>;

/** Bounded read-only chain projection safe for Agent Pilot and Desktop renderer use. */
export const DecisionRevisionProjectionSchema = z.strictObject({
  root_decision_id: DecisionIdSchema,
  original_decision_id: DecisionIdSchema,
  parent_decision_id: DecisionIdSchema,
  current_decision_id: DecisionIdSchema,
  revision_index: z.number().int().min(0).max(100_000),
  revision_count: z.number().int().min(0).max(100_000),
  revision_status: z.enum(REVISION_STATUSES).nullable(),
  trigger_type: z.enum(REVISION_TRIGGER_TYPES).nullable(),
  revisit_required: z.boolean(),
  reopen_recommended: z.boolean(),
  latest_outcome: z.enum(['not_required', 'pending', 'verified', 'mismatch', 'inconclusive', 'verification_failed']).nullable(),
  outcome_reason_codes: z.array(z.string().trim().min(1).max(200)).max(REVISION_PROJECTION_REASON_CODE_LIMIT),
  current_disposition: z.enum(DECISION_DISPOSITIONS).nullable(),
  new_plan_pending_approval: z.boolean().nullable(),
  evidence_delta_summary: z.array(RevisionEvidenceDeltaSummarySchema).max(REVISION_PROJECTION_EVIDENCE_DELTA_LIMIT),
  history_truncated: z.boolean(),
  history: z.array(RevisionHistoryEntrySchema).max(REVISION_PROJECTION_HISTORY_LIMIT),
});
export type DecisionRevisionProjection = z.infer<typeof DecisionRevisionProjectionSchema>;
