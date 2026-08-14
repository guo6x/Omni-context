/**
 * Goal24 Checkpoint 7 (Lane A) - Brain approval contracts.
 *
 * Fail-closed authorization contracts:
 *
 * - ExecutionAuthorizationRequest is strict: caller-supplied `required_approval`,
 *   `risk_snapshot`, `state`, `approval`, `evidence_coverage_snapshot` or
 *   `plan_id` (and any other unknown key) is rejected at parse time. All of
 *   those values are server-derived.
 * - TrustedApprovalActor can only be `owner` / `admin` with `source:
 *   trusted_local`. A model, skill, provider or untrusted API caller can
 *   never declare itself a trusted approval actor.
 * - ApprovalBindingPayload binds every execution semantic that must not
 *   change after approval; it deliberately excludes `state` and `approval`
 *   because awaiting_approval -> ready is a legal transition.
 * - The wire ApprovalReference (execution/contracts.ts) is kept compatible;
 *   CP7 fills its `token_digest` with the core-computed binding digest.
 */

import { z } from 'zod';
import {
  AUTHORITY_LEVELS,
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  SIDE_EFFECT_CLASSES,
} from '../capabilities/contracts.js';
import { JsonObjectSchema } from '../contracts/json-safe.js';
import {
  ADAPTER_ID_PATTERN,
  ExecutionPlanSchema,
  FORBIDDEN_INPUT_KEYS,
  PLAN_ID_PATTERN,
  RiskSnapshotSchema,
  RollbackPlanSchema,
  TIMEOUT_MAX_MS,
  TIMEOUT_MIN_MS,
  VerificationPlanSchema,
  type ApprovalReference,
  type ExecutionPlan,
  type RiskSnapshot,
} from '../execution/contracts.js';
import { SHA256_HEX_PATTERN } from '../evidence/model.js';

export const IsoTimestampSchema = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Approval lifecycle statuses
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = ['pending', 'granted', 'denied', 'revoked', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_ACTOR_KINDS = ['owner', 'admin'] as const;
export type ApprovalActorKind = (typeof APPROVAL_ACTOR_KINDS)[number];

// ---------------------------------------------------------------------------
// Trusted approval actor
// ---------------------------------------------------------------------------

/**
 * The only actor shapes that may grant an approval. `source` is a literal
 * `trusted_local`: anything else (model, skill, provider, untrusted API
 * caller) fails the strict schema. The actor never arrives over the
 * authorization request itself; it is supplied by the native grant verifier.
 */
export const TrustedApprovalActorSchema = z.strictObject({
  actor_id: z.string().trim().min(1).max(200),
  actor_kind: z.enum(['owner', 'admin']),
  authority_level: z.enum(AUTHORITY_LEVELS),
  source: z.literal('trusted_local'),
});
export type TrustedApprovalActor = z.infer<typeof TrustedApprovalActorSchema>;

// ---------------------------------------------------------------------------
// Authorization request (caller boundary)
// ---------------------------------------------------------------------------

/**
 * The only caller-supplied values are semantic request fields. Server-derived
 * authority (required_approval, risk_snapshot, state, approval, coverage,
 * plan_id, timestamps) has no key on this shape and strict parsing rejects
 * any request that carries one.
 */
export const ExecutionAuthorizationRequestSchema = z
  .strictObject({
    decision_id: z.string().trim().min(1).max(200),
    capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
    capability_version: z.string().regex(SEMVER_PATTERN, 'capability_version must be semantic (major.minor.patch)'),
    adapter_id: z.string().regex(ADAPTER_ID_PATTERN, 'adapter_id must be a lowercase implementation identifier'),
    normalized_inputs: JsonObjectSchema,
    guard_run_id: z.string().trim().min(1).max(200),
    timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
    verification_plan: VerificationPlanSchema.nullable(),
    rollback_plan: RollbackPlanSchema.nullable(),
    requested_by: z.string().trim().min(1).max(200).optional(),
    correlation_id: z.string().trim().min(1).max(200).optional(),
    expires_at: IsoTimestampSchema.optional(),
  })
  .superRefine((request, ctx) => {
    for (const forbidden of FORBIDDEN_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(request.normalized_inputs, forbidden)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `normalized_inputs must not contain a reserved top-level key '${forbidden}'`,
          path: ['normalized_inputs', forbidden],
        });
      }
    }
  });
export type ExecutionAuthorizationRequest = z.infer<typeof ExecutionAuthorizationRequestSchema>;

// ---------------------------------------------------------------------------
// Approval binding payload (immutable execution semantics)
// ---------------------------------------------------------------------------

/**
 * Canonical, strict payload bound to the approval. It carries digests of the
 * values that must not silently change after approval. `state` and `approval`
 * are intentionally absent: awaiting_approval -> ready is a legal transition.
 * Every digest field is a lowercase SHA-256 hex produced by the core.
 */
export const ApprovalBindingPayloadSchema = z.strictObject({
  plan_id: z.string().regex(PLAN_ID_PATTERN, 'plan_id must be a valid plan identifier'),
  decision_id: z.string().trim().min(1).max(200),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN),
  capability_version: z.string().regex(SEMVER_PATTERN),
  adapter_id: z.string().regex(ADAPTER_ID_PATTERN),
  normalized_inputs_digest: z.string().regex(SHA256_HEX_PATTERN, 'must be lowercase SHA-256 hex'),
  risk_snapshot_digest: z.string().regex(SHA256_HEX_PATTERN, 'must be lowercase SHA-256 hex'),
  evidence_coverage_digest: z.string().regex(SHA256_HEX_PATTERN, 'must be lowercase SHA-256 hex'),
  evidence_guard_run_id: z.string().trim().min(1).max(200),
  timeout_ms: z.number().int().min(TIMEOUT_MIN_MS).max(TIMEOUT_MAX_MS),
  verification_plan_digest: z.string().regex(SHA256_HEX_PATTERN).nullable(),
  rollback_plan_digest: z.string().regex(SHA256_HEX_PATTERN).nullable(),
  created_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  policy_version: z.string().trim().min(1).max(50),
});
export type ApprovalBindingPayload = z.infer<typeof ApprovalBindingPayloadSchema>;

// ---------------------------------------------------------------------------
// Approval request record (server-owned, no raw secrets)
// ---------------------------------------------------------------------------

export const ApprovalRequestRecordSchema = z.strictObject({
  approval_request_id: z.string().trim().min(1).max(200),
  plan_id: z.string().regex(PLAN_ID_PATTERN),
  decision_id: z.string().trim().min(1).max(200),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN),
  capability_version: z.string().regex(SEMVER_PATTERN),
  risk_snapshot: RiskSnapshotSchema,
  side_effect_summary: z.strictObject({
    side_effect_class: z.enum(SIDE_EFFECT_CLASSES),
    reversible: z.boolean(),
  }),
  reversible: z.boolean(),
  evidence_summary: z.strictObject({
    guard_run_id: z.string().trim().min(1).max(200),
    coverage_digest: z.string().regex(SHA256_HEX_PATTERN),
    mandatory_classes: z.array(z.string().trim().min(1).max(200)).max(100),
    mandatory_satisfied: z.boolean(),
  }),
  coverage_digest: z.string().regex(SHA256_HEX_PATTERN),
  normalized_inputs_digest: z.string().regex(SHA256_HEX_PATTERN),
  approval_binding_digest: z.string().regex(SHA256_HEX_PATTERN),
  required_authority: z.enum(AUTHORITY_LEVELS),
  policy_version: z.string().trim().min(1).max(50),
  created_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  status: z.enum(APPROVAL_STATUSES),
});
export type ApprovalRequestRecord = z.infer<typeof ApprovalRequestRecordSchema>;

// ---------------------------------------------------------------------------
// Verified native grant
// ---------------------------------------------------------------------------

export const VerifiedGrantSchema = z.strictObject({
  actor: TrustedApprovalActorSchema,
  authority: z.enum(AUTHORITY_LEVELS),
  granted_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  native_record_id: z.string().trim().min(1).max(200),
});
export type VerifiedGrant = z.infer<typeof VerifiedGrantSchema>;

export const VerifiedGrantRecordSchema = z.strictObject({
  actor: TrustedApprovalActorSchema,
  granted_at: IsoTimestampSchema,
  expires_at: IsoTimestampSchema,
  native_record_id: z.string().trim().min(1).max(200),
});
export type VerifiedGrantRecord = z.infer<typeof VerifiedGrantRecordSchema>;

// ---------------------------------------------------------------------------
// Native grant verifier abstraction
// ---------------------------------------------------------------------------

export interface ApprovalGrantVerifierRequest {
  plan: ExecutionPlan;
  approval_reference: ApprovalReference;
  approval_binding_digest: string;
}

export type ApprovalGrantVerificationResult =
  | { valid: true; grant: VerifiedGrant }
  | { valid: false; reason?: string };

/**
 * Brain never treats a structurally-valid ApprovalReference as a grant on its
 * own. A bare reference (approval_id / token_reference / token_digest) is
 * only honored after this injected internal verifier confirms a real native
 * grant. Lane A tests use fakes; integration wires the Lane B native
 * authority.
 */
export interface ApprovalGrantVerifier {
  verifyGrant(
    request: ApprovalGrantVerifierRequest,
  ): ApprovalGrantVerificationResult | Promise<ApprovalGrantVerificationResult>;
}

// ---------------------------------------------------------------------------
// Server-owned authorization store record
// ---------------------------------------------------------------------------

export const PlanAuthorizationRecordSchema = z.strictObject({
  plan: ExecutionPlanSchema,
  guard_run_id: z.string().trim().min(1).max(200),
  approval_request_id: z.string().trim().min(1).max(200).nullable(),
  approval_request: ApprovalRequestRecordSchema.nullable(),
  approval_binding_digest: z.string().regex(SHA256_HEX_PATTERN),
  grant: VerifiedGrantRecordSchema.nullable(),
  blocked_reason: z.string().max(2000).nullable(),
});
export type PlanAuthorizationRecord = z.infer<typeof PlanAuthorizationRecordSchema>;

export type { ApprovalReference, ExecutionPlan, RiskSnapshot };