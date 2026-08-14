/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome error taxonomy.
 *
 * Outcome errors are stable, machine-readable codes. They deliberately never
 * carry secrets, raw observation payloads or execution output text; business
 * semantics live in the code, not in exception messages.
 */

export const OUTCOME_ERROR_CODES = [
  'OUTCOME_INPUT_INVALID',
  'OUTCOME_RECEIPT_UNAVAILABLE',
  'OUTCOME_RECEIPT_INVALID',
  'OUTCOME_OBSERVATION_UNAVAILABLE',
  'OUTCOME_OBSERVATION_INVALID',
  'OUTCOME_NOT_FOUND',
  'OUTCOME_CONTEXT_UNAVAILABLE',
  'OUTCOME_EVALUATOR_NOT_FOUND',
  'OUTCOME_EXPECTATION_CHANGED',
  'OUTCOME_SUBJECT_MISMATCH',
  'OUTCOME_PLAN_MISMATCH',
  'OUTCOME_RECEIPT_MISMATCH',
  'OUTCOME_VERIFICATION_CAPABILITY_MISMATCH',
  'OUTCOME_ATTEMPT_MISMATCH',
  'OUTCOME_ATTEMPTS_EXHAUSTED',
  'OUTCOME_VERIFICATION_NOT_REQUIRED',
  'OUTCOME_TRANSITION_INVALID',
  'OUTCOME_STORE_CORRUPT',
  'OUTCOME_DUPLICATE_RECORD',
] as const;
export type OutcomeErrorCode = (typeof OUTCOME_ERROR_CODES)[number];

/**
 * Stable reason codes recorded on verification attempts. The required CP8 set
 * is present verbatim; READBACK_UNSUPPORTED is the only addition (parser
 * status `unsupported` fails closed to verification_failed).
 */
export const OUTCOME_REASON_CODES = [
  'OUTCOME_VERIFIED',
  'OUTCOME_MISMATCH',
  'OUTCOME_INCONCLUSIVE',
  'READBACK_NOT_AVAILABLE',
  'READBACK_MALFORMED',
  'READBACK_TRUNCATED',
  'READBACK_UNSUPPORTED',
  'OUTCOME_SUBJECT_MISMATCH',
  'OUTCOME_PLAN_MISMATCH',
  'OUTCOME_RECEIPT_MISMATCH',
  'OUTCOME_VERIFICATION_CAPABILITY_MISMATCH',
  'OUTCOME_EVALUATOR_NOT_FOUND',
  'OUTCOME_EXPECTATION_CHANGED',
  'OUTCOME_STORE_CORRUPT',
] as const;
export type OutcomeReasonCode = (typeof OUTCOME_REASON_CODES)[number];

export class OutcomeError extends Error {
  readonly code: OutcomeErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: OutcomeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'OutcomeError';
    this.code = code;
    this.details = details;
  }
}
