/**
 * Goal24 Post-CP8 Real E2E (DRG-2 candidate) - github.issue.close evaluator.
 *
 * The ONLY trusted deterministic evaluator for the production write
 * capability github.issue.close. It derives the expectation exclusively from
 * the approved plan (normalized inputs: owner/repo/number) and the fixed
 * verification capability github.issue.read. The caller can never supply
 * expected_state / predicate / regex / JSONPath / comparison prompts; there
 * is no LLM judge.
 *
 * Verdict semantics:
 * - verified:   the trusted read-back payload carries the exact issue number
 *               with state CLOSED
 * - mismatch:   the exact issue was read back but its state is not CLOSED
 *               (stdout claims, exit codes and timestamps prove nothing)
 * - inconclusive: the payload cannot establish the post-state (missing or
 *               non-conforming fields)
 *
 * The evaluator deliberately ignores every process-metadata field of the
 * observation: exit 0 / nonzero / timeout / cancel can never push an outcome
 * toward or away from verified.
 */

import type { ExecutionPlan } from '../../execution/contracts.js';
import type { OutcomeExpectation, ReadbackObservationEnvelope } from '../contracts.js';
import type { OutcomeEvaluatorV1 } from '../evaluator.js';

export const GITHUB_ISSUE_CLOSE_EVALUATOR: OutcomeEvaluatorV1 = {
  metadata: {
    evaluator_id: 'github-issue-close-evaluator',
    capability_id: 'github.issue.close',
    verification_capability_id: 'github.issue.read',
    version: '1.0.0',
  },

  deriveExpectation(plan: ExecutionPlan): OutcomeExpectation {
    const inputs = plan.normalized_inputs as Record<string, unknown>;
    const owner = String(inputs.owner ?? '');
    const repo = String(inputs.repo ?? '');
    const number = Number(inputs.number);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error('github.issue.close inputs must carry a positive integer number');
    }
    return {
      evaluator_id: 'github-issue-close-evaluator',
      capability_id: 'github.issue.close',
      verification_capability_id: 'github.issue.read',
      subject_key: `issue:${owner}/${repo}#${number}`,
      assertions: {
        owner,
        repo,
        number,
        state: 'CLOSED',
      },
    };
  },

  evaluate(expectation: OutcomeExpectation, observation: ReadbackObservationEnvelope) {
    const payload = observation.payload as Record<string, unknown>;
    const number = payload.number;
    const state = payload.state;
    if (typeof number !== 'number' || !Number.isInteger(number) || typeof state !== 'string') {
      return { status: 'inconclusive', reason_codes: ['OUTCOME_INCONCLUSIVE'] };
    }
    const expected = expectation.assertions as Record<string, unknown>;
    if (number !== expected.number) {
      return { status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] };
    }
    // Exact canonical state comparison; case/unicode variants can never
    // alias (GitHub emits OPEN|CLOSED uppercase).
    if (state === 'CLOSED') {
      return { status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] };
    }
    return { status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] };
  },
};
