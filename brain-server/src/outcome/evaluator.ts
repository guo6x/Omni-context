/**
 * Goal24 Checkpoint 8 (Lane A) - Trusted outcome evaluator contract.
 *
 * OutcomeEvaluatorV1 is trusted application code only. It derives a
 * structured expectation from the approved plan and evaluates a structured
 * read-back observation deterministically. It never uses an LLM judge, never
 * receives free-form `expected`, `predicate`, `jsonpath`, `regex`,
 * `success_condition` or `judge_prompt` strings, and can only return
 * verified / mismatch / inconclusive (verification_failed is decided by the
 * parser / read-back runtime BEFORE the evaluator runs).
 */

import { z } from 'zod';
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
} from '../capabilities/contracts.js';
import type { ExecutionPlan } from '../execution/contracts.js';
import {
  ATTEMPT_STATUSES,
  OutcomeExpectationSchema,
  type OutcomeExpectation,
  type ReadbackObservationEnvelope,
} from './contracts.js';
import { OUTCOME_REASON_CODES, OutcomeError, type OutcomeReasonCode } from './errors.js';

export const OutcomeEvaluatorV1MetadataSchema = z.strictObject({
  evaluator_id: z.string().trim().min(1).max(200),
  capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'capability_id must be provider.resource.action'),
  verification_capability_id: z.string().regex(CAPABILITY_ID_PATTERN, 'verification_capability_id must be a capability id'),
  version: z.string().regex(SEMVER_PATTERN, 'version must be semantic (major.minor.patch)'),
});
export type OutcomeEvaluatorV1Metadata = z.infer<typeof OutcomeEvaluatorV1MetadataSchema>;

export const EvaluationResultSchema = z.strictObject({
  /** Evaluators may only return these three statuses (never verification_failed). */
  status: z.enum(ATTEMPT_STATUSES.filter((status) => status !== 'verification_failed') as [
    'verified',
    'mismatch',
    'inconclusive',
  ]),
  reason_codes: z.array(z.enum(OUTCOME_REASON_CODES)).max(50),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export interface OutcomeEvaluatorV1 {
  readonly metadata: OutcomeEvaluatorV1Metadata;
  /** Derive the expected post-state from the approved plan (trusted code only). */
  deriveExpectation(plan: ExecutionPlan): OutcomeExpectation;
  /** Compare a parsed observation against the expectation (deterministic, typed). */
  evaluate(expectation: OutcomeExpectation, observation: ReadbackObservationEnvelope): EvaluationResult;
}

/**
 * Fail-closed evaluation result parser: a trusted evaluator that returns a
 * non-conforming result (unknown status, duplicate / invalid reason codes)
 * is treated as inconclusive rather than coerced into a success.
 */
export function parseEvaluationResult(result: unknown): EvaluationResult {
  const parsed = EvaluationResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_INPUT_INVALID',
      `evaluator returned a non-conforming result: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const data = parsed.data;
  const expectedCode = `OUTCOME_${data.status.toUpperCase()}` as OutcomeReasonCode;
  if (!data.reason_codes.includes(expectedCode)) {
    throw new OutcomeError(
      'OUTCOME_INPUT_INVALID',
      `evaluator status '${data.status}' requires reason code '${expectedCode}'`,
    );
  }
  return { status: data.status, reason_codes: data.reason_codes };
}

/**
 * Validate evaluator output (evaluation + expectation) fail-closed. The
 * returned expectation must bind the evaluator metadata exactly; otherwise
 * the observation can never be verified.
 */
export function validateExpectationFromEvaluator(
  evaluator: OutcomeEvaluatorV1,
  expectation: unknown,
): OutcomeExpectation {
  const parsed = OutcomeExpectationSchema.safeParse(expectation);
  if (!parsed.success) {
    throw new OutcomeError(
      'OUTCOME_INPUT_INVALID',
      `evaluator derived a non-conforming expectation: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }
  const data = parsed.data;
  if (data.evaluator_id !== evaluator.metadata.evaluator_id) {
    throw new OutcomeError('OUTCOME_EVALUATOR_NOT_FOUND', 'expectation evaluator_id does not match the trusted evaluator');
  }
  if (data.capability_id !== evaluator.metadata.capability_id) {
    throw new OutcomeError('OUTCOME_EVALUATOR_NOT_FOUND', 'expectation capability_id does not match the trusted evaluator');
  }
  if (data.verification_capability_id !== evaluator.metadata.verification_capability_id) {
    throw new OutcomeError('OUTCOME_EVALUATOR_NOT_FOUND', 'expectation verification_capability_id does not match the trusted evaluator');
  }
  return {
    evaluator_id: data.evaluator_id,
    capability_id: data.capability_id,
    verification_capability_id: data.verification_capability_id,
    subject_key: data.subject_key,
    assertions: data.assertions,
  };
}

