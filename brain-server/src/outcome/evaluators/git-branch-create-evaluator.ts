/**
 * Goal28 Lite - deterministic local Git branch read-back evaluator.
 *
 * The native binding only reports the observed branch target.  This evaluator
 * is the sole semantic authority: it derives the expected start point from
 * the approved plan and never trusts process exit status as proof of effect.
 */

import type { ExecutionPlan } from '../../execution/contracts.js';
import type { OutcomeExpectation, ReadbackObservationEnvelope } from '../contracts.js';
import type { OutcomeEvaluatorV1 } from '../evaluator.js';

const SHA_RE = /^[0-9a-f]{40}$/;

export const GIT_BRANCH_CREATE_EVALUATOR: OutcomeEvaluatorV1 = {
  metadata: {
    evaluator_id: 'git-branch-create-evaluator',
    capability_id: 'git.branch.create',
    verification_capability_id: 'git.branch.read',
    version: '1.0.0',
  },

  deriveExpectation(plan: ExecutionPlan): OutcomeExpectation {
    const inputs = plan.normalized_inputs as Record<string, unknown>;
    const repositoryPath = typeof inputs.repository_path === 'string' ? inputs.repository_path : '';
    const branchName = typeof inputs.branch_name === 'string' ? inputs.branch_name : '';
    const startPoint = typeof inputs.start_point === 'string' ? inputs.start_point : '';
    if (!repositoryPath || !branchName || !SHA_RE.test(startPoint)) {
      throw new Error('git.branch.create inputs must carry repository_path, branch_name and a full start_point SHA');
    }
    return {
      evaluator_id: 'git-branch-create-evaluator',
      capability_id: 'git.branch.create',
      verification_capability_id: 'git.branch.read',
      subject_key: `git:branch:${branchName}`,
      assertions: {
        repository_path: repositoryPath,
        branch_name: branchName,
        target_sha: startPoint,
      },
    };
  },

  evaluate(expectation: OutcomeExpectation, observation: ReadbackObservationEnvelope) {
    const payload = observation.payload as Record<string, unknown>;
    const targetSha = payload.target_sha;
    if (typeof targetSha !== 'string' || !SHA_RE.test(targetSha)) {
      return { status: 'inconclusive', reason_codes: ['OUTCOME_INCONCLUSIVE'] };
    }
    const expected = expectation.assertions as Record<string, unknown>;
    return targetSha === expected.target_sha
      ? { status: 'verified', reason_codes: ['OUTCOME_VERIFIED'] }
      : { status: 'mismatch', reason_codes: ['OUTCOME_MISMATCH'] };
  },
};
