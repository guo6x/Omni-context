/**
 * Goal24 Checkpoint 8 (Lane A) - Outcome lifecycle transitions.
 *
 * Pure lifecycle rules:
 *
 * - Execution success is NOT a verified outcome. For any
 *   side_effect_class != read_only, even `process_succeeded` leaves the
 *   outcome `pending` until a trusted read-back verifies the post-state.
 * - Ambiguous execution (timed_out / cancelled / process_failed after spawn /
 *   unknown_after_crash) defaults to `pending` with read-back required: the
 *   external effect may have partially or fully occurred.
 * - `not_started` (trusted native receipt proves no spawn) implies no
 *   external effect: verification is not required.
 * - read_only capabilities default to `not_required` in CP8 V1.
 * - Attempts are bounded (max 5, V1 default 3): pending -> attempt -> pending
 *   retry -> ... -> final mismatch / inconclusive / verification_failed.
 * - Revisit is only required for terminal bad states, never for pending.
 * - rollback_candidate is a boolean eligibility flag only; CP8 never
 *   executes, spawns, approves or plans a rollback.
 */

import {
  OUTCOME_ID_PATTERN,
  OutcomeRecordSchema,
  VERIFICATION_STATUSES,
  type ExecutionEffectState,
  type OutcomeRecord,
  type VerificationStatus,
} from './contracts.js';
import { OutcomeError } from './errors.js';
import { canonicalJson } from '../evidence/model.js';

export const DEFAULT_MAX_VERIFICATION_ATTEMPTS = 3;
export const MAX_VERIFICATION_ATTEMPTS_BOUND = 5;

// ---------------------------------------------------------------------------
// Initial verification status
// ---------------------------------------------------------------------------

/**
 * Map execution knowledge to the initial verification status. This function
 * never consults exit_code or success flags: they cannot verify anything.
 */
export function initialVerificationStatus(
  sideEffectClass: string,
  executionEffectState: ExecutionEffectState,
): VerificationStatus {
  if (sideEffectClass === 'read_only') return 'not_required';
  if (executionEffectState === 'not_started') return 'not_required';
  // spawn_started / process_succeeded / process_failed / timed_out / cancelled
  // / unknown_after_crash: an external effect may exist -> read-back required.
  return 'pending';
}

// ---------------------------------------------------------------------------
// Revisit + rollback eligibility
// ---------------------------------------------------------------------------

/** Revisit signal derivation. `pending` is awaiting verification, not a failure. */
export function deriveRevisitRequired(verificationStatus: VerificationStatus): boolean {
  switch (verificationStatus) {
    case 'verified':
    case 'not_required':
    case 'pending':
      return false;
    case 'mismatch':
    case 'inconclusive':
    case 'verification_failed':
      return true;
  }
}

/**
 * Rollback eligibility: mismatch AND a rollback plan exists AND the risk
 * snapshot declares the action reversible. This only produces a boolean
 * candidate flag; CP8 never executes a rollback.
 */
export function deriveRollbackCandidate(options: {
  verificationStatus: VerificationStatus;
  hasRollbackPlan: boolean;
  reversible: boolean;
}): boolean {
  return (
    options.verificationStatus === 'mismatch' &&
    options.hasRollbackPlan &&
    options.reversible
  );
}

/** Only `pending` outcomes may consume new verification attempts. */
export function isVerificationRetryable(verificationStatus: VerificationStatus): boolean {
  return verificationStatus === 'pending';
}

/**
 * True when the attempt count reached the bound and a non-verified attempt
 * must become the final outcome status.
 */
export function attemptsExhausted(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}

/**
 * Given the result of a new attempt and the remaining retry budget, decide
 * the next outcome verification_status.
 *
 * - verified       -> verified (terminal success)
 * - mismatch / inconclusive / verification_failed
 *                  -> pending while retry budget remains, else final status
 */
export function nextVerificationStatus(options: {
  attemptStatus: 'verified' | 'mismatch' | 'inconclusive' | 'verification_failed';
  attemptCount: number;
  maxAttempts: number;
}): VerificationStatus {
  if (options.attemptStatus === 'verified') return 'verified';
  return attemptsExhausted(options.attemptCount, options.maxAttempts)
    ? options.attemptStatus
    : 'pending';
}

// ---------------------------------------------------------------------------
// Outcome record transition validation (shared by all stores)
// ---------------------------------------------------------------------------

const IDENTITY_FIELDS = [
  'outcome_id',
  'plan_id',
  'decision_id',
  'capability_id',
  'capability_version',
  'execution_receipt_id',
  'execution_effect_state',
  'verification_capability_id',
  'created_at',
  'correlation_id',
] as const;

const ALLOWED_STATUS_TRANSITIONS: Record<VerificationStatus, readonly VerificationStatus[]> = {
  not_required: ['not_required'],
  pending: ['pending', 'verified', 'mismatch', 'inconclusive', 'verification_failed'],
  verified: ['verified'],
  mismatch: ['mismatch'],
  inconclusive: ['inconclusive'],
  verification_failed: ['verification_failed'],
};

function recordsEqual(left: unknown, right: unknown): boolean {
  if (left === undefined && right === undefined) return true;
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/**
 * Fail-closed store transition validation:
 * - identity fields are immutable;
 * - verification attempts are append-only history (the previous attempt list
 *   must remain an exact prefix; attempts can never be deleted or rewritten);
 * - the new verification_status must be a legal transition;
 * - updated_at must be monotonic and never precede created_at.
 */
export function validateOutcomeTransition(existing: OutcomeRecord, next: OutcomeRecord): OutcomeRecord {
  const existingParsed = OutcomeRecordSchema.safeParse(existing);
  if (!existingParsed.success) {
    throw new OutcomeError('OUTCOME_TRANSITION_INVALID', 'existing outcome record failed strict validation');
  }
  const nextParsed = OutcomeRecordSchema.safeParse(next);
  if (!nextParsed.success) {
    throw new OutcomeError(
      'OUTCOME_TRANSITION_INVALID',
      `next outcome record failed strict validation: ${nextParsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const before = existingParsed.data;
  const after = nextParsed.data;

  for (const field of IDENTITY_FIELDS) {
    if (!recordsEqual(before[field], after[field])) {
      throw new OutcomeError('OUTCOME_TRANSITION_INVALID', `immutable field '${field}' changed between outcome records`);
    }
  }

  if (after.verification_attempts.length < before.verification_attempts.length) {
    throw new OutcomeError('OUTCOME_TRANSITION_INVALID', 'verification attempt history can never shrink');
  }
  for (let index = 0; index < before.verification_attempts.length; index += 1) {
    if (!recordsEqual(before.verification_attempts[index], after.verification_attempts[index])) {
      throw new OutcomeError('OUTCOME_TRANSITION_INVALID', 'existing verification attempt history was rewritten');
    }
  }

  const allowed = ALLOWED_STATUS_TRANSITIONS[before.verification_status];
  if (!allowed.includes(after.verification_status)) {
    throw new OutcomeError(
      'OUTCOME_TRANSITION_INVALID',
      `verification_status cannot transition ${before.verification_status} -> ${after.verification_status}`,
    );
  }

  if (Date.parse(after.updated_at) < Date.parse(before.updated_at)) {
    throw new OutcomeError('OUTCOME_TRANSITION_INVALID', 'updated_at must be monotonic');
  }

  if (before.expected_outcome_digest !== after.expected_outcome_digest) {
    throw new OutcomeError('OUTCOME_TRANSITION_INVALID', 'expected_outcome_digest is immutable after creation');
  }

  return after;
}

/**
 * Expectation stability check: the expectation derived today must still hash
 * to the digest captured at outcome creation, otherwise the outcome can no
 * longer be verified (OUTCOME_EXPECTATION_CHANGED). Prevents any drift
 * between what was approved/executed and what is being verified.
 */
export function assertExpectationMatchesRecord(
  record: OutcomeRecord,
  recomputedExpectationDigest: string,
): void {
  if (!record.expected_outcome_digest) {
    throw new OutcomeError('OUTCOME_EXPECTATION_CHANGED', 'outcome carries no expected_outcome_digest');
  }
  if (record.expected_outcome_digest !== recomputedExpectationDigest) {
    throw new OutcomeError('OUTCOME_EXPECTATION_CHANGED', 'recomputed expectation digest does not match the outcome record');
  }
}

/** Structural validation used before any store mutation (fail closed). */
export function parseOutcomeRecord(record: unknown): OutcomeRecord {
  const parsed = OutcomeRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_TRANSITION_INVALID',
      `outcome record is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export function assertValidOutcomeId(outcomeId: string): void {
  if (!OUTCOME_ID_PATTERN.test(outcomeId)) {
    throw new OutcomeError('OUTCOME_INPUT_INVALID', 'outcome_id is not a valid outcome identifier');
  }
}

export { VERIFICATION_STATUSES };
