/**
 * Goal24 Checkpoint 7 (Integration) - immutable approval binding payload + digest.
 *
 * The binding digest is the anti-swap proof: everything approval must not
 * silently change (plan identity, decision identity, capability identity and
 * version, adapter, normalized inputs, risk snapshot, evidence coverage,
 * timeout, verification and rollback plans, created/expiry timestamps and the
 * policy version) is folded into one canonical payload and hashed.
 *
 * Cross-language contract (docs/goal24/cp7-approval-binding-contract.json):
 * the payload is the SAME 14-field object in TypeScript and Rust, and the
 * digest is SHA-256 over the canonical JSON of that object. The CP6 guard-run
 * id is intentionally NOT part of the cross-language binding: Brain owns
 * evidence qualification (EvidenceEligibilityService), the native Broker owns
 * approval/execution authority, and the current ExecutionPlan wire has no
 * guard_run_id field. The guard_run_id is retained Brain-side in
 * ApprovalRequestRecord.evidence_summary for audit/provenance only.
 *
 * Canonicalization is deterministic and shared with Rust:
 * - object keys sorted by UTF-16 code units (Rust mirrors this byte-for-byte),
 * - array order preserved,
 * - null semantics: optional values are explicit JSON null, never omitted,
 * - numbers: finite, |v| <= Number.MAX_SAFE_INTEGER, shortest fixed-point
 *   decimal form only (no exponent notation), at most 6 fractional digits,
 *   negative zero canonicalizes to 0; everything else fails closed.
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
  timeout_ms: number;
  verification_plan: VerificationPlan | null;
  rollback_plan: RollbackPlan | null;
  created_at: string;
  expires_at: string | null;
  policy_version: string;
}

const MAX_CANONICAL_NUMBER_ABS = Number.MAX_SAFE_INTEGER;
const MAX_CANONICAL_FRACTION_DIGITS = 6;
const MAX_CANONICAL_NUMBER_CHARS = 24;
const EXPONENT_PATTERN = /[eE]/;

/**
 * Cross-language canonical number domain (mirrored by Rust approval/digest.rs):
 * finite, within the safe-integer range, shortest fixed-point decimal form
 * without exponent notation, at most 6 fractional digits. Negative zero
 * canonicalizes to 0. Violations fail closed with APPROVAL_INPUT_INVALID.
 */
export function canonicalNumberString(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding numbers must be finite (NaN/Infinity rejected)');
  }
  if (Math.abs(value) > MAX_CANONICAL_NUMBER_ABS) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding numbers must not exceed Number.MAX_SAFE_INTEGER');
  }
  const text = value === 0 ? '0' : String(value);
  if (EXPONENT_PATTERN.test(text)) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding numbers must use fixed-point notation (no exponent)');
  }
  if (text.length > MAX_CANONICAL_NUMBER_CHARS) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding number representation exceeds the canonical bound');
  }
  const fraction = text.split('.')[1];
  if (fraction !== undefined && fraction.length > MAX_CANONICAL_FRACTION_DIGITS) {
    throw new ApprovalError('APPROVAL_INPUT_INVALID', 'binding numbers must have at most 6 fractional digits');
  }
  return text;
}

/** Fail-closed walk over every JSON number in a binding input value. */
export function assertBindingNumberDomain(value: unknown): void {
  if (typeof value === 'number') {
    canonicalNumberString(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertBindingNumberDomain(item);
    return;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      assertBindingNumberDomain((value as Record<string, unknown>)[key]);
    }
  }
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
 * fields are core-computed here; callers can never inject a digest. The
 * number domain is validated before any hashing so the Rust mirror can never
 * diverge from a plan that passed this builder.
 */
export function buildApprovalBindingPayload(inputs: ApprovalBindingInputs): ApprovalBindingPayload {
  assertBindingNumberDomain(inputs.normalized_inputs);
  assertBindingNumberDomain(inputs.risk_snapshot);
  assertBindingNumberDomain(inputs.evidence_coverage_snapshot);
  if (inputs.verification_plan !== null) assertBindingNumberDomain(inputs.verification_plan);
  if (inputs.rollback_plan !== null) assertBindingNumberDomain(inputs.rollback_plan);
  return ApprovalBindingPayloadSchema.parse({
    plan_id: inputs.plan_id,
    decision_id: inputs.decision_id,
    capability_id: inputs.capability_id,
    capability_version: inputs.capability_version,
    adapter_id: inputs.adapter_id,
    normalized_inputs_digest: normalizedInputsDigest(inputs.normalized_inputs),
    risk_snapshot_digest: digestJsonValue(inputs.risk_snapshot),
    evidence_coverage_digest: coverageDigest(inputs.evidence_coverage_snapshot),
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
 * change this digest). A plan without expires_at encodes explicit null in
 * the cross-language payload (documented canonical absent semantics).
 */
export function bindingPayloadForPlan(
  plan: ExecutionPlan,
  policyVersion: string,
): ApprovalBindingPayload {
  return buildApprovalBindingPayload({
    plan_id: plan.plan_id,
    decision_id: plan.decision_id,
    capability_id: plan.capability_id,
    capability_version: plan.capability_version,
    adapter_id: plan.adapter_id,
    normalized_inputs: plan.normalized_inputs,
    risk_snapshot: plan.risk_snapshot,
    evidence_coverage_snapshot: plan.evidence_coverage_snapshot,
    timeout_ms: plan.timeout_ms,
    verification_plan: plan.verification_plan,
    rollback_plan: plan.rollback_plan,
    created_at: plan.created_at,
    expires_at: plan.expires_at ?? null,
    policy_version: policyVersion,
  });
}
