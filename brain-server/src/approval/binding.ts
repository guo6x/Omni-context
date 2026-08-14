/**
 * Goal24 Checkpoint 7 (Lane A) - immutable approval binding payload + digest.
 *
 * The binding digest is the anti-swap proof: everything approval must not
 * silently change (capability identity/version, adapter, normalized inputs,
 * risk snapshot, evidence coverage + guard-run lineage, timeout, verification
 * and rollback plans, decision identity, created/expiry and policy version)
 * is folded into one canonical payload and hashed.
 *
 * Canonicalization is deterministic: object keys stably sorted, array order
 * preserved, non-JSON-safe values rejected. Ordinary object insertion order
 * is never treated as canonicalization.
 */

import type { JsonObject } from '../contracts/json-safe.js';
import {
  type EvidenceCoverageSnapshot,
  type ExecutionPlan,
  type RiskSnapshot,
  type RollbackPlan,
  type VerificationPlan,
} from '../execution/contracts.js';
import {
  canonicalJson,
  coverageDigest,
  EvidenceError,
  normalizedInputsDigest,
  sha256Hex,
} from '../evidence/index.js';
import {
  ApprovalBindingPayloadSchema,
  type ApprovalBindingPayload,
} from './contracts.js';
import { ApprovalError } from './errors.js';

export interface ApprovalBindingInputs {
  plan_id: string;
  decision_id: string;
  capability_id: string;
  capability_version: string;
  adapter_id: string;
  normalized_inputs: JsonObject;
  risk_snapshot: RiskSnapshot;
  evidence_coverage_snapshot: EvidenceCoverageSnapshot;
  evidence_guard_run_id: string;
  timeout_ms: number;
  verification_plan: VerificationPlan | null;
  rollback_plan: RollbackPlan | null;
  created_at: string;
  expires_at: string;
  policy_version: string;
}

/**
 * Canonical SHA-256 digest of an already-JSON-safe semantic value (risk
 * snapshot, verification plan, rollback plan). Non-JSON-safe input is
 * rejected, never coerced.
 */
export function digestJsonValue(value: unknown): string {
  try {
    return sha256Hex(canonicalJson(value));
  } catch (error) {
    if (error instanceof EvidenceError) {
      throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding value is not JSON-safe');
    }
    throw error;
  }
}

/**
 * Build the strict ApprovalBindingPayload from plan semantics. All digest
 * fields are core-computed here; callers can never inject a digest.
 */
export function buildApprovalBindingPayload(inputs: ApprovalBindingInputs): ApprovalBindingPayload {
  return ApprovalBindingPayloadSchema.parse({
    plan_id: inputs.plan_id,
    decision_id: inputs.decision_id,
    capability_id: inputs.capability_id,
    capability_version: inputs.capability_version,
    adapter_id: inputs.adapter_id,
    normalized_inputs_digest: normalizedInputsDigest(inputs.normalized_inputs),
    risk_snapshot_digest: digestJsonValue(inputs.risk_snapshot),
    evidence_coverage_digest: coverageDigest(inputs.evidence_coverage_snapshot),
    evidence_guard_run_id: inputs.evidence_guard_run_id,
    timeout_ms: inputs.timeout_ms,
    verification_plan_digest:
      inputs.verification_plan === null ? null : digestJsonValue(inputs.verification_plan),
    rollback_plan_digest:
      inputs.rollback_plan === null ? null : digestJsonValue(inputs.rollback_plan),
    created_at: inputs.created_at,
    expires_at: inputs.expires_at,
    policy_version: inputs.policy_version,
  });
}

/** Canonical deterministic JSON (stable key sort) + SHA-256 lowercase hex. */
export function approvalBindingDigest(payload: ApprovalBindingPayload): string {
  const parsed = ApprovalBindingPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApprovalError(
      'APPROVAL_INPUT_INVALID',
      `approval binding payload is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return sha256Hex(canonicalJson(parsed.data));
}

/**
 * Recompute the binding payload for a stored plan. Used by applyApproval to
 * prove the stored plan semantics did not mutate after authorization (input
 * swap, coverage swap, risk downgrade, adapter/timeout/plan mutations all
 * change this digest).
 */
export function bindingPayloadForPlan(
  plan: ExecutionPlan,
  evidenceGuardRunId: string,
  policyVersion: string,
): ApprovalBindingPayload {
  if (!plan.expires_at) {
    throw new ApprovalError(
      'APPROVAL_INPUT_INVALID',
      `plan '${plan.plan_id}' has no expires_at; CP7 authorization plans are always expiry-bounded`,
    );
  }
  return buildApprovalBindingPayload({
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs: plan.normalized_inputs,
    risk_snapshot: plan.risk_snapshot,
    evidence_coverage_snapshot: plan.evidence_coverage_snapshot,
    evidence_guard_run_id: evidenceGuardRunId,
    timeout_ms: plan.timeout_ms,
    verification_plan: plan.verification_plan,
    rollback_plan: plan.rollback_plan,
    created_at: plan.created_at,
    expires_at: plan.expires_at,
    policy_version: policyVersion,
  });
}