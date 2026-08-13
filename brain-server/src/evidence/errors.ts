/**
 * Goal24 Checkpoint 6 (Lane A) - Evidence Core error model.
 *
 * Every evidence-core failure carries a stable machine-readable code. The
 * codes are business semantics, never exception text: provider exception
 * messages are normalized to EVIDENCE_PROVIDER_ERROR without echoing the
 * original message, so provider/thrown text can never leak secrets or be
 * parsed for control flow.
 */

export const EVIDENCE_ERROR_CODES = [
  'EVIDENCE_INPUT_INVALID',
  'EVIDENCE_CLAIM_INVALID',
  'EVIDENCE_PROVIDER_ERROR',
  'EVIDENCE_PROVIDER_DUPLICATE',
  'EVIDENCE_PROVIDER_CLASS_MISMATCH',
  'EVIDENCE_PROVIDER_VERIFICATION_ESCALATION',
  'EVIDENCE_TIMESTAMP_INVALID',
  'EVIDENCE_COLLECTION_LIMIT_EXCEEDED',
  'EVIDENCE_COLLECTION_ABORTED',
] as const;
export type EvidenceErrorCode = (typeof EVIDENCE_ERROR_CODES)[number];

export class EvidenceError extends Error {
  readonly code: EvidenceErrorCode;

  constructor(code: EvidenceErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'EvidenceError';
    this.code = code;
  }
}