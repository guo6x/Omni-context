/**
 * Goal24 Checkpoint 7 (Lane A) - Brain approval error model.
 *
 * Every approval failure carries a stable machine-readable code. Codes are
 * business semantics, never exception text: verifier failures are normalized
 * to APPROVAL_GRANT_INVALID without echoing native authority internals, and
 * evidence-materialization failures surface as APPROVAL_EVIDENCE_INELIGIBLE
 * with only the structured CP6 error code (no payload, no secret material).
 */

export const APPROVAL_ERROR_CODES = [
  'APPROVAL_INPUT_INVALID',
  'APPROVAL_CAPABILITY_NOT_FOUND',
  'APPROVAL_CAPABILITY_VERSION_MISMATCH',
  'APPROVAL_EVIDENCE_INELIGIBLE',
  'APPROVAL_PLAN_INVALID',
  'APPROVAL_POLICY_VERSION_MISMATCH',
  'APPROVAL_BINDING_MISMATCH',
  'APPROVAL_GRANT_INVALID',
  'APPROVAL_GRANT_EXPIRED',
  'APPROVAL_AUTHORITY_INSUFFICIENT',
  'APPROVAL_PLAN_MISMATCH',
  'APPROVAL_STATE_CONFLICT',
  'APPROVAL_REQUEST_NOT_PENDING',
  'APPROVAL_REQUEST_EXPIRED',
  'APPROVAL_PLAN_NOT_FOUND',
  'APPROVAL_STORE_CONFLICT',
  'APPROVAL_STORE_FULL',
  'APPROVAL_AUDIT_UNAVAILABLE',
] as const;
export type ApprovalErrorCode = (typeof APPROVAL_ERROR_CODES)[number];

export class ApprovalError extends Error {
  readonly code: ApprovalErrorCode;

  constructor(code: ApprovalErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'ApprovalError';
    this.code = code;
  }
}
